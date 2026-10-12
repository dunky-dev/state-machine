# @dunky.dev/state-machine-wasm

Use a Dunky machine written in **Rust** from TypeScript. `fromWasm` wraps a class
exported with `dunky_state_machine_wasm::export_machine!` (see [`crates/wasm`](../../crates/wasm)) in
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

## Why two engines, not Rust everywhere

We tried one engine: the TS package as a thin layer over the Rust engine, compiled to wasm.
It worked, but it was not the win it looked like. Part of the TS side still had to mirror
the Rust engine — the context, the computed cache and the transition steps stay in JS,
next to the user code — and every event still paid the JS↔wasm bridge, so it gave up a
bit of speed. So we maintain both engines against one spec: each one runs natively, and
wasm is for machines written in Rust.
