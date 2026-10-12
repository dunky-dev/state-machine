//! The sandbox machines, written in Rust against `dunky-state-machine` — the Rust twins of the TS
//! machines in `sandbox/shared/src`, following the same spec:
//!
//! - [`palette`] — the command palette, a faithful port of `sandbox/shared/src/machine.ts`
//!   (computed filtering, logical navigation).
//! - [`dialog`] — open / closing / closed with a context-driven exit delay (`after`).
//!
//! `crates/uniffi` runs the palette on React Native. With the `wasm` feature, both are JS
//! classes too (`pnpm build:wasm` builds them to `crates/sandbox/pkg`): every sandbox
//! runs the palette on them with `?machine=rust` (`--machine=rust` in the terminal).

pub mod dialog;
pub mod palette;

#[cfg(all(feature = "wasm", not(target_arch = "wasm32")))]
pub use exports::typescript;

#[cfg(feature = "wasm")]
mod exports {
    use dunky_state_machine::{Config, Machine};
    use wasm_bindgen::prelude::*;

    use crate::{dialog, palette};

    // One config per machine type, shared by every instance (the shape a real app has).
    thread_local! {
        static PALETTE: Config<palette::Palette> = palette::config(Vec::new());
        static DIALOG: Config<dialog::Dialog> = dialog::config(0);
    }

    dunky_state_machine_wasm::export_machine! {
        /// The command palette.
        pub struct PaletteMachine(palette::Palette);
        new(commands: JsValue) {
            // Malformed commands throw: the host maps result indices onto its own array.
            dunky_state_machine_wasm::from_js::<Vec<palette::Command>>(commands)
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

    dunky_state_machine_wasm::export_machine! {
        /// A dialog whose `closing` phase lasts `exitMs`.
        pub struct DialogMachine(dialog::Dialog);
        new(exit_ms: u32) {
            DIALOG.with(|c| Machine::with_context(c, dialog::DialogCtx { exit_ms, open_count: 0 }))
        }
        computed {}
    }

    /// The classes' TS types (`examples/typescript.rs`, run by `pnpm build:wasm`).
    #[cfg(not(target_arch = "wasm32"))]
    pub fn typescript() -> String {
        PALETTE.with(PaletteMachine::typescript) + &DIALOG.with(DialogMachine::typescript)
    }
}
