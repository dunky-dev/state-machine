# `@dunky.dev/native-state-machine`

The **React Native bindings** for [`@dunky.dev/state-machine`](../core/README.md).

The behavior lives in the core machine — plain TypeScript, no renderer. This
package is the thin React Native edge that runs it, and it's mostly the
[react package](../react/README.md): `useMachine`, `useSelector`, and the
`ComponentEffect` type are **re-exported unchanged** (React Native uses the
same React renderer). What's native here is the translation layer:

1. **`normalize`** — translate the machine's agnostic bindings (`onPress`,
   `expanded`) into React Native props (`onPress`, `accessibilityState`).
2. **`mergeProps`** — merge the consumer's props with the component's,
   RN-aware (style arrays).

```
  core (agnostic)
  |
  |   config + connect()      behavior + snapshot -> view api
  |
  v
  this package (React Native)
  |
  |   useMachine              re-exported from the react package
  |   |
  |   v
  |   api                     the view surface instructions
  |   |
  |   v
  |   normalize()             RN props / accessibility*
  |
  v
  <Pressable {...props} />
```

## Quick start

A disclosure, end to end — the behavior (core), the surface (`connect`), and
the React Native component (this package):

```tsx
import { Pressable, Text, View } from 'react-native'
import { setup } from '@dunky.dev/state-machine'
import { useMachine, normalize } from '@dunky.dev/native-state-machine'

type DisclosureProps = { defaultOpen?: boolean }

// 1 — behavior: a plain state machine. No React Native in sight.
const disclosureConfig = (props: DisclosureProps) =>
  setup.infer().createMachine({
    initial: props.defaultOpen ? 'open' : 'closed', // props seed the machine ONCE
    context: {},
    states: {
      closed: { on: { toggle: { target: 'open' } } },
      open: { on: { toggle: { target: 'closed' } } },
    },
  })

// 2 — connect: machine snapshot -> what the view spreads onto elements.
//     Agnostic vocabulary: role / expanded — not RN props yet.
const connectDisclosure = ({ state, send }) => {
  const open = state === 'open'
  return {
    open,
    triggerProps: {
      role: 'button',
      expanded: open,
      onPress: () => send({ type: 'toggle' }),
    },
  }
}

// 3 — the React Native edge: build + run the machine, render from its api.
const disclosureEffects = [] // no platform effects yet; must be a static constant

export function Disclosure(props: DisclosureProps) {
  const { api } = useMachine(disclosureConfig, connectDisclosure, disclosureEffects, props)
  return (
    <View>
      <Pressable {...normalize(api.triggerProps)}>
        <Text>Details</Text>
      </Pressable>
      {api.open && <Text>Hidden content</Text>}
    </View>
  )
}
```

What happened:

- `useMachine` built the machine and connector **once** (the first render's
  props seeded the initial state), started it on mount, stops it on unmount.
- The component re-renders only when the `connect()` output actually changes.
- `normalize` turned `role` / `expanded` into `accessibilityRole` /
  `accessibilityState.expanded` — the **same** config and `connect` drive the
  web through the react package's `normalize`. Only this edge differs.

---

## `useMachine`, `useSelector`, `ComponentEffect` — the shared edge

Re-exported directly from
[`@dunky.dev/react-state-machine`](../react/README.md) — identical on both
platforms. See the react README for the full reference (build-once semantics,
prop flow, fine-grained subscription, the effect rules).

The one thing that changes on RN is the _transport_ inside a
`ComponentEffect`: the platform API differs, the shape doesn't. The web
dialog's Escape listener becomes a back-button listener:

```ts
import { BackHandler } from 'react-native'
import type { ComponentEffect } from '@dunky.dev/native-state-machine'

type DialogEffect = ComponentEffect<DialogMachine, DialogProps>

/** Back-button-to-close — the RN transport for the same close decision. */
const onBackButton: DialogEffect = [
  (machine, props) => {
    if (!props.closeOnBackButton) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      machine.send({ type: 'close' })
      return true // consume: prevent default back navigation
    })
    return () => sub.remove()
  },
  ['closeOnBackButton'], // re-run only when this prop changes
]

export const dialogEffects = [onBackButton]
```

The machine receives the same `send({ type: 'close' })` as the web version —
it has no idea a hardware button exists.

---

## `normalize` — agnostic bindings → React Native props

`connect` returns substrate-agnostic bindings; `normalize` translates them
into React Native's prop vocabulary:

```ts
const rnProps = normalize(api.triggerProps)
// { onPress, accessibilityRole, accessibilityState: { expanded }, ... }
```

The machine binding maps handlers (`onPress` → `onPress`, `onPointerDown` →
`onPressIn`, `onContextMenu` → `onLongPress`), accessibility props
(`labelledBy` → `accessibilityLabelledBy`, `role` → `accessibilityRole`,
`id` → `nativeID`), and accessibility state (`expanded` / `checked` / … fold
into `accessibilityState`, `valueMin/Max/Now/Text` into `accessibilityValue`).
[Check out the full mapping here](./src/normalize.ts).

Bindings with no RN equivalent (hover, `onKeyDown`, `onWheel`, most ARIA-only
attrs) are **silently dropped** rather than passed as invalid props.
`undefined` values are dropped; unknown keys pass through unchanged.

---

## `mergeProps` — consumer props + component props

When a consumer spreads their own props onto an element the component
controls:

```tsx
<Pressable {...mergeProps(consumerProps, normalize(api.triggerProps))} />
```

- **Handlers chain, consumer-first** — both run, unless the consumer's handler
  marks the event `defaultPrevented`, which skips the library handler (the
  consumer's veto).
- **`style` merges** — both sides set it → the array form
  `[consumerStyle, libraryStyle]` (RN accepts style arrays natively; later
  entry wins per key).
- **Everything else: library wins** — the component owns its semantics.

No consumer props → the library props are returned as-is.

---

## API

| Export                                        | What it is                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `useMachine(config, connect, effects, props)` | re-exported from [`@dunky.dev/react-state-machine`](../react/README.md) — the bridge hook            |
| `useSelector(machine, selector, isEqual?)`    | re-exported — fine-grained subscription to a derived slice                                           |
| `normalize(bindings)`                         | agnostic bindings → React Native props (`accessibility*`, `nativeID`, press handlers)                |
| `mergeProps(consumer, library)`               | merge consumer + component props (handlers chained w/ `defaultPrevented` veto; RN style-array merge) |
| `ComponentEffect<M, P>`                       | re-exported — `[ (machine, props) => cleanup, (keyof P)[] ]`; pass a static list of them             |
| `Bindings`                                    | `Record<string, unknown>` — the loose shape `normalize` accepts                                      |
