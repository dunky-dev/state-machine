import { defineConfig } from 'tsdown'

// One root config builds every publishable package in workspace mode. Each
// `@dunky.dev/*` package has a single `src/index.ts` entry; `react`/`react-native`
// and the `@dunky.dev/*` workspace deps are auto-externalized from each package's
// own `package.json`, so they're never bundled into the output.
export default defineConfig({
  // The publishable packages, listed explicitly. A glob (`packages/**`) over-matches
  // src/tests dirs, and `include: 'auto'` walks node_modules + grabs the non-published
  // benchmark/website packages — so for this layout an explicit list is the clean
  // choice. Keep in sync with the publish set in .changeset/config.json.
  //
  // `packages/svelte` is intentionally absent: it ships its `src` uncompiled so
  // the consumer's Svelte compiler can process its runes (`.svelte.ts`) modules —
  // tsdown doesn't run the Svelte compiler, and pre-compiling would strip the
  // runes the downstream build needs to see. Its `exports` point straight at
  // `src` (no `dist`), so it has no build step here.
  workspace: [
    'packages/core',
    'packages/react',
    'packages/native',
    'packages/opentui',
    'packages/shared/utils',
    'packages/shared/bindings',
  ],
  entry: ['src/index.ts'],
  format: ['esm'],
  // Every package is `"type": "module"`, so a plain `.js` is already ESM — emit
  // `index.js` / `index.d.ts` to match each package's `publishConfig.exports`.
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  // `oxc: true` generates declarations with oxc's isolated-declarations transform
  // (per-file, no cross-file type-check pass) — much faster than the tsc path. The
  // source satisfies `--isolatedDeclarations` (explicit types on all public exports).
  dts: { oxc: true },
  // Fail the build if the emitted output doesn't match each package's `exports`.
  publint: true,
  clean: true,
  // No sourcemaps in published output keeps the tarball small; flip on if needed.
  sourcemap: false,
})
