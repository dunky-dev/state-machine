# benchmark-demo

## 0.1.2

### Patch Changes

- Updated dependencies []:
  - @dunky.dev/state-machine@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @dunky.dev/state-machine@0.2.0

## 0.1.0

### Minor Changes

- [`f7c4b3e`](https://github.com/dunky-dev/state-machine/commit/f7c4b3efd9262d2242b0d42efb82c7059d04c470) Thanks [@ivanbanov](https://github.com/ivanbanov)! - Document the current live-demo methodology.

  The demo makes the ops/sec tables **visible**: four panels (Dunky, XState, Zag, and a Plain JS control), each a grid of real per-cell state machines fed one ramping change stream under an equal per-frame budget. Run it with `pnpm benchmark:demo`; it's idle until you press **Start**.

  It is deliberately **engine-bound, not DOM-bound** — a naive "render a grid" demo would measure React's render cost (which dominates and ties every engine), so the design isolates engine cost:

  - **Every cell is a real machine** doing the work the suite measures per update: a guarded transition (guard fallthrough) that writes context feeding a computed/derived value, then reads it back.
  - **Paint is off the hot path.** Each panel is a `<canvas>` heatmap on a throttled ~10fps tick — one cheap fill per cell, no per-cell React — so paint cost is tiny and identical across panels; what differs is the engine.
  - **Equal time budget.** Each frame, every panel gets the same few ms to drain its queue; a cheaper-per-update engine clears more and its backlog stays near zero, a costlier one falls behind.
  - **Async engines are measured by completed work, not issued work.** Zag's `send` defers each transition to a microtask, so the drain loop awaits a flush and counts an update applied only once it has actually executed — the same yardstick as the synchronous engines. Without this, Zag's queue would empty for free and report fictional throughput.

  One disclosed asymmetry: Dunky's derived value is a lazy/memoized `computed`; XState and Zag recompute eagerly in the transition. Here it's ~neutral (every update changes the input, so all three recompute anyway).

  Reading it: `updates/s` is the headline (higher is better); `queued` is the backlog it couldn't keep up with (panel tints red when falling behind). Plain JS is the control — bare-metal with no engine — so you can see how much each engine adds.

  Disposable by design: a felt demonstration, not a certified measurement. Absolute numbers and which panels diverge move with your machine, the workload, and the ramp — run it yourself. Full notes: [`benchmark/demo/README.md`](https://github.com/dunky-dev/state-machine/tree/main/benchmark/demo#readme).

### Patch Changes

- Updated dependencies [[`fd950db`](https://github.com/dunky-dev/state-machine/commit/fd950db7378c6af6a18aec5c234018d3345a61f4)]:
  - @dunky.dev/state-machine@0.1.0
