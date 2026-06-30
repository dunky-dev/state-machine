---
'@dunky.dev/state-machine-svelte': minor
---

Add Svelte 5 bindings: `@dunky.dev/state-machine-svelte`. A thin, runes-based edge layer mirroring the React package — `useMachine` (build-once bridge + lifecycle + prop-scoped substrate effects, returning a reactive `{ api, machine }`), `useSelector` (fine-grained leaf subscription returning `{ current }`), and `normalize`/`mergeProps` for Svelte's DOM idiom (lowercase `on*` event props, `class`/`style` string merge). The package ships its `src` uncompiled so the consumer's Svelte compiler processes its `.svelte.ts` runes modules.
