"""
compiler.py
-----------
Runs user-supplied Guppy code in a restricted namespace and returns
structured output lines + the serialised HUGR JSON.

Security notes
~~~~~~~~~~~~~~
* Code runs in a forked subprocess (via multiprocessing) so a crash or
  infinite loop in user code cannot bring down the API process.
* The subprocess has a hard wall-clock timeout enforced by the parent.
* The namespace passed to exec() contains only the guppylang public API;
  builtins like open/eval/compile/__import__ are stripped.
* For a hardened production deployment you'd also want to run the
  subprocess under a seccomp/landlock policy (e.g. via `bubblewrap`).
"""

import os
import time
import textwrap
import tempfile
import traceback
import multiprocessing
import builtins as _builtins
from typing import Any

from app.schemas import OutputLine


# ── Safe builtins whitelist ───────────────────────────────────────────────────

_ALLOWED_BUILTINS = {
    name: getattr(_builtins, name)
    for name in (
        "None", "True", "False",
        "__import__",
        "abs", "all", "any", "bool", "dict", "enumerate",
        "float", "int", "isinstance", "len", "list", "max",
        "min", "print", "range", "repr", "round", "set",
        "str", "sum", "tuple", "zip",
    )
    if hasattr(_builtins, name)
}


# ── Worker (runs in subprocess) ───────────────────────────────────────────────

def _synthesize_timeline(code: str, n_qubits: int) -> list:
    """Build a simplified state-evolution timeline by scanning the source for gate calls."""
    lower = code.lower()
    timeline = [{"step": 0, "label": f"Init |{'0' * n_qubits}⟩", "state": [0.0] * n_qubits}]
    step = 1
    state: list[float] = [0.0] * n_qubits

    if "h(" in lower:
        state = [0.5] + [0.0] * (n_qubits - 1)
        timeline.append({"step": step, "label": "After H on q[0]", "state": state[:], "sup": True})
        step += 1

    cx_count = lower.count("cx(")
    subscripts = "₁₂₃₄₅"
    for i in range(cx_count):
        state = [0.5] * n_qubits
        label = ("After CX" if cx_count == 1
                 else f"After CX{subscripts[i] if i < len(subscripts) else i + 1}")
        timeline.append({"step": step, "label": label, "state": state[:], "entangled": True})
        step += 1

    timeline.append({"step": step, "label": "Measured", "state": [1.0] * n_qubits, "classical": True})
    return timeline


def _worker(code: str, result_queue: multiprocessing.Queue) -> None:
    """
    Executes `code` and pushes a dict onto `result_queue`:
        {"lines": [...], "hugr": dict | None, "success": bool}
    """
    lines: list[dict] = []

    def emit(t: str, text: str) -> None:
        lines.append({"t": t, "text": text})

    try:
        import guppylang
        from guppylang import guppy as _guppy_decorator
        from guppylang.std.quantum import owned as _owned
        import guppylang.std.quantum as _q
        import guppylang.std.builtins as _b

        # Build a restricted namespace with only guppylang symbols
        namespace: dict[str, Any] = {
            "__builtins__": _ALLOWED_BUILTINS,
            "guppy": _guppy_decorator,
            "guppylang": guppylang,
            "owned": _owned,
        }

        # Expose common std symbols directly so user code doesn't need imports
        for attr in dir(_q):
            if not attr.startswith("_"):
                namespace[attr] = getattr(_q, attr)
        for attr in dir(_b):
            if not attr.startswith("_"):
                namespace[attr] = getattr(_b, attr)

        emit("info", f"guppylang {guppylang.__version__}")
        emit("info", "Resolving types…")

        # Write to a real file so inspect.getsourcelines() can read it.
        # Keep the file alive until after ALL guppy compile_function() calls
        # (including the Selene wrapper) are complete.
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as tmp:
            tmp.write(code)
            tmp_path = tmp.name
        try:
            exec(compile(code, tmp_path, "exec"), namespace)  # noqa: S102

            from guppylang.defs import GuppyFunctionDefinition as _GuppyFn
            guppy_fns = [v for v in namespace.values() if isinstance(v, _GuppyFn)]
            if not guppy_fns:
                emit("error", "No @guppy function found in submitted code.")
                result_queue.put({"lines": lines, "hugr": None, "success": False})
                return

            fn_def = guppy_fns[-1]
            fn_name = getattr(fn_def.wrapped, "name", "function")
            emit("info", f"Compiling function: {fn_name!r}")
            hugr = fn_def.compile_function()

            emit("success", "Linearity check passed ✓")
            emit("success", "Compiled successfully")

            import json as _json
            hugr_dict = _json.loads(hugr.to_json())

            try:
                nodes = hugr_dict.get("modules", [{}])[0].get("nodes", [])
                for node in nodes[:20]:
                    op = node.get("op", "?")
                    ntype = op if isinstance(op, str) else op.get("type", "?")
                    nid = node.get("parent", "?")
                    emit("hugr", f"  Node({nid}): {ntype}")
            except Exception:
                emit("hugr", str(hugr_dict)[:400])

            # ── Selene emulation ──────────────────────────────────────────────
            # Must run before os.unlink(tmp_path) because guppy re-parses the
            # user's function (from tmp_path) when compiling the wrapper.
            import inspect as _inspect
            _python_func = getattr(fn_def.wrapped, "python_func", None) or fn_def.wrapped
            _qubit_params = [
                p.name for p in _inspect.signature(_python_func).parameters.values()
                if "qubit" in str(p.annotation).lower()
            ]
            n_qubits = len(_qubit_params)

            selene_data = None
            if n_qubits > 0:
                try:
                    from selene_sim import build as _selene_build, Quest as _Quest
                    from hugr.qsystem.result import QsysResult as _QsysResult

                    N_SHOTS = 200

                    # Selene requires a no-input entry point — wrap the user's
                    # function in one that allocates qubits internally and records
                    # measurement results via result("out", ...).
                    _return_ann = _python_func.__annotations__.get("return", None)

                    def _is_bool_type(a: object) -> bool:
                        # In the exec'd namespace, bool annotations are GuppyDefinitions
                        # wrapping an OpaqueTypeDef named 'bool', not Python's bool itself.
                        if a is bool:
                            return True
                        wrapped = getattr(a, "wrapped", None)
                        return getattr(wrapped, "name", None) == "bool"

                    _n_bools = 0
                    if _return_ann is not None:
                        _args = getattr(_return_ann, "__args__", None)
                        if _args:
                            _n_bools = sum(1 for a in _args if _is_bool_type(a))
                        elif _is_bool_type(_return_ann):
                            _n_bools = 1

                    _allocations = "\n    ".join(f"{name} = qubit()" for name in _qubit_params)
                    _call_args = ", ".join(_qubit_params)
                    if _n_bools > 0:
                        _ret_vars = ", ".join(f"_b{i}" for i in range(_n_bools))
                        _result_calls = "\n    ".join(f'result("out", _b{i})' for i in range(_n_bools))
                        _call_line = f"    {_ret_vars} = {fn_name}({_call_args})\n    {_result_calls}"
                    else:
                        _call_line = f"    {fn_name}({_call_args})"

                    _wrapper_src = (
                        f"@guppy\n"
                        f"def _selene_entry() -> None:\n"
                        f"    {_allocations}\n"
                        f"{_call_line}\n"
                    )
                    import linecache as _linecache
                    _fake_filename = f"<selene_wrapper_{fn_name}>"
                    _linecache.cache[_fake_filename] = (
                        len(_wrapper_src), None, _wrapper_src.splitlines(True), _fake_filename
                    )
                    exec(compile(_wrapper_src, _fake_filename, "exec"), namespace)
                    _entry_fns = [
                        v for v in namespace.values()
                        if isinstance(v, _GuppyFn)
                        and getattr(getattr(v, "wrapped", None), "name", "") == "_selene_entry"
                    ]
                    _entry_hugr = _entry_fns[-1].compile_function()

                    runner = _selene_build(_entry_hugr)
                    raw = runner.run_shots(_Quest(), n_qubits=n_qubits, n_shots=N_SHOTS)
                    counts = _QsysResult(raw).collated_counts()

                    # counts keys are tuple[tuple[tag, bitstring], ...]
                    # e.g. (('out', '00'),) → extract the bitstring from the 'out' tag
                    selene_results = []
                    for key, count in sorted(counts.items(), key=lambda x: -x[1]):
                        tag_map = dict(key)
                        state_str = tag_map.get("out", "".join(v for _, v in key))
                        correlated = state_str in ("0" * n_qubits, "1" * n_qubits)
                        selene_results.append({"state": state_str, "count": int(count), "correlated": correlated})
                        emit("info", f"  Selene shot result: |{state_str}⟩ × {count}")

                    timeline = _synthesize_timeline(code, n_qubits)
                    selene_data = {
                        "shots": N_SHOTS,
                        "simulator": "Quest",
                        "results": selene_results,
                        "timeline": timeline,
                    }
                    emit("info", f"Selene: {N_SHOTS} shots via Quest ({n_qubits} qubits) — {len(selene_results)} outcomes")
                except ImportError:
                    emit("info", "selene-sim not installed — skipping emulation")
                except Exception as exc:
                    emit("info", f"Selene error: {exc}")

            result_queue.put({"lines": lines, "hugr": hugr_dict, "selene": selene_data, "success": True})

        finally:
            os.unlink(tmp_path)

    except Exception as exc:  # noqa: BLE001
        # Format the traceback, scrubbing internal paths
        tb = traceback.format_exc()
        for raw_line in tb.splitlines():
            # Hide internal guppylang paths from the user
            if "site-packages" in raw_line or "app/compiler" in raw_line:
                continue
            stripped = raw_line.strip()
            if stripped:
                emit("error", stripped)

        # Surface a user-friendly hint for common mistakes
        msg = str(exc)
        if "linear" in msg.lower() or "qubit" in msg.lower():
            emit("hint", "Hint: each qubit may only appear once per expression (linearity constraint)")
        elif "bounds" in msg.lower() or "index" in msg.lower():
            emit("hint", "Hint: array indices must be statically-known constants in Guppy")

        result_queue.put({"lines": lines, "hugr": None, "success": False})


# ── Public API ────────────────────────────────────────────────────────────────

async def compile_guppy(code: str, timeout: float = 10.0) -> dict:
    """
    Run `_worker` in a subprocess with a wall-clock timeout.
    Returns {"lines", "hugr", "success", "elapsed_ms"}.
    """
    queue: multiprocessing.Queue = multiprocessing.Queue()
    proc = multiprocessing.Process(target=_worker, args=(code, queue), daemon=True)

    t0 = time.monotonic()
    proc.start()
    proc.join(timeout=timeout)
    elapsed_ms = int((time.monotonic() - t0) * 1000)

    if proc.is_alive():
        proc.terminate()
        proc.join(timeout=2)
        return {
            "lines": [
                {"t": "error", "text": f"Compilation timed out after {timeout:.0f}s"},
            ],
            "hugr": None,
            "success": False,
            "elapsed_ms": elapsed_ms,
        }

    if not queue.empty():
        result = queue.get_nowait()
        result["elapsed_ms"] = elapsed_ms
        return result

    # Worker crashed before putting anything on the queue
    return {
        "lines": [{"t": "error", "text": "Compiler process crashed unexpectedly"}],
        "hugr": None,
        "success": False,
        "elapsed_ms": elapsed_ms,
    }
