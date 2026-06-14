# Benchmark suite

A **disposable, first-look** performance harness for `@chimba-ui/state-machine`.
It measures the engine's hot paths in isolation and compares the runnable parts
against [XState](https://stately.ai/docs) and [Zag](https://zagjs.com/).

> **These numbers are not a leaderboard.** They are reproducible first-look
> figures to catch regressions and sanity-check the engine's design bets. Run
> them yourself — absolute numbers vary by machine, Node version, and thermal
> state. What's stable is the _shape_ (how a number scales with N) and the
> _ratios_ between engines on the same box.

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

## What each section tests

### 1. Fan-out / fine-grain / throughput (`tests/fan-out.ts`)

The selection layer at scale — the thing that decides whether thousands of
machines stay cheap. Contenders: Chimba UI, xstate.

- **A. Propagation — change 1 of N.** ONE machine, N fields, N observers (one per
  field). Bump one field. Chimba UI's `select` is a coarse bus: every selection
  re-evaluates its selector on each notify and value-compares, so only the
  touched field's _listener_ fires (downstream is O(changed)) — but the re-eval
  pass itself is O(N observers) per write. The table shows _how_ that degrades
  with N versus XState's coarse `actor.subscribe`. (N = 100, 1000, 5000.)
- **B. Fine-grain — change an UNOBSERVED field.** Change a field nobody selects.
  The dedup layer re-evaluates and value-compares, so no listener fires — the
  subscriber-side cost is ~zero (the engine still pays one bus pass). This is the
  "irrelevant write" that a cell-per-field model gets for free and a coarse bus
  has to work to ignore. (N = 1000, 5000.)
- **C. Throughput — single machine, one event.** Per-transition cost with no
  selection scaling — the raw `send` price.

### 2. Compose / synced machines (`tests/compose.ts`)

The cross-region machinery `compose` adds, scaled by member count (M = 2, 10, 50).

- **A. combine.** One value-deduped `Selection` derived across M members but
  reading only `m0`. It re-evaluates on _any_ member change (it subscribes to
  every member's bus) but fires its listener only when `m0` changes. We rotate
  which member we hit, so most ops re-eval-and-dedup without firing — exposing how
  the O(M) re-eval pass grows.
- **B. sync.** A coarse cross-region rule that wakes on _any_ member change — the
  O(members) path by design, measured so its cost is visible against combine's
  fine-grained path.

> A third "chain" sub-test (a sync rule that `send()`s downstream every change)
> was removed: under a tight loop it shows superlinear slowdown. That's a real
> `compose.sync` + cross-machine-send interaction worth investigating on its own,
> not a benchmark-tuning artifact — see the note in `tests/compose.ts`.

### 3. Computed (`tests/computed.ts`)

The most machinery-heavy subsystem — read-key tracking via proxies, memoization
against a dep snapshot, glitch-free computed→computed chains. Chimba UI-only (XState
has no first-class lazy/memoized computed). All on one machine:

- **A. cached read** — read with no change since last read. The common case;
  should be a cheap memo hit (re-check deps, return cached).
- **B. recompute** — change a read field, then read. The full recompute path
  (re-run the def under tracking proxies, re-record deps).
- **C. chain (4 deep)** — a computed→computed→computed→computed line; change the
  root, read the tip. Verifies the chain resolves once per change, not per level.
- **D. fine-grain** — change a field the computed does _not_ read, then read.
  Read-key tracking should make this a memo hit (no recompute).

### 4. Engine hot paths (`tests/engine.ts`)

The parts of `send` that do real statechart work (everything else in the suite
stays in one state and only mutates context). Chimba UI-only — engine-subsystem
measurements, not a competitor table.

- **A. guard fallthrough (K = 2, 8, 32).** A transition with K guarded
  candidates where the _last_ one wins — times the `resolve()` walk (build params
  once, test guards in order).
- **B. state-change churn.** ping ↔ pong, with `entry`/`exit` actions every
  event — the exit→transition→entry action path a context-only mutate never runs.
- **C. effect churn.** Same, but each state boots an effect on entry and runs its
  cleanup on exit — times `startEffects`/`stopEffects` per transition.
- **D. subscriber churn vs stable.** Subscribe + immediately unsubscribe around
  each event, so the bus-snapshot is rebuilt every notify (the mount/unmount
  shape of a virtualized 5k list), contrasted with a stable subscriber set.

### 5. Construction cost (`tests/construct.ts`)

Wall-clock to build + `start()` N machines, no events sent (matches a real
mount). Synchronous for all three, so it's a fair three-way table. Median of 5
passes, JIT warmed first. (N = 1000, 10000.) Contenders: Chimba UI, xstate, zag.

### 6. Memory per machine (`tests/memory.ts`)

Build N = 5000 machines, hold them live, report retained heap per machine
(`heapMB()` double-GCs before sampling). Two context widths because the whole
point of the plain-object model is that memory stays ~flat in _field count_:

- **thin** — 2 fields
- **fat** — 64 fields (the case that balloons a cell-per-field engine)

And two modes:

- **idle** — never written
- **written** — one `hit` each (the footprint a churny app actually pays)

The idle/written split exposes lazy-copy schemes: Chimba UI owns its context copy from
construction (idle ≈ written by design), while XState's first `assign` allocates
a per-actor context, so its written row grows. Median of 3 passes, warmed
outside the measured window. Contenders: Chimba UI, xstate, zag.

### 7. React rendering (`tests/rendering/`)

The thing that actually hurts in an app — how many React components render — under
jsdom (bootstrapped before `react-dom` loads). A list of N rows, 50 highlight
moves. Two numbers: **mount** (rows rendered on first paint) and **re-renders**
(rows that re-render when one machine changes). Strategies:

- **selector** — a shared machine + `useSelector` per row ("am I highlighted?").
- **naive** — a shared machine, whole-snapshot subscription (re-renders all N —
  the anti-pattern, shown for contrast).
- **Chimba UI/instance** — one machine per row off the connector snapshot.
- **zag/instance** — Zag's `useMachine` per row + `React.memo`.
- **xstate/selector** — a shared actor + `@xstate/react`'s `useSelector`.

(N = 100, 1000.) Contenders: Chimba UI, xstate, zag.

## How to read the tables

Every ops/sec table (sections 1–4) carries these columns, from `report.ts`:

| Column      | Meaning                                                           |
| ----------- | ----------------------------------------------------------------- |
| `ops/sec`   | iterations per second — **higher is better**                      |
| `mean (µs)` | average time per iteration — **lower is better**                  |
| `±rme %`    | relative margin of error on the mean — the run-to-run noise floor |
| `samples`   | how many timed samples fed the mean                               |

**The `±rme %` column is the one that keeps you honest.** A gap between two rows
is only real if it clears both rows' margins of error. A 4% difference with a
±3% rme on each side is noise, not a finding.

Construction (section 5) reports `total (ms)` and `µs / machine`; memory
(section 6) reports `total (MB)` and `KB / machine`; rendering (section 7)
reports render counts and wall-clock per phase. Lower is better in all three.

The `(anti-DCE SINK: …)` lines are just proof the work wasn't dead-code-
eliminated by the JIT — ignore them.

## Representative results

From one clean run (Node 24, Apple Silicon). **Yours will differ in absolute
terms** — what should hold is the ranking and the scaling shape.

**Throughput — events/sec (higher is better)**

| Scenario                          | Chimba UI | XState |
| --------------------------------- | --------: | -----: |
| Single machine, one event         |     2.9 M | 0.86 M |
| Fine-grain (unobserved) 1 of 5000 |     1.3 M | 0.43 M |

Chimba UI's lead here is the design bet paying off: context is mutated in place behind
a value-deduping bus, so a transition doesn't allocate a snapshot (XState) and an
irrelevant write doesn't wake observers.

**Construction — µs / machine (lower is better)**

| N      | Chimba UI | XState |  Zag |
| ------ | --------: | -----: | ---: |
| 10 000 |      3.73 |   2.13 | 8.37 |

Construction against XState is roughly par — Chimba UI's bet is _flatness_, not a
spin-up win. XState is a touch faster to construct; Zag's per-field reactive
cells cost it ~2–4×.

**Memory — KB / machine, 5 000 live (lower is better)**

| Context  | Chimba UI | XState |     Zag |
| -------- | --------: | -----: | ------: |
| 2-field  |      4.23 |   3.62 |    9.06 |
| 64-field |      4.73 |   4.10 | **134** |

This is the headline. Chimba UI's 2 → 64 fields adds only ~0.5 KB/machine: context is
one plain object, so memory grows with the data you store, not with a per-field
cell. **Zag is the contrast** — one reactive cell per field balloons a 64-field
context to ~134 KB/machine (~28×). XState is marginally lighter than Chimba UI per
machine; Chimba UI's claim is the flat _slope_, not the smallest absolute number.

**React rendering — list of 1 000, 50 highlight moves (lower is better)**

| Metric              | Chimba UI | XState |          Zag |
| ------------------- | --------: | -----: | -----------: |
| Rows woken / move   |         2 |      2 |            2 |
| Mount (ms)          |       7.5 |    9.5 |          7.8 |
| Re-render wall (ms) |       4.9 |    8.0 | n/a (async)¹ |

All three properly-configured engines wake only the **2** rows that changed — the
metric that matters for "stays surgical at scale." The difference is per-render
_cost_, where Chimba UI and XState are directly comparable (both flush synchronously).

- ¹ Zag's `send` is microtask-batched, so a synchronous `flushSync` re-render loop
  can't time it fairly — only its row-count is reported.

> The curated, prose version of these tables (with bundle sizes and the full
> design rationale) lives in the engine's
> [README → Performance](../packages/core/README.md#performance). When you refresh
> numbers, update both.
