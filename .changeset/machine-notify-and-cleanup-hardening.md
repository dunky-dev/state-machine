---
'@dunky.dev/state-machine': patch
---

Harden the notify and teardown paths across the core, and cut hot-path
allocations:

- A listener removed during a notify pass no longer fires again when a nested
  notify (a send from inside a subscriber) rebuilds the iteration snapshot
  mid-pass — unsubscribing is now final even under re-entrancy. The same
  guarantee now holds for connector and store subscribers, and the mechanism
  lives in one shared primitive instead of three near-copies.
- A state cleanup that throws no longer skips the remaining cleanups or leaves
  the pass populated: every cleanup runs (timers and subscriptions all
  release), the first error is rethrown after the pass, and the next stop
  cannot double-run them.
- A `sync()` rule or `combine().subscribe()` disposed by hand now detaches from
  the composition's registry — long-lived groups with subscribe/unsubscribe
  churn no longer grow it without bound, and `stop()` no longer re-runs
  hand-run disposers.
- Computed recompute is allocation-free: dep keys/values live in reused
  buffers and are captured at read time, so the old post-pass that re-read
  every dep is gone. In the benchmark suite this lands recompute ~1.5× and
  4-deep computed chains ~1.6× faster.
- `machine.select` is built once and reused instead of allocating a fresh
  facade object on every property access, so its identity is stable (safe for
  dependency arrays).
- Dropped the internal write-only `version` counter — bumped on every notify,
  read by nothing.
