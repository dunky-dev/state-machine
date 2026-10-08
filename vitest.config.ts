import { defineConfig } from 'vitest/config'

// The Solid and Svelte tests need their compiler plugins (vite-plugin-solid's
// JSX transform must not rewrite the React `.tsx` tests), so each runs as its
// own project, living with its package so the root carries no framework
// dependencies.
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
      './packages/svelte/vitest.config.ts',
    ],
  },
})
