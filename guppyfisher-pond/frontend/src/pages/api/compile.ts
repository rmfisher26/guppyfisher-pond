// src/pages/api/compile.ts
// Proxy route: forwards Guppy compile requests to the FastAPI backend.
// Only active when output: 'server' in astro.config.mjs (SSR mode).
//
// Usage: POST /api/compile  { code: string }
// Forwards to: BACKEND_URL/api/compile
//
// In static mode (GitHub Pages), this file is ignored and the frontend
// falls back to mock data. Switch astro.config.mjs output to 'server'
// and deploy to Fly.io/Railway to enable real compilation.

import type { APIRoute } from 'astro';

const BACKEND_URL = import.meta.env.BACKEND_URL ?? 'http://localhost:8000';
const MAX_CODE_LEN = 4000;

export const POST: APIRoute = async ({ request }) => {
  // Parse request body
  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.code || typeof body.code !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing code field' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (body.code.length > MAX_CODE_LEN) {
    return new Response(
      JSON.stringify({ error: `Code exceeds ${MAX_CODE_LEN} character limit` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Forward to FastAPI backend
  try {
    const upstream = await fetch(`${BACKEND_URL}/api/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: body.code }),
      signal: AbortSignal.timeout(15_000), // 15s timeout
    });

    const data = await upstream.json();

    return new Response(JSON.stringify(data), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backend unavailable';
    return new Response(
      JSON.stringify({
        success: false,
        error: message,
        lines: [
          { t: 'error', text: `Backend unreachable: ${message}` },
          { t: 'hint',  text: 'Is the FastAPI server running? See README for setup.' },
        ],
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

// Block GET requests to this route
export const GET: APIRoute = () =>
  new Response('Method not allowed', { status: 405 });
