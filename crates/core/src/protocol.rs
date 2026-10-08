//! The handle protocol a binding speaks (React Native over JSI): one change mask per
//! call, and timer commands as flat numbers. The layout lives here, once.

use crate::machine::Machine;
use crate::timers::Command;
use crate::traits::Types;

/// Change-mask bit: the state changed.
pub const STATE_BIT: u32 = 1 << 0;
/// Change-mask bit: timer commands are waiting.
pub const COMMANDS_BIT: u32 = 1 << 1;
/// Context field `i` maps to bit `FIELD_SHIFT + i`. Fields from index [`HIGH_FIELD`] up
/// share the top bit: when it is set, re-read all of them.
pub const FIELD_SHIFT: u32 = 2;
pub const HIGH_FIELD: usize = (32 - FIELD_SHIFT as usize) - 1;
/// Timer command opcodes in [`encode_commands`].
pub const OP_START: u32 = 1;
pub const OP_CANCEL: u32 = 2;

/// Take what changed since the last call and pack it into the change mask.
pub fn take_change_mask<T: Types>(machine: &Machine<T>) -> u32 {
    let changes = machine.take_changes();
    let mut mask = if changes.state { STATE_BIT } else { 0 };
    if machine.has_commands() {
        mask |= COMMANDS_BIT;
    }
    let mut fields = changes.fields;
    while fields != 0 {
        let i = fields.trailing_zeros() as usize;
        mask |= 1 << (FIELD_SHIFT as usize + i.min(HIGH_FIELD));
        fields &= fields - 1;
    }
    mask
}

/// Timer commands as flat `[op, id, ms]` triples (`ms` is 0 for a cancel).
pub fn encode_commands(commands: &[Command]) -> Vec<u32> {
    let mut out = Vec::with_capacity(commands.len() * 3);
    for c in commands {
        match *c {
            Command::StartTimer { id, ms } => out.extend([OP_START, id, ms]),
            Command::CancelTimer { id } => out.extend([OP_CANCEL, id, 0]),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_encode_as_op_id_ms_triples() {
        let commands = [
            Command::StartTimer { id: 7, ms: 250 },
            Command::CancelTimer { id: 7 },
        ];
        assert_eq!(
            encode_commands(&commands),
            [OP_START, 7, 250, OP_CANCEL, 7, 0]
        );
    }
}
