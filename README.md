# Agnostic Render

**Define a behavior once. Render it anywhere.**

A UI component is really two things tangled together: _behavior_ and _render_.
Agnostic Render splits them. You describe behavior as a plain TypeScript
**state machine** that knows nothing about the environment and a thin per-substrate
layer plugs it into a runtime.

The same machine drives any render in a JS runtime. Same states, same
transitions, same accessibility intent. Only the render differs.

> **Status: experimental.** The engine (`core/machine`) is stable and tested. The
> components and target bridges are NOT production-ready yet.
>
> This is an in-progress exploration.

## The challenge

### Truly agnostic

This project was inspired by [Zag](https://zagjs.com/), which pioneered the
component-as-a-headless-machine approach. Zag is agnostic about _which framework_
renders the DOM, but it still assumes a DOM exists. Agnostic Render takes that one step
further: it assumes _nothing_ about the environment. The machine is a pure
behavioral kernel with no environment touchpoints, every place behavior meets the
platform — a keydown listener, a timer, a focus — is pushed to a per-target
adapter. So the _same_ machine runs unchanged on the DOM, React Native, or any other JS runtime.

### Fast at scale

The hard case is **many machines reacting to many events inside
one frame budget** — things like a trading terminal with live tickers, a monitoring wall, a
canvas board, a game HUD. There the cost of each transition and the memory per
machine, multiplied by thousands, is what decides whether you hold the frame. The
engine is built for it — ~3–4× XState's event throughput, flat-ish memory, surgical
re-renders; numbers + methodology in the [engine README](./packages/core/machine/README.md#performance).

## How it's built

4 layers

- **agnostic core** — the state machine engine
- **connector** — turns machine state into logical bindings (e.g. `onPress`, `role`,
  `describedBy`) and keeps that view in sync with the machine state
- **adapter** — the per-target layer that supplies platform effects (e.g. a DOM keydown
  listener, an RN `BackHandler`) and `normalize`s the logical bindings into real props
  (`onPress` → `onClick` / `Pressable`)
- **render glue** — the per-target view that spreads those normalized props onto the
  actual elements

The full layered model, the codegen pipeline, and the "the
machine never sees props" rule are in:

- **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — the big-picture map and the layered model.
- **[`packages/core/machine/README.md`](./packages/core/machine/README.md)** — the state machine and full benchmark results.
- **[`AGENTS.md`](./AGENTS.md)** — the contributor / agent contract.
- `packages/core/components/<comp>/SPEC.md` — per-component behavior specs.

## Inspiration & prior art

Agnostic Render stands on the shoulders of the amazing libs:

- **[XState](https://stately.ai/docs)** — for the disciplined statechart model:
  queued run-to-completion transitions, guards, entry/exit, the rigor of treating
  UI as a state machine in the first place.
- **[Zag](https://zagjs.com/)** — for proving the headless, framework-agnostic
  component-as-a-machine approach.

The engine here is an independent implementation — its own kernel, its own
state-machine runtime — built around one bet those libraries aren't: that behavior
should run with **no environment assumption at all**, fast enough to drive
thousands of machines at once.
