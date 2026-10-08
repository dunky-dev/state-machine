# SPEC - `dunky-wasm`

## Overview

`dunky-wasm` runs machines written in Rust ([`dunky-core`](../core/SPEC.md)) from
JavaScript. `export_machine!` turns a machine type into a JS class, in the author's own
wasm module; [`@dunky.dev/state-machine-wasm`](../../packages/wasm) wraps an instance
with `fromWasm` in the `Machine` interface, so the connector and every target consume
it next to the machines of the TS engine.

```
  Rust machine (dunky-core types)
        |
        |  export_machine!  (your crate, your wasm module)
        v
  exported class
        |  the protocol
        |    events in .... by kind number + the JS event
        |    notify ....... once per change, synchronously
        |    timers ....... on the host clock
        v
  fromWasm: the JS host + the Machine facade  (@dunky.dev/state-machine-wasm)
        |
        v
  connect() / useMachine / every target
```

## Intent

Write a machine once in Rust and use it in a Rust program, on React Native, and in JS,
with the same behavior. In JS the machine still runs entirely in Rust; JS keeps a mirror
of its context and fans each change out to the subscribers.

## Scope & boundaries

**In scope.** The protocol; the export macro; the conversion helpers between JS values
and Rust values; the TS types of an exported class.

**Out of scope — invariants, not preferences.**

- **No facade.** The `Machine` interface, the names (states, event types, fields) and the
  subscribers live in `@dunky.dev/state-machine-wasm`.
- **No TS machines.** Machines written in TypeScript run on the TS engine
  (`@dunky.dev/state-machine`), never on this binding.
- **No platform.** Only the JS host's own functions are called: no DOM, no `window`.
- **No strong JS references.** Rust holds no JS object of a machine (see below).
- **Dunky-specific.** This is Dunky's JS binding, not a general Rust/JS bridge (that is
  `wasm-bindgen`, which it builds on).

## The protocol

### The facade stays in JS

- Rust calls the host only during a call into the machine, so JS keeps the **facade**
  whose call is in progress itself (saved and restored around each call, as calls
  nest), and every host function runs for it. No reference to the facade crosses: a
  call carries only numbers (and the JS event). Rust holds no JS object of a machine, so
  no reference cycle through wasm keeps it alive: only JS references do.

### The host

- One JS host object serves every machine of a module. Its functions take numbers and
  return status codes, so each call crosses the boundary once, with nothing to box or
  free. They never throw: each catches what a subscriber throws, keeps the first error
  on the facade, and returns a failure status.
- `notify(state, changedLo, changedHi)`: once per effective change, in order,
  synchronously, with the current state and the context fields changed since the
  previous notify (the low and high 32 bits of the mask). The binding hears the changes
  through the engine's own subscription, so the engine needs no hook for it.
- `startTimer(id, ms)` returns the host's timeout; `cancelTimer(timeout)` cancels it. A
  due timer calls back into the machine with its id.

### Calls

- Each call into a machine runs to completion and returns a status: 0, 1 when a
  subscriber failed during this call (the facade holds the error), 3 when the binding
  failed (a malformed event, a second attach: its message comes from `takeFailure`).
- A subscriber's failure does not stop the step: the call finishes, then the facade
  throws the error.
- The **outermost** call also runs the timer commands. A **nested** call (a subscriber
  calling back in) reports only a failure it caused; the outer call reports it too.
- After a failure the machine stays usable.

### Timers

- The engine's timer commands run on the host clock. A pending timer is held by the
  host's closure, so it keeps its machine alive, like a JS timer holds `this`.

### Values

- Values convert with serde: `None` becomes `null`. A derived value is serialized only
  when its version changed, and the same JS value is served until then, so its identity
  marks a change.

## The export macro

- The macro takes the class name, the machine type, a constructor body, and the derived
  values the class serves, each with its key and its type; an optional `internal` block
  lists derived values it serves but leaves out of its types. A constructor body that
  returns an error throws it from the JS constructor; bad arguments read as
  `[machine] bad argument: ...`.
- The class implements the protocol: attach to a host (once), dispatch by kind, start,
  stop, report whether it runs, report the state, read a context field, read a derived
  value, take a due timer, and report the names (states, event types, fields, derived
  values, tags per state) the facade maps the numbers onto.
- The class works on its own too: `start()`, `send(kind, event)`. Once attached, call it
  through its `fromWasm` facade only: the host functions run for the facade whose call
  is in progress.
- An event kind without data is built from the number alone; any other kind is read from
  the JS event's fields. The event type opts in to that with `#[event(deserialize)]`.
- The crate using the macro depends on `wasm-bindgen` at the version this crate pins.
- **Types.** Natively, the class reports its TS types (`typescript(&config)`), generated
  from the machine's Rust types: the states, the context, the events, and the derived
  values outside `internal`. The build appends them to the module's `.d.ts` as a
  `__types` member of the class, which exists only in the types; `fromWasm` infers the
  machine's types from it. A Rust type change changes the TS types on the next build.
- Freeing the class frees the machine: the engine subscription that feeds `notify` is
  undone when the class drops.

## Edge cases that carry design meaning

- Attaching a machine to a host twice is a binding failure.
- An unknown event kind is an error; the facade filters unknown event types before.
- A malformed payload is an error that names the event type.
- Commands emitted before a machine was attached run when it attaches.
