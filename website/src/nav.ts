export interface NavItem {
  title: string
  href: string
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

export const nav: NavGroup[] = [
  {
    title: 'Guides',
    items: [
      { title: 'Get started', href: '/get-started' },
      { title: 'Install', href: '/install' },
      { title: 'Comparison', href: '/comparison' },
      { title: 'Benchmark', href: '/benchmark' },
    ],
  },
  {
    title: 'Core',
    items: [
      { title: 'Setup', href: '/api/setup' },
      { title: 'Context', href: '/api/context' },
      { title: 'States & Transitions', href: '/api/states' },
      { title: 'Guards', href: '/api/guards' },
      { title: 'Actions', href: '/api/actions' },
      { title: 'Effects', href: '/api/effects' },
      { title: 'Computed', href: '/api/computed' },
      { title: 'Timers', href: '/api/timers' },
      { title: 'Watch', href: '/api/watch' },
      { title: 'Subscriptions', href: '/api/subscriptions' },
    ],
  },
  {
    title: 'View layer',
    items: [
      { title: 'Connector', href: '/api/connector' },
      { title: 'Reactions', href: '/api/reactions' },
    ],
  },
  {
    title: 'Composition',
    items: [
      { title: 'Peer machines', href: '/api/compose' },
      { title: 'Store', href: '/api/create-store' },
      { title: 'Shared states', href: '/api/flat-states' },
    ],
  },
  {
    title: 'Integrations',
    items: [
      { title: 'React', href: '/libs/react' },
      { title: 'React Native', href: '/libs/react-native' },
    ],
  },
  {
    title: 'Reference',
    items: [
      { title: 'API overview', href: '/api' },
      { title: 'Glossary', href: '/glossary' },
    ],
  },
]
