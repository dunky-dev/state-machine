import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  // Locally served from /; in prod the demo is mounted under the docs site at
  // dunky.dev/state-machine/benchmark/demo, so BASE_PATH is set to that path
  // (see website/package.json build and .github/workflows/deploy-benchmark.yml).
  base: process.env.BASE_PATH ?? '/',
  // The website build (Vercel) redirects the output into the Astro dist so the
  // demo ships as same-origin static files; OUT_DIR carries that target.
  build: process.env.OUT_DIR ? { outDir: process.env.OUT_DIR, emptyOutDir: true } : undefined,
  plugins: [react()],
  resolve: {
    // the engine package is workspace-linked; aliasing straight to its `src`
    // means Vite serves the real TS source (no build step, edits hot-reload)
    alias: {
      '@dunky.dev/state-machine': resolve(__dirname, '../../packages/core/src'),
    },
    dedupe: ['react', 'react-dom'],
  },
})
