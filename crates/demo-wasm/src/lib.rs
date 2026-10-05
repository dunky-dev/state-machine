//! The demo machines as JS classes (wasm-bindgen). Built by `pnpm build:wasm` into
//! `packages/demo-wasm/pkg`.

#![allow(unused_imports)]

use dunky_core::{Config, Machine};
use dunky_demo::{cell, dialog, guards, highlight, list, palette, pingpong};
use wasm_bindgen::prelude::*;

// One config per machine type, shared by every instance (the shape a real app has).
#[cfg(feature = "palette")]
thread_local!(static PALETTE: Config<palette::Palette> = palette::config(Vec::new()));
#[cfg(feature = "cell")]
thread_local!(static CELL: Config<cell::Cell> = cell::config());
#[cfg(feature = "pingpong")]
thread_local!(static PINGPONG: Config<pingpong::PingPong> = pingpong::config());
#[cfg(feature = "dialog")]
thread_local!(static DIALOG: Config<dialog::Dialog> = dialog::config(0));

// The sandbox command palette.
#[cfg(feature = "palette")]
dunky_wasm::export_machine! {
    pub struct PaletteMachine(palette::Palette);
    new(commands: JsValue) {
        // Malformed commands throw: the host maps result indices onto its own array.
        dunky_wasm::from_js::<Vec<palette::Command>>(commands)
            .map(|commands| PALETTE.with(|c| Machine::with_context(c, palette::context(commands))))
    }
    computed {
        palette::RESULTS => Vec<palette::Command>,
        palette::ACTIVE_ID => Option<String>,
        palette::RESULT_INDICES => Vec<u32>,
    }
}

// The benchmark cell: `hit` bumps `value`, `miss` bumps `other`.
#[cfg(feature = "cell")]
dunky_wasm::export_machine! {
    pub struct CellMachine(cell::Cell);
    new() { CELL.with(Machine::new) }
    computed {}
}

// Ping ⇄ pong with entry/exit actions on every transition.
#[cfg(feature = "pingpong")]
dunky_wasm::export_machine! {
    pub struct PingPongMachine(pingpong::PingPong);
    new() { PINGPONG.with(Machine::new) }
    computed {}
}

// `k` guarded candidates, the last one wins.
#[cfg(feature = "guards")]
dunky_wasm::export_machine! {
    pub struct GuardsMachine(guards::Guards);
    new(k: u32) { Machine::new(&guards::config(k.max(1))) }
    computed {}
}

// A dialog whose `closing` phase lasts `exitMs`.
#[cfg(feature = "dialog")]
dunky_wasm::export_machine! {
    pub struct DialogMachine(dialog::Dialog);
    new(exit_ms: u32) {
        DIALOG.with(|c| Machine::with_context(c, dialog::DialogCtx { exit_ms, open_count: 0 }))
    }
    computed {}
}

#[cfg(feature = "list")]
thread_local!(static LIST: Config<list::List> = list::config());
#[cfg(feature = "highlight")]
thread_local!(static HIGHLIGHT: Config<highlight::Highlight> = highlight::config());

// The rendering bench's shared list (one highlighted index).
#[cfg(feature = "list")]
dunky_wasm::export_machine! {
    pub struct ListMachine(list::List);
    new() { LIST.with(Machine::new) }
    computed {}
}

// The rendering bench's per-row machine (one boolean).
#[cfg(feature = "highlight")]
dunky_wasm::export_machine! {
    pub struct HighlightMachine(highlight::Highlight);
    new(on: bool) {
        HIGHLIGHT.with(|c| Machine::with_context(c, highlight::HighlightCtx { on }))
    }
    computed {}
}

/// Raw boundary cost: one number in, one number out, no work.
#[wasm_bindgen]
pub fn noop(x: u32) -> u32 {
    x
}

/// The benchmark sink (proof the entry/exit/guard actions ran).
#[wasm_bindgen]
pub fn sink() -> f64 {
    dunky_demo::sink() as f64
}
