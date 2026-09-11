---
'@dunky.dev/state-machine': patch
---

Fewer allocations on the send path. A single action or transition entry is
run directly instead of being wrapped in a one-item array per event; guard
params are built only when a guard is actually met; the action and computed
hosts hold the live context and computed objects instead of reading them
through getter functions; the connector builds its snapshot argument once
and compares props without allocating key arrays. Single-event throughput
is up about 7% and state churn about 10% on the benchmark suite. No
behavior change for consumers.
