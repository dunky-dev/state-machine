# TODO

Parked work, with the decisions already made. The earlier shape, where the TS engine
ran on the Rust engine, is on the local branch `rust-engine-under-ts` (head `4e492a4`).

## Rust machines on React Native (JSI)

Decided on 2026-10-09. The TS engine stays the default on React Native. A machine
written in Rust (e.g. a dropdown) is consumed as wasm on the web and over uniffi on React
Native, behind a facade that gives it the TS `Machine` interface, as `fromWasm` does.

Spiked in PR #76: `crates/uniffi` runs in the Expo sandbox through
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
- Fine for a UI machine: ~11,000 payload-less events fit in one 16.67 ms frame, and a
  dropdown sends a handful. Too slow for a hot path (many machines updated per frame,
  or field reads on every render): the facade must keep the hot path on the JS side.

- [ ] The RN facade over `crates/uniffi` (`fromUniffi`, the twin of `fromWasm`): push
      mode, a JS context mirror re-read only on the fields a notify names, renders read
      the mirror. Reuse `RustMachine` from `packages/wasm`; only the handle differs.
- [ ] Typed payloads instead of JSON strings: uniffi records and enums as arguments
      (`highlight(index: u32)`, `move(to: MoveTo)`); numbers and enums lift cheaply.
- [ ] Push mode for `start` / `stop` / `fire_timer` (today only `send` runs the timers
      through the host).
- [ ] Only if the per-call floor ever matters: a hand-written JSI host object over the
      handle's protocol, or ubrn's `jsi2` flavor. Neither measured.

## Rust renders too

The Rust column of the architecture diagram (`ARCHITECTURE.md`), above the engine:

- [ ] A connector per Rust machine, next to it (`connect_palette`, the twin of
      `connectCommandPalette`), following the TS connector's spec.
- [ ] `crates/bindings`: one shared crate, the twin of `packages/shared/bindings`
      (roles, keyboard patterns, focus, a11y props), used by every Rust target.
- [ ] An iced target: one crate for macOS, Windows and Linux (winit + AccessKit); the OS
      conventions that remain are a platform switch inside it.

## Rust machines in JS (wasm) — done, notes

- `@dunky.dev/state-machine-wasm` (`packages/wasm`) holds `fromWasm`; the TS engine
  stays pure TS. `crates/wasm` is Dunky's JS binding (`export_machine!`), Dunky-specific,
  in this repo because its protocol and the facade change together.
- A user's crate depends on `dunky-state-machine` + `dunky-state-machine-wasm` + `wasm-bindgen` and builds its
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
