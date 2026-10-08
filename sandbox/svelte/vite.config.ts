import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// The @dunky.dev/* packages and the shared cmdk core all point at their TS
// `src/index.ts` (no build step). Alias each to its source so Vite transpiles them
// directly — the whole point of the sandbox is to run the workspace source live.
// The svelte() plugin compiles the binding's `.svelte.ts` runes modules here,
// the way a consumer's build compiles the published `.svelte.js` ones.
export default defineConfig({
  plugins: [svelte({ configFile: false })],
  resolve: {
    // One Svelte runtime for app + aliased packages — two copies means silently
    // dead reactivity.
    dedupe: ['svelte'],
    alias: {
      '@dunky.dev/state-machine': resolve(import.meta.dirname, '../../packages/core/src'),
      '@dunky.dev/svelte-state-machine': resolve(import.meta.dirname, '../../packages/svelte/src'),
      '@dunky.dev/state-machine-utils': resolve(
        import.meta.dirname,
        '../../packages/shared/utils/src',
      ),
      '@dunky.dev/state-machine-bindings': resolve(
        import.meta.dirname,
        '../../packages/shared/bindings/src',
      ),
      '@dunky.dev/state-machine-dom': resolve(import.meta.dirname, '../../packages/dom/src'),
      '@sandbox/cmdk-core': resolve(import.meta.dirname, '../shared/src'),
    },
  },
})
