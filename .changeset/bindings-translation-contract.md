---
'@dunky.dev/state-machine-bindings': minor
'@dunky.dev/react-state-machine': patch
'@dunky.dev/native-state-machine': patch
'@dunky.dev/opentui-state-machine': patch
---

The translation contract: every target accounts for the full vocabulary.

The bindings package now exports `HandlerKey`/`AttrKey` (derived from
`EventBindings`/`AttrBindings`) and the contract types `HandlerTargets`/
`AttrTargets` — `Record`s over the closed vocabulary where every key names the
host prop that carries it, or is `null`: a declared drop for a binding the
substrate cannot express.

Each target's normalize declares its maps against the contract:

```ts
export const HANDLER_MAP = {
  onPress: 'onPress',
  onWheel: null, // no RN analog — declared, not forgotten
  // ...every other vocabulary key, required by the type
} satisfies HandlerTargets
```

Adding a key to the vocabulary now breaks every target's typecheck until that
target decides — mapped or dropped, never silently leaked to the host through
the unknown-key passthrough (which still exists, but only for keys outside the
vocabulary, e.g. `data-state`). The react/native/opentui normalizers adopt the
contract with no behavior change: the ad-hoc `HANDLER_DROP`/`ATTR_DROP` sets
fold into `null` entries, native's `accessibilityState` fold derives its key
set from the ledger, and the two implicit passthroughs (native `role`, opentui
`disabled`) become explicit renames. A conformance test per target walks its
ledger and asserts every binding lands on its declared target — or, for a
`null`, nowhere at all.
