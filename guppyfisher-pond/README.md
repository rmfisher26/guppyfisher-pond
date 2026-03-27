# guppyfisher

Full-stack Guppy Pipeline Visualizer for [guppyfisher.dev](https://guppyfisher.dev).

```
guppyfisher/
├── frontend/   Astro + React app  — the Pipeline Visualizer UI
└── backend/    FastAPI server     — sandboxed Guppy compiler
```

## Quick start

### 1. Backend (FastAPI)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
# → http://localhost:8000
# → http://localhost:8000/docs  (Swagger UI)
```

### 2. Frontend (Astro)

```bash
cd frontend
npm install
cp .env.example .env        # set BACKEND_URL=http://localhost:8000
npm run dev
# → http://localhost:4321
```

Open http://localhost:4321 — the Pipeline Visualizer runs in mock mode by default.
To enable real Guppy compilation, make sure the backend is running and set
`PUBLIC_LIVE_BACKEND=true` in `frontend/.env`.

## How they connect

```
Browser  →  POST /api/compile  →  Astro proxy  →  FastAPI  →  guppylang
                                  (frontend/src/pages/api/compile.ts)
                                  only active in SSR mode — see frontend/README.md
```

In **static mode** (default, GitHub Pages), the frontend uses mock pipeline data.
Switch `output: 'server'` in `frontend/astro.config.mjs` and deploy to Fly.io
or Railway to enable live compilation via the backend proxy.

## Deployment

| Target         | Config                          | Notes                          |
|----------------|---------------------------------|--------------------------------|
| GitHub Pages   | `output: 'static'` (default)    | Mock data only, no backend     |
| Fly.io/Railway | `output: 'server'`              | Full stack, real compilation   |
| Docker Compose | see below                       | Local full-stack development   |

### Docker Compose (full stack locally)

```bash
# From repo root:
docker compose up
# Frontend: http://localhost:4321
# Backend:  http://localhost:8000
```

A `docker-compose.yml` is included in the root for convenience.

## Adding a new program

Edit `frontend/src/data/programs.ts` and add an entry to `PROGRAMS`. The new
program tab appears automatically — no component changes needed.
