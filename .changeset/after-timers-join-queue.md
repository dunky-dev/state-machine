---
'@dunky.dev/state-machine': patch
---

Internal cleanup of the core machine. `after` timers now dispatch through
the same run-to-completion queue as `send`, instead of running their own
copy of the flush cycle; the stale-timer check keeps only the entry
generation, which already covers "state exited" and "state re-entered".
`send` and `setContext` are plain bound fields (no pass-through hops), the
boot event is one shared frozen object, and `oneOf` picks its branch with
a loop instead of `find`. No behavior change for consumers.
