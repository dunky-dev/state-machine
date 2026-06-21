import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  // On GitHub Pages the site is served from /state-machine/; locally it's /.
  // The deploy workflow sets BASE_PATH=/state-machine/ for the Pages build.
  base: process.env.BASE_PATH ?? '/',
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
