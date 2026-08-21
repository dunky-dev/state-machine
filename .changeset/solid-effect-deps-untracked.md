---
'@dunky.dev/solid-state-machine': patch
---

A `ComponentEffect` body now runs untracked, so its authored `deps` list is the
whole re-run contract — identical to the React target's dep array. Previously
the body executed inside the tracking scope, so any prop the effect merely read
became a hidden dependency and re-ran it (cleanup + re-subscribe) on changes to
props it never declared.

```ts
const escape: ComponentEffect<M, Props> = [
  (machine, props) => {
    void props.onEscapeKeyDown // read, but NOT a dep — no longer re-runs on change
  },
  ['closeOnEscape'], // ONLY this prop re-runs the effect, on every target
]
```
