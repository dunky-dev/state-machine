# `@dunky.dev/react-state-machine`

The **React bindings** for [`@dunky.dev/state-machine`](../core/README.md).

The behavior lives in the core machine — plain TypeScript, no renderer. This
package is the thin React edge that runs it. It does four things:

1. **`useMachine`** — build the machine once, run its lifecycle, re-render when
   it changes, run the component's platform effects.
2. **`useSelector`** — re-render a leaf component only when one slice changes.
3. **`normalize`** — translate the machine's agnostic bindings (`onPress`,
   `checked`) into real DOM props (`onClick`, `aria-checked`).
4. **`mergeProps`** — merge the consumer's props with the component's.

```
  core (agnostic)
  |
  |   config + connect()      behavior + snapshot -> view api
  |
  v
  this package (React)
  |
  |   useMachine              build + start the machine, subscribe
  |   |
  |   v
  |   api                     the view surface instructions
  |   |
  |   v
  |   normalize()             DOM / ARIA / events
  |
  v
  <button {...props}>
```

## Quick start

A tooltip, end to end — the behavior (core), the surface (`connect`), and the
React component (this package):

```tsx
import { setup } from '@dunky.dev/state-machine'
import { useMachine, normalize } from '@dunky.dev/react-state-machine'

type TooltipProps = { defaultOpen?: boolean }

// 1 — behavior: a plain state machine. No React in sight.
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
//     Note the agnostic vocabulary: describedBy, not aria-describedby.
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

// 3 — the React edge: build + run the machine, render from its api.
const tooltipEffects = [] // no platform effects yet; must be a static constant

export function Tooltip(props: TooltipProps) {
  const { api } = useMachine(tooltipConfig, connectTooltip, tooltipEffects, props)
  return (
    <>
      <button {...normalize(api.triggerProps)}>Hover me</button>
      {api.open && <div {...normalize(api.contentProps)}>I'm a tooltip</div>}
    </>
  )
}
```

What happened:

- `useMachine` built the machine and connector **once** (the first render's
  props seeded the initial state), started it on mount, stops it on unmount.
- Hovering sends plain events; the machine handles the 300ms open delay
  itself (`after`) — no `setTimeout` in the component.
- The component re-renders only when the `connect()` output actually changes.
- `normalize` turned `describedBy` into `aria-describedby` — the same
  `connect` could drive React Native or a canvas through _their_ `normalize`.

That's the whole model. Everything below is reference.

---

## `useMachine` — the bridge hook

One call per component instance. (In the full Dunky pipeline a component's
generated `useXxxApi` makes this call; hand-written components call it
directly, the same way.)

```ts
const { api, machine } = useMachine(createConfig, connect, effects, props)
```

| Argument       | What it is                                                                 |
| -------------- | -------------------------------------------------------------------------- |
| `createConfig` | `(props) => config` — called **once**, with the first render's props       |
| `connect`      | pure `connect()`: snapshot → the api the view spreads                      |
| `effects`      | the component's `ComponentEffect[]` — static module constant; `[]` if none |
| `props`        | current props, defaults already applied                                    |

Returns `{ api, machine }` — `api` to render from; `machine` to `send` to and
to hand to `useSelector`.

What it guarantees:

- **Builds once.** Machine + connector are created on the first render and
  never rebuilt (rebuilding would lose state). Later prop changes flow through
  `setProps` — value-deduped, and applied in a passive effect, never during
  render (a mid-render store write would notify `useSyncExternalStore` and
  loop). Consequence: **props seed the machine once** — initial state and
  context come from the first render; after that, changed props reach the
  component through the connector, not a rebuild.
- **Lifecycle.** `start()` on mount, `stop()` on unmount — StrictMode's
  mount → unmount → mount included. The connector's
  [reactions](../core/README.md#reactions--firing-prop-callbacks-without-the-machine-knowing)
  (prop callbacks) follow the machine's lifecycle automatically.
- **Platform effects.** One `useEffect` per `ComponentEffect` entry, each
  keyed on its own named prop deps (see next section).
- **Rendering.** `useSyncExternalStore` over the connector's memoized
  snapshot — its identity changes only on a real change, so no tearing and no
  render loops.

---

## `ComponentEffect` — platform effects, next to the component

Some behavior can't live in the agnostic machine because it needs the
**platform** (a DOM `keydown`, a `ResizeObserver`) or the **props** the machine
[never sees](../core/README.md#the-machine-never-sees-props). That behavior is
a `ComponentEffect`: a `[setup/teardown, depPropNames]` tuple, declared as a
named const — **no React in the component file**; `useMachine` owns the
`useEffect`s.

```ts
import type { ComponentEffect } from '@dunky.dev/react-state-machine'

type TooltipEffect = ComponentEffect<TooltipMachine, TooltipMachineProps>

/** Escape-to-close — the DOM transport for a decision the core resolver makes. */
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
  ['closeOnEscape', 'onEscapeKeyDown'], // re-run only when THESE props change
]

export const tooltipEffects = [trackEscape]
```

The rules, and why:

- **Declare the list once, at module level.** Each entry becomes a `useEffect`
  call, and React forbids a changing number of hooks — so never add/remove
  entries conditionally or build the array inside the component.
- **Deps are prop names.** They become the `useEffect` dep array, so the
  effect re-runs only when one of those props changes.
- **Each effect has its own dep list, not one shared set.** A prop change
  re-runs only the effects that declared that prop.

---

## `useSelector` — fine-grained subscription

For a leaf that should re-render only when **one slice** of the machine
changes — the `O(readers)` path that matters at scale (thousands of menu
items, each re-rendering only when _its own_ highlight flips):

```ts
const open = useSelector(machine, () => machine.matches('open'))
const isHL = useSelector(machine, () => machine.context.highlightedValue === value)
```

Re-renders only when the selected value changes (`Object.is` by default).

> **A selector returning a fresh object/array each call MUST pass a custom
> `isEqual`** — otherwise every read is a "new" value and the component
> re-renders in a loop. Prefer selecting primitives; reach for `isEqual` when
> you genuinely need a composite:

```ts
const pos = useSelector(
  machine,
  () => ({ x: machine.context.x, y: machine.context.y }),
  (a, b) => a.x === b.x && a.y === b.y,
)
```

**vs `useMachine`:** `useMachine` re-renders the component on any machine
change; `useSelector` re-renders a child on one field.

---

## `normalize` — agnostic bindings → DOM props

`connect` returns substrate-agnostic
[bindings](../core/README.md#connector--the-view-boundary); `normalize`
translates them into real DOM/ARIA props:

```ts
const domProps = normalize(api.triggerProps) // { onClick, aria-describedby, role, ... }
```

The machine binding maps handlers (`onPress` → `onClick`), ARIA props
(`describedBy` → `aria-describedby`), ARIA state (`checked` → `aria-checked`),
and focus (`focusable` → `tabIndex`). [Check out the full mapping here](./src/normalize.ts).

---

## `mergeProps` — consumer props + component props

When a consumer spreads their own props onto an element the component controls
(`<Component onClick={mine}>`), merge them:

```ts
const finalProps = mergeProps(ownProps, normalize(api.triggerProps))
```

- **Handlers chain, consumer-first** — both run, unless the consumer's handler
  marks the event `defaultPrevented`, which **skips the library handler**. A key
  counts as a handler when it's `on` + an uppercase letter (`onClick`, `onKeyDown`).
- **`style` merges** — when both sides set it, the result is the React
  array-style form `[consumerStyle, libraryStyle]` (later entry wins per key).
- **`className` concatenates** — `'a b'` + `'c'` → `'a b c'` (only when both
  sides are strings).
- **Everything else: library wins** — the component owns its semantics (`id`,
  `role`, `aria-*`).

---

## API

| Export                                        | What it is                                                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `useMachine(config, connect, effects, props)` | the bridge hook — build once + lifecycle + component effects + subscribe; returns `{ api, machine }`                          |
| `useSelector(machine, selector, isEqual?)`    | fine-grained subscription to a derived slice (`O(readers)`)                                                                   |
| `normalize(bindings)`                         | agnostic bindings → DOM/ARIA props                                                                                            |
| `mergeProps(consumer, library)`               | merge consumer + component props (handlers chained w/ `defaultPrevented` veto; `style`/`className` merged; else library wins) |
| `ComponentEffect<M, P>`                       | `[ (machine, props) => cleanup, (keyof P)[] ]` — one platform effect + its prop deps; pass a static list of them              |
| `Bindings`                                    | `Record<string, unknown>` — the loose shape `normalize` accepts                                                               |
