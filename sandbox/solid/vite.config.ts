import { resolve } from 'node:path'
import solid from 'vite-plugin-solid'
import { defineConfig } from 'vite'

// The @dunky.dev/* packages and the shared cmdk core all point `main` at their TS
// `src/index.ts` (no build step). Alias each to its source so Vite transpiles them
// directly — the whole point of the sandbox is to run the workspace source live.
export default defineConfig({
  plugins: [solid()],
  resolve: {
    // The package alias points Vite inside packages/solid, which carries its own
    // solid-js devDep — dedupe so the app and the package share ONE Solid runtime
    // (two copies means silently dead reactivity on any version skew).
    dedupe: ['solid-js'],
    alias: {
      '@dunky.dev/state-machine': resolve(__dirname, '../../packages/core/src'),
      '@dunky.dev/solid-state-machine': resolve(__dirname, '../../packages/solid/src'),
      '@dunky.dev/state-machine-utils': resolve(__dirname, '../../packages/shared/utils/src'),
      '@dunky.dev/state-machine-bindings': resolve(__dirname, '../../packages/shared/bindings/src'),
      '@sandbox/cmdk-core': resolve(__dirname, '../shared/src'),
    },
  },
})
