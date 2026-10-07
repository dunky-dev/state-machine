//! The benchmark machines, written in Rust against `dunky-core` — each one the twin of a
//! TS machine in `benchmark/`, so a row compares the same work:
//!
//! - [`cell`], [`pingpong`], [`guards`] — the engine shapes.
//! - [`list`], [`highlight`] — the React rendering bench's shared list and per-row machine.
//! - The command palette comes from the sandbox (`dunky_sandbox::palette`).
//!
//! Built to wasm by `pnpm build:wasm` (`benchmark/rust/pkg`).

use std::cell::Cell as StdCell;

use dunky_core::{Config, Machine};
use dunky_sandbox::palette;
use wasm_bindgen::prelude::*;

pub mod cell;
pub mod guards;
pub mod highlight;
pub mod list;
pub mod pingpong;

thread_local! {
    static SINK: StdCell<u64> = const { StdCell::new(0) };
}

/// Entry/exit/guard actions bump the sink so the work is not optimized away.
pub fn bump() {
    SINK.with(|s| s.set(s.get() + 1));
}

/// The sink, read once per run as proof the actions ran.
#[wasm_bindgen]
pub fn sink() -> f64 {
    SINK.with(StdCell::get) as f64
}

/// Raw boundary cost: one number in, one number out, no work.
#[wasm_bindgen]
pub fn noop(x: u32) -> u32 {
    x
}

// One config per machine type, shared by every instance (the shape a real app has).
thread_local! {
    static PALETTE: Config<palette::Palette> = palette::config(Vec::new());
    static CELL: Config<cell::Cell> = cell::config();
    static PINGPONG: Config<pingpong::PingPong> = pingpong::config();
    static LIST: Config<list::List> = list::config();
    static HIGHLIGHT: Config<highlight::Highlight> = highlight::config();
}

dunky_wasm::export_machine! {
    /// The command palette.
    pub struct PaletteMachine(palette::Palette);
    new(commands: JsValue) {
        dunky_wasm::from_js::<Vec<palette::Command>>(commands)
            .map(|commands| PALETTE.with(|c| Machine::with_context(c, palette::context(commands))))
    }
    computed {
        palette::RESULTS => Vec<palette::Command>,
        palette::ACTIVE_ID => Option<String>,
    }
    // Only the JS side's `results` mapping reads it: not part of the machine's types.
    internal {
        palette::RESULT_INDICES => Vec<u32>,
    }
}

dunky_wasm::export_machine! {
    /// `hit` bumps `value`, `miss` bumps `other`.
    pub struct CellMachine(cell::Cell);
    new() { CELL.with(Machine::new) }
    computed {}
}

dunky_wasm::export_machine! {
    /// Ping <-> pong with entry/exit actions on every transition.
    pub struct PingPongMachine(pingpong::PingPong);
    new() { PINGPONG.with(Machine::new) }
    computed {}
}

dunky_wasm::export_machine! {
    /// `k` guarded candidates, the last one wins.
    pub struct GuardsMachine(guards::Guards);
    new(k: u32) { Machine::new(&guards::config(k.max(1))) }
    computed {}
}

dunky_wasm::export_machine! {
    /// The rendering bench's shared list (one highlighted index).
    pub struct ListMachine(list::List);
    new() { LIST.with(Machine::new) }
    computed {}
}

dunky_wasm::export_machine! {
    /// The rendering bench's per-row machine (one boolean).
    pub struct HighlightMachine(highlight::Highlight);
    new(on: bool) {
        HIGHLIGHT.with(|c| Machine::with_context(c, highlight::HighlightCtx { on }))
    }
    computed {}
}

/// The classes' TS types (`examples/typescript.rs`, run by `pnpm build:wasm`). The guards
/// config only sizes its candidate list, so any `k` gives the same types.
#[cfg(not(target_arch = "wasm32"))]
pub fn typescript() -> String {
    [
        PALETTE.with(PaletteMachine::typescript),
        CELL.with(CellMachine::typescript),
        PINGPONG.with(PingPongMachine::typescript),
        GuardsMachine::typescript(&guards::config(1)),
        LIST.with(ListMachine::typescript),
        HIGHLIGHT.with(HighlightMachine::typescript),
    ]
    .concat()
}
