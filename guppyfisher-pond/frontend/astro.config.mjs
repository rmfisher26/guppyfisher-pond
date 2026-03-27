import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  integrations: [react()],

  // Site config — update with your actual domain
  site: 'https://guppyfisher.dev',
  base: '/',

  // Output: static site (default) — swap to 'server' if you
  // add the FastAPI backend proxy route
  output: 'static',

  // Vite config for dev experience
  vite: {
    define: {
      // Expose env vars to client if needed
    },
  },
});
