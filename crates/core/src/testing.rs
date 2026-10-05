//! Test helpers: a virtual clock that plays the host for `after` timers.

use crate::machine::Machine;
use crate::timers::{Command, TimerId};
use crate::traits::Types;

/// A deterministic host clock for one machine: it runs the machine's timer commands and
/// fires due timers as virtual time advances (like fake timers in the TS tests).
pub struct Clock<T: Types> {
    machine: Machine<T>,
    now: u64,
    seq: u64,
    pending: Vec<(u64, u64, TimerId)>,
}

impl<T: Types> Clock<T> {
    pub fn new(machine: &Machine<T>) -> Self {
        Self {
            machine: machine.clone(),
            now: 0,
            seq: 0,
            pending: Vec::new(),
        }
    }

    pub fn now(&self) -> u64 {
        self.now
    }

    /// Timers currently scheduled (as of the last sync).
    pub fn pending(&self) -> usize {
        self.pending.len()
    }

    /// Apply the commands the machine emitted since the last sync.
    pub fn sync(&mut self) {
        for cmd in self.machine.take_commands() {
            match cmd {
                Command::StartTimer { id, ms } => {
                    self.seq += 1;
                    self.pending.push((self.now + u64::from(ms), self.seq, id));
                }
                Command::CancelTimer { id } => self.pending.retain(|(_, _, t)| *t != id),
            }
        }
    }

    /// Advance virtual time by `ms`, firing every timer that comes due, in order.
    pub fn advance(&mut self, ms: u64) {
        self.sync();
        let target = self.now + ms;
        loop {
            let next = self
                .pending
                .iter()
                .enumerate()
                .filter(|(_, (due, _, _))| *due <= target)
                .min_by_key(|(_, (due, seq, _))| (*due, *seq))
                .map(|(i, _)| i);
            let Some(i) = next else { break };
            let (due, _, id) = self.pending.remove(i);
            self.now = due;
            self.machine.fire_timer(id);
            self.sync();
        }
        self.now = target;
    }
}
