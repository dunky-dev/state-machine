# TODO

Parked work, with the decisions already made. The earlier shape, where the TS engine
ran on the Rust engine, is on the local branch `rust-engine-under-ts` (head `4e492a4`).

## Rust machines on React Native (JSI)

Spiked on 2026-10-09: `crates/uniffi` runs in the Expo sandbox through
uniffi-bindgen-react-native (`sandbox/uniffi`, a turbo module Expo autolinks into a dev
build), in push mode (`attach(host)`: a `notify(state, lo, hi)` per change and timers as
host calls, as `crates/wasm` speaks) next to the pull mode. The sandbox app times both
against the TS engine (`sandbox/native/rust-bench.tsx`). Hermes, Release build, iPhone 17
simulator, per event:

| Event                      |     TS | Rust pull | Rust push |
| -------------------------- | -----: | --------: | --------: |
| execute (no payload)       | 315 ns |  1,596 ns |  1,446 ns |
| query.set (JSON payload)   | 982 ns |  6,365 ns |  7,618 ns |
| bare call (`stateIndex()`) |        |  1,130 ns |           |

- The floor is the generated wrapper, not the engine: each method is two FFI calls (an
  `Arc` clone, then the call) plus the status object and closures the generated TS
  allocates. Push and pull cost the same; a notify back into JS adds ~0.3 µs.
- A JSON payload adds ~5 µs: the string is lowered, then parsed by serde.
- So uniffi does not get close to wasm, where a Rust machine runs within ~1.3× of the TS
  engine. On React Native the TS engine stays the default: 315 ns per event is far below
  any frame budget.

- [ ] If Rust on React Native is still wanted: a hand-written JSI host object over the
      handle's protocol (no per-call clone, no status allocation, typed payloads), or
      ubrn's `jsi2` flavor — neither measured.
- [ ] Only then, the TS facade over the handle (what `fromWasm` is to a wasm class), so
      `connect()`, the bindings and `packages/native` work unchanged.

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
