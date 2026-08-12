---
'@dunky.dev/native-state-machine': patch
---

`normalize` fixes two accessibility translations that silently misfired:

- `hidden` now maps to RN's web-aligned `aria-hidden` instead of folding into `accessibilityState` — which has no `hidden` slot, so the value was stored and ignored. `aria-hidden` is fanned out per platform by RN itself (`accessibilityElementsHidden` on iOS, `importantForAccessibility: 'no-hide-descendants'` on Android).
- `describedBy` is now dropped. RN has no describe-by-reference slot (there is no `aria-describedby`); the old mapping routed it into `accessibilityLabelledBy`, which misnamed the element and clobbered `labelledBy` whenever a part emitted both — a dialog's content was announced by its description instead of its title.

```ts
normalize({ hidden: true })
// before: { accessibilityState: { hidden: true } }  -> ignored by RN
// after:  { 'aria-hidden': true }

normalize({ labelledBy: 'title', describedBy: 'desc' })
// before: { accessibilityLabelledBy: 'desc' }  -> named by its description
// after:  { accessibilityLabelledBy: 'title' }
```
