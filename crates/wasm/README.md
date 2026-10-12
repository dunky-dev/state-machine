# dunky-state-machine-wasm

Run [`dunky-state-machine`](../core) machines from JavaScript. Export a machine written in Rust
with one macro; wrap an instance with `fromWasm` from `@dunky.dev/state-machine-wasm`, and
the connector, `useMachine` and every target consume it like a machine written in TS.

```rust
use dunky_state_machine::{Config, Machine};
use wasm_bindgen::prelude::*;

thread_local!(static CONFIG: Config<palette::Palette> = palette::config(Vec::new()));

dunky_state_machine_wasm::export_machine! {
    /// The command palette.
    pub struct PaletteMachine(palette::Palette);
    new(commands: JsValue) {
        // A Result body throws its error from the JS constructor.
        dunky_state_machine_wasm::from_js(commands)
            .map(|c| CONFIG.with(|config| Machine::with_context(config, palette::context(c))))
    }
    computed { palette::RESULTS => Vec<Command>, palette::ACTIVE_ID => Option<String> }
    // Optional: served too, but left out of the machine's TS types.
    internal { palette::RESULT_INDICES => Vec<u32> }
}
```

Build it, add its TS types, then wrap it:

```bash
cargo build --target wasm32-unknown-unknown --release
wasm-bindgen --target web --weak-refs --reference-types --out-dir pkg target/wasm32-unknown-unknown/release/my_machines.wasm
# Natively, PaletteMachine::typescript(&config) returns the class's TS types, generated
# from the Rust types: print them from a small binary or example, onto the .d.ts.
cargo run --example typescript >> pkg/my_machines.d.ts
```

```ts
import { fromWasm } from '@dunky.dev/state-machine-wasm'
import init, { PaletteMachine } from './pkg/my_machines.js'

await init()
// Machine<'closed' | 'open', { commands: ...; query: string; ... }, ...>: from Rust.
const palette = fromWasm(new PaletteMachine(commands))
```

The data types the machine shows JS derive `TsType` (`#[derive(TsType)]`), next to
their serde derives.

The crate using the macro also depends on `wasm-bindgen` (the version this crate pins),
and its event type derives `#[event(deserialize)]`.

What the protocol guarantees: [`SPEC.md`](./SPEC.md).

## Why two engines, not Rust everywhere

We tried one engine: the TS package as a thin layer over the Rust engine, compiled to wasm.
It worked, but it was not the win it looked like. Part of the TS side still had to mirror
the Rust engine — the context, the computed cache and the transition steps stay in JS,
next to the user code — and every event still paid the JS↔wasm bridge, so it gave up a
bit of speed. So we maintain both engines against one spec: each one runs natively, and
wasm is for machines written in Rust.
