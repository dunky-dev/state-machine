# SPEC - `dunky-core`

## Overview

`dunky-core` is the Rust implementation of Dunky's state machines. The TypeScript
implementation is [`@dunky.dev/state-machine`](../../packages/core). They are two
engines with one behavior contract,
[`packages/core/SPEC.md`](../../packages/core/SPEC.md): flat states, run-to-completion,
guards, actions, effects, timed transitions, derived data, data-reactions, observation,
the connector, composition, and the cross-instance store.

This SPEC covers only what is specific to the crate: authoring a machine in Rust, and
timers without a clock.

```
  Rust types + config builder
        |
        |  build once
        v
  config  (shared by every machine of the type)
        |
        v
  machine  ------ timer commands out ------>  host clock (an event loop, a test clock)
     ^  |                                        |
     |  +-------- changes out (state, fields)    |
     |                                           |
     +----------- events in, due timers in <-----+
```

## Intent

Bring the same machines to Rust programs and native bindings (React Native over JSI),
optimized for Rust with no trade-off made for another runtime. The engine stays free of
IO and platform, so one build behaves the same everywhere; a host supplies the clock.

## Scope & boundaries

**In scope.** The engine runtime; typed authoring of machines; timers as commands; change
reporting.

**Out of scope — invariants, not preferences.**

- **No IO, no clock, no platform.** The engine never reads time and never schedules work.
  A host does.
- **No JS.** Bindings live in their own crates (`crates/uniffi` for React Native).
- **One thread.** A machine and what it shares stay on one thread. A binding that crosses
  threads enforces that itself.
- **At most 64 context fields** per machine: each field is one bit of the change mask.

## Staying in sync with the TS engine

- A behavior change lands in `packages/core/SPEC.md`, in both engines, and in both test
  suites, in the same PR.
- The Rust tests in `tests/` are ported from `packages/core/tests`, file by file: a new
  behavior test on one side gets its twin on the other.
- What only one engine has (this SPEC, or a TS-only API like `setup()` typing) stays out
  of the shared contract.

## Authoring a machine in Rust

- A machine type names three types: its **states** (an enum without data), its
  **events** (an enum: each variant is a kind, and a variant may carry a payload), and its
  **context** (a struct).
- Derives generate the glue: the state names and indices; one event kind per variant,
  which keys the handlers; and for the context, a patch builder that sets fields by name,
  one typed handle per field (`Field<Ctx, V>`: its bit and how to read it), and a reader
  that records which fields a derived value reads.
- A selection of one field (`select_field`, the twin of TS `select.context(key)`) reads
  through the field's handle.
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

- User code (guards, actions, effects, delays, derived definitions) gets params — the
  context, the event, derived values, a way to write context, a way to dispatch — not
  the machine.
- Observers (subscriptions, selections, lifecycle listeners, effect cleanups) run while
  the engine holds no borrow: they may read, dispatch, or write context. A dispatch made
  during a run-to-completion step is queued.

### Equality

- A context write changes a field only when the value differs (`PartialEq`). A derived
  value changes by its declared equality.

### Failures

- A missing named implementation panics in debug builds, and warns and does nothing in
  release builds.
- A runaway step (more than 10,000 items in one run-to-completion step) panics in debug
  builds and drops the queue in release builds.
- A panicking cleanup does not leak the others: every cleanup runs, then the first panic
  resumes.

## Performance guarantees

- The steady state allocates nothing: events, notifications, selections and recomputes
  reuse their memory.
- A field selection wakes only on a write to its field (and a state selection only on a
  state change): every other notification skips it with one bit test, in subscription
  order. Which selections fire, and when, is exactly the contract's.
- A derived value is fresh by a stamp comparison: a read re-reads and compares no input
  value.
- One config per machine type, shared by every instance.
- A machine pays only for what it uses: field stamps grow with the fields it writes,
  broadcasts exist from the first subscriber, and states without effects or timers do no
  effect work.

## Edge cases that carry design meaning

- An observer may dispatch; the event runs after the current item.
- A due timer reported after stop, after the state was left, or after the state was
  entered again is ignored.
- A context with more than 64 fields is rejected when the machine is built.
