# `@dunky.dev/vue-state-machine`

The **Vue bindings** for [`@dunky.dev/state-machine`](../core/README.md).

The behavior lives in the core machine — plain TypeScript, no renderer. This
package is the thin Vue edge that runs it. It does four things:

1. **`useMachine`** — build the machine once, run its lifecycle, expose its
   snapshot as a computed ref, run the component's platform effects.
2. **`useSelector`** — wake a leaf component only when one slice changes.
3. **`normalize`** — translate the machine's agnostic bindings (`onPress`,
   `checked`) into real DOM props (`onClick`, `aria-checked`).
4. **`mergeProps`** — merge the consumer's props with the component's.

```
  core (agnostic)
  |
  |   config + connect()      behavior + snapshot -> view api
  |
  v
  this package (Vue)
  |
  |   useMachine              build + start the machine, subscribe
  |   |
  |   v
  |   api                     computed ref of the snapshot
  |   |
  |   v
  |   normalize()             DOM / ARIA / events
  |
  v
  <button v-bind="props">
```

This is a **first-class Vue target**, not a re-export of the React bridge.
React's adapters re-export onto React Native and OpenTUI because those share a
React reconciler; Vue has its own reactivity, so the lifecycle is implemented
with Vue primitives — a `computed` over the connector's memoized snapshot,
`watch` for prop sync and effect deps, and the `onMounted` / `onUnmounted` /
`onActivated` / `onDeactivated` hooks — while keeping React's effect order.
The behavior still lives in the core machine and the component's `connect`;
this layer only adapts them to Vue.

## Quick start

A tooltip, end to end — the behavior (core), the surface (`connect`), and the
Vue component (this package):

```ts
// tooltip.ts — plain TypeScript, no Vue in sight
import { setup } from '@dunky.dev/state-machine'

export type TooltipProps = { defaultOpen?: boolean }

// 1 — behavior: a plain state machine.
export const tooltipConfig = (props: TooltipProps) =>
  setup.infer().createMachine({
    initial: props.defaultOpen ? 'open' : 'closed', // props seed the machine ONCE
    context: {},
    states: {
      closed: { on: { hover: { target: 'opening' } } },
      opening: {
        after: { 300: { target: 'open' } }, // open after a 300ms hover
        on: { leave: { target: 'closed' } },
      },
      open: { on: { leave: { target: 'closed' } } },
    },
  })

// 2 — connect: machine snapshot -> what the view spreads onto elements.
export const connectTooltip = ({ state, send }) => {
  const open = state === 'open'
  return {
    open,
    triggerProps: {
      describedBy: open ? 'tip' : undefined,
      onPointerEnter: () => send({ type: 'hover' }),
      onPointerLeave: () => send({ type: 'leave' }),
    },
    contentProps: { id: 'tip', role: 'tooltip' },
  }
}

export const tooltipEffects = []
```

```vue
<!-- tooltip.vue — 3, the Vue edge: build + run the machine, render from its api -->
<script setup lang="ts">
import { useMachine, normalize } from '@dunky.dev/vue-state-machine'
import { connectTooltip, tooltipConfig, tooltipEffects, type TooltipProps } from './tooltip'

// `default: undefined` — see "Declare boolean props" below.
const props = withDefaults(defineProps<TooltipProps>(), { defaultOpen: undefined })
const { api } = useMachine(tooltipConfig, connectTooltip, tooltipEffects, props)
</script>

<template>
  <button v-bind="normalize(api.triggerProps)">Hover me</button>
  <div v-if="api.open" v-bind="normalize(api.contentProps)">I'm a tooltip</div>
</template>
```

What happened:

- `useMachine` built the machine and connector **once** (`setup()` runs once
  per instance — the first props seeded the initial state), started it after
  mount, stops it on unmount.
- Hovering sends plain events; the machine handles the 300ms open delay itself
  (`after`) — no `setTimeout` in the component.
- `api` is a computed ref: the template unwraps it (`api.open`); in script it
  is `api.value.open`. It changes only when the machine or the props do.
- `normalize` turned `describedBy` into `aria-describedby` and `onPointerEnter`
  into Vue's `onPointerenter` listener — the same `connect` drives React, Solid,
  React Native, or a terminal through _their_ `normalize`.

That's the whole model. Everything below is reference.

---

## `useMachine` — the bridge composable

Every component's generated `useXxxApi` calls this with the agnostic pieces:

```ts
const { api, machine } = useMachine(
  tooltipMachineConfig, // (props) => config  — config factory, props seed it ONCE
  connectTooltip, // pure connect(): snapshot → view api
  tooltipEffects, // the component's substrate effects (ComponentEffect[])
  props, // the component's props — a reactive object, a ref, or a getter
)
```

It:

- **builds once** — `machine(createConfig(props))` + `connector(...)` in
  `setup()`, which runs once per instance, so plain consts are "build once"
  (no memo). The first props seed context and the initial state; later prop
  changes flow through `setProps`, never a rebuild.
  > The connector is seeded with — and later handed — a **plain copy** of the
  > props (`{ ...props }`), never the live props proxy. `setProps` is a shallow
  > dedup, and a proxy that mutates in place would always compare equal to
  > itself and never wake the connector.
- **keeps props fresh** via `watch(() => ({ ...props }), connection.setProps)`.
  The spread tracks every top-level prop; the watch is not `deep`, because
  `setProps` compares top-level identities only.
- **exposes the snapshot** as `api: ComputedRef<Api>`. The connector memoizes
  its snapshot; the computed re-reads it lazily after a change, so `connect()`
  runs once per read rather than once per machine notification, and `api`'s
  identity changes only on a real change.
- **runs the lifecycle in React's order** — `service.start()` after mount, then
  the component's effects; on unmount, `service.stop()`, then the effect
  cleanups, once the component's DOM is gone (as React's passive effects run).
  The connector wired its
  [reactions](../core/README.md#reactions--firing-prop-callbacks-without-the-machine-knowing)
  to the machine's own `start`/`stop`, so prop callbacks follow automatically.
- **pauses under `<KeepAlive>`** — deactivation stops the machine and tears the
  effects down; reactivation restarts both, state intact. That is React's
  `<Activity mode="hidden">` contract: a deactivated component keeps no
  document listeners, timers, or reactions alive.
- **runs nothing on the server** — Vue never mounts during SSR, so
  `renderToString` renders the initial snapshot without starting the machine
  or running an effect (a `document` listener can't crash the server).

Returns `{ api, machine }`: `api` is the computed ref to render from; `machine`
is the running service (for `send`, and to hand to `useSelector`).

### Declare boolean props with `default: undefined`

Vue casts an **absent** `Boolean` prop to `false`. The core reads `undefined`
as "not set" — the uncontrolled mode, or the machine's own default — so a cast
`false` silently breaks a component: `open` becomes permanently controlled, a
`modal: true` default is lost. Declare every boolean option with
`default: undefined`:

```ts
// <script setup>, type-based declaration
const props = withDefaults(defineProps<DialogProps>(), {
  open: undefined,
  defaultOpen: undefined,
  modal: undefined,
})

// runtime declaration
props: {
  open: { type: Boolean, default: undefined },
  modal: { type: Boolean, default: undefined },
}
```

### Call it before any `await`

In an async `setup()` (a component under `<Suspense>`), Vue binds only the
lifecycle hooks registered before the first `await`. Call `useMachine` before
awaiting anything — otherwise the machine never starts and no effect runs.

---

## `ComponentEffect` — platform effects, next to the component

Some behavior can't live in the agnostic machine because it needs the **platform
itself** — a DOM `keydown` listener for Escape, a `ResizeObserver` — and the
**props** the machine never sees (`closeOnEscape`). That's the component's
Vue-side _effect_.

Each effect is a `[setup/teardown, depPropNames]` tuple (`ComponentEffect`) — the
**same shape as every other target**, so a component's effects are authored once
and run unchanged on React, Solid, and Vue:

```ts
import type { ComponentEffect } from '@dunky.dev/vue-state-machine'

type TooltipEffect = ComponentEffect<TooltipMachine, TooltipMachineProps>

/** Escape-to-close (on unless closeOnEscape is false). */
const trackEscape: TooltipEffect = [
  (machine, props) => {
    if (props.closeOnEscape === false) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') machine.send({ type: 'escape' })
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  },
  ['closeOnEscape'], // ← re-run only when this prop changes
]

export const tooltipEffects = [trackEscape]
```

`useMachine` runs each entry once the machine has started, after mount — DOM
refs are filled by then. It re-runs an entry (cleanup → setup) only when one
of its named deps changes, and only after Vue has patched the DOM with that
change (a `post`-flush watcher with one getter per dep, each compared by
value). The body runs untracked, so a prop it merely reads never becomes a
hidden dependency — the authored `deps`, typed `(keyof Props)[]`, are the whole
re-run contract, as with React's dep array. Each entry runs on its own: one
that throws is reported through Vue's error handling (`app.config.errorHandler`)
and the others still run. The effect receives the machine and the current
props: pass the component's props object and a listener reading a prop at
event time sees its latest value.

> The agnostic _decision_ lives in the core component's resolver; only the
> _transport_ (the DOM listener) is here. The machine just receives a plain event.

---

## `useSelector` — fine-grained subscription

Returns a **readonly ref** that updates only when one slice of the machine
changes:

```ts
const open = useSelector(machine, () => machine.matches('open'))
// a machine from props: pass a getter, and read props inside the selector freely
const isHL = useSelector(
  () => props.machine,
  () => props.machine.context.highlightedValue === props.value,
)
// in a template: <div :data-open="open" />
```

The selector re-runs on every machine change and whenever a reactive value it
reads changes (a prop it compares against), and the ref takes the new value only
when it differs. `Object.is` by default; **an object/array selection MUST pass
a custom `isEqual`** so a re-derived equal value doesn't bump the ref:

```ts
const pos = useSelector(
  machine,
  () => ({ x: machine.context.x, y: machine.context.y }),
  (a, b) => a.x === b.x && a.y === b.y,
)
```

The selection comes back as-is — never wrapped in a reactive proxy, so
`selected.value === machine.context.item` holds. The machine may be a ref or a
getter; swapping it re-subscribes. The subscription is disposed with the
surrounding effect scope — the component's on unmount, or a bare
`effectScope()` when it stops — and a server render leaves none behind on Vue
3.5+. (On 3.3–3.4, Vue never runs that cleanup on the server: hand
`useSelector` a per-request machine there, such as one from `useMachine`.)

`api` from `useMachine` already updates only on a real change, so reach for
`useSelector` when a leaf wants to track one slice of a machine it doesn't
otherwise own — e.g. thousands of rows backed by one machine, each waking only
for its own value (`O(readers)`).

---

## `normalize` — agnostic bindings → DOM props

`connect` returns substrate-agnostic
[bindings](../core/README.md#connector--the-view-boundary) (`onPress`, `role`).
`normalize` translates them to the DOM/ARIA props `h()` and a template
`v-bind` take:

```ts
const domProps = normalize(api.value.triggerProps) // { onClick, 'aria-expanded', role, tabindex, ... }
```

Same vocabulary as the
[React DOM normalizer](../react/README.md#normalize--agnostic-bindings--dom-props),
with Vue's names where they differ:

- **Listener casing.** Vue derives the DOM event from a listener prop by
  hyphenating its camel tail, so a multi-word event keeps only its leading
  capital: `onPointerenter`, `onKeydown`, `onContextmenu`, `onScrollend`. (An
  `onPointerEnter` prop would listen to `pointer-enter` and never fire.)
- `onValueChange` → `onInput` (fires per change; `change` fires only on commit)
  and `onDoublePress` → `onDblclick`.
- `focusable` → `tabindex` (`true → 0`, `false → -1`).
- ARIA booleans pass through: Vue renders them as the `"true"` / `"false"`
  tokens ARIA expects, on the client and on the server.

[Check out the full mapping here](./src/normalize.ts). `undefined` values are
dropped (so they never override a consumer prop in `mergeProps`); any key not in
the map (`class`, `data-*`) passes through unchanged.
`onValueChange`/`onWheel`/`onScroll`/`onScrollEnd` are wrapped so the consumer
receives the agnostic payload built from the native DOM event.

---

## `mergeProps` — consumer props + component props

When a consumer's props land on the same element the component controls,
`mergeProps(consumer, library)` merges them the Radix/Ark way, Vue flavor:

```vue
<script setup lang="ts">
import { useAttrs } from 'vue'
import { mergeProps, normalize } from '@dunky.dev/vue-state-machine'

defineOptions({ inheritAttrs: false }) // the attrs land on the button below, once
const attrs = useAttrs()
// …useMachine as above
</script>

<template>
  <button v-bind="mergeProps(attrs, normalize(api.triggerProps))">Open</button>
</template>
```

- **Event handlers are chained, consumer-first** — both run, but if the
  consumer's handler marks the event `defaultPrevented`, the library handler is
  skipped (a clean veto). Every Vue listener key qualifies (`onClick`,
  `onPointerenter`, `onUpdate:open`), and an **array** of consumer handlers —
  what Vue puts in `attrs` when a listener is bound twice — composes like one.
- **`class` and `style` merge as `[consumer, library]`** when both sides set
  them, in any shape Vue accepts (string, array, object); Vue normalizes the
  array, and the library entry, last, wins a conflicting style key.
- **Everything else: library wins** (`id`, `role`, `aria-*`).

Spreading `useAttrs()` needs `inheritAttrs: false`, as above — otherwise Vue
also falls the attrs through to the root element and every handler runs twice.

> This is **not** Vue's own `mergeProps` from `vue`, which concatenates
> handlers into an array that all run — there is no veto.

---

## API

| Export                                        | What it is                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `useMachine(config, connect, effects, props)` | the bridge composable — build once + lifecycle + run effects + computed snapshot; returns `{ api, machine }`                   |
| `useSelector(machine, selector, isEqual?)`    | fine-grained subscription to a derived slice (machine: value, ref, or getter); returns a readonly ref (`O(readers)`)           |
| `normalize(bindings)`                         | agnostic bindings → Vue DOM/ARIA props                                                                                         |
| `mergeProps(consumer, library)`               | merge consumer + component props (handlers chained w/ `defaultPrevented` veto; `class`/`style` as `[consumer, library]` array) |
| `ComponentEffect<M, P>`                       | `[ (machine, props) => cleanup, (keyof P)[] ]` — one platform effect + its prop deps; pass a static list of them               |
| `Bindings`                                    | `Record<string, unknown>` — the loose shape `normalize` accepts                                                                |

---

## Vue version support

Peer range: `vue` `^3.3.0` — the bridge needs 3.3's `toValue` and
`MaybeRefOrGetter`. The suite runs on Vue 3.5 and is verified on 3.3, 3.4,
and the 3.6 release candidate, where the composables also work inside Vapor
components: they use only the reactivity and lifecycle APIs both renderers
share.

TypeScript 7 no longer ships the compiler's JS API, which the Vue toolchain
still needs: `@vue/compiler-sfc` uses it to resolve an imported type in
`defineProps<DialogProps>()`, and `vue-tsc` builds on it. Keep `typescript@^6`
installed for an SFC project until the Vue tooling supports 7.
