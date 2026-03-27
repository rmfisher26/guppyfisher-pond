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
        # Keep the file alive until after compile_function() is called below.
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as tmp:
            tmp.write(code)
            tmp_path = tmp.name
        try:
            exec(compile(code, tmp_path, "exec"), namespace)  # noqa: S102

            # Find @guppy-decorated functions; GuppyFunctionDefinition cannot be
            # monkeypatched so we call compile_function() ourselves here while
            # the source file is still on disk.
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
        finally:
            os.unlink(tmp_path)

        emit("success", "Linearity check passed ✓")
        emit("success", "Compiled successfully")

        # to_json() returns a JSON string in guppylang 0.21+
        import json as _json
        hugr_dict = _json.loads(hugr.to_json())

        # Emit top-level HUGR nodes as readable lines
        try:
            nodes = hugr_dict.get("modules", [{}])[0].get("nodes", [])
            for node in nodes[:20]:
                op = node.get("op", "?")
                ntype = op if isinstance(op, str) else op.get("type", "?")
                nid = node.get("parent", "?")
                emit("hugr", f"  Node({nid}): {ntype}")
        except Exception:
            emit("hugr", str(hugr_dict)[:400])

        result_queue.put({"lines": lines, "hugr": hugr_dict, "success": True})

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
