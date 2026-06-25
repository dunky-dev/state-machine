# Live demo — engine throughput

The ops/sec tables in [`../README.md`](../README.md) measure how much engine work
each of Dunky, XState, and Zag clears per unit time. This makes that
**visible**: four panels, each a grid of real per-cell state machines, fed one
ramping change stream under an equal per-frame budget — and you watch which
panels' backlogs grow as the load climbs.

```bash
pnpm benchmark:demo     # from the repo root
# or
cd benchmark/demo && pnpm dev
```

Then open the printed URL (default <http://localhost:5173>). It's idle until you
start a run. Two modes:

- **⏱️ 15s test** — runs the full fifteen seconds and crowns the engine with the
  highest `updates/s` (shown as a `% of vanilla` badge per panel).
- **☠️ Survival test** — ramps the load until every engine falls behind, reporting
  how long each survived before its backlog blew past the budget.

A thick red bar at the top of the screen tracks run progress.

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
- **Async engines are measured by completed work, not issued work.** Zag's `send`
  defers each transition to a microtask, so it does no work synchronously when
  called. The drain loop accounts for this: for an async engine it awaits a flush
  so the transitions actually run, and counts an update applied only once it has
  executed — the same yardstick (real transitions completed under the budget) as
  the synchronous engines. Without this, Zag's queue would empty for free and its
  panel would report fictional throughput.

## What you're watching

| Panel                  | Per-cell model                                                |
| ---------------------- | ------------------------------------------------------------- |
| **Dunky**              | machine per cell · guarded transition + memoized computed     |
| **XState**             | actor per cell · guarded transition + assign-derived field    |
| **Zag**                | VanillaMachine per cell · guarded transition + bindable cells |
| **Vanilla** (control)  | no engine — the same guard walk + derive as plain JS          |

> **One asymmetry, disclosed:** Dunky's derived value is a **lazy/memoized
> `computed`** (recomputes only when its input changes); XState and Zag recompute
> it eagerly in the transition. Here it's ~neutral — every update changes the input,
> so all three recompute every update anyway — but it's a genuine model difference,
> not a thumb on the scale.

The load **ramps automatically** until the engines diverge. Reading each panel:

- **`updates/s`** — how much engine work it cleared under the same budget. Higher
  is better.
- **`% of vanilla`** (the badge by the name) — that `updates/s` as a fraction of
  the Vanilla control's, so each engine's overhead reads at a glance.
- **15s test:** the fastest engine is tagged `· faster` (green), the rest `· slower`
  (red).
- **Survival test:** once an engine's backlog blows past the budget its panel turns
  red and shows `survived Ns · N ops` — how long it lasted and how much it applied.

As the load ramps, an engine whose per-update cost is higher can't clear its queue
within the shared budget, so it falls behind while a cheaper one keeps up. Watch
the panels diverge and draw your own conclusion — the demo measures, it doesn't
assert a winner.

**Vanilla is the control, and that's the point of including it:** machine
machinery has a cost; the demo lets you see how much each engine adds over
bare-metal.

> Disposable, like the rest of the benchmark — a felt demonstration, not a
> certified measurement. Absolute numbers, and which panels diverge, move with your
> machine, the workload, and the ramp — run it yourself rather than trust a
> screenshot.
