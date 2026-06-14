import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// The engine packages are workspace-linked; aliasing straight to their `src`
// means Vite serves the real TS sources (no build step, edits hot-reload).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@chimba-ui/state-machine': resolve(__dirname, '../../packages/core/src'),
      '@chimba-ui/react-state-machine': resolve(__dirname, '../../packages/react/src'),
      '@chimba-ui/shared-state-machine': resolve(__dirname, '../../packages/shared/utils/src'),
    },
    dedupe: ['react', 'react-dom'],
  },
})
