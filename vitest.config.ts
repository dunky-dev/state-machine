import solid from 'vite-plugin-solid'
import { defineConfig } from 'vitest/config'

// Two projects so the Solid tests get their JSX transform without touching the
// rest of the suite. The default project runs every package the way it always
// has (node, or jsdom via a per-file `@vitest-environment` comment) and EXCLUDES
// the Solid tests; the `solid` project owns `packages/solid/tests` with
// vite-plugin-solid (Solid JSX → reactive runtime) and the `solid-js` dev/browser
// conditions @solidjs/testing-library needs. Keeping the Solid plugin on its own
// project is what stops it from rewriting the React `.tsx` tests.
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
      {
        plugins: [solid()],
        resolve: {
          // @solidjs/testing-library + the reactive runtime expect Solid's
          // dev/browser build conditions.
          conditions: ['development', 'browser'],
        },
        test: {
          name: 'solid',
          globals: false,
          // node by default; the DOM tests opt into jsdom per-file via a
          // `@vitest-environment jsdom` comment (same convention as the React
          // package), which also lets knip trace the jsdom devDependency.
          environment: 'node',
          include: ['packages/solid/tests/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
})
