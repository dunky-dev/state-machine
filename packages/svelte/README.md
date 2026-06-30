# `@dunky.dev/state-machine-svelte`

The **Svelte 5 bindings** for [`@dunky.dev/state-machine`](../core/README.md).
The core engine is renderer-agnostic; this package is the thin Svelte edge that
drives it: it builds the machine + connector, runs the Svelte lifecycle, bridges
the connector's snapshot into Svelte reactivity (runes), translates the agnostic
[bindings](../core/README.md#connector--the-view-boundary) vocabulary into DOM
props, and owns the per-component substrate effects.

Everything here is deliberately small — the behavior lives in the core machine
and the component's `connect`; this layer only adapts them to Svelte. There are
four exports: one bridge (`useMachine`, which also runs the component's substrate
effects), one leaf-subscription helper (`useSelector`), and two prop helpers
(`normalize`, `mergeProps`) — plus the `ComponentEffect` types.

> **Svelte 5 only.** `useMachine` and `useSelector` use runes (`$state`,
> `$effect`), so they ship as `.svelte.ts` modules and are compiled by your
> Svelte build (Vite plugin / SvelteKit), exactly like a component. The package
> ships its `src` uncompiled for that reason.

---

## `useMachine` — the one bridge

Every component's generated `useXxxApi` calls this with the agnostic pieces:

```svelte
<script lang="ts">
  const view = useMachine(
    tooltipMachineConfig, // (props) => config — config factory, props seed it ONCE
    connectTooltip, // pure connect(): snapshot → view api
    tooltipEffects, // the component's substrate effects (ComponentEffect[])
    () => props, // a GETTER for the resolved props (not a value)
  )
</script>

<button {...normalize(view.api.triggerProps)}>…</button>
```

It:

- **builds once** — `machine(createConfig(props))` + `connector(service, connect, props)`.
  The first props read seeds context and the initial state; recreating would lose
  state, so later prop changes flow through `setProps`, not a rebuild.
- **keeps props fresh** via an `$effect` calling `connection.setProps(getProps())`.
  `getProps()` reads the component's reactive props, so it re-runs when they
  change; `setProps` value-dedups, so an unchanged read doesn't churn.
- **runs the lifecycle**: `service.start()` on setup, `service.stop()` on destroy,
  wired in one `$effect` whose cleanup Svelte calls automatically. The connector
  wired its
  [reactions](../core/README.md#reactions--firing-prop-callbacks-without-the-machine-knowing)
  to the machine's own `start`/`stop`, so prop-callbacks follow with no teardown
  threading here.
- **runs the component's substrate effects** — one `$effect` per `ComponentEffect`
  entry, each reading only its named prop deps (see below).
- **exposes the snapshot** through a `$state`-backed `view.api` getter, seeded with
  the connector's initial snapshot and reassigned on each connector notify. The
  connector memoizes, so the identity changes only on a real change — reading
  `view.api` in markup updates only then.

Returns `{ api, machine }` (both getters): `api` is the `connect()` output to
spread onto elements; `machine` is the running service (also handed to
`useSelector`).

### Why a props getter

React hands `useMachine` a fresh `props` value each render. Svelte props are
reactive bindings, so the bridge instead takes `() => props` and reads it inside
its effects — that's how `setProps` and the substrate effects see current values
without a per-render call. Pass `() => props` (or `() => ({ ...resolved })` after
applying defaults).

---

## `ComponentEffect` — substrate transport, without the boilerplate

Some behavior can't live in the agnostic machine because it needs the **platform
itself** — a DOM `keydown` listener for Escape, a `ResizeObserver` — and the
**props** the machine never sees (`closeOnEscape`). That's the component's
Svelte-side _effect_.

Each effect is a `[setup/teardown, depPropNames]` tuple (`ComponentEffect`), the
**same shape as the React binding** — only how `useMachine` runs it differs:

```ts
import type { ComponentEffect } from '@dunky.dev/state-machine-svelte'

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

`useMachine` runs the list — **one `$effect` per entry**. Each effect reads only
its named props, so runes wake it _only when one of those values actually
changes_ (the precise-dependency behavior React got from a manual dep array, here
from automatic tracking) — never for an unrelated machine change. Returning the
setup's teardown lets Svelte clean it up on re-run / destroy.

> Unlike React there's no rules-of-hooks constraint, so the list need not be a
> module constant — but keeping it one (`export const xEffects = [...]`) stays the
> tidy convention.

> The agnostic _decision_ (gate + veto) belongs in the core component's resolver;
> only the _transport_ (the DOM listener) is here. Same split as everywhere:
> agnostic policy in core, platform wiring at the edge.

---

## `useSelector` — fine-grained leaf subscription

For a leaf that should update only when **one slice** of the machine changes (the
`O(readers)` path that matters at scale — thousands of items, each waking only for
its own value):

```ts
const open = useSelector(machine, () => machine.matches('open'))
// in markup: {#if open.current} … {/if}
```

It returns `{ current }` — a single reactive getter (a bare value can't carry its
reactivity across the `return`). The selector reads the machine directly and the
value updates only when the selected value changes — `Object.is` by default. **A
selector that returns a fresh object/array each call should pass a custom
`isEqual`** so an equal-but-new value isn't seen as a change:

```ts
const pos = useSelector(
  machine,
  () => ({ x: machine.context.x, y: machine.context.y }),
  (a, b) => a.x === b.x && a.y === b.y,
)
```

Internally it wraps the selector in one `Selection` and subscribes in an
`$effect`, writing a `$state` cell that `current` reads. The Selection's
value-dedup gates the update; there's no getSnapshot-identity hazard to guard
against (unlike React) because `$state` only notifies on reassignment.

**`useMachine` vs. `useSelector`.** `useMachine` drives the whole component off
the connector's snapshot (memoized, so it updates only on a real change).
`useSelector` is for _within_ that tree — a child that wants to track just one
field. Reach for it when a subtree is large enough that whole-snapshot updates are
wasteful.

---

## `normalize` — agnostic bindings → DOM props

`connect` returns substrate-agnostic [bindings](../core/README.md#connector--the-view-boundary)
(`onPress`, `describedBy`, `role`). `normalize` translates them to real DOM/ARIA
props in Svelte's idiom — lowercase `on*` events, `tabindex`, `aria-*`:

```ts
const domProps = normalize(view.api.triggerProps) // { onclick, 'aria-describedby', role, … }
```

The mapping mirrors the React DOM normalizer, with two Svelte differences: event
props are the **lowercase DOM names** (`onclick`, `onkeydown`) rather than
camelCase synthetic-event props, and `focusable` → `tabindex` (lowercase). The
`aria-*` names are identical — ARIA is part of the DOM, not the framework. A few
handlers whose agnostic payload differs from the raw event
(`onValueChange`/`onWheel`/`onScroll`/`onScrollEnd`) are wrapped so the consumer
receives the agnostic payload. `undefined` values are dropped, and any key not in
the map passes through unchanged.

---

## `mergeProps` — combine consumer props with the component's props

When a consumer spreads their own props onto the same element the component
controls, the two prop sets have to merge sensibly. `mergeProps(consumer, library)`
does it the Radix/Ark way:

```ts
const finalProps = mergeProps(consumerProps, normalize(view.api.triggerProps))
```

- **Event handlers are chained, consumer-first** — both run, the consumer's
  before the library's — **but if the consumer's handler marks the event
  `defaultPrevented`, the library handler is skipped.** Detection is on Svelte's
  lowercase `on*` props.
- **`style` is concatenated** as a string (Svelte styles are strings, not React's
  array form), joined with `; ` and trimmed. String + string only; else library
  wins.
- **`class` is concatenated** with a single space and trimmed (the Svelte
  attribute name, React's `className`). String + string only; else library wins.
- **Everything else: library wins** — the component owns its semantics (`id`,
  `role`, `aria-*`).

If the consumer passes no props, the library props are returned as-is.

---

## API

| Export                                           | What it is                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `useMachine(config, connect, effects, getProps)` | the bridge — build once + lifecycle + run the component effects + reactive snapshot; returns `{ api, machine }` (getters)       |
| `useSelector(machine, selector, isEqual?)`       | fine-grained subscription to a derived slice (`O(readers)`); returns `{ current }`                                              |
| `normalize(bindings)`                            | agnostic bindings → DOM/ARIA props (lowercase `on*`, `tabindex`, `aria-*`)                                                      |
| `mergeProps(consumer, library)`                  | merge consumer + component props (handlers chained w/ `defaultPrevented` veto; `style`/`class` concatenated; else library wins) |
| `ComponentEffect<M, P>`                          | `[ (machine, props) => cleanup, (keyof P)[] ]` — one substrate effect + its prop deps                                           |
| `ComponentEffects<M, P>`                         | `ComponentEffect<M, P>[]` — a component's effect list                                                                           |
| `Bindings`                                       | `Record<string, unknown>` — the loose shape `normalize` accepts                                                                 |
