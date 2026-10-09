<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/dunky-dev/logo/main/logo-white%402x.png" />
    <img src="https://raw.githubusercontent.com/dunky-dev/logo/main/logo%402x.png" alt="Dunky" width="400px" />
  </picture>
</p>

# STATE-MACHINE

**Define a behavior once. Render it anywhere. Write it in TypeScript or Rust.**

A UI component is really two things tangled together: _behavior_ and _render_.
Dunky splits them. You describe behavior as a plain **state machine** that knows
nothing about the environment, and a thin per-substrate layer plugs it into a runtime.

The machine is universal in two ways. It is **substrate-agnostic**: the same machine
drives the DOM, React Native, a terminal, any render in a JS runtime. And it is
**language-agnostic**: the engine exists twice, in TypeScript (`packages/core`) and in
Rust (`crates/core`), both implementing one spec. Write a machine in TypeScript and it
runs in every JS runtime. Write it in Rust and it runs in Rust programs, and in
TypeScript too: compiled to wasm, it sits behind the same `Machine` interface, so
every target takes it like any other machine.

```
                      packages/core/SPEC.md
                     one contract, two engines
                                |
              +-----------------+-----------------+
              v                                   v
   TS engine (packages/core)          Rust engine (crates/core)
   machines in TypeScript             machines in Rust
              |                             |
              |                   +---------+---------+
              |                   |                   |
              |             wasm, uniffi           Rust apps
              |                   v               (iced, planned)
              |      fromWasm: the TS Machine interface
              |      over a Rust machine (packages/wasm)
              v                   v
   react . solid . native . opentui: targets never know which engine
```

## The challenge

### Truly agnostic

This project was inspired by [Zag](https://zagjs.com/), which pioneered the
component-as-a-headless-machine approach. Zag is agnostic about _which framework_
renders the DOM, but it still assumes a DOM exists. Dunky takes that one step
further: it assumes _nothing_ about the environment. The machine is a pure
behavioral kernel with no environment touchpoints, every place behavior meets the
platform — a keydown listener, a timer, a focus — is pushed to the per-target
layer (the view's `effects.ts`). So the _same_ machine runs unchanged on the DOM,
React Native, or any other JS runtime.

The same idea applies to the language. Neither engine runs on the other: the TS
engine is pure TypeScript, tuned for JS runtimes; the Rust engine is tuned for Rust,
with no JS trade-off. What keeps them one product is the spec and twin test suites,
not a shared runtime. See **[Two engines, one spec](./ARCHITECTURE.md#two-engines-one-spec)**
for the full map, including the Rust render path.

### Fast at scale

The hard case is **many machines reacting to many events inside
one frame budget** — things like a trading terminal with live tickers, a monitoring wall, a
canvas board, a game HUD. There the cost of each transition and the memory per
machine, multiplied by thousands, is what decides whether you hold the frame. The
engine is built for it:

| At scale (thousands of machines) |      Dunky | XState |     Zag |
| -------------------------------- | ---------: | -----: | ------: |
| Event throughput (ops/s)         | **11.6 M** |  1.6 M |   n/a ᵃ |
| Memory / machine, 2-field (KB)   |    **3.9** |    3.6 |     8.9 |
| Memory / machine, 64-field (KB)  |    **4.4** |    4.1 | **134** |

→ **~7× XState's throughput**, on par with XState for memory but at least **2× lighter than Zag** — and the gap widens as context grows, because memory stays ~flat in field count (no per-field cell). ᵃ Zag uses async ops, so a synchronous ops/s loop can't time it. Full methodology + per-scenario tables in the
**[benchmark README](./benchmark/ts/README.md)**.

**▶ [Try the live benchmark demo](https://dunky.dev/state-machine/benchmark/demo)** — watch all three engines run in your browser.

The Rust engine, measured natively, handles ~96 M events/s with zero allocations in the
steady state: no workload in its suite uses more than 3% of a 60 fps frame. See the
**[Rust benchmark](./benchmark/rust/README.md)**.

## How it's built

The machine's behavior flows out through a few thin layers until it reaches real
elements — the left two are agnostic, the right three are per-target:

![How Dunky works, from agnostic to substrate: the dunky engine powers, the machine decides, the binding connects, the behavior appears](./website/src/assets/diagrams/flow-animated.svg)

- **core** — the state-machine engine. Pure behavior: states, transitions,
  context, effects. Knows nothing about a renderer. It exists in TypeScript
  ([`packages/core`](./packages/core)) and in Rust ([`crates/core`](./crates/core)),
  two engines on one spec. A machine written in Rust reaches TypeScript through
  wasm ([`crates/wasm`](./crates/wasm) + [`packages/wasm`](./packages/wasm)) and
  React Native through uniffi ([`crates/uniffi`](./crates/uniffi), in progress).
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
- **[`packages/core/README.md`](./packages/core/README.md)** — the TS engine and its full API.
- **[`crates/core/SPEC.md`](./crates/core/SPEC.md)** and the **[Rust docs](https://dunky.dev/state-machine/rust)** — the Rust engine, machines in Rust, and using them from TypeScript.
- **[`benchmark/`](./benchmark/README.md)** — the TS suite (methodology, results vs. XState & Zag) and the Rust suite.
- **[`ACCESSIBILITY.md`](./ACCESSIBILITY.md)** — the external specs every package answers to.
- **[`AGENTS.md`](./AGENTS.md)** — the contributor / agent contract.

## Inspiration & prior art

Dunky stands on the shoulders of the amazing libs:

- **[XState](https://stately.ai/docs)** — for the disciplined statechart model:
  queued run-to-completion transitions, guards, entry/exit, the rigor of treating
  UI as a state machine in the first place.
- **[Zag](https://zagjs.com/)** — for proving the headless, framework-agnostic
  component-as-a-machine approach.

The engine here is an independent implementation — its own kernel, its own
state-machine runtime — built around one bet those libraries aren't: that behavior
should run with **no environment assumption at all**, fast enough to drive
thousands of machines at once.

## License

[MIT](./LICENSE) © Ivan Banov
