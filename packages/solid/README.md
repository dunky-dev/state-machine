# `@dunky.dev/solid-state-machine`

The **Solid bindings** for [`@dunky.dev/state-machine`](../core/README.md).

The behavior lives in the core machine — plain TypeScript, no renderer. This
package is the thin Solid edge that runs it. It does four things:

1. **`useMachine`** — build the machine once, run its lifecycle, mirror its
   snapshot into a fine-grained store, run the component's platform effects.
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
  this package (Solid)
  |
  |   useMachine              build + start the machine, subscribe
  |   |
  |   v
  |   api                     fine-grained store proxy
  |   |
  |   v
  |   normalize()             DOM / ARIA / events
  |
  v
  <button {...props}>
```

This is a **first-class Solid target**, not a re-export of the React bridge.
React's adapters re-export onto React Native and OpenTUI because those share a
React reconciler; Solid has its own fine-grained reactivity, so the lifecycle is
implemented with Solid primitives — `createStore` + `reconcile`,
`createEffect(compute, apply)`, `onSettled`/`onCleanup` — and there is no
`useSyncExternalStore`. The behavior
still lives in the core machine and the component's `connect`; this layer only
adapts them to Solid.

## Quick start

A tooltip, end to end — the behavior (core), the surface (`connect`), and the
Solid component (this package):

```tsx
import { Show } from 'solid-js'
import { setup } from '@dunky.dev/state-machine'
import { useMachine, normalize } from '@dunky.dev/solid-state-machine'

type TooltipProps = { defaultOpen?: boolean }

// 1 — behavior: a plain state machine. No Solid in sight.
const tooltipConfig = (props: TooltipProps) =>
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
const connectTooltip = ({ state, send }) => {
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

// 3 — the Solid edge: build + run the machine, render from its api.
const tooltipEffects = []

export function Tooltip(props: TooltipProps) {
  const { api } = useMachine(tooltipConfig, connectTooltip, tooltipEffects, props)
  return (
    <>
      <button {...normalize(api.triggerProps)}>Hover me</button>
      <Show when={api.open}>
        <div {...normalize(api.contentProps)}>I'm a tooltip</div>
      </Show>
    </>
  )
}
```

What happened:

- `useMachine` built the machine and connector **once** (a Solid component body
  runs a single time — the first props seeded the initial state), started it
  once rendering settled (`onSettled`), stops it on disposal.
- Hovering sends plain events; the machine handles the 300ms open delay itself
  (`after`) — no `setTimeout` in the component.
- Reading `api.open` in JSX subscribed that spot to exactly that leaf — an
  unrelated field changing never touches it.
- `normalize` turned `describedBy` into `aria-describedby` — the same `connect`
  drives React, React Native, or a terminal through _their_ `normalize`.

That's the whole model. Everything below is reference.

---

## `useMachine` — the bridge hook

Every component's generated `useXxxApi` calls this with the agnostic pieces:

```ts
const { api, machine } = useMachine(
  tooltipMachineConfig, // (props) => config  — config factory, props seed it ONCE
  connectTooltip, // pure connect(): snapshot → view api
  tooltipEffects, // the component's substrate effects (ComponentEffect[])
  props, // the reactive Solid props
)
```

It:

- **builds once** — `machine(createConfig(props))` + `connector(service, connect,
{ ...props })`. A Solid component body runs a single time, so a plain build IS
  "build once" (no `useMemo` equivalent). The first props seed context and the
  initial state; later prop changes flow through `setProps`, never a rebuild.
  > The connector is seeded with a **plain snapshot** (`{ ...props }`), never the
  > live Solid props proxy. The connector value-dedups in `setProps`; if it held
  > the proxy it would later compare the proxy against a fresh spread of that same
  > proxy — whose getters have already updated — find them equal, and never wake.
- **is fine-grained** — the connector's snapshot is mirrored into a
  `createStore` via `reconcile` on every connector wake. Reading `api.isOpen` in
  JSX subscribes to exactly that leaf, so an unrelated field changing won't touch
  it. `api` is the store proxy — **don't destructure it** (`const { isOpen } =
api` snapshots the value and drops reactivity); read its fields where you use
  them.
- **keeps props fresh** via a tracked effect — `createEffect(() => ({ ...props }),
snapshot => connection.setProps(snapshot))`. Solid auto-tracks every prop read
  in the compute phase's spread, so it re-runs whenever a consumed prop changes,
  with no manual dep list. `setProps` value-dedups.
- **runs the lifecycle** — `service.start()` in `onSettled`, `service.stop()` in
  its returned cleanup. The connector wired its
  [reactions](../core/README.md#reactions--firing-prop-callbacks-without-the-machine-knowing)
  to the machine's own `start`/`stop`, so prop-callbacks follow automatically.
- **runs the component's substrate effects** — one `createEffect` per
  `ComponentEffect` entry, each reading its named prop deps so it re-subscribes
  only when one of them changes (see below).

Returns `{ api, machine }`: `api` is the reactive store to spread onto elements;
`machine` is the running service (also handed to `useSelector`).

---

## `ComponentEffect` — platform effects, next to the component

Some behavior can't live in the agnostic machine because it needs the **platform
itself** — a DOM `keydown` listener for Escape, a `ResizeObserver` — and the
**props** the machine never sees (`closeOnEscape`). That's the component's
Solid-side _effect_.

Each effect is a `[setup/teardown, depPropNames]` tuple (`ComponentEffect`) — the
**same shape as every other target**, so a component's effects are authored once
and run unchanged on React and Solid:

```ts
import type { ComponentEffect } from '@dunky.dev/solid-state-machine'

type TooltipEffect = ComponentEffect<TooltipMachine, TooltipMachineProps>

/** Escape-to-close (gated by closeOnEscape). */
const trackEscape: TooltipEffect = [
  (machine, props) => {
    if (!props.closeOnEscape) return
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

`useMachine` runs the list — **one `createEffect` per entry**. The compute phase
READS the declared prop deps, so Solid's auto-tracking re-runs the effect
(cleanup → setup) only when one of those props actually changes, never on
unrelated changes; the body runs in the apply phase, which Solid leaves
untracked. The deps are prop NAMES — typed `(keyof Props)[]`, so a typo is a
compile error. Reading the deps explicitly (rather than letting the effect
body's own reads decide) keeps the dependency set driven by the authored `deps`
and identical to every other target.

> The agnostic _decision_ lives in the core component's resolver; only the
> _transport_ (the DOM listener) is here. The machine just receives a plain event.

---

## `useSelector` — fine-grained subscription

Returns a Solid **accessor** that updates only when one slice of the machine
changes:

```ts
const open = useSelector(machine, () => machine.matches('open'))
const isHL = useSelector(machine, () => machine.context.highlightedValue === value)
// read it in JSX: <div data-open={open()} />
```

Backed by a `createSignal` driven by the machine's `select` — a value-deduped
Selection. `Object.is` by default; **an object/array selection MUST pass a custom
`isEqual`** so a re-derived equal value doesn't push a change:

```ts
const pos = useSelector(
  machine,
  () => ({ x: machine.context.x, y: machine.context.y }),
  (a, b) => a.x === b.x && a.y === b.y,
)
```

`api` from `useMachine` is already fine-grained, so reach for `useSelector` when
a leaf wants to track one slice of a machine it doesn't otherwise own — e.g.
thousands of rows backed by one machine, each waking only for its own value
(`O(readers)`).

---

## `normalize` — agnostic bindings → DOM props

`connect` returns substrate-agnostic
[bindings](../core/README.md#connector--the-view-boundary) (`onPress`, `role`).
`normalize` translates them to DOM/ARIA props as Solid's JSX expects them:

```ts
const domProps = normalize(api.triggerProps) // { onClick, 'aria-expanded', role, tabindex, ... }
```

Same vocabulary as the
[React DOM normalizer](../react/README.md#normalize--agnostic-bindings--dom-props),
with Solid's JSX conventions where the DOM prop name differs: `onValueChange` →
`onInput`, `onDoublePress` → `onDblClick`, and `focusable` → lowercase
`tabindex` (`true → 0`, `false → -1`).
[Check out the full mapping here](./src/normalize.ts).

`undefined` values are dropped; any key not in the map (`class`, `data-*`) passes
through unchanged. `onValueChange`/`onWheel`/`onScroll`/`onScrollEnd` are wrapped
so the consumer receives the agnostic payload built from the native DOM event.

---

## `mergeProps` — consumer props + component props

When a consumer spreads their own props onto the same element the component
controls, `mergeProps(consumer, library)` merges them the Radix/Ark way, Solid
flavor:

```ts
const finalProps = mergeProps(consumerProps, normalize(api.triggerProps))
```

- **Event handlers are chained, consumer-first** — both run, but if the
  consumer's handler marks the event `defaultPrevented`, the library handler is
  skipped (a clean veto).
- **`class` is concatenated** with a single space and trimmed (Solid uses
  `class`, not React's `className`).
- **`style` is merged into ONE object**, library winning on conflicting keys.
  Solid's `style` is a plain object, not React's array form — so styles merge
  rather than wrap.
- **Everything else: library wins** (`id`, `role`, `aria-*`).

> This is **not** Solid's own `mergeProps` from `solid-js` (which merges reactive
> prop objects). It merges the consumer's props with the component's normalized
> bindings.

---

## API

| Export                                        | What it is                                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `useMachine(config, connect, effects, props)` | the bridge hook — build once + lifecycle + run effects + fine-grained store; returns `{ api, machine }`              |
| `useSelector(machine, selector, isEqual?)`    | fine-grained subscription to a derived slice; returns a Solid accessor (`O(readers)`)                                |
| `normalize(bindings)`                         | agnostic bindings → Solid DOM/ARIA props                                                                             |
| `mergeProps(consumer, library)`               | merge consumer + component props (handlers chained w/ `defaultPrevented` veto; `class` concat; `style` object merge) |
| `ComponentEffect<M, P>`                       | `[ (machine, props) => cleanup, (keyof P)[] ]` — one platform effect + its prop deps; pass a static list of them     |
| `Bindings`                                    | `Record<string, unknown>` — the loose shape `normalize` accepts                                                      |

---

## Solid version support

Peer range: `solid-js` `^2.0.0-rc.0` — Solid 2.0 is the first-class target.
Solid 1.x is NOT supported: 2.0 removed the exact surface this bridge is built
on (`solid-js/store` moved into the root export, single-argument `createEffect`
became `createEffect(compute, apply)`, `onMount` became `onSettled`), so one
code path cannot serve both majors, and 1.x lacks the root exports this package
imports. Like the rest of the Solid ecosystem (`@solidjs/router`, TanStack,
`solid-primitives`), the majors are version-split.

Two 2.0 behaviors worth knowing as a consumer:

- Writes commit on the microtask queue — after `send()`, a synchronous read of
  the `api` store or a `useSelector` accessor returns the previous value until
  the queue flushes. JSX readers always settle correctly; in tests, call
  `flush()` from `solid-js` before asserting.
- JSX types live in the renderer package: set `"jsxImportSource": "@solidjs/web"`
  and import `render` from `@solidjs/web`, not `solid-js/web`.
