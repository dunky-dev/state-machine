import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  // Many engine exports are public API (re-exported from each package's index)
  // that knip can't see a consumer for in this repo, but which are used within
  // their own module — keep those out of the "unused exports" report.
  ignoreExportsUsedInFile: true,

  workspaces: {
    '.': {
      // `react` is a peer dependency of the react/native packages; the root
      // installs it so `tsc`/`vitest` can resolve it. `@types/use-sync-external-store`
      // is a type-only dep knip can't attribute to a runtime import.
      ignoreDependencies: ['react', '@types/use-sync-external-store'],
      // `pnpm -C <dir> dev` makes knip read `dev` as an unlisted binary.
      ignoreBinaries: ['dev'],
    },
    // The native target re-exports the engine's hooks/types through
    // machine-react, so it never imports @chimba-ui/state-machine directly — but
    // listing it as a dependency is correct (it's part of native's public surface).
    'packages/native': {
      ignoreDependencies: ['@chimba-ui/state-machine'],
    },
  },
}

export default config
