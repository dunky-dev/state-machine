---
'@dunky.dev/state-machine': patch
---

Harden the machine's notify and teardown paths, and trim dead weight:

- A listener removed during a notify pass no longer fires again when a nested
  notify (a send from inside a subscriber) rebuilds the iteration snapshot
  mid-pass — unsubscribing is now final even under re-entrancy.
- A state cleanup that throws no longer skips the remaining cleanups or leaves
  the pass populated: every cleanup runs (timers and subscriptions all
  release), the first error is rethrown after the pass, and the next stop
  cannot double-run them.
- `machine.select` is built once and reused instead of allocating a fresh
  facade object on every property access.
- Dropped the internal write-only `version` counter — bumped on every notify,
  read by nothing.
