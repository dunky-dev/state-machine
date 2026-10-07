---
'@dunky.dev/state-machine': minor
---

The engine is now Rust, compiled to WebAssembly. The API does not change:
`machine(config)`, `setup`, the connector and every target work as before, and
the 0.x test suite passes unchanged on the new engine. Rust runs the graph — the
queue, transition resolution, entry/exit order, effects, `after` timers, watchers
and computed bookkeeping — and calls back into your guards, actions, effects,
delays and computed definitions. The wasm is inlined, so the package starts
synchronously on the first `machine()` call: there is no `await init()`.

Machines can now also be written in Rust, on the `dunky-core` crate. Export the
machine type with `dunky_wasm::export_machine!`, build it with `wasm-bindgen`,
and wrap an instance with `fromWasm`: the connector, `useMachine` and every
target consume it like a TS machine, with the same notifications (one per
change, in order).

```ts
import { fromWasm } from '@dunky.dev/state-machine'
import init, { PaletteMachine } from './pkg/machines.js' // your wasm-bindgen output

await init()
const palette = fromWasm<PaletteState, PaletteContext, PaletteEvent>(new PaletteMachine(commands))
```

The `computed` option of `fromWasm` maps a raw value once per change — for
example, indices that crossed the boundary back onto your own objects.

Breaking:

- The package needs WebAssembly: browsers, Node, Bun and Deno have it. React
  Native (Hermes) does not, so this version does not run there yet.
- The runaway guard (one run-to-completion step over 10,000 events or watcher
  runs) now throws in production too, instead of hanging.
- Computed values refresh on writes made through `setContext`, like watchers and
  subscribers always did; mutating the context object directly does not refresh
  them.
- The bundle carries the engine: about 75 kB gzip.
