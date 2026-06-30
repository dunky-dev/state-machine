---
'@dunky.dev/state-machine-solid': minor
---

Add `@dunky.dev/state-machine-solid` — the Solid bindings target.

A first-class Solid bridge (not a React re-export): `useMachine` mirrors the
connector's snapshot into a Solid `createStore` (via `reconcile`) so reading a
field in JSX is fine-grained, runs the lifecycle through `onMount`/`onCleanup`,
keeps props fresh with a tracked `setProps` effect, and runs each
`ComponentEffect` as its own dep-tracked `createEffect`. `useSelector` returns a
Solid accessor. `normalize` maps the agnostic bindings to Solid DOM props
(`onInput`, `onDblClick`, `tabindex`) and `mergeProps` applies Solid's `class`
concat + single-object `style` merge. The same `connect` and machine config run
unchanged across React, Solid, React Native, and OpenTUI.
