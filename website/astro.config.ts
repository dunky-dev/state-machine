import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import mdx from '@astrojs/mdx'
import { resolve } from 'node:path'

// The site is served under the /state-machine/ path on dunky.dev
// (dunky.dev/ redirects there; see vercel.json). BASE_PATH can override
// it (e.g. '/' for an isolated local preview).
const base = process.env.BASE_PATH ?? '/state-machine/'

// Astro does NOT prepend `base` to root-absolute markdown links (`[x](/api/y)`),
// so they 404 under a non-root base. This rehype plugin rewrites internal
// root-absolute hrefs to include the base. External links and already-based
// links are left alone. The sidebar is already base-aware (Starlight handles it).
// Dependency-free hast walk (avoids relying on a transitive unist-util-visit).
const basePrefix = base.replace(/\/$/, '')
function rehypeBaseLinks() {
  type Node = {
    type?: string
    tagName?: string
    properties?: { href?: unknown }
    children?: Node[]
  }
  const walk = (node: Node) => {
    if (node.tagName === 'a') {
      const href = node.properties?.href
      if (
        typeof href === 'string' &&
        href.startsWith('/') &&
        !href.startsWith('//') &&
        !(basePrefix && (href === basePrefix || href.startsWith(`${basePrefix}/`)))
      ) {
        node.properties!.href = `${basePrefix}${href}`
      }
    }
    if (node.children) for (const child of node.children) walk(child)
  }
  return (tree: Node) => walk(tree)
}

// https://astro.build/config
export default defineConfig({
  site: 'https://dunky-dev.github.io',
  base,
  // Vercel serves the static output only at slash-less paths (`/api/context`);
  // the trailing-slash variant 404s. `'never'` makes Astro emit slash-less
  // canonical links AND flips Starlight's search to strip the trailing slash
  // from Pagefind result URLs, so cmd+k results resolve instead of 404ing.
  trailingSlash: 'never',
  markdown: {
    rehypePlugins: [rehypeBaseLinks],
  },
  integrations: [
    starlight({
      title: 'Dunky',
      favicon: '/logo/logo-symbol.svg',
      logo: {
        light: './public/logo/logo.svg',
        dark: './public/logo/logo-white.png',
        replacesTitle: true,
      },
      customCss: ['./src/styles/starlight.css'],
      components: {
        // Wrap Starlight's default Head to mount Vercel Analytics on doc pages.
        Head: './src/components/head.astro',
        // Wrap the default Search to add Up/Down/Enter keyboard navigation,
        // which Pagefind's default UI doesn't provide on its own.
        Search: './src/components/search.astro',
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
            { label: 'Vue', link: 'libs/vue' },
            { label: 'React Native', link: 'libs/react-native' },
            { label: 'OpenTUI', link: 'libs/opentui' },
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
        '@dunky.dev/state-machine': resolve(import.meta.dirname, '../packages/core/src'),
      },
    },
  },
})
