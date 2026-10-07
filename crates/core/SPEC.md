# SPEC - `dunky-core`

## Overview

`dunky-core` is the engine of [`@dunky.dev/state-machine`](../../packages/core), in Rust.
Every machine runs on it: a machine written in Rust with this crate, and a machine
written in TypeScript, through the runtime in [`dunky-wasm`](../wasm/SPEC.md).

The behavior contract is [`packages/core/SPEC.md`](../../packages/core/SPEC.md): flat
states, run-to-completion, guards, actions, effects, timed transitions, derived data,
data-reactions, observation, the connector, composition, and the cross-instance store.
This SPEC covers only what is specific to the crate: authoring a machine in Rust, timers
without a clock, and the binding API.

```
  Rust types + config builder              a binding (dunky-wasm, React Native)
        |                                     |   host: runs the external parts,
        |  build once                         |   hears every change
        v                                     |
  config  (shared by every machine of the type)
        |                                     |
        v                                     v
  machine  ------ timer commands out ------>  host clock
     ^  |                                        |
     |  +-------- changes out (state, fields)    |
     |                                           |
     +----------- events in, due timers in <-----+
```

## Intent

Write the engine once and run it for every host: JS through wasm, React Native through
JSI, and Rust programs directly. The engine stays free of IO and platform, so one build
behaves the same everywhere; a host supplies the clock and the boundary.

## Scope & boundaries

**In scope.** The engine runtime; typed authoring of machines; timers as commands; change
reporting; and the binding API (cargo feature `host`).

**Out of scope — invariants, not preferences.**

- **No IO, no clock, no platform.** The engine never reads time and never schedules work.
  A host does.
- **No JS.** Bindings live in their own crates: `dunky-wasm` for JS, `crates/uniffi` for
  React Native.
- **One thread.** A machine and what it shares stay on one thread. A binding that crosses
  threads enforces that itself.
- **At most 64 context fields** per machine: each field is one bit of the change mask.

## Authoring a machine in Rust

- A machine type names three types: its **states** (an enum without data), its
  **events** (an enum: each variant is a kind, and a variant may carry a payload), and its
  **context** (a struct).
- Derives generate the glue: the state names and indices; one event kind per variant,
  which keys the handlers; and for the context, a patch builder that sets fields by name,
  one handle per field, and a reader that records which fields a derived value reads.
- A **config** is built once, with a builder, from the initial state and the seed
  context. It is cheap to share: every machine of the type uses the same config.
- Guards, actions, effects and delays are inline closures or registered names; a name
  resolves when the config is built.
- A derived value is declared with a typed key, numbered in declaration order, and an
  equality (`PartialEq` by default).
- With the `serde` feature, a context field serializes by index and an event rebuilds
  from its kind and its payload: what a binding needs to cross into another runtime.

## The behavior contract

The contract is `packages/core/SPEC.md`'s. These guarantees are specific to the crate.

### Timers are commands

- Scheduling a timed transition emits a **start** command: a timer id and a delay.
  Leaving the state emits a **cancel** command for each of its pending timers.
- The host takes the commands after each call, runs them on its clock, and reports each
  due timer by id. A report for a cancelled, fired, or stale timer is ignored.
- A timer id is unique among the machine's pending timers.

### Change reporting

- Each effective change stamps what it touched: the state, or a set of context fields.
- A binding can take what changed since its last take — a state flag and a field mask —
  to mirror only those values into another runtime.

### Re-entrancy

- User code written in Rust (guards, actions, effects, delays, derived definitions) gets
  params — the context, the event, derived values, a way to write context, a way to
  dispatch — not the machine.
- Observers (subscriptions, selections, lifecycle listeners, effect cleanups) and host
  callbacks run while the engine holds no mutable borrow: they may read, dispatch, or
  write context. A dispatch made during a run-to-completion step is queued.

### Equality

- A context write changes a field only when the value differs (`PartialEq`). A derived
  value changes by its declared equality.

### Failures

- A missing named implementation panics in debug builds, and warns and does nothing in
  release builds.
- A runaway step (more than 10,000 items in one run-to-completion step) stops. Without a
  host it panics in debug builds and drops the queue in release builds. With a host, the
  step stops and the binding raises the failure in its own runtime.
- A panicking cleanup does not leak the others: every cleanup runs, then the first panic
  resumes.

## The binding API

A **host** (cargo feature `host`) connects a machine to another runtime. It has two jobs:

- **Run the external parts.** A config may reference guards, actions, effects, delays
  and derived definitions by number instead of Rust code — for example, the user code of
  a machine written in TypeScript. The engine calls the host for them while it holds no
  mutable borrow, so the host may read derived values, write context, and dispatch. A
  run of external actions can be one host call, and so can a guard walk over a handler's
  candidates (the host returns the first that passes).
- **Hear every change.** After each effective change the engine notifies the host: once
  per change, in order, with no borrow held, with the current state and what changed
  since the previous notify. A host may hold a notification back and deliver it with its
  next callback, first, and no later than when the transition ends.

The contract:

- **Failure.** When a host callback fails, the host raises the machine's halt flag. The
  engine stops the current step at its next checkpoint: no more user code runs in that
  step, nothing more applies, and what is queued stays queued. The binding raises the
  failure and lowers the flag. A derived value evaluated during a failure is not cached.
- **Context the host owns.** A host that keeps the context itself (the JS object of a TS
  machine) reports which fields a write changed, and announces the write to its own
  observers. The engine stamps the fields at once, or at its next safe point when it is
  in the middle of a step, then runs the watchers; it does not notify for that write.
- **Dependencies of external derived values.** The host reports what an evaluation read
  — context fields, the state, other derived values — and the engine tracks staleness
  from that report.
- A machine written in Rust has no external parts: its host only hears changes.

## Performance guarantees

- Notifying observers in the steady state allocates nothing.
- A derived value is fresh by a stamp comparison: a read re-reads and compares no input
  value.
- One config per machine type, shared by every instance.

## Edge cases that carry design meaning

- A host callback may dispatch; the event runs after the current item.
- A write a host makes in the middle of a step applies at the next safe point, before the
  step ends, so watchers and notifications see it in order.
- A due timer reported after stop, after the state was left, or after the state was
  entered again is ignored.
- A context with more than 64 fields is rejected when the machine is built.
