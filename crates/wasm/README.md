# dunky-wasm

Run [`dunky-core`](../core) machines from JavaScript. Export a machine written in Rust
with one macro; wrap an instance with `fromWasm` from `@dunky.dev/state-machine-wasm`, and
the connector, `useMachine` and every target consume it like a machine written in TS.

```rust
use dunky_core::{Config, Machine};
use wasm_bindgen::prelude::*;

thread_local!(static CONFIG: Config<palette::Palette> = palette::config(Vec::new()));

dunky_wasm::export_machine! {
    /// The command palette.
    pub struct PaletteMachine(palette::Palette);
    new(commands: JsValue) {
        // A Result body throws its error from the JS constructor.
        dunky_wasm::from_js(commands)
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

## Why the TS engine does not run on Rust

We tried it: the TS engine as a thin layer over the Rust engine, compiled to wasm. It was
not faster. Every event crosses the JS↔wasm bridge, and user code (guards, actions,
effects) stays in JS, so it crosses back. After batching the calls, one event reached
~9.9 M/sec, still ~15% below the pure TS engine (11.6 M/sec), and the package grew by
~75 kB gzip. So each engine runs on its own, and wasm is for machines written in Rust.
