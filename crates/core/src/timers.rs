/// Identifies one scheduled `after` timer.
pub type TimerId = u32;

/// What the sans-IO core asks its host to do. The core owns no clock: a host (a JS
/// adapter, a native event loop, a test clock) runs these and calls
/// `Machine::fire_timer(id)` when a timer comes due.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command {
    StartTimer { id: TimerId, ms: u32 },
    CancelTimer { id: TimerId },
}
