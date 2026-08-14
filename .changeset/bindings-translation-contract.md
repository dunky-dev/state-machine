---
'@dunky.dev/state-machine-bindings': minor
'@dunky.dev/react-state-machine': patch
'@dunky.dev/native-state-machine': patch
'@dunky.dev/opentui-state-machine': patch
---

The translation contract: every target must account for every vocabulary key —
mapped, or `null` as a declared drop. Previously the normalize maps were
untyped, so a new binding compiled everywhere and silently leaked to the host;
now it's a compile error in every target until that target decides.

Bindings exports the contract (`HandlerKey`/`AttrKey`, `HandlerTargets`/
`AttrTargets`, their string-indexed `Any*` counterparts) and the all-dropped
bases `DROPPED_HANDLERS`/`DROPPED_ATTRS` for targets that express little of
the vocabulary (they inherit `null` for future keys; the compile error fires
at the base):

```ts
export const HANDLER_MAP: AnyHandlerTargets = {
  ...DROPPED_HANDLERS, // hover, keyboard, double-press, wheel: no RN analog
  onPress: 'onPress',
  onPointerDown: 'onPressIn',
  // ...everything this target can express
} satisfies HandlerTargets
```

No behavior change in the targets; a conformance test per target walks its
ledger and asserts every binding lands on its declared target — or, for a
`null`, nowhere at all.
