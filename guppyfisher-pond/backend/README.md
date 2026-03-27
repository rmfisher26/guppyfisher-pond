# guppy-backend

FastAPI backend for the GuppyFisher playground widget.
Compiles user-supplied Guppy programs and returns structured output + HUGR IR.

## Quick start

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

API is now at http://localhost:8000  
Swagger docs at http://localhost:8000/docs

## Endpoints

| Method | Path          | Description                        |
|--------|---------------|------------------------------------|
| GET    | /health       | Liveness check                     |
| POST   | /api/compile  | Compile a Guppy program            |

### POST /api/compile

**Request**
```json
{ "code": "from guppylang import GuppyModule\n..." }
```

**Response**
```json
{
  "success": true,
  "elapsed_ms": 134,
  "hugr_json": { ... },
  "lines": [
    { "t": "info",    "text": "guppylang 0.14.0" },
    { "t": "success", "text": "Compiled successfully" },
    { "t": "hugr",    "text": "  Node(0): FuncDefn" }
  ]
}
```

Line types: `info` · `success` · `error` · `hugr` · `hint`

## Running tests

```bash
pip install pytest pytest-asyncio httpx
pytest -v
```

## Deployment (Fly.io)

```bash
fly launch          # first time — follow prompts
fly deploy          # subsequent deploys
```

Set `ALLOWED_ORIGINS` as a Fly secret:
```bash
fly secrets set ALLOWED_ORIGINS='["https://guppyfisher.dev"]'
```

## Security model

User code runs in a **forked subprocess** with:
- A stripped `__builtins__` (no `open`, `eval`, `__import__`, etc.)
- A hard wall-clock timeout (default 10 s)
- Only the guppylang public API in scope

For hardened production use, wrap the subprocess in a `bubblewrap`
seccomp sandbox — see comments in `app/services/compiler.py`.
