import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { defineConfig } from 'vitest/config'

// Two projects. The default one keeps the original plain-node setup for every
// package (the react tests opt into jsdom per-file via `// @vitest-environment
// jsdom`, which needs no plugin since esbuild handles JSX). The `svelte` project
// is scoped to packages/svelte and brings the Svelte compiler (so `.svelte` test
// components and `.svelte.ts` runes modules are transformed) plus jsdom, which
// `@testing-library/svelte` renders into.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'default',
          globals: false,
          environment: 'node',
          include: ['**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', '**/dist/**', 'packages/svelte/**'],
        },
      },
      {
        // `svelteTesting()` compiles the testing-library helpers themselves
        // (their own `.svelte.js`) and resolves Svelte's browser/client build so
        // runes run under jsdom — without it `$state` throws `rune_outside_svelte`.
        // It also wires automatic cleanup between tests.
        plugins: [svelte(), svelteTesting()],
        test: {
          name: 'svelte',
          globals: false,
          environment: 'jsdom',
          include: ['packages/svelte/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
        },
      },
    ],
  },
})
