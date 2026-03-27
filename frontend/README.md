# guppyfisher-visualizer

The **Pipeline Visualizer** for [guppyfisher.dev](https://guppyfisher.dev) — an
interactive Astro + React app that traces a Guppy quantum program through the
full Quantinuum stack:

```
Guppy source  →  HUGR IR  →  TKET circuit  →  Selene emulation
```

## Quick start

```bash
# Install dependencies
npm install

# Start dev server (http://localhost:4321)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Project structure

```
src/
├── components/
│   ├── GuppyPanel.astro         # Static syntax-highlighted source (no JS)
│   ├── HUGRPanel.tsx            # Interactive HUGR graph + JSON view (React)
│   ├── TKETPanel.tsx            # Gate-level circuit diagram (React)
│   ├── SelenePanel.tsx          # State evolution + shot results (React)
│   └── PipelineController.tsx   # Root React island — orchestrates all panels
├── data/
│   └── programs.ts              # All program data (Guppy, HUGR, TKET, Selene)
├── layouts/
│   └── BaseLayout.astro         # Site nav + HTML shell
├── pages/
│   └── index.astro              # Main page
├── styles/
│   └── global.css               # Design tokens + shared syntax tokens
└── utils/
    └── highlight.ts             # Regex highlighters for Guppy + HUGR JSON
public/
└── favicon.svg
```

## Architecture decisions

### Islands architecture
The **Guppy source panel** is a pure Astro component (`GuppyPanel.astro`) — it
renders syntax-highlighted code at build time with zero client JS. The remaining
three panels (HUGR, TKET, Selene) are React components inside a single
`PipelineController` island, hydrated with `client:load`.

This means:
- First paint is fast — Guppy source visible immediately, no layout shift
- Interactive panels (graph hover, optimisation toggle, simulation) load after
- Adding a new program only requires editing `src/data/programs.ts`

### Data separation
All program definitions live in `src/data/programs.ts`. This is intentional:

- Programs can be added without touching any component
- The same data can be fetched from an API in the future (swap the import)
- TypeScript interfaces enforce the shape at build time

### Syntax highlighting
`src/utils/highlight.ts` runs regex-based highlighting with zero dependencies.
It works in both Astro (Node/SSR) and React (browser), so `GuppyPanel.astro`
can call it at build time and `HUGRPanel.tsx` can call it client-side.

## Adding a new program

Edit `src/data/programs.ts` and add a new entry to the `PROGRAMS` object:

```ts
export const PROGRAMS: Record<string, Program> = {
  // existing...

  myCircuit: {
    name: 'My Circuit',
    description: 'What it does',
    guppy: `...source code...`,
    hugr: {
      nodes: [...],
      edges: [...],
      json: `{...}`,
    },
    tket: {
      qubits: ['q[0]'],
      bits:   ['c[0]'],
      gates: [...],
      stats: { gates: N, depth: N, twoQ: N },
      optimised: { gates: [...], stats: {...} },
    },
    selene: {
      shots: 200,
      simulator: 'Stim',
      results: [...],
      timeline: [...],
    },
  },
};
```

The program tab appears automatically in the UI.

## Wiring up the real backend

When the FastAPI backend (`guppy-backend/`) is running, replace the mock data
in `programs.ts` with a fetch call:

```ts
// In PipelineController.tsx, replace static import with:
const [prog, setProg] = useState<Program | null>(null);

useEffect(() => {
  fetch('/api/compile', {
    method: 'POST',
    body: JSON.stringify({ code: guppySource }),
  })
    .then(r => r.json())
    .then(setProg);
}, [guppySource]);
```

The FastAPI backend returns HUGR JSON which maps directly to the `hugr.json`
field in the Program type.

## Deployment

### GitHub Pages (static)
```bash
npm run build
# Deploy dist/ to gh-pages branch
```

Update `astro.config.mjs`:
```js
export default defineConfig({
  site: 'https://guppyfisher.dev',
  base: '/',        // or '/visualizer/' if hosting at a subpath
  output: 'static',
});
```

### Fly.io / Railway (with SSR + API)
```js
// astro.config.mjs
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
});
```

Then add API routes in `src/pages/api/compile.ts` to proxy to the FastAPI backend.
