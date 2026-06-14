# Chimba UI

**Define a behavior once. Render it anywhere.**

A UI component is really two things tangled together: _behavior_ and _render_.
Chimba UI splits them. You describe behavior as a plain TypeScript
**state machine** that knows nothing about the environment and a thin per-substrate
layer plugs it into a runtime.

The same machine drives any render in a JS runtime. Same states, same
transitions, same accessibility intent. Only the render differs.

```
          +------------------------------+
          |      ONE STATE MACHINE       |
          |   states · events · context  |
          |   pure behavior — no render  |
          +---------------+--------------+
                          |  connect() → onPress · role · describedBy
          +---------------+---------------+
          v               v               v
    +-----------+   +-----------+   +-----------+
    | React DOM |   |   Native  |   |    TUI    |
    | → onClick |   |→ Pressable|   | → keypress|
    |  + aria-* |   |   + a11y  |   |  + cells  |
    +-----------+   +-----------+   +-----------+
     same behavior, byte-for-byte — only the render differs
```

> **Status: experimental.** The engine (`packages/core`) is stable and tested. The
> target bridges are NOT production-ready yet.
>
> This is an in-progress exploration.

## The challenge

### Truly agnostic

This project was inspired by [Zag](https://zagjs.com/), which pioneered the
component-as-a-headless-machine approach. Zag is agnostic about _which framework_
renders the DOM, but it still assumes a DOM exists. Chimba UI takes that one step
further: it assumes _nothing_ about the environment. The machine is a pure
behavioral kernel with no environment touchpoints, every place behavior meets the
platform — a keydown listener, a timer, a focus — is pushed to the per-target
layer (the view's `effects.ts`). So the _same_ machine runs unchanged on the DOM,
React Native, or any other JS runtime.

### Fast at scale

The hard case is **many machines reacting to many events inside
one frame budget** — things like a trading terminal with live tickers, a monitoring wall, a
canvas board, a game HUD. There the cost of each transition and the memory per
machine, multiplied by thousands, is what decides whether you hold the frame. The
engine is built for it — ~3–4× XState's event throughput, flat-ish memory, surgical
re-renders; numbers + methodology in the [benchmark README](./benchmark/README.md).

## How it's built

The machine's behavior flows out through a few thin layers until it reaches real
elements — the left two are agnostic, the right three are per-target:

```
agnostic                                                            substrate
+-----------+   +-----------+   +-----------+   +-----------+   +-----------+
|   core    |-->| connector |-->| normalize |-->| effects   |-->|   view    |
|  engine   |   | state ->  |   | bindings  |   | platform  |   | spreads   |
| behavior  |   | bindings  |   | -> props  |   | (rare)    |   | on elems  |
+-----------+   +-----------+   +-----------+   +-----------+   +-----------+
  onPress         onPress         onClick /       keydown,       <button
               (state as props)   Pressable       BackHandler    onClick=...>
```

- **core** — the state-machine engine. Pure behavior: states, transitions,
  context, effects. Knows nothing about a renderer.
- **connector** — turns machine state into agnostic _bindings_ and keeps that
  view in sync as the machine changes.
- **normalize** — per target, translates those bindings into real props
  (`onPress` → `onClick` on web / a `Pressable` handler on RN). Always runs.
- **effects** — per target, the platform listener that the machine can't own
  itself (a DOM `keydown`, an RN `BackHandler`).
- **view** — the per-target render that spreads the normalized props onto the
  actual elements.

The full layered model and the "the machine never sees props" rule are in:

- **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — the big-picture map and the layered model.
- **[`packages/core/README.md`](./packages/core/README.md)** — the state machine engine and its full API.
- **[`benchmark/README.md`](./benchmark/README.md)** — what's measured, the methodology, and results vs. XState & Zag.
- **[`AGENTS.md`](./AGENTS.md)** — the contributor / agent contract.

## Inspiration & prior art

Chimba UI stands on the shoulders of the amazing libs:

- **[XState](https://stately.ai/docs)** — for the disciplined statechart model:
  queued run-to-completion transitions, guards, entry/exit, the rigor of treating
  UI as a state machine in the first place.
- **[Zag](https://zagjs.com/)** — for proving the headless, framework-agnostic
  component-as-a-machine approach.

The engine here is an independent implementation — its own kernel, its own
state-machine runtime — built around one bet those libraries aren't: that behavior
should run with **no environment assumption at all**, fast enough to drive
thousands of machines at once.
