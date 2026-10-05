# `@dunky.dev/svelte-state-machine`

The **Svelte 5 bindings** for [`@dunky.dev/state-machine`](../core/README.md).

The behavior lives in the core machine — plain TypeScript, no renderer. This
package is the thin Svelte edge that runs it. It does four things:

1. **`useMachine`** — build the machine once, run its lifecycle, mirror its
   snapshot into reactive state, run the component's platform effects.
2. **`useSelector`** — wake a leaf component only when one slice changes.
3. **`normalize`** — translate the machine's agnostic bindings (`onPress`,
   `checked`) into real DOM props (`onclick`, `aria-checked`).
4. **`mergeProps`** — merge the consumer's props with the component's.

```
  core (agnostic)
  |
  |   config + connect()      behavior + snapshot -> view api
  |
  v
  this package (Svelte)
  |
  |   useMachine              build + start the machine, subscribe
  |   |
  |   v
  |   view.api                the connector's snapshot, as raw state
  |   |
  |   v
  |   normalize()             DOM / ARIA / events
  |
  v
  <button {...props}>
```

This is a **first-class Svelte target**, not a re-export of the React bridge.
React's adapters re-export onto React Native and OpenTUI because those share a
React reconciler; Svelte has its own reactivity, so the lifecycle is written in
runes — `$state.raw`, `$effect.pre`, `$effect`, `$derived`, `untrack` — and
there is no `useSyncExternalStore`. The behavior still lives in the core machine
and the component's `connect`; this layer only adapts them to Svelte.

## Quick start

A tooltip, end to end — the behavior (core), the surface (`connect`), and the
Svelte component (this package):

```svelte
<!-- Tooltip.svelte -->
<script lang="ts">
  import { setup } from '@dunky.dev/state-machine'
  import { useMachine, normalize } from '@dunky.dev/svelte-state-machine'

  type TooltipProps = { defaultOpen?: boolean }

  // 1 — behavior: a plain state machine. No Svelte in sight.
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

  // 3 — the Svelte edge: build + run the machine, render from its api.
  let props: TooltipProps = $props()
  const view = useMachine(tooltipConfig, connectTooltip, [], () => props)
</script>

<button {...normalize(view.api.triggerProps)}>Hover me</button>
{#if view.api.open}
  <div {...normalize(view.api.contentProps)}>I'm a tooltip</div>
{/if}
```

What happened:

- `useMachine` built the machine and connector **once** (the component's script
  runs a single time — the first props seeded the initial state), started it
  after mount, and stops it on destroy.
- Hovering sends plain events; the machine handles the 300ms open delay itself
  (`after`) — no `setTimeout` in the component.
- Reading `view.api` in markup subscribed those spots to the connector's
  snapshot, which changes only when the machine or a prop does.
- `normalize` turned `onPointerEnter` into `onpointerenter` and `describedBy`
  into `aria-describedby` — the same `connect` drives React, React Native, or a
  terminal through _their_ `normalize`.

That's the whole model. Everything below is reference.

---

## `useMachine` — the bridge

Every component calls it with the agnostic pieces, while it initializes:

```ts
const view = useMachine(
  tooltipMachineConfig, // (props) => config  — config factory, props seed it ONCE
  connectTooltip, // pure connect(): snapshot → view api
  tooltipEffects, // the component's substrate effects (ComponentEffect[])
  () => props, // a GETTER for the props, so later changes keep flowing in
)
```

It:

- **builds once** — `machine(createConfig(props))` + `connector(service,
connect, props)`, seeded with a **plain copy** of the props, never the live
  `$props()` proxy: the connector value-dedups in `setProps`, and a held proxy
  would compare equal to itself and never wake. Later prop changes flow through
  `setProps`, never a rebuild.
- **mirrors the snapshot** into `$state.raw` — the connector already memoizes
  it, so `view.api` is that very object (no deep proxy, no copy), and it changes
  identity only on a real change. The subscription is an `$effect.pre`, so it is
  live from the component's first line: a child that sends on mount (children's
  effects run before their parent's) still lands in the parent's `api`.
- **keeps props fresh** — an `$effect` spreads `{ ...props() }` into `setProps`,
  so every prop is tracked and any change re-runs it; `setProps` value-dedups.
- **runs the lifecycle** — `service.start()` after mount, `service.stop()` on
  destroy (untracked, so it never re-runs). The connector wired its
  [reactions](../core/README.md#reactions--firing-prop-callbacks-without-the-machine-knowing)
  to the machine's own `start`/`stop`, so prop-callbacks follow automatically.
- **runs the component's substrate effects** — one `$effect` per
  `ComponentEffect` entry, re-running only when one of its named prop deps
  changes (see below). The order matches React's: start, then the effects; on
  destroy, stop, then their cleanups. None of it runs during server rendering.

Returns `{ api, machine }`: `api` is the reactive view api to spread onto
elements; `machine` is the running service (also handed to `useSelector`).
Read `view.api.x` where you use it — **don't destructure** `api`
(`const { api } = useMachine(…)` captures one snapshot and loses reactivity).

### Why a props getter

React hands `useMachine` a fresh `props` value each render; a Svelte component's
script runs once, and its props are reactive bindings. Pass a getter and the
bridge reads the current props inside its effects. `() => props` (the
`$props()` object) is the usual form; a getter that builds its own object —
`() => ({ closeOnEscape, ...rest })`, to apply destructured defaults — works the
same, because effect deps are compared by value, not by which props the getter
read.

---

## `ComponentEffect` — platform effects, next to the component

Some behavior can't live in the agnostic machine because it needs the **platform
itself** — a DOM `keydown` listener for Escape, a `ResizeObserver` — and the
**props** the machine never sees (`closeOnEscape`). That's the component's
Svelte-side _effect_.

Each effect is a `[setup/teardown, depPropNames]` tuple (`ComponentEffect`) — the
**same shape as every other target**, so a component's effects are authored once
and run unchanged on React, Solid, and Svelte:

```ts
import type { ComponentEffect } from '@dunky.dev/svelte-state-machine'

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

`useMachine` runs the list — **one `$effect` per entry**. Each named dep is read
through its own `$derived`, so the effect re-runs (cleanup → setup) only when
one of those prop VALUES actually changes, never on unrelated changes; the body
runs `untrack`ed, so a prop it merely reads never becomes a hidden dependency.
The deps are prop NAMES — typed `(keyof Props)[]`, so a typo is a compile error —
and the authored list is the whole re-run contract, identical to every other
target. There is no rules-of-hooks constraint, but the list stays a module
constant by convention.

> The agnostic _decision_ lives in the core component's resolver; only the
> _transport_ (the DOM listener) is here. The machine just receives a plain event.

---

## `useSelector` — fine-grained subscription

Returns `{ current }`, which updates only when one slice of the machine changes:

```ts
const open = useSelector(machine, () => machine.matches('open'))
const isHL = useSelector(machine, () => machine.context.highlightedValue === value)
// read it in markup: <div data-open={open.current}></div>
```

`current` is raw state driven by the machine's `select` — a value-deduped
Selection — holding the selected value as the selector returned it. `Object.is`
by default; **an object/array selection MUST pass a custom `isEqual`** so a
re-derived equal value doesn't push a change:

```ts
const pos = useSelector(
  machine,
  () => ({ x: machine.context.x, y: machine.context.y }),
  (a, b) => a.x === b.x && a.y === b.y,
)
```

A selector may close over props (`value` above): when one changes, `current`
re-evaluates, and later machine changes compare against the new value. Like
`useMachine`, call it while a component initializes.

Reach for `useSelector` when a leaf wants to track one slice of a machine it
doesn't otherwise own — e.g. thousands of rows backed by one machine, each
waking only for its own value (`O(readers)`).

---

## `normalize` — agnostic bindings → DOM props

`connect` returns substrate-agnostic
[bindings](../core/README.md#connector--the-view-boundary) (`onPress`, `role`).
`normalize` translates them to the props a Svelte element spread expects:

```ts
const domProps = normalize(view.api.triggerProps) // { onclick, 'aria-expanded', role, tabindex, ... }
```

Same vocabulary as the
[React DOM normalizer](../react/README.md#normalize--agnostic-bindings--dom-props),
with Svelte's conventions where the prop name differs: event props are the DOM's
own lowercase attribute names (`onclick`, `onpointerenter`, `onkeydown` —
Svelte reads `onClick` as a `Click` event), `onValueChange` → `oninput`,
`onDoublePress` → `ondblclick`, and `focusable` → `tabindex` (`true → 0`,
`false → -1`). ARIA booleans pass through: Svelte writes `false` as the literal
`"false"` token, on the client and the server.
[Check out the full mapping here](./src/normalize.ts).

`undefined` values are dropped; any key not in the map (`class`, `data-*`) passes
through unchanged. `onValueChange`/`onWheel`/`onScroll`/`onScrollEnd` are wrapped
so the consumer receives the agnostic payload built from the native DOM event.

---

## `mergeProps` — consumer props + component props

When a consumer spreads their own props onto the same element the component
controls, `mergeProps(consumer, library)` merges them the Radix/Ark way, Svelte
flavor:

```svelte
<button {...mergeProps(rest, normalize(view.api.triggerProps))}>
```

- **Event handlers are chained, consumer-first** — Svelte's lowercase `onclick`
  as well as camelCase `on*` props. Both run, but if the consumer's handler
  marks the event `defaultPrevented`, the library handler is skipped (a clean
  veto).
- **`class` merges as `[consumer, library]`**, whatever its shape — Svelte
  resolves strings, arrays, and objects through clsx, so
  `class={['card', { active }]}` survives the merge.
- **`style` strings are joined**, the library's declarations last so they win.
- **Everything else: library wins** (`id`, `role`, `aria-*`).

---

## API

| Export                                        | What it is                                                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `useMachine(config, connect, effects, props)` | the bridge — build once + lifecycle + run effects + reactive snapshot; `props` is a getter; returns `{ api, machine }`           |
| `useSelector(machine, selector, isEqual?)`    | fine-grained subscription to a derived slice; returns `{ current }` (`O(readers)`)                                               |
| `normalize(bindings)`                         | agnostic bindings → Svelte DOM/ARIA props                                                                                        |
| `mergeProps(consumer, library)`               | merge consumer + component props (handlers chained w/ `defaultPrevented` veto; `class` as `[consumer, library]`; `style` joined) |
| `ComponentEffect<M, P>`                       | `[ (machine, props) => cleanup, (keyof P)[] ]` — one platform effect + its prop deps; pass a static list of them                 |
| `Bindings`                                    | `Record<string, unknown>` — the loose shape `normalize` accepts                                                                  |

---

## Svelte version support

Peer range: `svelte` `>=5.16.0 <5.33.5 || ^5.34.5` — Svelte 5, tested against
5.57.1. The bridge is written in runes, so Svelte 4 is not supported. The bounds
are measured, not guessed — the suite runs green on the range's edges (5.16.0,
5.33.4, 5.34.5) and on the last patch of every minor from 5.16 to 5.57 but 5.33:

- **5.16** is where Svelte started resolving `class` arrays and objects through
  clsx, which `mergeProps`'s `[consumer, library]` merge relies on.
- **5.33.5–5.34.4** kept the first non-delegated event handler of a spread
  ([sveltejs/svelte#16180](https://github.com/sveltejs/svelte/pull/16180)), so a
  re-rendered part's `onpointerenter`/`onfocus` called a stale `connect()`
  closure. Those releases are excluded.

### What a consumer needs

The package ships `.svelte.js` runes modules plus `.d.ts` files, built with
`@sveltejs/package`: like a component, it is compiled by **your** Svelte build.
Its `exports` resolve only through the `types` and `svelte` conditions, so use
it through Vite with `@sveltejs/vite-plugin-svelte` (or SvelteKit, which
includes it): the plugin resolves the `svelte` condition and compiles the
modules for the client and for SSR. Vitest needs nothing beyond that same
plugin — no `server.deps.inline`. A tool without the Svelte compiler fails at
resolution instead of loading uncompiled runes.
