import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // the engine package is workspace-linked; aliasing straight to its `src`
    // means Vite serves the real TS source (no build step, edits hot-reload)
    alias: {
      '@chimba-ui/state-machine': resolve(__dirname, '../../packages/core/src'),
    },
    dedupe: ['react', 'react-dom'],
  },
})
