# @dunky.dev/state-machine-wasm

Use a Dunky machine written in **Rust** from TypeScript. `fromWasm` wraps a class
exported with `dunky_wasm::export_machine!` (see [`crates/wasm`](../../crates/wasm)) in
the same `Machine` interface the TS engine returns, so `connect()`, `useMachine` and
every target consume it unchanged, next to your TS machines.

```ts
import { fromWasm } from '@dunky.dev/state-machine-wasm'
import init, { PaletteMachine } from './pkg/my_machines.js' // your wasm-bindgen output

await init()
// Machine<'closed' | 'open', …>: the types come from the Rust types.
const palette = fromWasm(new PaletteMachine(commands))
```

- **The machine runs in Rust**: its graph, user code, timers and computed values. The
  facade keeps a JS mirror of the context and re-reads only the fields each change
  names.
- **Typed from Rust**: the build generates each class's types from the machine's Rust
  types; `fromWasm` infers `Machine<State, Context, Event, Computed>` from them. For a
  class built without them, name them: `fromWasm<State, Context, Event, Computed>(…)`.
- **`computed` option**: map a raw computed value once per change — e.g. indices that
  crossed the boundary, back onto your own objects:

  ```ts
  fromWasm(new PaletteMachine(commands), {
    computed: {
      results: {
        from: 'resultIndices',
        map: raw => Array.from(raw as number[], i => commands[i]!),
      },
    },
  })
  ```

- **In a target**: `useMachine(props => fromWasm(new PaletteMachine(props.commands)), connect, effects, props)`.

In JS a TS machine is a little faster (its context already lives in JS); a Rust machine
is for reuse: the same machine runs in Rust programs and on React Native. The protocol:
[`crates/wasm/SPEC.md`](../../crates/wasm/SPEC.md).

## Why the TS engine does not run on Rust

We tried it: the TS engine as a thin layer over the Rust engine, compiled to wasm. It was
not faster. Every event crosses the JS↔wasm bridge, and user code (guards, actions,
effects) stays in JS, so it crosses back. After batching the calls, one event reached
~9.9 M/sec, still ~15% below the pure TS engine (11.6 M/sec), and the package grew by
~75 kB gzip. So each engine runs on its own, and wasm is for machines written in Rust.
