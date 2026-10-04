import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

// The @dunky.dev/* packages and the shared cmdk core all point `main` at their TS
// `src/index.ts` (no build step). Alias each to its source so Vite transpiles them
// directly — the whole point of the sandbox is to run the workspace source live.
const repo = resolve(import.meta.dirname, '../..')

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@dunky.dev/state-machine': resolve(repo, 'packages/core/src'),
      '@dunky.dev/vue-state-machine': resolve(repo, 'packages/vue/src'),
      '@dunky.dev/state-machine-utils': resolve(repo, 'packages/shared/utils/src'),
      '@dunky.dev/state-machine-bindings': resolve(repo, 'packages/shared/bindings/src'),
      '@dunky.dev/state-machine-dom': resolve(repo, 'packages/dom/src'),
      '@sandbox/cmdk-core': resolve(repo, 'sandbox/shared/src'),
    },
  },
})
