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
platform — a keydown listener, a timer, a focus call — is pushed to a per-target
adapter. So the _same_ machine runs unchanged on the DOM, React Native, or a WebGL
with no framework at all.

### Fast at scale

State is mutated in place over a tiny notifier — a transition
is roughly a function call and a property write, with no immutable-snapshot
allocation per event. Memory per machine is flat regardless of how much context it
holds. That matters when you have **many machines reacting to an event stream
inside one frame budget**: a trading terminal with live tickers, a monitoring wall,
a canvas board, a game HUD.

| (5 000 machines, single clean run) | Agnostic Render   | XState        | Zag       |
| ---------------------------------- | ----------------- | ------------- | --------- |
| Memory / machine (4 → 64 fields)   | **2.8 KB** (flat) | 3.6 KB (flat) | 13→136 KB |
| Create + start, 5 000 machines     | **13 ms**         | 19 ms         | 81 ms     |
| Apply 200k events to completion    | **53 ms**         | 199 ms        | 204 ms    |
| Bundle (min + gzip)                | **2.7 KB**        | 14.5 KB       | 2.2 KB    |

See [`packages/core/machine/README.md`](./packages/core/machine/README.md) for the
methodology, the honest trade-offs, and how each number was measured.

**Single behavior byte-for-byte, everywhere**
The machine never reads props, the props live only at the edge (the connector + adapter).
That's what lets a single behavior contract stay identical across every target, instead of drifting
into N per-framework reimplementations.

## The trade-off

This is a focused engine, not a do-everything statechart. It leaves out, on
purpose:

- **Nested / parallel / hierarchical states** — flat states + composition instead.
- **Serializable-snapshot features** — time-travel, persistence, a visual inspector.
- **Spawned child machines / actors.**

**Need those? Reach for XState.** Driving many lightweight UI machines you never
serialize? You're not paying for capabilities you don't use.

## Solution

```ts
import { machine } from '@render-experiment/machine-core'

const toggle = machine({
  initial: 'off',
  context: { count: 0 },
  states: {
    off: {
      on: {
        flip: {
          target: 'on',
          actions: [({ context, setContext }) => setContext({ count: context.count + 1 })],
        },
      },
    },
    on: { on: { flip: { target: 'off' } } },
  },
})

toggle.start()
toggle.send({ type: 'flip' })
toggle.state // 'on'
toggle.context.count // 1
```

That machine is the whole behavior. To render it, a target adds two thin steps —
and **the machine itself never changes**:

1. **`connect()`** turns machine state into _logical_ bindings — `onPress`, `role`,
   `describedBy`.
2. **`normalize`** translates those to real props per platform — `onClick` +
   `aria-*` on web, `Pressable` props on React Native.

## How it's built

Four layers — agnostic core, cross-target shared assets, per-target render glue,
and the consumer app. The full layered model, the codegen pipeline, and the "the
machine never sees props" rule are in:

- **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — the big-picture map and the layered model.
- **[`packages/core/machine/README.md`](./packages/core/machine/README.md)** — the
  engine: states, guards, actions, effects, `computed`, `after`, `watch`, `select`,
  `compose`, the connector, and the full performance comparison.
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
thousands of machines at once. Where this engine differs and why is laid out,
honestly, in the [engine README](./packages/core/machine/README.md).
