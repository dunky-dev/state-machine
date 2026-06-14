For _rules_ (do this, never do that), see [`AGENTS.md`](./AGENTS.md).

# Architecture

## The big picture

A component's behavior is a **state machine** — plain TypeScript that knows
nothing about where it renders. A thin per-target layer plugs that machine into a
runtime: same machine, same behavior, same accessibility intent, different render.

```
The host
+----------------------------------------------------------------------+
|  packages/core                                                      |
|  No runtime render — pure JS, runs anywhere                        |
|  states, events, context, guards, actions, effects, select        |
+----------------------------------------------------------------------+
                               |  consumed by every target
                               v
+-----------------------------------------------------------------------+
|  shared/utils                                                      |
|  Cross-target helpers (mergeProps, composeHandlers, positioning)    |
+-----------------------------------------------------------------------+
                               |  bridged per target
                               v
+------------------------------------------------------------------------+
|  <target>   (react, native, …)                               |
|  Runtime-specific bridge                                             |
|  • lifecycle (build + start/stop)  • normalize bindings -> props     |
|  • selector subscription                                             |
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

## Two halves

The repo splits in two halves. **`core/`** is the agnostic side — pure JS,
no renderer. It says _what_ behavior is: states, transitions, the bindings
vocabulary. Nothing in `core/` knows that React or the DOM exists.

**`<target>/`** is the substrate side — `react`, `native`, etc, and any future
renderer. Each target is the runtime bridge for one environment: the lifecycle
bridge, the event normalization, and the selector subscription all live here.

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

| File / location          | What it owns                                                       |
| ------------------------ | ------------------------------------------------------------------ |
| `packages/core/`         | State-machine engine (plain-mutation kernel) + bindings vocabulary |
| `packages/shared/utils/` | mergeProps, composeHandlers, positioning, memo                     |
| `packages/<target>/`     | Hook + normalize per substrate (react, native, ...)                |

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
+-- bindings                          event + attr vocabulary (onPress, role, …)

shared/utils                          cross-target, cross-component helpers
+-- (composeHandlers, positioning, memo, mergeProps)

<target>                              one substrate (react, native, …) — the
|                                     runtime, hooks, and props translator
+-- use-machine                       lifecycle bridge (build + start/stop + useSyncExternalStore)
+-- use-selector                      fine-grained leaf subscription (O(readers))
+-- normalize                         bindings -> target props
```

Three package groups, three jobs:

- **`core/`** — _the agnostic side_. Behavior, types, and the engine that
  knows nothing about a renderer.
- **`shared/`** — _the cross-target side_. Agnostic helpers: positioning math,
  prop merging, memoization.
- **`<target>/`** — _the substrate side_. One folder per renderer
  (react, native). Owns its runtime bridge and its props translator.

## The machine parts

`machine.ts` is the state graph (states, transitions, action impls). It
changes when behavior changes.

`connect` (the connector) translates the machine snapshot + props into the
surface a view consumes (handlers + attrs per part). This is the layer that
reads props (see "the machine never sees props" above) and fires the consumer's
callbacks. It changes when the API surface changes.

Cross-instance singletons (e.g. "only one tooltip open at a time") use
`createStore` from `@chimba-ui/state-machine` — a tiny reactive cell (plain value +
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

| Term         | What it is                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| **host**     | The agnostic core — `packages/core/*`. Declares what behavior is.                                              |
| **target**   | A substrate-specific bridge package and its render environment — `packages/<target>/*` (`react`, `native`, …). |
| **machine**  | A state-graph config consumed by `machine()`; returns a startable service.                                     |
| **connect**  | A function returning the logical surface a view spreads onto elements.                                         |
| **bindings** | The substrate-agnostic event + attr vocabulary core's connect speaks.                                          |
| **compose**  | Run several machines as one unit (orthogonal regions): bundled `start`/`stop` + `sync` + `combine`.            |
