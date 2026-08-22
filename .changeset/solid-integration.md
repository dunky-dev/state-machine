---
'@dunky.dev/solid-state-machine': minor
---

Add `@dunky.dev/solid-state-machine` — the Solid bindings target.

A first-class Solid bridge (not a React re-export): `useMachine` mirrors the
connector's snapshot into a Solid `createStore` (via `reconcile`) so reading a
field in JSX is fine-grained, runs the lifecycle through `onSettled`/`onCleanup`,
keeps props fresh with a tracked `setProps` effect, and runs each
`ComponentEffect` as its own dep-tracked `createEffect(compute, apply)`.
`useSelector` returns a Solid accessor. `normalize` maps the agnostic bindings
to Solid DOM props (`onInput`, `onDblClick`, `tabindex`) and `mergeProps`
applies Solid's `class` concat + single-object `style` merge. The same `connect`
and machine config run unchanged across React, Solid, React Native, and OpenTUI.

Targets Solid 2.0 as a first-class citizen: the peer range is `solid-js`
`^2.0.0-rc.1`. Solid 1.x is not supported — 2.0 removed the surface a 1.x
bridge would stand on (`solid-js/store`, single-argument `createEffect`,
`onMount`) and 1.x lacks the root exports this package imports, so, like the
rest of the Solid ecosystem (router, TanStack, solid-primitives), the majors
are version-split. Two consumer-facing 2.0 behaviors: writes commit on the
microtask queue (call `flush()` in tests before asserting), and JSX comes from
the renderer package (`"jsxImportSource": "@solidjs/web"`, `render` from
`@solidjs/web`).
