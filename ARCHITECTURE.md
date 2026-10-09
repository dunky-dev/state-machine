For _rules_ (do this, never do that), see [`AGENTS.md`](./AGENTS.md).

# Architecture

## The big picture

A component's behavior is a **state machine** — plain TypeScript that knows
nothing about where it renders. A thin per-target layer plugs that machine into a
runtime: same machine, same behavior, same accessibility intent, different render.

```
The host
+----------------------------------------------------------------------+
|  packages/core                                                       |
|  No runtime render — pure JS, runs anywhere                          |
|  states, events, context, guards, actions, effects, select           |
+----------------------------------------------------------------------+
                               |  consumed by every target
                               v
+-----------------------------------------------------------------------+
|  shared/bindings                                                      |
|  Substrate-agnostic event + attr vocabulary (onPress, role, …)        |
+-----------------------------------------------------------------------+
                               |
+-----------------------------------------------------------------------+
|  shared/utils                                                         |
|  Cross-target helpers (mergeProps, composeHandlers)                   |
+-----------------------------------------------------------------------+
                               |  bridged per target
                               v
+------------------------------------------------------------------------+
|  <target>   (react, solid, native, opentui, …)                         |
|  Runtime-specific bridge                                               |
|  • lifecycle (build + start/stop)  • normalize bindings -> props       |
|  • selector subscription                                               |
+------------------------------------------------------------------------+
                               |  imported as a normal package
                               v
                            Consumer app
```

This repo is the **engine** — the agnostic machine plus its per-target bridges.
The components that consume it (and their style/codegen pipeline) live elsewhere.

> **Status: experimental, but it compiles and runs.** The `packages/core` engine
> is a stable plain-mutation kernel (no signals; see
> [`packages/core/README.md`](./packages/core/README.md)). The
> suite is green and `tsc` is clean. It's an in-progress exploration — the API may
> still move — not a 1.0.

## Three layers

The repo splits in three layers. **`core/`** is the agnostic side — pure JS,
no renderer. It says _what_ behavior is: states, transitions, context, guards,
actions. Nothing in `core/` knows that React or the DOM exists.

**`shared/`** is the cross-target side — `shared/bindings` owns the
substrate-agnostic event and attr vocabulary (`onPress`, `role`, …); `shared/utils`
owns cross-target helpers (mergeProps, composeHandlers).

**`<target>/`** is the substrate side — `react`, `solid`, `native`, `opentui`, and any
future renderer. Each target is the runtime bridge for one environment: the
lifecycle bridge, the event normalization, and the selector subscription all
live here.

## The core rule: the machine never sees props

A machine is pure behavior — states, transitions, context, effects. It does
**not** read the consumer's props. Props are where the environment leaks in (a
DOM event handed to `onOpenChange`, a platform timer, a host-specific callback);
if the machine read them, it would be coupled to the shape one runtime happens
to give it.

So props enter only at the **edge**, never the machine:

- **config the transitions need** (delays, flags like `disabled`) → seeded into
  the machine's **context** (and updated via `setContext` when props change);
- **callbacks + controlled state** (`onOpenChange`, controlled `open`) → handled
  by the **connector / connect**, which observes the machine and calls back;
- **initial state derived from props** → computed before `machine()` is built.

**Controlled state is initial-only.** A controlled `open`/`value` resolves into
the _initial_ state once, and the connector fires the prop callback on every
intent — the engine does not live-reconcile a controlled value after mount. The
consumer re-renders with the new value; the component never mutates it. ("It
reports the intent and the consumer decides," not "the component obeys the
controlled value frame-by-frame.")

This is the rule that makes one machine run byte-for-byte identically on React,
React Native, a canvas loop, or a test — each target varies only the thin
connector layer around it. (It's the one place this engine diverges from
Zag, whose machines read props directly.)

## Project structure

| File / location             | What it owns                                                      |
| --------------------------- | ----------------------------------------------------------------- |
| `packages/core/`            | State-machine engine (plain-mutation kernel)                      |
| `packages/shared/bindings/` | Substrate-agnostic event + attr vocabulary (onPress, role, …)     |
| `packages/shared/utils/`    | mergeProps, composeHandlers                                       |
| `packages/<target>/`        | Hook + normalize per substrate (react, solid, native, opentui, …) |
| `crates/core/`              | The Rust engine: the same spec, in Rust (`dunky-state-machine`)   |
| `crates/macros/`            | `#[derive(State, Event, Context)]` for Rust machines              |
| `crates/wasm/`              | Rust machines as JS classes (`export_machine!`)                   |
| `packages/wasm/`            | `fromWasm`: a Rust machine behind the TS `Machine` interface      |
| `crates/sandbox/`           | The sandbox machines in Rust, twins of `sandbox/shared` ones      |
| `crates/uniffi/`            | Rust machines for React Native over JSI (uniffi; facade planned)  |
| `sandbox/uniffi/`           | The turbo module uniffi-bindgen-react-native generates from it    |

## The map

```
core                                  agnostic state-machine engine — no React,
|                                     no DOM, no RN (one file per concern;
|                                     public surface in index)
+-- machine()                         builds a stopped service from a config;
|                                     .start()/.stop()/.send()/.state/.select
+-- context / state                   one plain-object context per machine
|                                     (mutated in place) + flat states
+-- guards / actions                  and/or/not combinators · oneOf
+-- connector                         connect() -> live, subscribable snapshot
+-- compose                           run several machines as one (orthogonal
|                                     regions): start/stop + sync + combine

shared/bindings                       substrate-agnostic event + attr vocabulary
+-- (onPress, role, aria-*, …)        consumed by every target's normalize

shared/utils                          cross-target, cross-component helpers
+-- (mergeProps, composeHandlers)

<target>                              one substrate (react, solid, native, opentui, …)
|                                     runtime, hooks, and props translator
+-- use-machine                       lifecycle bridge (build + start/stop + useSyncExternalStore)
+-- use-selector                      fine-grained leaf subscription (O(readers))
+-- normalize                         bindings -> target props
```

Three package groups, three jobs:

- **`core/`** — _the agnostic side_. Behavior, types, and the engine that
  knows nothing about a renderer.
- **`shared/`** — _the cross-target side_. `shared/bindings` owns the
  event + attr vocabulary; `shared/utils` owns agnostic helpers (prop
  merging, handler composition).
- **`<target>/`** — _the substrate side_. One folder per renderer
  (`react`, `solid`, `native`, `opentui`). Owns its runtime bridge and its props translator.

## Two engines, one spec

The machine behavior exists twice, in TypeScript and in Rust, against one contract.
This is the target shape of the repo; the boxes marked _planned_ do not exist yet.

```
                        packages/core/SPEC.md
                      one behavior contract, two engines
                                   |
             +---------------------+---------------------+
             |         sync by spec, twin test suites    |
             v                                           v
+---------------------------+             +---------------------------+
| TS engine                 |             | Rust engine               |
| packages/core             |             | crates/core, crates/macros|
| @dunky.dev/state-machine  |             | dunky-state-machine                |
+---------------------------+             +---------------------------+
             |                                           |
             | authors                                   | authors
             v                                           v
+---------------------------+             +---------------------------+
| TS machines + connectors  |             | Rust machines + connectors|
| setup().config()          |             | derives + Config builder  |
| e.g. palette, connect()   |             | e.g. dropdown, connect()  |
+---------------------------+             +---------------------------+
             |                            |              |               |
             |                web: wasm32 |              | native: lib   | Rust app
             |                            v              v               |
             |              +----------------+  +----------------+       |
             |              | crates/wasm    |  | crates/uniffi  |       |
             |              | export_machine!|  | push protocol  |       |
             |              | wasm-bindgen   |  | ubrn turbo mod |       |
             |              +----------------+  +----------------+       |
             |                      |                  |                 |
             |        notify(state, fields), timers, field reads         |
             |                      v                  v                 |
             |              +----------------+  +----------------+       |
             |              | packages/wasm  |  | RN facade      |       |
             |              | fromWasm()     |  | (planned)      |       |
             |              | context mirror |  | context mirror |       |
             |              | no Rust engine |  | no Rust engine |       |
             |              +----------------+  +----------------+       |
             |                      |                  |                 |
             v                      v                  v                 v
+------------------------------------------------------------+  +------------------------+
| Machine interface (TS, packages/core)                      |  | Machine<T> (Rust,      |
| send, state, context, computed, subscribe, select,         |  | crates/core)           |
| start/stop. toMachine(source) takes a config or any ready  |  | same contract, typed   |
| machine; a target cannot tell which engine built it.       |  | fields, timers as cmds |
+------------------------------------------------------------+  +------------------------+
                            |                                              |
                 connector per machine                          connector per machine
                            |                                              |
+------------------------------------------------------------+  +------------------------+
| packages/shared/bindings                                   |  | crates/bindings        |
| roles, keyboard, focus, a11y props; substrate-free         |  | (planned) the same     |
+------------------------------------------------------------+  +------------------------+
                            |                                              |
     +------------+---------+---------+------------+                       |
     v            v                   v            v                       v
+----------+ +----------+       +----------+ +----------+          +------------------+
| react    | | solid    |       | native   | | opentui  |          | iced (planned)   |
| web + RN | | web      |       | RN props | | terminal |          | macOS, Windows,  |
+----------+ +----------+       +----------+ +----------+          | Linux: winit +   |
                                                                   | AccessKit; OS    |
                                                                   | conventions in a |
                                                                   | platform switch  |
                                                                   +------------------+
```

How to read it:

- **Two engines, one spec.** `packages/core` and `crates/core` each implement
  `packages/core/SPEC.md`. Neither runs on the other: each is tuned for its own
  runtime. They stay in sync through the spec, twin test suites (`packages/core/tests`
  and `crates/core/tests`, file by file) and one rule: a behavior change updates the
  spec, both engines and both suites in the same PR (see
  [AGENTS.md](AGENTS.md#two-engines-one-spec)).
- **A machine is authored against one engine, with its connector next to it.** TS
  machines against the TS engine; Rust machines against the Rust engine, which is the
  only place they run. The sandbox palette exists in both (`sandbox/shared`,
  `crates/sandbox`), as a worked example of the twin rule.
- **The TS engine is the default in every JS runtime**, React Native included. A
  machine is written in Rust when it is wanted in Rust too (a Rust app) or shared
  across the web, React Native and Rust from one source.
- **The facades put a Rust machine behind the TS `Machine` interface.** They ship no
  engine: they map names to numbers, keep a JS mirror of the context, re-read only the
  fields each notify names, and fan changes out to subscribers. `packages/wasm`
  (`fromWasm`) does it over `crates/wasm`; the React Native facade does the same over
  `crates/uniffi`, which speaks the same push protocol (one `notify` per change, timers
  as host calls).
- **One binding per substrate.** `crates/wasm` for JS runtimes with wasm (web, Node,
  Bun, so OpenTUI too). `crates/uniffi` for React Native over JSI, generated into a
  turbo module by uniffi-bindgen-react-native (`sandbox/uniffi`).
- **Targets are engine-blind.** They take a `Machine` through `toMachine` and
  `connect`, so react, solid, native and opentui work unchanged whichever engine built
  it.
- **Rust renders too.** A Rust app holds the `Machine<T>` directly, no binding and no
  facade. Above it the Rust column mirrors the TS one: a connector per machine, one
  shared bindings crate (the twin of `packages/shared/bindings`), and one target, iced.
  iced already spans macOS, Windows and Linux (winit for windows and input, AccessKit
  for the accessibility tree), so the OS differences that remain, such as Cmd vs Ctrl
  or Home/End conventions, are a platform switch inside the target, not a crate per OS.

## The machine parts

`machine.ts` is the state graph (states, transitions, action impls). It
changes when behavior changes.

`connect` (the connector) translates the machine snapshot + props into the
surface a view consumes (handlers + attrs per part). This is the layer that
reads props (see "the machine never sees props" above) and fires the consumer's
callbacks. It changes when the API surface changes.

Cross-instance singletons (e.g. "only one tooltip open at a time") use
`createStore` from `@dunky.dev/state-machine` — a tiny reactive cell (plain value +
listeners) living outside any one machine. Per-machine state is the engine's own
plain-object context.

### Two homes for a side-effect

A behavior that runs as a side-effect lives in one of two places, depending on
whether it needs props/platform or not:

1. **Core config effect** — props-free **and** platform-free (e.g. a store
   subscription). It's registered by name in the machine's `setup({ effects })`
   and named on a state in `createMachine({ states })`, so it runs inside the
   machine, scoped to that state. Use this when the machine owns the lifecycle
   and the effect needs neither props nor the platform.

2. **Component effect (`ComponentEffect`)** — **prop-aware** and
   **platform-specific** (a DOM `keydown` for Escape on web, an RN `BackHandler`).
   The machine can't own it because [it never sees props](packages/core/README.md#the-machine-never-sees-props).
   It lives in the target as a plain `(machine, props) => cleanup` + the prop
   names it depends on. The agnostic _decision_ still lives in core; only the
   platform listener is per-target. On accept it `send()`s a plain event the
   machine already understands.

## Vocabulary

| Term         | What it is                                                                                                                                                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **host**     | The agnostic core — `packages/core/*`. Declares what behavior is.                                                                                                                                                                                                                      |
| **target**   | A substrate-specific bridge package and its render environment — `packages/<target>/*` (`react`, `solid`, `native`, `opentui`, …).                                                                                                                                                     |
| **machine**  | A state-graph config consumed by `machine()`; returns a startable service.                                                                                                                                                                                                             |
| **connect**  | A function returning the logical surface a view spreads onto elements.                                                                                                                                                                                                                 |
| **bindings** | The substrate-agnostic event + attr vocabulary — lives in `shared/bindings`, consumed by every target's normalize. Each target's rename map and drop set are vocabulary-typed (`HandlerTargets`/`AttrTargets`, `HandlerKey`/`AttrKey`), so a typo'd or unknown key is a compile error. |
| **compose**  | Run several machines as one unit (orthogonal regions): bundled `start`/`stop` + `sync` + `combine`.                                                                                                                                                                                    |

## Versioning

Every package versions independently; `.changeset/config.json` keeps `fixed`
and `linked` empty, so no group is ever forced to share a version number —
an untouched package never gets an empty bump.

Internal workspace dependencies pin exact (`workspace:*`), never a caret
range (`workspace:^`). Independent versions mean siblings drift apart at
their own pace, so a caret range between two packages that share a further
dependency can let a consumer's install resolve to two different physical
copies of it — a dependency diamond. Anything identity-sensitive further
down (a singleton, a `WeakMap`, module-level state) breaks silently across
the two copies. An exact pin collapses the diamond to one resolvable
version: a mismatch fails at publish time, not at runtime in a consumer's
app.
