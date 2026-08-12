---
'@dunky.dev/state-machine': patch
'@dunky.dev/react-state-machine': patch
'@dunky.dev/native-state-machine': patch
'@dunky.dev/opentui-state-machine': patch
'@dunky.dev/state-machine-utils': patch
'@dunky.dev/state-machine-bindings': patch
---

Ship the `src` folder in the published packages, alongside `dist`. The
READMEs point at source files for the full binding mappings (e.g.
`./src/normalize.ts`), and those links were dead on the npm page because
only `dist` was published. The sources are small, plain TypeScript, so the
readable reference now travels with the package; the build outputs and the
`exports` map are unchanged.
