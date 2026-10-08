# TODO

Parked work, with the decisions already made. The earlier shape, where the TS engine
ran on the Rust engine, is on the local branch `rust-engine-under-ts` (head `4e492a4`).

## Rust machines on React Native (JSI)

- [ ] `crates/uniffi` is a Rust machine as a JS object over JSI (today: the palette
      only). It needs the same facade `fromWasm` gives a wasm class: the TS `Machine`
      interface over the handle. Then `connect()`, the bindings and `packages/native`
      work unchanged; it does not need to mirror `packages/shared/bindings`, which sit
      above the machine.
- [ ] Rework the handle onto the protocol `crates/wasm` speaks (notify per change,
      timers as host calls) instead of JSON strings and a pulled change mask.

## Rust machines in JS (wasm) — done, notes

- `@dunky.dev/state-machine-wasm` (`packages/wasm`) holds `fromWasm`; the TS engine
  stays pure TS. `crates/wasm` is Dunky's JS binding (`export_machine!`), Dunky-specific,
  in this repo because its protocol and the facade change together.
- A user's crate depends on `dunky-core` + `dunky-wasm` + `wasm-bindgen` and builds its
  own `.wasm`; each module carries its own copy of the engine.
- The binding hears changes through the engine's own `subscribe()` / `take_changes()`
  and runs timers from `take_commands()`: the engine has no hook for JS.
- Types come from Rust (`TsType`, `typescript(&config)`, the `__types` member);
  `internal { }` computed values stay out of the types. A type test pins the Rust
  palette's types to the TS palette's.
- Measured on the earlier shape: in JS a Rust machine handles ~1.3× fewer events than
  its TS twin (8.5 M vs 10.7 M events/s, one event); a guard walk is ~1.1× faster in Rust.

## Later

- [ ] Review what else to bring back from `rust-engine-under-ts` on the TS side.
- [x] Benchmarks split by engine: `benchmark/ts` (the TS suite) and `benchmark/rust` (the
      Rust engine, natively, on the same scenarios).
