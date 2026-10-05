---
'@dunky.dev/state-machine-wasm': minor
---

Add `@dunky.dev/state-machine-wasm` — run a machine written in Rust (on the
`dunky-core` crate) and compiled to wasm behind the same `Machine` interface
as the TS engine. Export the machine type from Rust with
`dunky_wasm::export_machine!`, build it with `wasm-bindgen`, and wrap an
instance with `fromWasm`: the connector, `useMachine` and every target (React,
Solid, React Native, OpenTUI) consume it unchanged.

```ts
import { fromWasm } from '@dunky.dev/state-machine-wasm'
import init, { PaletteMachine } from './pkg/machines.js' // wasm-bindgen output

await init()
const palette = fromWasm<PaletteState, PaletteContext, PaletteEvent>(new PaletteMachine(commands))
palette.start()
palette.send({ type: 'open' })
```

Reads stay plain property reads. `context` is a JS mirror with a stable
identity, updated in place: every call into Rust returns a change mask, so
only the fields that changed cross the boundary. Computed values are cached
until Rust reports a new version, and the `computed` option maps a raw value
once per change — for example, indices that crossed the boundary back onto
your own objects. Timers run on the host: the machine asks for them, and the
adapter schedules them with `setTimeout`, or with the `scheduler` you pass.

One deliberate difference from the TS engine: subscribers are notified once
per call (`send`, `start`, `stop`, a timer firing), after the whole
run-to-completion step, instead of once per change inside it.
