import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  // Many engine exports are public API (re-exported from each package's index)
  // that knip can't see a consumer for in this repo, but which are used within
  // their own module — keep those out of the "unused exports" report.
  ignoreExportsUsedInFile: true,

  workspaces: {
    '.': {
      // `pnpm -C <dir> dev` is a workspace script name knip mistakes for a binary.
      ignoreBinaries: ['dev'],
    },
  },
}

export default config
