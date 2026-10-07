# SPEC - `dunky-wasm`

## Overview

`dunky-wasm` runs [`dunky-core`](../core/SPEC.md) machines from JavaScript. It owns the
**protocol** between the engine, compiled to WebAssembly, and the `Machine` facade in
[`@dunky.dev/state-machine`](../../packages/core/SPEC.md). Two producers speak it:

- **The runtime** (cargo feature `runtime`) runs machines written in TypeScript. The
  core package ships it, built from `crates/core-wasm`.
- **The export macro** turns a machine written in Rust into a JS class, in the author's
  own wasm module. The core package wraps an instance with `fromWasm`.

```
  TS machine (config)                   Rust machine (dunky-core types)
        |                                     |
        |  compiled to numbers + JS tables    |  export macro, your crate
        v                                     v
  runtime  (crates/core-wasm)           exported class  (your wasm module)
        |                                     |
        +-----------------+-------------------+
                          |  the protocol
                          |    events in .... by kind number + the JS event
                          |    notify ....... once per change, synchronously
                          |    timers ....... on the host clock
                          v
            the JS host + the Machine facade  (packages/core)
```

## Intent

One protocol for both kinds of machine, so the facade, the connector and every target
treat them alike, and the JS side stays thin: Rust runs the graph, the timers'
bookkeeping and the change tracking; JS runs only the user code of a TS machine and the
fan-out to subscribers.

## Scope & boundaries

**In scope.** The protocol; the runtime for TS machines; the export macro for Rust
machines; the conversion helpers between JS values and Rust values.

**Out of scope — invariants, not preferences.**

- **No facade.** The `Machine` interface, the names (states, event types, fields) and the
  subscribers live in the core package.
- **No platform.** Only the JS host's own functions are called: no DOM, no `window`.
- **No strong JS references.** Rust never holds a JS object strongly (see Handles).

## The protocol

### The facade travels with each call

- JS passes the machine's **facade** with each call into Rust. Rust hands it to every
  host function of that call, then lets it go when the outermost call returns. Rust
  holds no JS object between calls, so no reference cycle through wasm keeps a machine
  alive: only JS references do.

### The host

- One JS host object serves every machine of a module. Its functions take numbers and
  return status codes, so each call crosses the boundary once, with nothing to box or
  free.
- The host functions never throw. Each catches what user code throws, keeps the first
  error on the facade, and returns a failure status; Rust raises the machine's halt flag
  and stops the step.
- `notify(facade, state, changedLo, changedHi)`: once per effective change, in order,
  synchronously, with the current state and the context fields changed since the
  previous notify (the low and high 32 bits of the mask).
- `startTimer(facade, id, ms)` returns the host's timeout; `cancelTimer(timeout)` cancels
  it. A due timer calls back into the machine with its id.
- For TS machines only, by index in the JS tables, with the event that caused the call
  (none for a boot or a data-reaction):
  - `guard`; `pick`, a guard walk in one call (the first candidate that passes);
  - `action`; `actions`, a run of actions in one call;
  - `effect`: starts an effect, and the facade keeps its cleanup;
  - `delay`; `computed`, which reports its value and its reads back before it returns;
  - `transition`: a leaving transition run whole (see below).
- What the engine holds back rides on the next `action`, `actions`, `effect` or
  `transition` call as `pre`, and runs first: bit 0 stops the effects (the facade runs
  every cleanup, in start order, even past one that throws), the bits above announce a
  state change (the state + 1). With no such call, `pre` is delivered on its own, before
  the state switches and when the transition ends.
- A **whole transition** is one call for a TS machine without computed values, when the
  target has no named delay: stop the effects, exit actions, the transition's actions,
  announce the switch, entry actions, start the target's effects. It returns where it
  failed: before the switch (the machine stays put), after it, or while starting the
  effects.

### Calls

- Each call into a machine runs to completion and returns a status: 0, 1 when user code
  failed during this call (the facade holds the error), 3 when the engine failed (its
  message comes from `takeFailure`).
- The **outermost** call also runs the timer commands. A **nested** call (user code
  calling back in, e.g. a write inside an action) reports only a failure it caused; the
  outer call reports it too. JS throws: the outermost call takes the error, a nested one
  leaves it for the outer call.
- After a failure the machine stays usable; what was queued stays queued.

### Timers

- The engine's timer commands run on the host clock. A pending timer is held by the
  host's closure, so it keeps its machine alive, like a JS timer holds `this`.

### Values

- **TS machines** keep JS values: the context is a JS object, and a derived value is a
  JS value compared with `Object.is`.
- **Rust machines** convert with serde: `None` becomes `null`. A derived value is
  serialized only when its version changed, and the same JS value is served until then,
  so its identity marks a change.

## The runtime — TS machines

- A config is **compiled** once, on the JS side: states, event types and every callback
  become numbers. The compiled config is shared by every machine built from it.
- The context lives in JS, and JS announces its own writes to the subscribers. It
  reports a write's change mask to Rust only when the machine has watchers or derived
  values: one bit per field, 64 bits, and every field past the 63rd shares the last bit.
  JS also reports what each derived evaluation read: fields, the state, other derived
  values.
- Every input of a derived value changes through JS, so JS serves a value read again
  with no change in between without calling Rust.
- The event object crosses as is: the engine carries it — also for a timed transition
  scheduled by that event — and hands it back to the callbacks.

## The export macro — Rust machines

- The macro takes the class name, the machine type, a constructor body, and the derived
  values the class serves, each with its key and its type. A constructor body that
  returns an error throws it from the JS constructor; bad arguments read as
  `[machine] bad argument: ...`.
- The class implements the protocol: attach to a host (once), dispatch by kind, start,
  stop, report whether it runs, report the state, read a context field, read a derived
  value, take a due timer, and report the names (states, event types, fields, derived
  values, tags per state) the facade maps the numbers onto.
- The facade argument is optional, so the class works on its own: `start()`,
  `send(kind, event)`. Once attached, a call without its facade is an engine failure,
  since the host needs the facade for every callback.
- An event kind without data is built from the number alone; any other kind is read from
  the JS event's fields. The event type opts in to that with `#[event(deserialize)]`.
- The crate using the macro depends on `wasm-bindgen` at the version this crate pins.

## Edge cases that carry design meaning

- Attaching a Rust machine to a host twice is an engine failure.
- An unknown event kind is an error; the facade filters unknown event types before.
- A malformed payload is an error that names the event type.
- Commands emitted before a Rust machine was attached run when it attaches.
