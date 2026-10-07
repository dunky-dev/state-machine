# SPEC - `@dunky.dev/react-state-machine`

## Overview

The React target runs one core machine inside one React component. The
behavior lives in the core machine and in the component's `connect`. This
package adds only what React needs: a lifecycle hook, a selector hook, a
translator from bindings to DOM props, and a prop merger.

```
  machine source        connect       component effects       props
  (config or machine)   (pure)        (static list)           (each render)
        |                  |                 |                     |
        v                  v                 v                     v
  +-------------------------------------------------------------------+
  |  the lifecycle hook  -  one call per component instance           |
  |                                                                   |
  |    first render ..... build the machine + connector, once         |
  |    mount ............ start the machine;  unmount: stop it        |
  |    after a render ... push the current props into the connector   |
  |    any change ....... re-render from the connector's surface      |
  |    each effect ...... re-run it when its named props change       |
  +-------------------------------------------------------------------+
        |                                     |
        |  surface (api)                      |  machine
        v                                     v
  translator: bindings --> DOM props    the selector hook: a leaf
        |                               re-renders on one value
        v
  <element {...props}>
```

## Intent

Bridge one machine into React with as little React as possible. A
component's behavior files stay free of React: the machine, `connect`, and
the component effects are plain values. The lifecycle hook makes every
React hook call for them.

The bridge makes three promises. The machine is built once and lives as
long as the component. The view renders from a stable surface, so React
never tears and never loops. A leaf can subscribe to one value, so a change
wakes only the readers of that value (`O(readers)`).

## Scope & boundaries

**In scope.** The lifecycle hook, the selector hook, the translator from
bindings to React DOM props, and the prop merger.

**Out of scope — invariants, not preferences.**

- **No state of its own.** The target reads the machine through the
  connector. It does not mirror context, fork the state graph, or shadow
  transitions. New state goes in core.
- **The machine never sees props.** The first props reach the source
  factory once. After that, props reach the connector and the component
  effects, never the machine. See
  [the core rule](../core/SPEC.md#the-machine-never-sees-props).
- **Platform quirks live here, as component effects.** An effect that needs
  props or a platform API (a DOM `keydown`, a `ResizeObserver`) is a
  component effect. Core makes the decision; the effect only listens and
  sends a plain event. Props-free, platform-free effects stay in the core
  config (see
  [Two homes for a side-effect](../../ARCHITECTURE.md#two-homes-for-a-side-effect)).
- **The hooks use React only.** They touch no DOM API, because other React
  renderers reuse them: the React Native target re-exports both hooks, and
  the OpenTUI sandbox pairs them with the OpenTUI translator. Only the
  translator and the prop merger are DOM-specific.

## The behavior contract

These are the guarantees the bridge gives. They describe what it does, not
the names it exports.

### The machine source

- The first argument is a factory. The hook calls it with the first
  render's props. It returns a **config** or a **ready machine** (for
  example, a Rust machine wrapped with `fromWasm`).
- A config is built into a stopped machine. A ready machine is used as is:
  the hook returns that same instance. A target cannot tell the two kinds
  apart (see [core Intent](../core/SPEC.md#intent)).
- The hook owns the machine's lifecycle in both cases. So a ready machine
  must come fresh from the factory, one per component instance. Sharing one
  machine between components is not supported: when one instance unmounts,
  it stops the machine for all of them.

### Lifecycle

- **Build once.** The machine and its connector are built on the first
  render and never rebuilt. A rebuild would lose state.
- **Start on mount, stop on unmount.** A StrictMode mount, unmount, and
  mount runs start, stop, start. This is safe because a stop keeps state
  and a restart boots from the current state (see
  [core Lifecycle](../core/SPEC.md#lifecycle)).
- **The hook never destroys the connector.** The connector shares the
  machine's lifetime. A destroy on unmount would break the StrictMode
  remount, which reuses the same memoized connector.
- **Reactions follow the machine.** The connector wires its reactions on
  start and removes them on stop (see
  [the connector](../core/SPEC.md#the-view-boundary--the-connector)). So a
  prop callback fires only while the component is mounted, and never on
  subscribe.

### Props

- The first render's props seed the machine (through the factory) and the
  connector.
- After each render commits, the hook pushes the current props into the
  connector. It never does this during render: a store write mid-render
  notifies React's external-store subscription and loops.
- The connector ignores props that are shallow-equal to the current props.
  A re-render with equal props keeps the same surface.

### Rendering

- The component re-renders on every machine change and on every real props
  change. React reads the connector's memoized surface through its
  external-store subscription.
- The surface keeps its identity between changes, so React never tears and
  never loops.
- The hook returns the surface and the machine. The view renders from the
  surface. The machine is for sending events and for the selector hook.

### Component effects

- A component effect is a pair: a setup function of the machine and the
  props, which can return a cleanup; and the names of the props it depends
  on. The names are typed against the props, so a typo does not compile.
- Each effect runs as its own React effect. Setup runs after mount. Cleanup
  runs on unmount.
- An effect re-runs (cleanup, then setup) only when one of its own named
  props changes. A change to any other prop does not re-run it, not even a
  new callback identity.
- The effect list must be a static module constant. Each entry is one React
  hook call, and React forbids a changing hook count.
- An effect sees the props of the render that last ran it. If it reads a
  prop later (for example, a callback inside a listener), that prop must be
  in its dep list. If not, the effect reads a stale value.
- The machine that an effect gets is live: it can read the current state.

### Fine-grained selection

- The selector hook subscribes a leaf to one value read from a machine. The
  leaf re-renders only when that value changes: by identity, or by a
  supplied equality.
- A change elsewhere in the machine, or an event that changes nothing, does
  not re-render the leaf. A change wakes only the leaves whose value
  changed.
- A fresh selector closure on each render is correct. The hook always
  evaluates the latest closure, so a selector can close over a prop.
- A selector that returns a fresh object or array on each call must supply
  an equality. With one, the hook returns the same object until a real
  change. Without one, every read looks new and the leaf re-renders in a
  loop.

### Translating bindings

- The translator turns the connector's agnostic bindings into React DOM
  props. It is the only place where a binding becomes a DOM prop.
- Handlers take their DOM names: `onPress` becomes `onClick`,
  `onValueChange` becomes `onChange`, and `onDoublePress` becomes
  `onDoubleClick`. The other handlers keep their names.
- A handler whose agnostic payload differs from the DOM event (value
  change, wheel, scroll, scroll end) is wrapped, so the consumer's handler
  gets the agnostic payload. Other handlers pass through unchanged.
- An ARIA-derived attribute becomes `aria-*`, and its value does not change
  (booleans, the `'mixed'` tristate, enums). `focusable` becomes `tabIndex`:
  `0` when true, `-1` when false.
- An `undefined` value is dropped. An unknown key (`data-*`) passes through.
- The DOM can express every key in the vocabulary, so this target drops
  none. The shared conformance suite checks where each key lands.
- The DOM half that the Solid target also uses (the `aria-*` map and the
  payload adapters) lives in `@dunky.dev/state-machine-dom`. This package
  adds only React's own prop names.

### Merging consumer props

- The prop merger combines the consumer's props with the component's
  translated props for one element.
- Handlers (`on` followed by an uppercase letter) chain, consumer first. If
  the consumer's handler marks the event `defaultPrevented`, the library
  handler is skipped.
- `className` concatenates when both sides are strings: one space between,
  edges trimmed.
- `style`: when both sides set it, both apply, and the library wins on a
  conflicting key.
- Every other key: the library wins, because the component owns its
  semantics (`id`, `role`, `aria-*`). A key that only the consumer sets
  stays.

## Edge cases that carry design meaning

- In StrictMode development, React runs the build twice on the first render
  and keeps one result. The other machine is never started. So the factory
  must only build and return.
- A props change reaches the surface one render later. The render that
  carries the new props still shows the old surface. The connector's wake
  then schedules a render with the new surface.

## Reference

- [WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/) — the attribute
  vocabulary that the translator maps to `aria-*`. See
  [ACCESSIBILITY.md](../../ACCESSIBILITY.md).
- React [`useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore)
  and [`StrictMode`](https://react.dev/reference/react/StrictMode) — the
  contracts that the lifecycle hook relies on.
