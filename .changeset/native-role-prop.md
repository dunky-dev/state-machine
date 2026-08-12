---
'@dunky.dev/native-state-machine': patch
---

`normalize` now passes `role` through to React Native's web-aligned `role` prop instead of mapping it to the legacy `accessibilityRole`.

`accessibilityRole` takes a narrow enum that Android validates in native code — any ARIA role outside it (e.g. `dialog`, emitted by the dialog machine) crashed on device with `Invalid accessibility role value`. The `role` prop (RN 0.71+) accepts the full ARIA vocabulary, takes precedence over `accessibilityRole`, and degrades gracefully for roles a platform can't map.

```ts
normalize({ role: 'dialog' })
// before: { accessibilityRole: 'dialog' }  -> native crash on Android
// after:  { role: 'dialog' }
```
