# Rust benchmark suite

The Rust engine (`dunky-state-machine`), measured natively. Release build, Apple M5 Pro; medians are
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
| 1,000 machines, 1 event each             |      0.014 ms (0.1%) | 0.031 ms | 0.072 ms |       **0** |
| 10,000 machines, 1 event each            |      0.151 ms (0.9%) | 0.215 ms | 0.435 ms |       **0** |
| 1 machine, 10,000 events                 |      0.105 ms (0.6%) | 0.131 ms | 0.195 ms |       **0** |
| 1,000 transitions (exit, entry, effects) |      0.017 ms (0.1%) | 0.026 ms | 0.048 ms |       **0** |
| 1,000 computed recomputes                |      0.015 ms (0.1%) | 0.019 ms | 0.033 ms |       **0** |
| 64 observers, 1,000 field changes        |      0.044 ms (0.3%) | 0.060 ms | 0.069 ms |       **0** |

→ **No workload goes past 3% of a frame, even in its worst frame.** 10,000 machines
reacting to an event every frame take 0.15 ms at the median, leaving more than 97% of the
frame for rendering and the rest of the app.

→ **Zero allocations per frame.** The steady state allocates nothing — no events, no
notifications, no recomputes — so the engine adds no allocator pauses and no jitter.

→ **~1.6 million events fit in one frame** on a single machine (96 M events/sec ÷ 60).

## Throughput

| Scenario                      |    ops/sec | ns/op |
| ----------------------------- | ---------: | ----: |
| One event (observed field)    | **95.6 M** |  10.5 |
| Unobserved write, 1,000 cells |     97.6 M |  10.2 |
| Unobserved write, 5,000 cells |     97.7 M |  10.2 |
| 1 change, 64 observers        |     22.6 M |  44.2 |

"Observed" means a value-deduped selection watches the field (`select_field`); a write to
another field skips it with one bit test. A Rust context is a typed struct with at most 64
fields, so the widest fan-out is one selection on each of 64 fields: one change re-checks
only the selection of the field that changed.

## Computed values

| Scenario                             |     ops/sec | ns/op |
| ------------------------------------ | ----------: | ----: |
| Cached read (no change)              | **344.1 M** |   2.9 |
| Fine-grain (change unread, re-read)  |     105.0 M |   9.5 |
| Recompute (change read field)        |      68.7 M |  14.6 |
| 4-deep chain (change root, read tip) |      18.0 M |  55.6 |

A cached read is a stamp comparison. Changing a field the value does not read keeps it
cached; a recompute reuses the value's memory in place when nothing else holds it.

## Engine paths

| Scenario                                      |     ops/sec | ns/op |
| --------------------------------------------- | ----------: | ----: |
| Guard fallthrough, 2 candidates               | **171.2 M** |   5.8 |
| Guard fallthrough, 8 candidates               |      61.7 M |  16.2 |
| Guard fallthrough, 32 candidates              |      16.4 M |  61.0 |
| State churn (exit + entry every event)        |      88.2 M |  11.3 |
| Effect churn (boot + cleanup each transition) |      63.3 M |  15.8 |

## Construction and memory

| Scenario                                  |       Value |
| ----------------------------------------- | ----------: |
| Build + start, per machine (10,000)       |   **23 ns** |
| Memory, 2-field context, written (5,000)  | **0.36 KB** |
| Memory, 64-field context, written (5,000) | **0.60 KB** |

→ 10,000 machines cost about 3.6 MB with a 2-field context, and build in about 0.23 ms.

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
