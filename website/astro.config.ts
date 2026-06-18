import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import mdx from '@astrojs/mdx'
import { resolve } from 'node:path'

// The site is served under the /state-machine/ path on dunky.dev
// (dunky.dev/ redirects there; see vercel.json). BASE_PATH can override
// it (e.g. '/' for an isolated local preview).
const base = process.env.BASE_PATH ?? '/state-machine/'

// https://astro.build/config
export default defineConfig({
  site: 'https://dunky-dev.github.io',
  base,
  integrations: [
    starlight({
      title: 'Dunky',
      favicon: '/logo-symbol.svg',
      logo: {
        light: './public/logo.svg',
        dark: './public/logo-white.png',
        replacesTitle: true,
      },
      customCss: ['./src/styles/starlight.css'],
      components: {
        // Wrap Starlight's default Head to mount Vercel Analytics on doc pages.
        Head: './src/components/head.astro',
      },
      sidebar: [
        {
          label: 'Guides',
          items: [
            { label: 'Get started', link: 'get-started' },
            { label: 'Install', link: 'install' },
            { label: 'Comparison', link: 'comparison' },
            { label: 'Benchmark', link: 'benchmark' },
          ],
        },
        {
          label: 'Core',
          items: [
            { label: 'Setup', link: 'api/setup' },
            { label: 'Context', link: 'api/context' },
            { label: 'States & Transitions', link: 'api/states' },
            { label: 'Guards', link: 'api/guards' },
            { label: 'Actions', link: 'api/actions' },
            { label: 'Effects', link: 'api/effects' },
            { label: 'Computed', link: 'api/computed' },
            { label: 'Timers', link: 'api/timers' },
            { label: 'Watch', link: 'api/watch' },
            { label: 'Subscriptions', link: 'api/subscriptions' },
          ],
        },
        {
          label: 'View layer',
          items: [
            { label: 'Connector', link: 'api/connector' },
            { label: 'Reactions', link: 'api/reactions' },
          ],
        },
        {
          label: 'Composition',
          items: [
            { label: 'Peer machines', link: 'api/compose' },
            { label: 'Store', link: 'api/create-store' },
            { label: 'Shared states', link: 'api/flat-states' },
          ],
        },
        {
          label: 'Integrations',
          items: [
            { label: 'React', link: 'libs/react' },
            { label: 'React Native', link: 'libs/react-native' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'API overview', link: 'api' },
            { label: 'Cheatsheet', link: 'cheatsheet' },
          ],
        },
      ],
    }),
    mdx(),
  ],
  vite: {
    resolve: {
      // The engine package is workspace-linked; alias straight to its `src`
      // so docs demos run the real TS source with no build step.
      alias: {
        '@dunky-dev/state-machine': resolve(import.meta.dirname, '../packages/core/src'),
      },
    },
  },
})
