import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { defineConfig } from 'vitest/config'

// Referenced as a project from the root vitest.config.ts; lives here so the
// root workspace carries no Svelte dependencies.
export default defineConfig({
  // svelteTesting(): Svelte's client build under jsdom + cleanup between tests.
  plugins: [svelte(), svelteTesting()],
  test: {
    name: 'svelte',
    globals: false,
    // node by default; DOM tests opt into jsdom per-file via `@vitest-environment`.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
