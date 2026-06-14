# Benchmark suite

A performance harness for `@chimba-ui/state-machine`. It measures the engine's
hot paths in isolation and compares the runnable parts against
[XState](https://stately.ai/docs) and [Zag](https://zagjs.com/).

Numbers below are from one clean run (Node 24, Apple Silicon). Absolute figures
vary by machine, Node version, and thermal state — **run it yourself** — but the
ranking and the scaling shape are what hold.

> Want to _see_ it instead of read tables? **`pnpm benchmark:demo`** opens a live
> side-by-side where each engine drives a grid of real per-cell machines under a
> ramping load — watch them fall behind one by one (XState, then Zag, with Chimba
> last). See [`demo/`](./demo/README.md).

## Running

```bash
pnpm benchmark          # from the repo root (delegates here)
# or
cd benchmark && pnpm benchmark
```

Either runs the whole suite in one Node process with `--expose-gc` (the memory
bench needs accurate GC; the flag is harmless for the rest). Output is a series
of `console.table`s grouped by section.

Each section is also exported as a `run*()` function, so you can run one in
isolation:

```bash
node --expose-gc --import tsx -e "import('./tests/memory').then(m => m.runMemory())"
```

## Who's compared, and why not always all three

The engines don't all fit every test, because they don't all run the same way:

| Engine        | How `send` works              | Where it's measured                                |
| ------------- | ----------------------------- | -------------------------------------------------- |
| **Chimba UI** | synchronous                   | everywhere                                         |
| **XState**    | synchronous                   | the ops/sec loops, construction, memory, rendering |
| **Zag**       | **async** (microtask-batched) | construction, memory, and React rendering only     |

A `tinybench` ops/sec loop counts synchronous iterations, so it can only compare
**synchronous** engines fairly. Zag's headless `send` is microtask-batched, so it
would either deadlock or report meaningless numbers in a tight sync loop — it
appears only where it runs synchronously (construction, memory via the headless
`VanillaMachine`) and in the React arena, where it runs natively via
`@zag-js/react`.

Two XState variants appear in the fine-grain tables:

- **`xstate`** — `actor.subscribe` with a hand-written `value` diff in the
  listener (the same dedup Chimba UI does for free).
- **`xstate-raw`** — stock `actor.subscribe`, which fires on _every_ snapshot
  change with no diff.

Showing both separates "what XState costs out of the box" from "what it costs
once you add a differ."

A key fairness rule across construction + memory: **all engines share one
module-level config across instances** — the shape a real app has (a component's
machine config is a `const`; every instance reuses it). So those loops time
_machine construction_, not config-literal allocation.

> **How to read the ops/sec tables.** `ops/sec` (higher is better) is the headline;
> `±rme %` is the run-to-run noise floor — a gap between two rows is only real if
> it clears both rows' margins. The `(anti-DCE SINK: …)` lines in the raw output
> are just proof the JIT didn't dead-code-eliminate the work — ignore them.

**Every comparison table lists all three engines**, so you always see the full
field. Where one can't run a given test, the cell is marked — same marker
everywhere:

- **`n/a ᵃ`** — _async._ Zag's `send` is microtask-batched, so it can't run in a
  synchronous ops/sec or `flushSync` loop.
- **`n/a ᶠ`** — _no equivalent feature._ The engine has no first-class primitive
  for this scenario (e.g. XState has no lazy/memoized `computed`), so there's
  nothing comparable to time.

---

## 1. Fan-out / fine-grain / throughput (`tests/fan-out.ts`)

The selection layer at scale — the thing that decides whether thousands of
machines stay cheap. Zag can't run these (async `send`).

**A. Propagation — change 1 of N.** ONE machine, N fields, N observers (one per
field). Bump one field. Chimba UI's `select` is a coarse bus: every selection
re-evaluates its selector on each notify and value-compares, so only the touched
field's _listener_ fires (downstream is O(changed)) — but the re-eval pass itself
is O(N observers) per write. The table shows _how_ that degrades with N versus
XState's coarse `actor.subscribe`.

| Change 1 of N | Chimba UI (ops/sec) | XState (ops/sec) |   Zag |
| ------------- | ------------------: | ---------------: | ----: |
| 100           |               275 K |            250 K | n/a ᵃ |
| 1000          |               9.5 K |           10.4 K | n/a ᵃ |
| 5000          |           **4.2 K** |              709 | n/a ᵃ |

→ Roughly par at small N, but Chimba UI **~6× faster at 5000 observers** — XState's
coarse subscribe degrades much faster as the observer set grows.

**B. Fine-grain — change an UNOBSERVED field.** Change a field nobody selects. The
dedup layer re-evaluates and value-compares, so no listener fires — the
subscriber-side cost is ~zero. This is the "irrelevant write" that a cell-per-field
model gets for free and a coarse bus has to work to ignore.

| Irrelevant write, N cells | Chimba UI (ops/sec) | XState (ops/sec) |   Zag |
| ------------------------- | ------------------: | ---------------: | ----: |
| 1000                      |           **2.1 M** |            420 K | n/a ᵃ |
| 5000                      |           **945 K** |            401 K | n/a ᵃ |

→ Chimba UI is **~5× faster** at shrugging off a write nobody is watching (1000
cells); the value-deduping bus skips waking observers entirely.

**C. Throughput — single machine, one event.** Per-transition cost with no
selection scaling — the raw `send` price.

| Single machine, one event |   ops/sec |
| ------------------------- | --------: |
| Chimba UI                 | **3.0 M** |
| XState (raw)              |     870 K |
| XState (diffed)           |     829 K |
| Zag                       |     n/a ᵃ |

→ Chimba UI pushes **~3.5× the events/sec** of XState. Context is mutated in place,
so a transition allocates nothing; XState builds a fresh snapshot per event.

## 2. Compose / synced machines (`tests/compose.ts`)

The cross-region machinery `compose` adds, scaled by member count. No competitor
column: neither XState nor Zag has a first-class orthogonal-region primitive that
maps to `combine`/`sync`, so there's nothing equivalent to time (**n/a ᶠ** for
both).

**A. combine** — one value-deduped `Selection` derived across M members but reading
only `m0`. It re-evaluates on _any_ member change but fires its listener only when
`m0` changes. **B. sync** — a coarse cross-region rule that wakes on _any_ member
change (the O(members) path by design).

| Members | Chimba UI combine (ops/sec) | Chimba UI sync (ops/sec) | XState | Zag   |
| ------- | --------------------------: | -----------------------: | ------ | ----- |
| 2       |                       3.0 M |                    3.0 M | n/a ᶠ  | n/a ᶠ |
| 10      |                       2.9 M |                    2.9 M | n/a ᶠ  | n/a ᶠ |
| 50      |                       2.6 M |                    2.6 M | n/a ᶠ  | n/a ᶠ |

→ Cross-region coordination stays in the **~2.6–3.0 M ops/sec** band even at 50
synced members — the O(M) re-eval pass costs ~12% going from 2 to 50.

> A third "chain" sub-test (a sync rule that `send()`s downstream every change) was
> removed: under a tight loop it shows superlinear slowdown. That's a real
> `compose.sync` + cross-machine-send interaction worth investigating on its own,
> not a benchmark-tuning artifact — see the note in `tests/compose.ts`.

## 3. Computed (`tests/computed.ts`)

The most machinery-heavy subsystem — read-key tracking via proxies, memoization
against a dep snapshot, glitch-free computed→computed chains. This is a subsystem
profile: XState has no first-class lazy/memoized `computed` (**n/a ᶠ**), and Zag's
`send` is async (**n/a ᵃ**), so neither has a comparable primitive to time.

| Scenario                             | Chimba UI (ops/sec) | XState | Zag   |
| ------------------------------------ | ------------------: | ------ | ----- |
| Cached read (no change)              |          **16.1 M** | n/a ᶠ  | n/a ᵃ |
| Fine-grain (change unread, re-read)  |               2.9 M | n/a ᶠ  | n/a ᵃ |
| Recompute (change read field)        |               1.5 M | n/a ᶠ  | n/a ᵃ |
| 4-deep chain (change root, read tip) |               495 K | n/a ᶠ  | n/a ᵃ |

→ A cached read is **~16 M/sec** (near-free memo hit), and changing a field the
computed _doesn't_ read stays a memo hit at ~2.9 M/sec — read-key tracking means
you only pay the recompute when an input you actually read changes.

## 4. Engine hot paths (`tests/engine.ts`)

The parts of `send` that do real statechart work (everything else in the suite
stays in one state and only mutates context). These probe Chimba UI internals in
isolation — there's no comparable isolated path to time in XState (**n/a ᶠ**), and
Zag's `send` is async (**n/a ᵃ**).

| Scenario                               | Chimba UI (ops/sec) | XState | Zag   |
| -------------------------------------- | ------------------: | ------ | ----- |
| Guard fallthrough — 2 candidates       |               3.3 M | n/a ᶠ  | n/a ᵃ |
| Guard fallthrough — 8 candidates       |               3.0 M | n/a ᶠ  | n/a ᵃ |
| Guard fallthrough — 32 candidates      |               2.0 M | n/a ᶠ  | n/a ᵃ |
| State churn — exit+entry every event   |               2.6 M | n/a ᶠ  | n/a ᵃ |
| Effect churn — boot+cleanup each trans |               2.6 M | n/a ᶠ  | n/a ᵃ |
| Sub churn — stable set                 |               2.7 M | n/a ᶠ  | n/a ᵃ |
| Sub churn — churning set (rebuild)     |               2.0 M | n/a ᶠ  | n/a ᵃ |

→ Even the heavy paths hold **~2–3.3 M ops/sec**: a 32-candidate guard walk, full
state transitions with entry/exit actions, and effect boot/cleanup every
transition all stay in the same order of magnitude as a bare `send`.

## 5. Construction cost (`tests/construct.ts`)

Wall-clock to build + `start()` N machines, no events sent (matches a real mount).
Synchronous for all three, so it's a fair three-way table. Median of 5 passes, JIT
warmed first.

| Build + start | Chimba UI (µs/machine) | XState |   Zag |
| ------------- | ---------------------: | -----: | ----: |
| 10 000        |                   4.34 |   2.67 | 10.44 |

→ Construction is the one axis where Chimba UI **doesn't** win — XState spins up
~1.6× faster. Chimba UI's bet is flat memory + hot-path throughput, not spin-up;
it's still ~2.4× faster than Zag's per-field reactive cells.

## 6. Memory per machine (`tests/memory.ts`)

Build 5000 machines, hold them live, report retained heap per machine (`heapMB()`
double-GCs before sampling). Two context widths — **thin** (2 fields) and **fat**
(64 fields) — because the whole point of the plain-object model is that memory
stays ~flat in field count. Rows below are the **written** mode (one `hit` each —
the footprint a churny app actually pays).

| Context  | Chimba UI (KB/machine) | XState |     Zag |
| -------- | ---------------------: | -----: | ------: |
| 2-field  |                   4.22 |   3.62 |    9.06 |
| 64-field |                   4.73 |   4.10 | **134** |

→ Going 2 → 64 fields costs Chimba UI only **~0.5 KB/machine** — memory grows with
the data you store, not with a per-field cell. **Zag is the contrast**: one reactive
cell per field balloons the 64-field context to ~134 KB/machine — **~28× more** than
Chimba UI.

**Idle vs written.** Chimba UI owns its context copy from construction and mutates
it in place forever, so its idle and written footprints match by design — while a
lazy-copy scheme steps up once writes start:

| 64-field, 5000 machines | Chimba UI | XState | Zag |
| ----------------------- | --------: | -----: | --: |
| Idle (never written)    |      4.72 |   3.55 | 130 |
| Written (1 event each)  |      4.73 |   4.10 | 134 |

→ Chimba UI idle ≡ written; XState's first `assign` allocates a per-actor context,
so its written row grows.

## 7. React rendering (`tests/rendering/`)

The thing that actually hurts in an app — how many React components render — under
jsdom. A list of N rows, 50 highlight moves. Two numbers: **rows woken / move**
(the fine-grained payoff) and **wall-clock** per phase. Strategies: `selector`
(shared machine + `useSelector` per row), `naive` (whole-snapshot — the
anti-pattern), `core/instance` (one machine per row), plus `xstate/selector` and
`zag/instance`.

List of 1000 rows:

| Strategy             | Rows woken / move | Mount (ms) | Re-render wall (ms) |
| -------------------- | ----------------: | ---------: | ------------------: |
| Chimba UI/instance   |             **2** |        6.3 |             **4.4** |
| Chimba UI/selector   |                 2 |        8.7 |                 7.0 |
| xstate/selector      |                 2 |        6.5 |                 8.3 |
| zag/instance         |                 2 |        9.9 |               n/a ᵃ |
| naive (anti-pattern) |           **980** |        7.8 |                64.5 |

→ Every properly-set-up engine wakes only the **2** rows that changed (vs. the
naive whole-snapshot subscription, which re-renders all **980** — a ~490× gap and
~15× the wall time). Among the surgical strategies Chimba UI re-renders **~1.9×
faster than XState**.

Zag mounts and wakes the same **2** rows, but its re-render wall is **n/a ᵃ** — the
microtask-batched `send` can't be timed under a synchronous `flushSync` loop, so
only its row-count is comparable.

---

> This file is the single source of truth for benchmark tables. The engine
> [README → Performance](../packages/core/README.md#performance) carries only a
> short prose claim + a link here — when you refresh numbers, update this file,
> and only touch the engine README's one-line claim if a headline ratio actually
> shifted.
