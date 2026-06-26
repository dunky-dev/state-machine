import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// The @dunky.dev/* packages and the shared cmdk core all point `main` at their TS
// `src/index.ts` (no build step). Alias each to its source so Vite transpiles them
// directly — the whole point of the sandbox is to run the workspace source live.
//
// The svelte binding alias points at its `src` too: that source includes the
// `.svelte.ts` runes modules (useMachine/useSelector), which the svelte() plugin
// compiles here — exactly how a consumer's Svelte build processes the package.
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      '@dunky.dev/state-machine': resolve(__dirname, '../../packages/core/src'),
      '@dunky.dev/state-machine-svelte': resolve(__dirname, '../../packages/svelte/src'),
      '@dunky.dev/state-machine-bindings': resolve(__dirname, '../../packages/shared/bindings/src'),
      '@sandbox/cmdk-core': resolve(__dirname, '../shared/src'),
    },
  },
})
