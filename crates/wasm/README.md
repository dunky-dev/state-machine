# dunky-wasm

Run [`dunky-core`](../core) machines from JavaScript. Export a machine written in Rust
with one macro; wrap an instance with `fromWasm` from `@dunky.dev/state-machine`, and the
connector, `useMachine` and every target consume it like a machine written in TS.

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
}
```

Build it, then wrap it:

```bash
cargo build --target wasm32-unknown-unknown --release
wasm-bindgen --target web --weak-refs --reference-types --out-dir pkg target/wasm32-unknown-unknown/release/my_machines.wasm
```

```ts
import { fromWasm } from '@dunky.dev/state-machine'
import init, { PaletteMachine } from './pkg/my_machines.js'

await init()
const palette = fromWasm(new PaletteMachine(commands))
```

The crate using the macro also depends on `wasm-bindgen` (the version this crate pins),
and its event type derives `#[event(deserialize)]`. The `runtime` feature is the engine
for machines written in TS; `@dunky.dev/state-machine` ships it.

What the protocol guarantees: [`SPEC.md`](./SPEC.md).
