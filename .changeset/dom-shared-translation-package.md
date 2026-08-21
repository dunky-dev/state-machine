---
'@dunky.dev/state-machine-dom': minor
'@dunky.dev/react-state-machine': patch
'@dunky.dev/solid-state-machine': patch
---

Add `@dunky.dev/state-machine-dom` — the DOM half of the bindings translation,
shared by every DOM target. The `aria-*` attribute projection and the payload
adapters (`onValueChange`/`onWheel`/`onScroll`/`onScrollEnd` → neutral
payloads, with `preventDefault` bound to its event) were byte-identical in the
React and Solid normalizers; they now live once, in this package, and each
target keeps only what genuinely differs: its handler prop names
(`onChange`/`onDoubleClick` vs `onInput`/`onDblClick`), the `focusable` →
tabindex casing (`tabIndex` vs `tabindex`), and its value serialization
(React passes ARIA booleans through; Solid stringifies them).

No API change for consumers of the React or Solid packages — `normalize`
behaves exactly as before; the shared package becomes a dependency of both.
The motivation is drift-proofing: a payload-adapter fix previously had to be
applied to each DOM target by hand, and had already diverged once.
