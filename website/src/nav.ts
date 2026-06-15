// The sidebar, hand-ordered. Each `href` is root-relative (no base prefix);
// the layout prepends import.meta.env.BASE_URL so it works under /state-machine/.
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
      { title: 'Motivation', href: '/motivation' },
      { title: 'Install', href: '/install' },
      { title: 'Comparison', href: '/comparison' },
      { title: 'Benchmark', href: '/benchmark' },
      { title: 'Glossary', href: '/glossary' },
    ],
  },
  {
    title: 'API',
    items: [
      { title: 'Overview', href: '/api' },
      { title: 'machine()', href: '/api/machine' },
      { title: 'setup()', href: '/api/setup' },
      { title: 'connector()', href: '/api/connector' },
      { title: 'compose()', href: '/api/compose' },
      { title: 'createStore()', href: '/api/create-store' },
      { title: 'makeReaction()', href: '/api/make-reaction' },
      { title: 'Guards', href: '/api/guards' },
      { title: 'Actions', href: '/api/actions' },
    ],
  },
  {
    title: 'Libs',
    items: [
      { title: 'Vanilla', href: '/libs/vanilla' },
      { title: 'React', href: '/libs/react' },
      { title: 'React Native', href: '/libs/react-native' },
    ],
  },
]
