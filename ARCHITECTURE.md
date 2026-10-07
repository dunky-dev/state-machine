For _rules_ (do this, never do that), see [`AGENTS.md`](./AGENTS.md).

# Architecture

## The big picture

A component's behavior is a **state machine** that knows nothing about where it
renders. You write the machine in TypeScript or in Rust; both run on **one engine**,
written in Rust. A thin per-target layer plugs the machine into a runtime: same machine,
same behavior, same accessibility intent, different render.

```
  machine written in TypeScript            machine written in Rust
  (a config)                               (dunky-core types)
          |                                         |
          v                                         v
+----------------------------------------------------------------------+
|  the engine: crates/core (dunky-core), Rust                          |
|  runs the graph: queue, transitions, effects, timers, watchers,      |
|  computed bookkeeping                                                |
+----------------------------------------------------------------------+
          |  engine bindings: crates/wasm (JS, as wasm),
          |                   crates/uniffi (React Native, over JSI)
          v
+----------------------------------------------------------------------+
|  packages/core (@dunky.dev/state-machine)                            |
|  the TS API and the Machine facade: machine(), fromWasm(),           |
|  connector, compose, createStore                                     |
+----------------------------------------------------------------------+
          |  consumed by every target
          v
+----------------------------------------------------------------------+
|  shared/bindings  - substrate-agnostic event + attr vocabulary       |
|  shared/utils     - cross-target helpers (mergeProps, ...)           |
+----------------------------------------------------------------------+
          |  bridged per target
          v
+----------------------------------------------------------------------+
|  <target>   (react, solid, native, opentui, ...)                     |
|  lifecycle (build + start/stop), normalize bindings -> props,        |
|  selector subscription                                               |
+----------------------------------------------------------------------+
          |  imported as a normal package
          v
     consumer app
```

This repo is the **engine** — the agnostic machine plus its per-target bridges.
The components that consume it (and their style/codegen pipeline) live elsewhere.

> **Status: experimental, but it compiles and runs.** The suite is green and `tsc`
> is clean. It's an in-progress exploration — the API may still move.

## Layers

| Layer          | Where                                | Job                                                                     |
| -------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| Engine         | `crates/core`                        | What every machine does: the behavior contract, in Rust                 |
| Engine binding | `crates/wasm`, `crates/uniffi`       | Connects the engine to a runtime: JS through wasm, React Native via JSI |
| Core           | `packages/core`                      | The TS API every consumer imports, and the `Machine` facade             |
| Shared         | `packages/shared/bindings`, `/utils` | The vocabulary and helpers every target shares                          |
| Target         | `packages/<target>`                  | One substrate: lifecycle bridge, props translator, selector             |

Nothing below a layer knows the layer above it. The engine knows no runtime; core knows
no renderer; a target knows one substrate and nothing about the engine.

## The core rule: the machine never sees props

A machine is pure behavior — states, transitions, context, effects. It does
**not** read the consumer's props. Props are where the environment leaks in (a
DOM event handed to `onOpenChange`, a platform timer, a runtime-specific callback);
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

| Location                    | What it owns                                                           |
| --------------------------- | ---------------------------------------------------------------------- |
| `crates/core/`              | The engine (`dunky-core`): runtime, typed authoring, binding API       |
| `crates/macros/`            | The derives for Rust machines (`State`, `Event`, `Context`)            |
| `crates/wasm/`              | The JS engine binding (`dunky-wasm`): protocol, runtime, export macro  |
| `crates/core-wasm/`         | The wasm `packages/core` ships (built into `packages/core/wasm`)       |
| `crates/uniffi/`            | The React Native engine binding, over JSI (in progress)                |
| `packages/core/`            | The TS API: `machine()`, `fromWasm()`, connector, the `Machine` facade |
| `packages/shared/bindings/` | Substrate-agnostic event + attr vocabulary (onPress, role, …)          |
| `packages/shared/utils/`    | mergeProps, composeHandlers                                            |
| `packages/<target>/`        | Hook + normalize per substrate (react, solid, native, opentui, …)      |
| `sandbox/`                  | One demo app per substrate; `sandbox/shared/rust`: machines in Rust    |
| `benchmark/`                | The perf suite; `benchmark/rust`: the Rust twins of its machines       |

Each package's definition is its `SPEC.md`; the README is the quick reference.

## The map

```
packages/core                         the TS API over the engine — no React,
|                                     no DOM, no RN (one file per concern;
|                                     public surface in index)
+-- machine()                         compiles a config, builds a stopped TS
|                                     machine: .start()/.stop()/.send()/.select
+-- fromWasm()                        wraps a Rust machine in the same facade
+-- context / state                   one plain-object context per machine
|                                     (mutated in place) + flat states
+-- guards / actions                  and/or/not combinators · oneOf
+-- connector                         connect() -> live, subscribable snapshot
+-- compose                           run several machines as one (orthogonal
|                                     regions): start/stop + sync + combine
+-- createStore                       a reactive cell shared between machines

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

## The engine

The engine is `crates/core` (`dunky-core`). It runs the graph — the run-to-completion
queue, transition resolution, entry/exit order, the effects lifecycle, `after` timers,
watchers and computed bookkeeping — and implements
[`packages/core/SPEC.md`](packages/core/SPEC.md); its Rust tests are ported from
`packages/core/tests`. It owns no clock and no IO: a timer is a command its host runs.
What is specific to the crate is [`crates/core/SPEC.md`](crates/core/SPEC.md).

A machine is written in TypeScript or in Rust; both run on the engine:

```
TS machine: machine(config)            Rust machine: dunky-core types
     |                                      |
     | compiled: numbers + JS tables        | export_machine! (your crate)
     v                                      v
crates/core-wasm (inlined in the package)  your wasm module
     |                                      |
     +------------------+-------------------+
                        |  the protocol (crates/wasm): calls with status codes,
                        |  a notify per change, timers on the host clock
                        v
          packages/core: the Machine facade (machine() / fromWasm())
                        |
                        v
          the targets: react, solid, native, opentui
```

### A machine written in TypeScript

- `machine(config)` **compiles** the config once (cached per config object): states and
  event types become numbers; guards, actions, effects, delays and computed definitions
  become JS tables. The engine gets the numbers; the user code stays in JS.
- The engine runs the graph and calls back into the user code by index, through the
  **host functions**. The **context** stays a plain JS object, so a read is a property
  read.
- Each callback crossing is batched: a run of actions is one call, a guard walk is one
  call, and — when the machine has no computed values — a whole leaving transition
  (cleanups, exit, actions, the switch and its notification, entry, effects) is one call.
- JS announces its own context writes to the subscribers. The engine hears about a write
  only when watchers or computed values need it. JS keeps each computed value with what
  it read: a value whose inputs did not change comes from that cache, with no call.
- The wasm (`crates/core-wasm`) is inlined in the package and starts synchronously on the
  first `machine()` call.

### A machine written in Rust

- Typed Rust (`#[derive(State, Event, Context)]`, a `Config` built once), exported to JS
  with `dunky_wasm::export_machine!` in your own wasm module, and wrapped with `fromWasm`.
- Its **TS types** come from its Rust types: the build generates them onto the exported
  class, and `fromWasm` infers them, so nobody writes them twice.
- The engine runs everything, user code included, inside wasm. The facade keeps a JS
  **mirror** of the context and re-reads only the fields each notify names; a computed
  value crosses only when it changed.
- In JS a TS machine is faster (its context already lives in JS); a Rust machine is for
  reuse — the same machine runs in Rust programs, and over JSI on React Native.

### One facade, one protocol

- Both kinds share the **facade** (`MachineClass` in `packages/core`): it maps names to
  numbers, holds the context (or its mirror), and fans each change out to the
  subscribers. Targets, the connector and `compose` see only the `Machine` interface.
- The **protocol** ([`crates/wasm/SPEC.md`](crates/wasm/SPEC.md)): JS passes the facade
  with each call into the engine; the engine hands it to every host function of that
  call and lets it go afterwards. Rust holds no JS object between calls, so only JS
  references keep a machine alive — a pending timer holds its machine, like a JS timer
  holds `this`.
- **Errors** stay in JS: a host function catches what user code throws, keeps it on the
  facade, and returns a failure status; the engine raises its halt flag and stops the
  step; the facade rethrows the error to the caller.

### React Native

Hermes has no WebAssembly. `crates/uniffi` is the engine binding for React Native over
JSI (in progress); until it lands, the package does not run on React Native.

## Vocabulary

### The repo

| Term               | What it is                                                                                                                                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **engine**         | `crates/core` (`dunky-core`): the Rust runtime every machine runs on. It owns no clock and no IO.                                                                                                                                                                                      |
| **engine binding** | A crate that connects the engine to a runtime: `crates/wasm` (JS, through wasm), `crates/uniffi` (React Native, over JSI).                                                                                                                                                             |
| **core**           | `packages/core` (`@dunky.dev/state-machine`): the TS API every consumer imports, and the facade.                                                                                                                                                                                       |
| **target**         | A substrate-specific bridge package and its render environment — `packages/<target>/*` (`react`, `solid`, `native`, `opentui`, …).                                                                                                                                                     |
| **bindings**       | The substrate-agnostic event + attr vocabulary — lives in `shared/bindings`, consumed by every target's normalize. Each target's rename map and drop set are vocabulary-typed (`HandlerTargets`/`AttrTargets`, `HandlerKey`/`AttrKey`), so a typo'd or unknown key is a compile error. |
| **connect**        | A function returning the logical surface a view spreads onto elements.                                                                                                                                                                                                                 |
| **compose**        | Run several machines as one unit (orthogonal regions): bundled `start`/`stop` + `sync` + `combine`.                                                                                                                                                                                    |

### Machines (core, TS)

| Term                | What it is                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **config**          | A machine written in TypeScript: the state graph and its user code, a plain object. `machine()` builds a service from it.                               |
| **compiled config** | A config compiled once for the engine: numbers for states and event types, JS tables for the user code, and the engine's own copy of the graph.         |
| **TS machine**      | A service built from a config. The engine runs the graph; its user code and its context stay in JS.                                                     |
| **Rust machine**    | An instance of a class exported with `export_machine!`, wrapped with `fromWasm`. The engine runs it all; JS keeps a mirror of its context.              |
| **facade**          | The `Machine` object JS code holds, for both kinds: names to numbers, the context (or its mirror), the subscribers. Targets only ever see a facade.     |
| **source**          | What a target's lifecycle hook builds a service from: a config, or a ready facade.                                                                      |
| **host functions**  | The JS functions the engine calls back into (`HOST` in `packages/core`): user code by index, notify, timers. They take numbers and return status codes. |
| **status code**     | What every call into the engine returns: 0 done, 1 user code failed (the facade holds the error), 3 the engine failed (`takeFailure`).                  |

### The engine (Rust)

| Term                 | What it is                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **typed machine**    | A machine written in Rust: its states, events and context are Rust types, its config is built once with a builder and shared by every instance.                                       |
| **host**             | The `Host` trait (cargo feature `host`): what an engine binding implements to run a machine's external parts and hear its changes. In JS, the host is the set of host functions.      |
| **external part**    | A guard, action, effect, delay or computed definition referenced by number, run by the host — the user code of a TS machine.                                                          |
| **halt flag**        | Shared by the engine and its host: raised when a callback fails, it stops the current step at the next checkpoint. The binding lowers it once it has reported the failure.            |
| **notify**           | One per effective change, in order, with the state and the changed fields. A host may hold one back to deliver it with its next callback, no later than when the transition ends.     |
| **whole transition** | A leaving transition the host runs in one call: effect cleanups, exit actions, actions, the switch and its notification, entry actions, effects. Only where JS cannot see the switch. |
| **command**          | What a timer is to the engine: start or cancel, with an id. The host runs it on its clock and reports a due timer.                                                                    |
| **change mask**      | A bit per context field (64 at most), plus the state: what a write or a step changed.                                                                                                 |
| **TS types**         | A Rust machine's TypeScript types, generated from its Rust types (`TsType`) onto its exported class; `fromWasm` infers them.                                                          |

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
