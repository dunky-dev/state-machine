# `@dunky.dev/opentui-state-machine`

The **OpenTUI (terminal) bindings** for [`@dunky.dev/state-machine`](../core/README.md).

The behavior lives in the core machine — plain TypeScript, no renderer. This
package is **only the prop translator**. Unlike the
[react](../react/README.md) and [native](../native/README.md) packages it
ships no `useMachine` hook and has no framework dependency — `normalize` and
`mergeProps` are pure object-to-object functions, so they work the same under
any of OpenTUI's reactive bindings (`@opentui/react`, `@opentui/solid`, …):

1. **`normalize`** — translate the machine's agnostic bindings (`onPress`,
   `hidden`) into OpenTUI props (`onMouseDown`, `visible`).
2. **`mergeProps`** — merge the consumer's props with the component's,
   OpenTUI-aware (plain style-object merge).

```
  core (agnostic)
  |
  |   config + connect()      behavior + snapshot -> view api
  |
  v
  your framework binding      e.g. useMachine from the react package
  |
  |   api                     the view surface instructions
  |   |
  |   v
  |   normalize()             this package: terminal I/O props
  |
  v
  <box {...props}>
```

## Quick start — bring your own lifecycle hook

The lifecycle binding — turning the engine's connector into a live
component — is the consuming app's concern. OpenTUI renders through a React
reconciler, so the standard pairing is `useMachine` from the **react**
package plus `normalize` from **this** package:

```tsx
import { useMachine } from '@dunky.dev/react-state-machine'
import { normalize } from '@dunky.dev/opentui-state-machine'
import { createDialogConfig, connectDialog } from './dialog'

function Dialog(props: DialogProps) {
  const { api, machine } = useMachine(createDialogConfig, connectDialog, [], props)

  return (
    <box style={{ flexDirection: 'column' }}>
      <box {...normalize(api.triggerProps)}>
        <text>Open</text>
      </box>
      {api.isOpen && (
        <box {...normalize(api.contentProps)} style={{ border: true, padding: 1 }}>
          <text>Dialog content</text>
        </box>
      )}
    </box>
  )
}
```

`useMachine` runs the same shared machine, `connect` produces the same
logical bindings — only `normalize` and the JSX elements differ from the DOM
version. The same `createDialogConfig` / `connectDialog` that drive the
browser drive the terminal, unchanged.

---

## Keyboard handling is global

A terminal has no per-element focus model like the DOM, so key handling
can't be a listener scoped to one element — and it can't be a
`ComponentEffect` either: OpenTUI's keyboard input hangs off the renderer,
which lives in React context, out of reach of an effect tuple's
`(machine, props)` arguments. Key navigation goes through OpenTUI's
`useKeyboard` instead.

Keep the `ComponentEffect` discipline anyway: author the handler at module
level as a prop-gated factory, and feed it to `useKeyboard` in the
component:

```tsx
import { useKeyboard } from '@opentui/react'
import type { KeyEvent } from '@opentui/core'

/** Escape-to-close — the terminal transport for the same close decision. */
const dialogKeys = (machine: DialogMachine, props: DialogProps) => (key: KeyEvent) => {
  if (!props.closeOnEscape) return
  if (machine.matches('open') && key.name === 'escape') {
    machine.send({ type: 'close' })
  }
}

function Dialog(props: DialogProps) {
  const { api, machine } = useMachine(createDialogConfig, connectDialog, [], props)
  useKeyboard(dialogKeys(machine, props))
  // ...
}
```

It sends the **same logical events** the DOM version's `ComponentEffect`
sends — the machine can't tell the difference: three transports (a DOM
`keydown` effect, RN's `BackHandler`, OpenTUI's `useKeyboard`), the same
`send({ type: 'close' })`.

---

## `normalize` — agnostic bindings → OpenTUI props

`connect` returns substrate-agnostic bindings; `normalize` translates them
into OpenTUI's terminal I/O vocabulary — the pointer model is the mouse,
reported in terminal cells, and there is **no accessibility tree**, so the
entire ARIA vocabulary is dropped rather than forwarded as props the
renderer ignores:

```ts
const tuiProps = normalize(api.triggerProps)
// { onMouseDown, visible, focusable, ... }
```

The machine binding maps handlers (`onPress` → `onMouseDown`,
`onWheel` → `onMouseScroll`, `onValueChange` → `onChange` with the payload
adapted), and the visual analogs (`hidden` → `visible`, inverted;
`disabled` and `focusable` pass through).
[Check out the full mapping here](./src/normalize.ts).

Bindings with no terminal analog (`onFocus`/`onBlur` — OpenTUI signals focus
via the `focused` **prop** — `onScroll`, `onContextMenu`, and the whole ARIA
attribute set) are **silently dropped** rather than passed as invalid props.
`undefined` values are dropped; unknown keys pass through unchanged.

---

## `mergeProps` — consumer props + component props

When a consumer spreads their own props onto an element the component
controls:

```tsx
<box {...mergeProps(consumerProps, normalize(api.triggerProps))} />
```

- **Handlers chain, consumer-first** — both run, unless the consumer's
  handler marks the event `defaultPrevented`, which skips the library
  handler (the consumer's veto).
- **`style` merges into one object** — library wins on conflicting keys.
  Unlike React Native, OpenTUI's `style` is a plain object, not an array —
  so styles merge rather than wrap.
- **Everything else: library wins** — the component owns its semantics.

There is no `className` in a terminal, so — like React Native — there is no
`className` branch. No consumer props → the library props are returned
as-is.

---

## API

| Export                          | What it is                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `normalize(bindings)`           | agnostic bindings → OpenTUI props (mouse handlers, `visible`, `focusable`; ARIA dropped)                 |
| `mergeProps(consumer, library)` | merge consumer + component props (handlers chained w/ `defaultPrevented` veto; plain style-object merge) |
| `Bindings`                      | `Record<string, unknown>` — the loose shape `normalize` accepts                                          |
