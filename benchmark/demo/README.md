# Live demo — engine throughput

The ops/sec tables in [`../README.md`](../README.md) say Chimba UI clears more
engine work per unit time than XState or Zag. This makes that **visible**: four
panels, each a grid of real per-cell state machines, fed one ramping change
stream — and you watch them fall behind one by one.

```bash
pnpm benchmark:demo     # from the repo root
# or
cd benchmark/demo && pnpm dev
```

Then open the printed URL (default <http://localhost:5173>). It's idle until you
press **Start**.

## Why it's built this way

A naive "render a grid" demo measures **React's** render cost, not the engine's —
and React dominates, so every fine-grained engine ties and the comparison says
nothing. This demo is deliberately **engine-bound**, not DOM-bound:

- **Every cell is a real machine.** Per update it does the work the benchmark
  measures: a **guarded transition** (guard fallthrough) that writes context
  feeding a **computed** / derived value, then reads that value back. See
  [`engines.ts`](./src/engines.ts).
- **Paint is off the hot path.** Each panel is a `<canvas>` heatmap drawn on a
  throttled ~10fps tick — one cheap fill per cell, no per-cell React. So paint
  cost is tiny and identical across panels; what differs is the **engine**.
- **Equal time budget.** Each frame, every panel gets the same few ms to apply
  its queue of pending updates. A cheaper-per-update engine clears more → its
  backlog stays near zero; a costlier one can't keep up and falls behind.

## What you're watching

| Panel                  | Per-cell model                                                |
| ---------------------- | ------------------------------------------------------------- |
| **Chimba UI**          | machine per cell · guarded transition + memoized computed     |
| **XState**             | actor per cell · guarded transition + assign-derived field    |
| **Zag**                | VanillaMachine per cell · guarded transition + bindable cells |
| **Plain JS** (control) | no engine — the same guard walk + derive as plain JS          |

The load **ramps automatically** until the engines diverge. Reading the result:

- **`updates/s`** (the blue headline) — how much engine work each cleared under
  the same budget. Higher is better.
- **`queued`** — the backlog it couldn't keep up with; the panel tints red once
  it's falling behind.
- The honest signal is the **order they fall behind** as the load climbs: XState
  first, then Zag, with **Chimba the last engine standing** before the
  no-engine control. That mirrors the benchmark's throughput ranking — made
  visible.

**Plain JS leads, and that's the point of including it:** machine machinery has a
cost; the question is only how cheap. Chimba is the closest of the three engines
to bare-metal.

> Disposable, like the rest of the benchmark — a felt demonstration, not a
> certified measurement. Absolute numbers move with your machine; the ranking and
> the fall-behind order are what hold.
