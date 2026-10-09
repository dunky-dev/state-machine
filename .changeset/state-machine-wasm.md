---
'@dunky.dev/state-machine-wasm': minor
---

New package: use a machine written in Rust from TypeScript. `fromWasm` wraps a class
exported with `dunky_state_machine_wasm::export_machine!` in the same `Machine` interface the TS
engine returns, so `connect()`, `useMachine` and every target take it unchanged, next
to TS machines.

```ts
import { fromWasm } from '@dunky.dev/state-machine-wasm'
import init, { PaletteMachine } from './pkg/my_machines.js' // your wasm-bindgen output

await init()
const palette = fromWasm(new PaletteMachine(commands)) // typed from the Rust types
```

The machine runs entirely in Rust, on the Rust engine (`dunky-state-machine`), which follows the
same spec as the TS engine. Its TS types are generated from its Rust types and inferred
by `fromWasm`, so they are never written twice. In JS a TS machine is a little faster,
because its context already lives in JS: write a machine in Rust to reuse it in Rust
programs and on React Native.
