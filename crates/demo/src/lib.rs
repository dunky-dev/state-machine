//! Example machines written against `dunky-core`.
//!
//! - [`palette`] — the sandbox command palette, a faithful port of
//!   `sandbox/shared/src/machine.ts` (computed filtering, logical navigation).
//! - [`dialog`] — open / closing / closed with a context-driven exit delay (`after`).
//! - [`cell`], [`pingpong`], [`guards`] — the benchmark shapes from `benchmark/`.
//! - [`list`], [`highlight`] — the React rendering bench's shared list and per-row machine.

use std::cell::Cell as StdCell;

pub mod cell;
pub mod dialog;
pub mod guards;
pub mod highlight;
pub mod list;
pub mod palette;
pub mod pingpong;

thread_local! {
    static SINK: StdCell<u64> = const { StdCell::new(0) };
}

/// Benchmark sink: entry/exit/guard actions bump it so the work is not optimized away.
pub fn bump() {
    SINK.with(|s| s.set(s.get() + 1));
}

pub fn sink() -> u64 {
    SINK.with(StdCell::get)
}
