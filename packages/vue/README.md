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
import { setup, type Connect, type Machine } from '@dunky.dev/state-machine'

export type TooltipProps = { defaultOpen?: boolean; closeOnEscape?: boolean }

type State = 'closed' | 'opening' | 'open'
type Context = Record<string, never>
type Event = { type: 'hover' } | { type: 'leave' }
type Api = {
  open: boolean
  triggerProps: Record<string, unknown>
  contentProps: Record<string, unknown>
}
export type TooltipMachine = Machine<State, Context, Event>

// 1 — behavior: a plain state machine.
export const tooltipConfig = (props: TooltipProps) =>
  setup.as<Context, Event>().createMachine({
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
export const connectTooltip: Connect<State, Context, Event, TooltipProps, Api> = ({
  state,
  send,
}) => {
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
```

```vue
<!-- tooltip.vue — 3, the Vue edge: build + run the machine, render from its api -->
<script setup lang="ts">
import { useMachine, normalize } from '@dunky.dev/vue-state-machine'
import { connectTooltip, tooltipConfig, type TooltipProps } from './tooltip'
import { tooltipEffects } from './tooltip-effects' // see ComponentEffect below

// `default: undefined` — see "Declare boolean props" below.
const props = withDefaults(defineProps<TooltipProps>(), {
  defaultOpen: undefined,
  closeOnEscape: undefined,
})
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
  tooltipConfig, // (props) => config  — config factory, props seed it ONCE
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
- **starts in React's order** — `service.start()` after mount, then the
  component's effects. On unmount it stops the machine before the component's
  children unmount, so a part sending from its own teardown reaches a stopped
  machine and fires no prop callback. The effect cleanups follow in
  `onUnmounted`, which Vue runs children first (React runs passive cleanups
  parent first) and, under `<Transition>`, while the leaving element is still
  in the document. The connector wired its
  [reactions](../core/README.md#reactions-firing-prop-callbacks-without-the-machine-knowing)
  to the machine's own `start`/`stop`, so prop callbacks follow automatically;
  the bridge runs them untracked.
- **pauses under `<KeepAlive>`** — deactivation stops the machine and tears the
  effects down; reactivation restarts both, state intact. That is React's
  `<Activity mode="hidden">` contract: a deactivated component keeps no
  document listeners, timers, or reactions alive. A component mounted into a
  view that is already deactivated holds still — no start, no effects — until
  the view activates. (Vue runs the parts' `onDeactivated` hooks before the
  root's, so a part shouldn't send from one.)
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
// in <script setup lang="ts">
type DialogProps = { open?: boolean; defaultOpen?: boolean; modal?: boolean }

const props = withDefaults(defineProps<DialogProps>(), {
  open: undefined,
  defaultOpen: undefined,
  modal: undefined,
})
```

With a runtime declaration, the same rule reads
`open: { type: Boolean, default: undefined }`.

### Replace prop values, don't mutate them

Props reach the machine through `setProps`, which compares each prop by
identity, as React does. A value mutated in place — `items.value.push(x)` on an
array the parent passes down — keeps its identity, so the machine never sees
the change. Replace it instead: `items.value = [...items.value, x]`.

### Call it before any `await`

In an async `setup()` (a component under `<Suspense>`), Vue binds only the
lifecycle hooks registered before the first `await`. Call `useMachine` before
awaiting anything — otherwise the machine never starts and no effect runs.

### Send from handlers, `watch` callbacks, or hooks

`send()` runs the transition synchronously, inside whatever is tracking at that
moment. The bridge runs its own callbacks — prop callbacks included —
untracked, but the machine's actions and guards run as they are. From
`watchEffect`, a `computed`, or a render function, anything they read becomes a
dependency, and an unrelated change re-runs the effect and sends again. Send
from event handlers, `watch(source, callback)` callbacks, or lifecycle hooks,
which Vue runs untracked:

```ts
watch(shouldOpen, open => open && machine.send({ type: 'hover' })) // not watchEffect
```

The other direction needs care too: don't watch `api` or a `useSelector` ref
with `flush: 'sync'`. A sync watcher reads in the middle of a transition, before
its entry actions have run; the default flush reads once it is done.

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
// tooltip-effects.ts
import type { ComponentEffect } from '@dunky.dev/vue-state-machine'
import type { TooltipMachine, TooltipProps } from './tooltip'

type TooltipEffect = ComponentEffect<TooltipMachine, TooltipProps>

/** Escape closes the tooltip, unless closeOnEscape is false. */
const trackEscape: TooltipEffect = [
  (machine, props) => {
    if (props.closeOnEscape === false) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') machine.send({ type: 'leave' })
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
re-run contract, as with React's dep array. Each run receives the machine and
its own plain snapshot of the props — as a React effect closes over its
render's props — so a cleanup undoes exactly what its run set up; a listener
that reads a prop later sees the setup-time value, so name that prop in the
deps. Each entry runs on its own: if one throws — on any run or in its
cleanup — the others still run, a throwing cleanup doesn't block the next
setup, and every error reaches Vue's error handling
(`app.config.errorHandler`).

An effect re-runs after the render its dep change caused, so a machine change it
makes — a controlled option echoed into the machine — renders in the pass
after. A `post` watcher queued by the same prop change runs before that render
and reads the previous DOM. To act on what the new state rendered, use
`onUpdated` (or `onMounted`), which runs after every render, the echoed state's
included.

> The agnostic _decision_ lives in the core component's resolver; only the
> _transport_ (the DOM listener) is here. The machine just receives a plain event.

---

## `useSelector` — fine-grained subscription

Returns a **readonly ref** that updates only when one slice of the machine
changes:

```ts
const open = useSelector(machine, () => machine.matches('open'))
// a machine from props: pass a getter, and read props inside the selector freely
const isHighlighted = useSelector(
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
`effectScope()` when it stops. A server render subscribes nothing — it is a
single pass, and Vue never disposes a scope on the server — so each read there
runs the selector afresh. As with `useMachine`, call it before the first
`await` in an async `setup()`.

`api` from `useMachine` already updates only on a real change, so reach for
`useSelector` when a leaf wants to track one slice of a machine it doesn't
otherwise own — e.g. thousands of rows backed by one machine, each waking only
for its own value (`O(readers)`).

---

## `normalize` — agnostic bindings → DOM props

`connect` returns substrate-agnostic
[bindings](../core/README.md#connector-the-view-boundary) (`onPress`, `role`).
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
import { mergeProps, normalize, useMachine } from '@dunky.dev/vue-state-machine'
import { connectTooltip, tooltipConfig, type TooltipProps } from './tooltip'
import { tooltipEffects } from './tooltip-effects'

defineOptions({ inheritAttrs: false }) // the attrs land on the button below, once
const attrs = useAttrs()
const props = withDefaults(defineProps<TooltipProps>(), {
  defaultOpen: undefined,
  closeOnEscape: undefined,
})
const { api } = useMachine(tooltipConfig, connectTooltip, tooltipEffects, props)
</script>

<template>
  <button v-bind="mergeProps(attrs, normalize(api.triggerProps))">Open</button>
</template>
```

- **Event handlers are chained, consumer-first** — both run, but if the
  consumer's handler marks the event `defaultPrevented`, the library handler is
  skipped (a clean veto). Every Vue listener key qualifies (`onClick`,
  `onPointerenter`, `onUpdate:open`). An **array** of consumer handlers — what
  Vue puts in `attrs` when a listener is bound twice — stays an array, so Vue's
  invoker semantics hold, with the library handler appended last. A consumer's
  capture listener (`onClickCapture`), or a `.once` one bound from the first
  render, still vetoes the library's plain `onClick` — it runs first. A passive
  listener can't (the browser ignores its `preventDefault`), and neither can a
  `.once` added after mount, which registers after the library's.
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

Peer range: `vue` `^3.4.0`. `useSelector` relies on the computed of Vue 3.4's
reactivity, which skips its readers when a re-evaluation returns the same value
— on 3.3 every machine change would re-render every reader. The suite runs on
Vue 3.5 and is verified on 3.4.0 and the 3.6 release candidate, where the
composables also work inside Vapor components: they use only the reactivity and
lifecycle APIs both renderers share. One exception: a Vapor component has no
`getCurrentInstance()`, so one mounted into an already-deactivated
`<KeepAlive>` view starts right away instead of holding still.

TypeScript 7 no longer ships the compiler's JS API, which the Vue toolchain
still needs: `@vue/compiler-sfc` uses it to resolve an imported type in
`defineProps<DialogProps>()`, and `vue-tsc` builds on it. Keep `typescript@^6`
installed for an SFC project until the Vue tooling supports 7.
