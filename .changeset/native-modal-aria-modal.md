---
'@dunky.dev/native-state-machine': minor
---

The `modal` binding now reaches React Native instead of being dropped:
`normalize()` maps it to `aria-modal`, the web-aligned alias RN routes to
`accessibilityViewIsModal`.

```tsx
normalize({ modal: true }) // { 'aria-modal': true }
```

It was dropped on the assumption RN had no element-attr analog. It does —
`aria-modal` sits in the same alias block as `aria-hidden`, which this
normalizer already targets. The effect is iOS-only (VoiceOver stops reading
siblings of the modal surface); Android has no sibling-inerting equivalent, so
it degrades to a no-op there, the same per-platform fan-out `aria-hidden`
already relies on.

Without it, a dialog authored once in core announced as modal on the web and as
an ordinary view on native — the substrate-agnostic contract leaking a hole
exactly where a screen reader user would notice it.
