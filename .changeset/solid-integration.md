---
'@dunky.dev/solid-state-machine': minor
---

Add `@dunky.dev/solid-state-machine` — the Solid bindings target.

A first-class Solid bridge (not a React re-export): `useMachine` mirrors the
connector's snapshot into a Solid `createStore` (via `reconcile`) so reading a
field in JSX is fine-grained, runs the lifecycle through `onMount`/`onCleanup`,
keeps props fresh with a tracked `setProps` effect, and runs each
`ComponentEffect` as its own dep-tracked `createEffect`. `useSelector` returns a
Solid accessor. `normalize` maps the agnostic bindings to Solid DOM props
(`onInput`, `onDblClick`, `tabindex`) and `mergeProps` applies Solid's `class`
concat + single-object `style` merge. The same `connect` and machine config run
unchanged across React, Solid, React Native, and OpenTUI.

Supports `solid-js` `^1.6` (the 1.x line). Solid 2.0 — a release candidate as
of August 2026 — removes the exact surface this bridge stands on
(`solid-js/store`, single-argument `createEffect`, `onMount`, the 1.x
`reconcile` calling convention), so, like the rest of the Solid ecosystem
(router, TanStack, solid-primitives), 2.0 support will ship as a separate major
once 2.0 is stable rather than as a dual-version range.
