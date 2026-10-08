# Rust benchmark suite

The Rust engine (`dunky-core`) measured natively, on its own. Each row is the twin of a
row in the TS suite ([`../ts`](../ts/README.md)): the same machine shape and the same
work, so the two engines can be tuned against the same scenarios.

Numbers below are the average of two runs (release build, Apple M5 Pro). Absolute
figures vary by machine and thermal state — **run it yourself**.

## Running

```bash
cargo bench -p dunky-benchmark
```

A plain `cargo bench` target with no extra dependency: ops/sec is the median of 5
samples of ~100 ms after a 100 ms warmup; memory counts live heap bytes with a counting
allocator. The machines are in [`src/lib.rs`](./src/lib.rs), the runner in
[`benches/engine.rs`](./benches/engine.rs).

## Results

The **TS engine** column is the same row in [`../ts`](../ts/README.md), for reference
only: native Rust and JS on V8 are different runtimes, so this is not a contest.

### Throughput and fan-out

| Scenario                      | Rust (ops/sec) | TS engine |
| ----------------------------- | -------------: | --------: |
| One event (observed field)    |     **52.3 M** |    11.6 M |
| Unobserved write, 1,000 cells |     **79.6 M** |     5.4 M |
| Unobserved write, 5,000 cells |     **76.9 M** |     4.4 M |
| 1 change, 64 observers        |      **4.0 M** |         — |

A Rust context is a typed struct, with at most 64 fields, so the TS suite's 5,000-field
fan-out has no Rust twin. Its Rust row uses the 64-field maximum: one value-deduped
selection per field.

### Computed

| Scenario                             | Rust (ops/sec) | TS engine |
| ------------------------------------ | -------------: | --------: |
| Cached read (no change)              |    **355.7 M** |    44.0 M |
| Fine-grain (change unread, re-read)  |    **107.5 M** |    10.7 M |
| Recompute (change read field)        |     **42.0 M** |     4.9 M |
| 4-deep chain (change root, read tip) |     **11.8 M** |     1.5 M |

### Engine paths

| Scenario                                      | Rust (ops/sec) | TS engine |
| --------------------------------------------- | -------------: | --------: |
| Guard fallthrough, 2 candidates               |    **157.6 M** |     5.2 M |
| Guard fallthrough, 8 candidates               |     **62.4 M** |     4.5 M |
| Guard fallthrough, 32 candidates              |     **16.7 M** |     3.2 M |
| State churn (exit + entry every event)        |     **87.4 M** |     8.8 M |
| Effect churn (boot + cleanup each transition) |     **60.3 M** |     8.2 M |

### Construction and memory

| Scenario                                  |        Rust | TS engine |
| ----------------------------------------- | ----------: | --------: |
| Build + start, per machine (10,000)       |   **23 ns** |   1.58 µs |
| Memory, 2-field context, written (5,000)  | **0.35 KB** |   3.85 KB |
| Memory, 64-field context, written (5,000) | **0.59 KB** |   4.35 KB |

Rendering and composition are TS-only (React, `compose`), so they have no Rust rows.
