import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { defineConfig } from 'vitest/config'

// Two projects: the Solid tests need vite-plugin-solid's JSX transform, which
// must not rewrite the React `.tsx` tests. The solid project lives with its
// package so the root carries no Solid dependencies.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'default',
          globals: false,
          environment: 'node',
          include: ['packages/**/tests/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', '**/dist/**', 'packages/solid/**', 'packages/svelte/**'],
        },
      },
      './packages/solid/vitest.config.ts',
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
