# SPEC - `@dunky.dev/solid-state-machine`

## Overview

The Solid target runs one core machine inside one Solid component. It is a
first-class target built on Solid 2.0's own reactivity, not a port of the
React bridge. It has the same four parts as the React target (a lifecycle
hook, a selector hook, a translator from bindings to DOM props, and a prop
merger), and it takes the same machine, `connect`, and component effects.

```
  machine source        connect       component effects      reactive props
  (config or machine)   (pure)        (static list)          (Solid proxy)
        |                  |                 |                     |
        v                  v                 v                     v
  +-------------------------------------------------------------------+
  |  the lifecycle hook  -  the component body calls it once          |
  |                                                                   |
  |    call ........... build the machine + connector                 |
  |    settled ........ start the machine;  disposal: stop it         |
  |    a prop change .. push a plain copy of the props                |
  |    a wake ......... reconcile the new surface into a Solid store  |
  |    each effect .... run it; re-run it when its named props change |
  +-------------------------------------------------------------------+
        |                                     |
        |  api (store proxy)                  |  machine
        v                                     v
  translator: bindings --> DOM props    the selector hook: an accessor
        |                               that changes on one value
        v
  <element {...props}>
```

## Intent

Bridge one machine into Solid with Solid's own tools: a store that mirrors
the surface, two-phase effects, and the owner's settle and cleanup. There is
no re-render and no external-store hook.

The bridge is fine-grained by default. A read of one surface field
subscribes to that field only, so an unrelated change never touches it. A
component effect has the same shape on every target, so it is written once
and runs unchanged on React and Solid.

## Scope & boundaries

**In scope.** The lifecycle hook, the selector hook, the translator from
bindings to Solid DOM props, and the prop merger.

**Out of scope — invariants, not preferences.**

- **No state of its own.** The store mirrors the connector's surface. The
  hook writes to it only from the connector, on each wake. New state goes
  in core.
- **The machine never sees props.** The first props reach the source
  factory once. After that, props reach the connector and the component
  effects, never the machine. See
  [the core rule](../core/SPEC.md#the-machine-never-sees-props).
- **Platform quirks live here, as component effects.** Core makes the
  decision; the effect only listens and sends a plain event. Props-free,
  platform-free effects stay in the core config (see
  [Two homes for a side-effect](../../ARCHITECTURE.md#two-homes-for-a-side-effect)).
- **Solid 2.0 only.** The peer range is `solid-js` `^2.0.0-rc.1`. Solid 1.x
  is not supported. Solid 2.0 removed the 1.x surface (`solid-js/store`,
  one-phase effects, `onMount`), and 1.x lacks the root exports that this
  package imports. One code path cannot serve both majors.

## The behavior contract

These are the guarantees the bridge gives. They describe what it does, not
the names it exports.

### The machine source

- The first argument is a factory. The hook calls it once, with the
  component's props. It returns a **config**, which is built into a stopped
  machine, or a **ready machine** (for example, a Rust machine wrapped with
  `fromWasm`), which is used as is: the hook returns that same instance.
- The hook owns the machine's lifecycle in both cases. So a ready machine
  must come fresh from the factory, one per component instance. Sharing one
  machine between components is not supported.

### Lifecycle

- **Build once.** A Solid component body runs once, so a plain call builds
  once. A later prop change never rebuilds the machine.
- **Start when rendering settles. Stop on disposal.** A stop keeps state
  (see [core Lifecycle](../core/SPEC.md#lifecycle)).
- **The hook never destroys the connector.** The connector and the machine
  share the component's lifetime and are collected together.
- **Reactions follow the machine.** The connector wires them on start and
  removes them on stop. A reaction never fires on subscribe.

### Props

- The hook takes Solid's reactive props object.
- The connector gets a plain copy of the props, never the live proxy. The
  connector compares each update with the props it holds. A held proxy
  always equals a fresh copy of itself, because its getters already return
  the new values. So the connector would never wake.
- A tracked effect reads every prop. When any prop changes, it pushes a new
  copy to the connector. There is no manual dep list. The connector ignores
  a copy that is shallow-equal to the current props.

### The surface — a fine-grained store

- The hook mirrors the connector's surface into a Solid store. On each
  connector wake, it reconciles the new surface into the store. Only the
  leaves that changed notify their readers.
- A read of one field, in JSX or in a tracked scope, subscribes to that
  field only. A change to another field does not re-run that reader.
- The returned `api` is the store proxy. Do not destructure it: that reads
  each value once and drops reactivity. Read a field where you use it.
- Function leaves (handlers, part getters such as `getItemProps`) stay
  callable and live across updates, although `connect` builds new closures
  on each wake.

### Component effects

- A component effect is the same pair as on every target: a setup function
  of the machine and the props, which can return a cleanup; and the names
  of the props it depends on, typed against the props.
- Each effect is one two-phase Solid effect. The tracking phase reads
  exactly the named props. The setup runs in the untracked phase.
- So the dep list is the whole re-run contract. A prop that the setup only
  reads never becomes a hidden dependency. A change to a prop outside the
  list does not re-run the effect.
- Setup runs after mount, and cleanup on disposal. On a dep change, the
  previous cleanup runs before the next setup, so a listener never stacks.
- The effect gets the hook's reactive props object, not a copy. A read
  inside a listener sees the current value, and the read does not re-run
  the effect.
- The machine that an effect gets is live: it can read the current state.

### Fine-grained selection

- The selector hook returns a Solid accessor for one value read from a
  machine. The accessor changes only when that value changes: by identity,
  or by a supplied equality.
- A change elsewhere in the machine, or an event that changes nothing, does
  not update the accessor. A change wakes only the readers whose value
  changed.
- A selected function comes back by identity and is never called. A Solid
  2.0 signal treats a function argument as a compute, so the hook seeds and
  writes the signal through the function form.
- The subscription belongs to the owner. When the owner is disposed, the
  machine stops evaluating the selector.
- An object selection must supply an equality. If not, every machine change
  pushes a new value, even when the content is equal.
- `api` is already fine-grained. The selector hook is for a leaf that
  tracks one value of a machine it does not own, such as many rows.

### Translating bindings

- The translator turns the agnostic bindings into DOM props as Solid's JSX
  expects them. It uses the same vocabulary and the same shared DOM half
  (`@dunky.dev/state-machine-dom`) as the React target. Only Solid's own
  names and values differ:
  - `onValueChange` becomes `onInput`, because Solid's `onChange` fires only
    on commit.
  - `onDoublePress` becomes `onDblClick`.
  - `focusable` becomes the lowercase `tabindex`: `0` when true, `-1` when
    false. It is not a boolean, because `false` must still let script focus
    the element.
  - A boolean ARIA value becomes the string `"true"` or `"false"`. Solid 2.0
    renders a boolean attribute as present or absent, but ARIA states are
    literal tokens. Other values (`'mixed'`, enums, numbers) do not change.
- Handlers get native events, not synthetic events. The payload adapters
  read the same fields on both, so a wrapped handler (value change, wheel,
  scroll, scroll end) gets the agnostic payload.
- An `undefined` value is dropped. An unknown key (`class`, `data-*`) passes
  through. This target drops no vocabulary key; the shared conformance
  suite checks where each key lands.

### Merging consumer props

- Handlers chain, consumer first. If the consumer's handler marks the event
  `defaultPrevented`, the library handler is skipped.
- `class` (not `className`) concatenates when both sides are strings: one
  space between, edges trimmed.
- `style` merges into one object when both sides are objects. The library
  wins on a conflicting key. If either side is a string, the library's
  value wins.
- Every other key: the library wins. A key that only the consumer sets
  stays.
- This is not Solid's own `mergeProps`, which merges reactive prop objects.

### Solid 2.0 timing

- Solid 2.0 commits signal writes, effects, and DOM updates on the
  microtask queue. JSX readers always settle.
- After an event, a plain read of `api` sees the new value at once. A
  selector accessor read in the same tick returns the previous value until
  the queue flushes. So tests call `flush()` from `solid-js` before they
  check the DOM or an accessor.
- JSX types and `render` come from `@solidjs/web`
  (`"jsxImportSource": "@solidjs/web"`), not from `solid-js/web`.

## Edge cases that carry design meaning

- Function leaves stay live across updates. The peer floor is `2.0.0-rc.1`
  because the `reconcile` in `2.0.0-rc.0` corrupted them.
- After disposal, an event can still move the machine, but no prop callback
  fires.

## Reference

- [WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/) — the attribute
  vocabulary that the translator maps to `aria-*`. See
  [ACCESSIBILITY.md](../../ACCESSIBILITY.md).
- [Solid](https://github.com/solidjs/solid) `2.0.0-rc.1` — the peer floor
  and the reactive model that this bridge is built on.
