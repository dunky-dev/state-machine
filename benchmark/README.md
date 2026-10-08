# Benchmarks

Dunky has two engines that follow one spec, and each has its own suite:

| Suite             | What it measures                                                                                        | Run                              |
| ----------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------- |
| [`ts/`](./ts)     | The TS engine (`@dunky.dev/state-machine`) against XState and Zag, plus React rendering and a live demo | `pnpm benchmark`                 |
| [`rust/`](./rust) | The Rust engine (`dunky-core`), natively, on the same scenarios                                         | `cargo bench -p dunky-benchmark` |

The Rust rows are twins of TS rows, so a change to one engine can be measured against the
same work on the other.
