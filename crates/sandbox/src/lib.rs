//! The sandbox machines, written in Rust against `dunky-core` — the Rust twins of the TS
//! machines in `sandbox/shared/src`, following the same spec:
//!
//! - [`palette`] — the command palette, a faithful port of `sandbox/shared/src/machine.ts`
//!   (computed filtering, logical navigation).
//! - [`dialog`] — open / closing / closed with a context-driven exit delay (`after`).
//!
//! `crates/uniffi` runs the palette on React Native.

pub mod dialog;
pub mod palette;
