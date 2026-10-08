# Rust benchmark suite

The Rust engine (`dunky-core`), measured natively. Release build, Apple M5 Pro; medians are
the average of two runs, and the frame table's p99 and worst columns take the **higher** of
the two runs. Absolute figures vary by machine and thermal state — **run it yourself**.

```bash
cargo bench -p dunky-benchmark
```

## It does not cost a frame

At 60 fps one frame is **16.67 ms**. Each workload below runs inside one frame, timed frame
by frame over **600 frames** (10 seconds of 60 fps):

| Workload per frame                       | Median (of 16.67 ms) |      p99 |    Worst | Allocations |
| ---------------------------------------- | -------------------: | -------: | -------: | ----------: |
| 1,000 machines, 1 event each             |      0.013 ms (0.1%) | 0.041 ms | 0.064 ms |       **0** |
| 10,000 machines, 1 event each            |      0.135 ms (0.8%) | 0.205 ms | 0.233 ms |       **0** |
| 1 machine, 10,000 events                 |      0.103 ms (0.6%) | 0.123 ms | 0.129 ms |       **0** |
| 1,000 transitions (exit, entry, effects) |      0.017 ms (0.1%) | 0.021 ms | 0.039 ms |       **0** |
| 1,000 computed recomputes                |      0.014 ms (0.1%) | 0.017 ms | 0.025 ms |       **0** |
| 64 observers, 1,000 field changes        |      0.251 ms (1.5%) | 0.313 ms | 0.331 ms |       **0** |

→ **The heaviest workload uses 2% of a frame in its worst frame.** 10,000 machines
reacting to an event every frame take under a quarter of a millisecond, leaving more than
98% of the frame for rendering and the rest of the app.

→ **Zero allocations per frame.** The steady state allocates nothing — no events, no
notifications, no recomputes — so the engine adds no allocator pauses and no jitter.

→ **~1.5 million events fit in one frame** on a single machine (93 M events/sec ÷ 60).

## Throughput

| Scenario                      |    ops/sec | ns/op |
| ----------------------------- | ---------: | ----: |
| One event (observed field)    | **93.4 M** |  10.7 |
| Unobserved write, 1,000 cells |     80.5 M |  12.4 |
| Unobserved write, 5,000 cells |     79.5 M |  12.6 |
| 1 change, 64 observers        |      3.9 M | 260.0 |

"Observed" means a value-deduped selection watches the field; an unobserved write wakes no
one. A Rust context is a typed struct with at most 64 fields, so the widest fan-out is one
selection on each of 64 fields: one change wakes and re-checks all 64.

## Computed values

| Scenario                             |     ops/sec | ns/op |
| ------------------------------------ | ----------: | ----: |
| Cached read (no change)              | **364.5 M** |   2.7 |
| Fine-grain (change unread, re-read)  |     102.4 M |   9.8 |
| Recompute (change read field)        |      68.4 M |  14.6 |
| 4-deep chain (change root, read tip) |      18.7 M |  53.6 |

A cached read is a stamp comparison. Changing a field the value does not read keeps it
cached; a recompute reuses the value's memory in place when nothing else holds it.

## Engine paths

| Scenario                                      |     ops/sec | ns/op |
| --------------------------------------------- | ----------: | ----: |
| Guard fallthrough, 2 candidates               | **147.8 M** |   6.8 |
| Guard fallthrough, 8 candidates               |      61.9 M |  16.2 |
| Guard fallthrough, 32 candidates              |      15.7 M |  63.8 |
| State churn (exit + entry every event)        |      92.4 M |  10.8 |
| Effect churn (boot + cleanup each transition) |      61.9 M |  16.2 |

## Construction and memory

| Scenario                                  |       Value |
| ----------------------------------------- | ----------: |
| Build + start, per machine (10,000)       |   **23 ns** |
| Memory, 2-field context, written (5,000)  | **0.35 KB** |
| Memory, 64-field context, written (5,000) | **0.59 KB** |

→ 10,000 machines cost about 3.5 MB with a 2-field context, and build in about 0.23 ms.

## How it measures

- **ops/sec**: the median of 5 samples of ~100 ms, after a 100 ms warmup.
- **Frames**: each workload runs 60 warmup frames, then 600 timed frames, each timed on
  its own; the table shows the median, the 99th percentile and the slowest frame.
- **Memory and allocations**: a counting global allocator; memory is live heap bytes per
  machine, allocations are counted across the 600 frames.
- The machines are in [`src/lib.rs`](./src/lib.rs), the runner in
  [`benches/engine.rs`](./benches/engine.rs). Each scenario is the twin of one in the TS
  suite ([`../ts`](../ts/README.md)), so a change to one engine can be checked on the
  same work.
