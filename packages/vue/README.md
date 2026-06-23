# `@dunky.dev/state-machine-vue`

The **Vue 3 bindings** for [`@dunky.dev/state-machine`](../core/README.md). The
core engine is renderer-agnostic; this package is the thin Vue edge that drives
it: it builds the machine + connector, runs the Vue lifecycle, bridges the
connector's snapshot into Vue reactivity, translates the agnostic
[bindings](../core/README.md#connector--the-view-boundary) vocabulary into DOM
props, and owns the per-component substrate effects.

Everything here is deliberately small — the behavior lives in the core machine
and the component's `connect`; this layer only adapts them to Vue. There are
four exports: one bridge composable (`useMachine`, which also runs the
component's substrate effects), one leaf-subscription composable (`useSelector`),
and two prop helpers (`normalize`, `mergeProps`) — plus the `ComponentEffect`
types. The export names and signatures match the
[React package](../react/README.md) one-for-one; only the implementation is Vue.

---

## `useMachine` — the one bridge composable

Every component's generated `useXxxApi` calls this with the agnostic pieces:

```ts
const { api, machine } = useMachine(
  tooltipMachineConfig, // (props) => config  — config factory, props seed it ONCE
  connectTooltip, // pure connect(): snapshot → view api
  tooltipEffects, // the component's substrate effects (ComponentEffect[])
  props, // the component's reactive props (a getter / ref also works)
)
```

It:

- **builds once** — `machine(createConfig(props))` + `connector(service, connect, props)`.
  Vue `setup()` runs once per instance, so these are plain consts (no memo). The
  props read at setup seed context and the initial state; recreating would lose
  state, so later prop changes flow through `setProps`, not a rebuild.
- **keeps props fresh** via `watch(props, p => connection.setProps(p))`. Vue's
  `props` object keeps a stable identity and mutates its fields in place, so the
  watch is `deep`; `setProps` value-dedups, so an equal-valued update doesn't
  recompute the snapshot.
- **runs the lifecycle**: `service.start()` on `onMounted`, `service.stop()` on
  `onBeforeUnmount`. The connector wired its
  [reactions](../core/README.md#reactions--firing-prop-callbacks-without-the-machine-knowing)
  to the machine's own `start`/`stop`, so prop-callbacks follow automatically with
  no teardown threading here.
- **runs the component's substrate effects** — one `watch` per `ComponentEffect`
  entry, sourced on its named prop deps (see below). The generated `useApi` never
  touches Vue directly; passing the effects list here is all it does.
- **drives Vue** via a `shallowRef` mirrored from the connector's stable,
  memoized snapshot (updated on `connection.subscribe`), exposed as a `computed`.
  Its identity only changes on a real change, so reads stay stable — no tearing,
  no over-rendering.

Returns `{ api, machine }`: `api` is a `ComputedRef` of the `connect()` output
(read `api.value`, or unwrap it in a template); `machine` is the running service
(also handed to `useSelector`).

---

## `ComponentEffect` — substrate transport, without the boilerplate

Some behavior can't live in the agnostic machine because it needs the **platform
itself** — a DOM `keydown` listener for Escape, a `ResizeObserver` — and the
**props** the machine never sees (`closeOnEscape`, a prevent-able
`onEscapeKeyDown` veto). That's the component's Vue-side _effect_.

Each effect is a `[setup/teardown, depPropNames]` tuple (`ComponentEffect`). A
component declares one named const per effect and exports a flat list. **No Vue
in the component file** — the generated `useApi` owns the `watch`es:

```ts
// a target component's effects.ts (illustrative — components live outside this repo)
import type { ComponentEffect } from '@dunky.dev/state-machine-vue'

type TooltipEffect = ComponentEffect<TooltipMachine, TooltipMachineProps>

/** Escape-to-close (gated by closeOnEscape; honors the onEscapeKeyDown veto). */
const trackEscape: TooltipEffect = [
  (machine, props) => {
    if (!props.closeOnEscape) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
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

export const tooltipEffects = [trackEscape]
```

`useMachine` runs the list — **one `watch` per entry**, each sourced on that
entry's named props (so the component file never touches Vue):

```ts
// inside useMachine, for each [fn, deps] of effects:
//   watch(
//     deps.map(k => () => props[k]), // an ARRAY OF GETTERS, value-compared per entry
//     (_n, _p, onCleanup) => { const off = fn(machine, props); if (off) onCleanup(off) },
//     { immediate: true },
//   )
```

**Why a list of per-effect deps** (not one combined set): each effect re-runs only
when _its own_ deps change — toggling `focusTrap` doesn't churn the Escape
listener. **Why an array of getters** (not one getter returning an array): Vue
value-compares each entry and each getter touches only its own prop key, so a
change to a _non-dep_ prop never re-runs the effect — a single getter returning a
fresh array would fire on every prop change, since its identity always differs.
`machine` is always an implicit dep.

> The agnostic _decision_ (gate + veto) lives in the core component's resolver
> (`resolveEscape`); only the _transport_ (the DOM listener) is here. The machine
> just receives a plain `escape` event. This is the Vue counterpart of a core
> `effect` — but one that may read props and touch the DOM, which a core effect
> can't.

---

## `useSelector` — fine-grained leaf subscription

For a leaf component that should update only when **one slice** of the machine
changes (not on every machine change) — the `O(readers)` path that matters at
scale (e.g. thousands of menu items, each waking only when _its own_ highlighted
state flips):

```ts
const open = useSelector(machine, () => machine.matches('open'))
const isHL = useSelector(machine, () => machine.context.highlightedValue === value)
```

It returns a **readonly ref**. The selector reads from the machine directly; the
ref updates only when the selected value changes — `Object.is` by default. **A
selector that returns a fresh object/array each call should pass a custom
`isEqual`** so an equal value doesn't bump the ref:

```ts
const pos = useSelector(
  machine,
  () => ({ x: machine.context.x, y: machine.context.y }),
  (a, b) => a.x === b.x && a.y === b.y,
)
```

Internally it wraps the selector in one machine `Selection` and feeds its
value-deduped notifications into a `shallowRef`, disposing on scope teardown.

**`useMachine` vs. `useSelector`.** `useMachine` is the per-instance bridge: it
drives the whole component off the connector's coarse snapshot (the connector
already memoizes, so it only changes on a real change). `useSelector` is for
_within_ that tree — a child that wants to update on just one field, decoupled
from the parent's snapshot. Reach for it when a subtree is large enough that
whole-snapshot updates are wasteful.

---

## `normalize` — agnostic bindings → DOM props

`connect` returns substrate-agnostic [bindings](../core/README.md#connector--the-view-boundary)
(`onPress`, `describedBy`, `role`). `normalize` translates them to real DOM/ARIA
props in Vue's `onXxx` listener form, so the same `connect` can target DOM, React,
or canvas — each via its own `normalize`:

```ts
const domProps = normalize(api.triggerProps) // { onClick, 'aria-describedby', role, ... }
// spread onto an element: h('button', normalize(api.triggerProps)) or v-bind="..."
```

The mapping mirrors React's, with the Vue-appropriate names:

| Agnostic binding                                                                                | Vue DOM prop                                                                        |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `onPress`                                                                                       | `onClick`                                                                           |
| `onValueChange`                                                                                 | `onInput` (wrapped → `ChangePayload`; fires live, like React's `onChange`)          |
| `onContextMenu` / `onDoublePress`                                                               | `onContextmenu` / `onDblclick`                                                      |
| `onWheel` / `onScroll` / `onScrollEnd`                                                          | `onWheel` / `onScroll` / `onScrollend` (wrapped → `WheelPayload` / `ScrollPayload`) |
| `onPointerEnter/Leave/Move/Down/Up/Cancel`                                                      | `onPointerenter` / `onPointerleave` / … (Vue listener casing)                       |
| `onFocus` / `onBlur` / `onKeyDown` / `onKeyUp`                                                  | `onFocus` / `onBlur` / `onKeydown` / `onKeyup`                                      |
| `describedBy` / `labelledBy` / `controls` / `label`                                             | `aria-describedby` / `aria-labelledby` / `aria-controls` / `aria-label`             |
| `expanded` / `selected` / `disabled` / `hidden` / `modal`                                       | `aria-expanded` / `aria-selected` / `aria-disabled` / `aria-hidden` / `aria-modal`  |
| `checked` / `pressed` / `current` / `busy` / `invalid` / `required` / `readOnly`                | matching `aria-*` (value untransformed)                                             |
| `valueMin/Max/Now/Text`                                                                         | `aria-valuemin` / `-valuemax` / `-valuenow` / `-valuetext`                          |
| `orientation` / `sort` / `autoComplete` / `level` / `posInSet` / `setSize` / grid `col*`/`row*` | the matching `aria-*` attr                                                          |
| `activeDescendant` / `errorMessage` / `owns` / `hasPopup`                                       | `aria-activedescendant` / `-errormessage` / `-owns` / `-haspopup`                   |
| `live` / `atomic`                                                                               | `aria-live` / `aria-atomic`                                                         |
| `focusable`                                                                                     | `tabindex` (`true → 0`, `false → -1`)                                               |
| `role` / `id`                                                                                   | `role` / `id`                                                                       |

A few handlers whose agnostic payload differs from the raw event
(`onValueChange`/`onWheel`/`onScroll`/`onScrollEnd`) are wrapped so the consumer
receives the agnostic payload, not the DOM event. `undefined` values are dropped,
and any key not in the map passes through unchanged — so a binding the renderer
already understands needs no entry.

---

## `mergeProps` — combine consumer props with the component's props

When a consumer spreads their own props onto the same element the component
controls, the two prop sets have to merge sensibly. `mergeProps(consumer, library)`
does it the Radix/Ark way, with Vue's `class`/`style` conventions:

```ts
const finalProps = mergeProps(consumerProps, normalize(api.triggerProps))
```

- **Event handlers are chained, consumer-first** — both run, the consumer's
  before the library's, **but if the consumer's handler marks the event
  `defaultPrevented`, the library handler is skipped** (a clean veto). (A key
  counts as a handler when it's `on` + an uppercase letter.)
- **`style` is merged, not overwritten.** If both sides set `style`, the result is
  the Vue array form `[consumerStyle, libraryStyle]` (later entry wins on
  conflicting keys). If only one side sets it, that one is kept.
- **`class` is concatenated** with a single space and trimmed at the edges, when
  both sides are strings. (Vue's `class` also accepts arrays/objects; those fall
  through to library-wins.)
- **Everything else: library wins.** A plain attr the component sets (`id`, `role`,
  `aria-*`) overrides the consumer's — the component owns its semantics.

If the consumer passes no props, the library props are returned as-is.

---

## API

| Export                                        | What it is                                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `useMachine(config, connect, effects, props)` | the bridge composable — build once + lifecycle + run the component effects + reactive snapshot; returns `{ api, machine }` |
| `useSelector(machine, selector, isEqual?)`    | fine-grained subscription to a derived slice as a readonly ref (`O(readers)`)                                              |
| `normalize(bindings)`                         | agnostic bindings → Vue DOM/ARIA props                                                                                     |
| `mergeProps(consumer, library)`               | merge consumer + component props (handlers chained w/ `defaultPrevented` veto; `class`/`style` merged; else library wins)  |
| `ComponentEffect<M, P>`                       | `[ (machine, props) => cleanup, (keyof P)[] ]` — one substrate effect + its prop deps                                      |
| `ComponentEffects<M, P>`                      | `ComponentEffect<M, P>[]` — a component's effect list                                                                      |
| `Bindings`                                    | `Record<string, unknown>` — the loose shape `normalize` accepts                                                            |
