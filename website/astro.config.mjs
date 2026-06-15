import { defineConfig } from 'astro/config'
import mdx from '@astrojs/mdx'
import { resolve } from 'node:path'

// The site is served from the repo subpath on GitHub Pages.
// The deploy workflow sets BASE_PATH=/state-machine/; locally it's /.
const base = process.env.BASE_PATH ?? '/'

// https://astro.build/config
export default defineConfig({
  site: 'https://chimba-ui.github.io',
  base,
  integrations: [mdx()],
  vite: {
    resolve: {
      // The engine package is workspace-linked; alias straight to its `src`
      // so docs demos run the real TS source with no build step.
      alias: {
        '@chimba-ui/state-machine': resolve(import.meta.dirname, '../packages/core/src'),
      },
    },
  },
})
