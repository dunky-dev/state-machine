//! The sandbox machines, written in Rust against `dunky-core`:
//!
//! - [`palette`] — the command palette, a faithful port of `sandbox/shared/src/machine.ts`
//!   (computed filtering, logical navigation).
//! - [`dialog`] — open / closing / closed with a context-driven exit delay (`after`).
//!
//! Built to wasm by `pnpm build:wasm` (`sandbox/shared/rust/pkg`); every sandbox runs the
//! palette on it with `?engine=rust` (`--engine=rust` in the terminal).

pub mod dialog;
pub mod palette;

#[cfg(feature = "wasm")]
mod exports {
    use dunky_core::{Config, Machine};
    use wasm_bindgen::prelude::*;

    use crate::{dialog, palette};

    // One config per machine type, shared by every instance (the shape a real app has).
    thread_local! {
        static PALETTE: Config<palette::Palette> = palette::config(Vec::new());
        static DIALOG: Config<dialog::Dialog> = dialog::config(0);
    }

    dunky_wasm::export_machine! {
        /// The command palette.
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

    dunky_wasm::export_machine! {
        /// A dialog whose `closing` phase lasts `exitMs`.
        pub struct DialogMachine(dialog::Dialog);
        new(exit_ms: u32) {
            DIALOG.with(|c| Machine::with_context(c, dialog::DialogCtx { exit_ms, open_count: 0 }))
        }
        computed {}
    }
}
