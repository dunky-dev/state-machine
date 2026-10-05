# @dunky.dev/state-machine-wasm

Run a Rust machine (written with [`dunky-core`](../../crates/core)) behind the TypeScript
`Machine` interface. Every target — react, solid, native, opentui — and the connector
consume it unchanged.

```ts
import { fromWasm } from '@dunky.dev/state-machine-wasm'
import { useMachine } from '@dunky.dev/react-state-machine'
import init, { PaletteMachine } from './pkg/my_machines.js' // built with wasm-bindgen

await init()

function CommandPalette(props) {
  const { api } = useMachine(
    p => fromWasm(new PaletteMachine(p.commands)),
    connectCommandPalette,
    effects,
    props,
  )
  // …
}
```

On the Rust side, export the machine with one macro:

```rust
dunky_wasm::export_machine! {
    pub struct PaletteMachine(palette::Palette);
    new(commands: JsValue) {
        // A Result body throws its error from the JS constructor.
        dunky_wasm::from_js(commands)
            .map(|commands| Machine::with_context(&CONFIG.with(Clone::clone), palette::context(commands)))
    }
    computed { palette::RESULTS => Vec<Command>, palette::ACTIVE_ID => Option<String> }
}
```

## How it works

- **Events in.** Payload-less events cross as one number (`sendKind`); events with a
  payload cross as their fields only (`sendPayload`, when the Rust event derives
  `#[event(deserialize)]`).
- **Changes out.** Every call returns a change mask. The adapter keeps a plain JS mirror of
  the context (one object, identity stable) and re-reads only the fields the mask names,
  so reading context is a property read.
- **Computed values** are cached by the version the Rust side reports. A `computed`
  mapping can read another Rust value and remap it — e.g. read indices and map them onto
  the host's own objects, so rich values never cross the boundary.
- **Timers** are the host's job: the machine emits start/cancel commands and the adapter
  runs them with `setTimeout` (or the `scheduler` you pass).

One deliberate difference from the TS engine: observers are notified once per call
(send, start, stop, timer), after the whole run-to-completion step.
