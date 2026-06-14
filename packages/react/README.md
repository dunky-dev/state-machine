# `@chimba-ui/react-state-machine`

The **React bindings** for [`@chimba-ui/state-machine`](../core/README.md).
The core engine is renderer-agnostic; this package is the thin React edge that
drives it: it builds the machine + connector, runs the React lifecycle, bridges
the connector's snapshot into React rendering, translates the agnostic
[bindings](../core/README.md#connector--the-view-boundary) vocabulary into DOM
props, and owns the per-component substrate effects.

Everything here is deliberately small — the behavior lives in the core machine
and the component's `connect`; this layer only adapts them to React. There are
four exports: one bridge hook (`useMachine`, which also runs the component's
substrate effects), one leaf-subscription hook (`useSelector`), and two prop
helpers (`normalize`, `mergeProps`) — plus the `ComponentEffect` types.

---

## `useMachine` — the one bridge hook

Every component's generated `useXxxApi` calls this with the agnostic pieces:

```ts
const { api, machine } = useMachine(
  tooltipMachineConfig, // (props) => config  — config factory, props seed it ONCE
  connectTooltip, // pure connect(): snapshot → view api
  tooltipEffects, // the component's substrate effects (ComponentEffect[])
  resolved, // props with defaults applied
)
```

It:

- **builds once** (in `useMemo` with an empty dep array) —
  `machine(createConfig(props))` + `connector(service, connect, props)`. The
  first render's props seed context and the initial state; recreating would lose
  state, so later prop changes flow through `setProps`, not a rebuild.
- **keeps props fresh** via a passive effect (`connection.setProps(props)`) —
  never during render (writing the props signal mid-render would notify
  `useSyncExternalStore` and loop with _"cannot update a component while
  rendering"_). The connector was seeded with the first render's props in
  `useMemo`, so the initial snapshot is already correct; this only pushes
  _subsequent_ changes. `setProps` value-dedups, so a consumer that rebuilds an
  equal props object each render doesn't churn.
- **runs the lifecycle**: `service.start()` on mount, `service.stop()` on unmount.
  The connector wired its
  [reactions](../core/README.md#reactions--firing-prop-callbacks-without-the-machine-knowing)
  to the machine's own `start`/`stop`, so prop-callbacks follow automatically
  (StrictMode mount→unmount→mount included), with no teardown threading here.
- **runs the component's substrate effects** — one `useEffect` per
  `ComponentEffect` entry, each keyed on its named prop deps (see below). The
  generated `useApi` no longer touches React directly; passing the effects list
  here is all it does.
- **drives React** via
  `useSyncExternalStore(connection.subscribe, () => connection.snapshot)` over the
  connector's stable, memoized snapshot — its identity only changes on a real
  change, so there's no infinite-loop / tearing.

Returns `{ api, machine }`: `api` is the `connect()` output to spread onto
elements; `machine` is the running service (also handed to `useSelector`).

---

## `ComponentEffect` — substrate transport, without the boilerplate

Some behavior can't live in the agnostic machine because it needs the **platform
itself** — a DOM `keydown` listener for Escape, a `ResizeObserver` — and the
**props** the machine never sees (`closeOnEscape`, a prevent-able
`onEscapeKeyDown` veto). That's the component's React-side _effect_.

Each effect is a `[setup/teardown, depPropNames]` tuple (`ComponentEffect`). A
component declares one named const per effect — aliasing the type once keeps the
annotations short — and exports a flat list. **No React in the component file** —
the generated `useApi` owns the `useEffect`s:

```ts
// a target component's effects.ts (illustrative — components live outside this repo)
import type { ComponentEffect } from '@chimba-ui/react-state-machine'

type TooltipEffect = ComponentEffect<TooltipMachine, TooltipMachineProps>

/** Escape-to-close (gated by closeOnEscape; honors the onEscapeKeyDown veto). */
const trackEscape: TooltipEffect = [
  (machine, props) => {
    if (!props.closeOnEscape) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // defer the decision to the agnostic resolver; act on its verdict
      if (resolveEscape({ ...props, state: machine.state }).close) {
        e.stopPropagation()
        machine.send({ type: 'escape' })
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  },
  ['closeOnEscape', 'onEscapeKeyDown'], // ← re-run only when these props change
]

// a component with more effects adds more named consts, each with its OWN deps:
// const tabTrap: TooltipEffect = [tabFn, ['focusTrap']]
export const tooltipEffects = [trackEscape]
```

Named consts over inline tuples: each effect gets a label (`trackEscape`), the
export is a flat readable list (no `[[…],[…]]` nesting), and each effect's deps
sit next to it. The export type is inferred (`ComponentEffect[]`).

`useMachine` runs the list — **one `useEffect` per entry**, each with a **precise
dependency array** built from that entry's named props (so the component file
never touches React):

```ts
// inside useMachine, after start():
//   for each [fn, deps] of effects:
//     useEffect(() => fn(machine, resolved), [machine, ...deps.map(k => resolved[k])])
```

**Why a list of per-effect deps** (not one combined set): each effect
re-subscribes only when _its own_ deps change — toggling `focusTrap` doesn't
churn the Escape listener.

**Why named deps** (not the whole props object): `resolved` is a fresh object
every render, so `[machine, resolved]` would re-run **every render**. Naming the
props — typed `(keyof Props)[]`, so a typo is a compile error — re-runs an effect
_only when one of its values actually changes_, never stale. `machine` is always
an implicit dep.

> The list **must be a static module constant** — `useMachine` calls one hook per
> entry, so its length can't vary between renders (rules-of-hooks). Declaring it
> as `export const xEffects = [...]` guarantees that; never build it conditionally
> or per-render.

> The agnostic _decision_ (gate + veto) lives in the core component's resolver
> (`resolveEscape`); only the _transport_ (the DOM listener) is here. Same split
> as everywhere: agnostic policy in core, platform wiring at the edge. The machine
> just receives a plain `escape` event. This is the React counterpart of a core
> `effect` — but one that may read props and touch the DOM, which a core effect
> can't.

---

## `useSelector` — fine-grained leaf subscription

For a leaf component that should re-render only when **one slice** of the machine
changes (not on every machine change) — the `O(readers)` path that matters at
scale (e.g. thousands of menu items, each re-rendering only when _its own_
highlighted state flips):

```ts
const open = useSelector(machine, () => machine.matches('open'))
const isHL = useSelector(machine, () => machine.context.highlightedValue === value)
```

The selector reads from the machine directly, so it auto-subscribes to exactly
the fields it touches (the same auto-tracking the core's
[`select`](../core/README.md#subscriptions--observing-changes) gives you); the
component re-renders only when the selected value changes — `Object.is` by
default, or pass a custom `isEqual` for object selections:

```ts
const pos = useSelector(
  machine,
  () => ({ x: machine.context.x, y: machine.context.y }),
  (a, b) => a.x === b.x && a.y === b.y,
)
```

Internally it wraps the selector in one memoized `Selection` and feeds it through
`useSyncExternalStore`, caching the value in a ref so `getSnapshot` stays
referentially stable between real changes.

**`useMachine` vs. `useSelector`.** `useMachine` is the per-instance bridge: it
drives the whole component off the connector's coarse snapshot (the connector
already memoizes, so a render only happens on a real change). `useSelector` is for
_within_ that tree — a child that wants to re-render on just one field, decoupled
from the parent's snapshot. Reach for it when a component subtree is large enough
that whole-snapshot re-renders are wasteful.

---

## `normalize` — agnostic bindings → DOM props

`connect` returns substrate-agnostic [bindings](../core/README.md#connector--the-view-boundary)
(`onPress`, `describedBy`, `role`). `normalize` translates them to real DOM/ARIA
props so the same `connect` can target DOM, React Native, or canvas — each via its
own `normalize`:

```ts
const domProps = normalize(api.triggerProps) // { onClick, aria-describedby, role, ... }
```

The mapping:

| Agnostic binding                                              | DOM/ARIA prop                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| `onPress`                                                     | `onClick`                                                           |
| `onPointerEnter/Leave/Move/Down`, `onFocus/Blur`, `onKeyDown` | same name (already DOM-shaped)                                      |
| `describedBy` / `labelledBy`                                  | `aria-describedby` / `aria-labelledby`                              |
| `expanded` / `selected` / `disabled` / `hidden`               | `aria-expanded` / `aria-selected` / `aria-disabled` / `aria-hidden` |
| `focusable`                                                   | `tabIndex` (`true → 0`, `false → -1`)                               |
| `role` / `id`                                                 | `role` / `id`                                                       |

`undefined` values are dropped, and any key not in the map passes through
unchanged — so a binding the renderer already understands needs no entry.

---

## `mergeProps` — combine consumer props with the component's props

When a consumer spreads their own props onto the same element the component
controls (`<Trigger onClick={mine} className="mine">`), the two prop sets have to
merge sensibly. `mergeProps(consumer, library)` does it the Radix/Ark way:

```ts
const finalProps = mergeProps(consumerProps, normalize(api.triggerProps))
```

- **Event handlers are chained, consumer-first.** Both run, the consumer's
  before the library's — **but if the consumer's handler marks the event
  `defaultPrevented`, the library handler is skipped.** So a consumer can veto the
  component's behavior (e.g. prevent a click from toggling) by calling
  `e.preventDefault()`. (A key counts as a handler when it's `on` + an uppercase
  letter, e.g. `onClick`, `onKeyDown`.)
- **`style` is merged, not overwritten.** If both sides set `style`, the result is
  an array `[consumerStyle, libraryStyle]` (the React array-style form; the later
  entry wins on conflicting keys). If only one side sets it, that one is kept.
- **`className` is concatenated** with a single space and trimmed at the edges
  (`'a b'` + `'c'` → `'a b c'`). Inner spacing is preserved verbatim; the concat
  only applies when _both_ sides are strings.
- **Everything else: library wins.** A plain attr the component sets (`id`,
  `role`, `aria-*`) overrides the consumer's — the component owns its semantics.

If the consumer passes no props, the library props are returned as-is.

---

## API

| Export                                        | What it is                                                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `useMachine(config, connect, effects, props)` | the bridge hook — build once + lifecycle + run the component effects + `useSyncExternalStore`; returns `{ api, machine }`     |
| `useSelector(machine, selector, isEqual?)`    | fine-grained subscription to a derived slice (`O(readers)`)                                                                   |
| `normalize(bindings)`                         | agnostic bindings → DOM/ARIA props                                                                                            |
| `mergeProps(consumer, library)`               | merge consumer + component props (handlers chained w/ `defaultPrevented` veto; `style`/`className` merged; else library wins) |
| `ComponentEffect<M, P>`                       | `[ (machine, props) => cleanup, (keyof P)[] ]` — one substrate effect + its prop deps                                         |
| `ComponentEffects<M, P>`                      | `ComponentEffect<M, P>[]` — a component's effect list (static module constant)                                                |
| `Bindings`                                    | `Record<string, unknown>` — the loose shape `normalize` accepts                                                               |
