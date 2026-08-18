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
          exclude: ['**/node_modules/**', '**/dist/**', 'packages/solid/**'],
        },
      },
      './packages/solid/vitest.config.ts',
    ],
  },
})
