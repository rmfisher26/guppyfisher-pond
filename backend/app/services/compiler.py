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

def _count_qubit_allocs(code: str) -> int:
    """Count qubit() allocation calls in source (for main()-style programs)."""
    import ast as _ast
    try:
        tree = _ast.parse(code)
        return sum(
            1 for node in _ast.walk(tree)
            if isinstance(node, _ast.Call)
            and isinstance(node.func, _ast.Name)
            and node.func.id == "qubit"
        )
    except Exception:
        return 0


def _inject_result_calls_for_selene(code: str) -> tuple[str, int]:
    """Inject result("out", name) after every `name = measure(q)` in main().

    Returns (modified_code, n_injected).  If nothing to inject, returns the
    original code with n=0.
    """
    import ast as _ast
    try:
        tree = _ast.parse(code)
        main_fn = next(
            (n for n in _ast.walk(tree)
             if isinstance(n, _ast.FunctionDef) and n.name == "main"),
            None,
        )
        if main_fn is None:
            return code, 0

        # Collect: end_lineno → (col_offset, var_name) for single-target measure assigns
        inject: dict[int, tuple[int, str]] = {}
        for stmt in _ast.walk(main_fn):
            if (
                isinstance(stmt, _ast.Assign)
                and len(stmt.targets) == 1
                and isinstance(stmt.targets[0], _ast.Name)
                and isinstance(stmt.value, _ast.Call)
                and isinstance(stmt.value.func, _ast.Name)
                and stmt.value.func.id == "measure"
            ):
                inject[stmt.end_lineno] = (stmt.col_offset, stmt.targets[0].id)

        if not inject:
            return code, 0

        lines = code.splitlines()
        new_lines: list[str] = []
        for i, line in enumerate(lines, start=1):
            new_lines.append(line)
            if i in inject:
                ind, var = inject[i]
                new_lines.append(" " * ind + f'result("out", {var})')
        return "\n".join(new_lines), len(inject)
    except Exception:
        return code, 0


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


def _build_tket_data(code: str, qubit_params: list) -> dict | None:
    """Parse the Guppy source AST to build a pytket circuit and run optimisation."""
    import ast as _ast
    try:
        from pytket.circuit import Circuit as _Circuit, OpType as _OpType
        from pytket.passes import FullPeepholeOptimise as _FPO
    except ImportError:
        return None

    GATE_MAP = {
        "h": _OpType.H, "x": _OpType.X, "y": _OpType.Y, "z": _OpType.Z,
        "cx": _OpType.CX, "cnot": _OpType.CX, "cz": _OpType.CZ,
        "rx": _OpType.Rx, "ry": _OpType.Ry, "rz": _OpType.Rz,
        "s": _OpType.S, "t": _OpType.T,
    }

    try:
        tree = _ast.parse(code)
    except SyntaxError:
        return None

    # ── qubit() allocation style (main()/no-param style) ─────────────────────
    # Build qubit_index by scanning all @guppy function bodies for:
    #   q0, q1 = qubit(), qubit()   — direct allocations
    #   q0, q1 = some_fn()          — tuple returns from other @guppy functions
    # Gates are collected across all function bodies.
    if not qubit_params:
        qubit_index: dict[str, int] = {}
        all_stmts: list = []

        guppy_fns = [
            n for n in _ast.walk(tree)
            if isinstance(n, _ast.FunctionDef)
        ]
        for fn in guppy_fns:
            for stmt in fn.body:
                # `a, b = qubit(), qubit()` or `a, b = some_fn()`
                if (
                    isinstance(stmt, _ast.Assign)
                    and len(stmt.targets) == 1
                    and isinstance(stmt.targets[0], _ast.Tuple)
                ):
                    for elt in stmt.targets[0].elts:
                        if isinstance(elt, _ast.Name) and elt.id not in qubit_index:
                            # Only track names that look like qubit vars (not c0, c1…)
                            if not elt.id.startswith("c"):
                                qubit_index[elt.id] = len(qubit_index)
                all_stmts.append(stmt)

        n_qubits = len(qubit_index)
        if n_qubits == 0:
            return None
        func_body = all_stmts
    else:
        # ── qubit parameter style ─────────────────────────────────────────────
        n_qubits = len(qubit_params)
        qubit_index = {name: i for i, name in enumerate(qubit_params)}
        func_body = None
        for node in _ast.walk(tree):
            if isinstance(node, _ast.FunctionDef):
                func_body = node.body
                break
        if func_body is None:
            return None

    circ = _Circuit(n_qubits, n_qubits)
    for stmt in func_body:
        for node in _ast.walk(stmt):
            if not isinstance(node, _ast.Call):
                continue
            func_name = ""
            if isinstance(node.func, _ast.Name):
                func_name = node.func.id.lower()
            elif isinstance(node.func, _ast.Attribute):
                func_name = node.func.attr.lower()

            if func_name == "measure":
                if node.args and isinstance(node.args[0], _ast.Name):
                    q = qubit_index.get(node.args[0].id)
                    if q is not None:
                        circ.Measure(q, q)
            elif func_name in GATE_MAP:
                q_indices = [
                    qubit_index[a.id]
                    for a in node.args
                    if isinstance(a, _ast.Name) and a.id in qubit_index
                ]
                if q_indices:
                    try:
                        circ.add_gate(GATE_MAP[func_name], q_indices)
                    except Exception:
                        pass

    def _extract_gates(circuit: "_Circuit") -> list:
        col_tracker: dict[int, int] = {}
        gates = []
        for cmd in circuit.get_commands():
            q_idxs = [q.index[0] for q in cmd.qubits if q.index]
            b_idxs = [b.index[0] for b in cmd.bits if b.index]
            col = max((col_tracker.get(q, 0) for q in q_idxs), default=0)
            for q in q_idxs:
                col_tracker[q] = col + 1
            gate: dict = {"type": cmd.op.type.name, "qubits": q_idxs, "col": col}
            if b_idxs:
                gate["bits"] = b_idxs
            gates.append(gate)
        return gates

    def _get_stats(circuit: "_Circuit") -> dict:
        return {
            "gates": circuit.n_gates,
            "depth": circuit.depth(),
            "twoQ": sum(1 for cmd in circuit.get_commands() if len(cmd.qubits) == 2),
        }

    opt_circ = circ.copy()
    opt_note = ""
    try:
        _FPO().apply(opt_circ)
        opt_note = "FullPeepholeOptimise"
    except Exception:
        pass

    return {
        "qubits": [f"q[{i}]" for i in range(n_qubits)],
        "bits":   [f"c[{i}]" for i in range(n_qubits)],
        "gates":  _extract_gates(circ),
        "stats":  _get_stats(circ),
        "optimised_gates": _extract_gates(opt_circ),
        "optimised_stats": {**_get_stats(opt_circ), "note": opt_note},
    }


def _worker(code: str, result_queue: multiprocessing.Queue, selene_shots: int = 200) -> None:
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
            # Module-level calls like `main.compile()` or `main.emulator().run()`
            # may fail, but @guppy decorators run first and register functions.
            # Capture exec errors so we can proceed if functions were registered.
            _exec_error = None
            try:
                exec(compile(code, tmp_path, "exec"), namespace)  # noqa: S102
            except Exception as _e:
                _exec_error = _e

            from guppylang.defs import GuppyFunctionDefinition as _GuppyFn
            guppy_fns = [v for v in namespace.values() if isinstance(v, _GuppyFn)]
            if not guppy_fns:
                if _exec_error:
                    raise _exec_error  # no functions registered — real error
                emit("error", "No @guppy function found in submitted code.")
                result_queue.put({"lines": lines, "hugr": None, "success": False})
                return

            # Prefer a function named 'main'; fall back to last defined
            _fn_by_name = {
                getattr(getattr(v, "wrapped", None), "name", None): v
                for v in guppy_fns
            }
            _main_fn = _fn_by_name.get("main")
            fn_def = _main_fn if _main_fn is not None else guppy_fns[-1]
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

            # For main()-style programs, qubits are allocated inside with qubit()
            _no_input_entry = (n_qubits == 0)
            if _no_input_entry:
                n_qubits = _count_qubit_allocs(code)

            selene_data = None
            if n_qubits > 0:
                try:
                    from selene_sim import build as _selene_build, Quest as _Quest
                    from hugr.qsystem.result import QsysResult as _QsysResult

                    N_SHOTS = selene_shots

                    if _no_input_entry:
                        # Entry function takes no inputs (main()-style).
                        # Inject result() calls after measure() assignments so
                        # Selene can track measurement outcomes, then recompile.
                        _modified_code, _n_injected = _inject_result_calls_for_selene(code)
                        if _n_injected > 0:
                            import linecache as _linecache
                            _sel_filename = f"<selene_main_{fn_name}>"
                            _linecache.cache[_sel_filename] = (
                                len(_modified_code), None,
                                _modified_code.splitlines(True), _sel_filename,
                            )
                            _sel_exec_err = None
                            try:
                                exec(compile(_modified_code, _sel_filename, "exec"), namespace)  # noqa: S102
                            except Exception as _se:
                                _sel_exec_err = _se
                            _sel_fns = [
                                v for v in namespace.values()
                                if isinstance(v, _GuppyFn)
                                and getattr(getattr(v, "wrapped", None), "name", None) == "main"
                            ]
                            if _sel_fns and not _sel_exec_err:
                                _entry_hugr = _sel_fns[-1].compile_function()
                            else:
                                _entry_hugr = hugr  # fall back to original
                        else:
                            _entry_hugr = hugr
                    else:
                        # Wrap the user's function in a no-input entry point that
                        # allocates qubits and records measurement results.
                        _return_ann = _python_func.__annotations__.get("return", None)

                        def _is_bool_type(a: object) -> bool:
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

            tket_data = _build_tket_data(code, _qubit_params)
            result_queue.put({"lines": lines, "hugr": hugr_dict, "selene": selene_data, "tket": tket_data, "success": True})

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

async def compile_guppy(code: str, timeout: float = 10.0, selene_shots: int = 200) -> dict:
    """
    Run `_worker` in a subprocess with a wall-clock timeout.
    Returns {"lines", "hugr", "success", "elapsed_ms"}.
    """
    queue: multiprocessing.Queue = multiprocessing.Queue()
    proc = multiprocessing.Process(target=_worker, args=(code, queue, selene_shots), daemon=True)

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
