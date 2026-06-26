---
'@dunky.dev/state-machine-vue': minor
---

Add the Vue 3 bindings package (`@dunky.dev/state-machine-vue`). It mirrors the React package's API one-for-one — `useMachine`, `useSelector`, `normalize`, `mergeProps`, and the `ComponentEffect`/`ComponentEffects` types — implemented with Vue's reactivity: `useMachine` builds the machine + connector once in `setup()`, runs `start`/`stop` on the mount lifecycle, pushes prop changes through `setProps`, runs each `ComponentEffect` as its own dep-keyed `watch`, and exposes the connector snapshot as a `ComputedRef`; `useSelector` returns a value-deduped readonly ref; `normalize` translates the agnostic bindings to Vue DOM/ARIA props; `mergeProps` merges consumer + component props with Vue's `class`/`style` conventions.
