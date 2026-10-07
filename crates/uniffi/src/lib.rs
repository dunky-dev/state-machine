//! React Native binding of the engine, exported over JSI by
//! uniffi-bindgen-react-native: the sandbox palette written in Rust.
//!
//! Events go in by kind index; a u32 change mask comes out, and timers come out as
//! flat commands (`dunky_core::protocol`). Values cross as JSON strings instead of JS
//! values. Pending its rework onto the host protocol `crates/wasm` speaks.

use std::mem::ManuallyDrop;
use std::sync::Arc;
use std::thread::{self, ThreadId};

use dunky_core::{
    Config, Context, DeserializeEvent, EventEnum, Machine, SerializeFields, StateEnum, Types,
};
use dunky_sandbox::palette::{self, Palette, PaletteEvent};

uniffi::setup_scaffolding!();

// The change mask and the command encoding are the shared protocol (the TS adapter
// decodes every binding with the same code): `dunky_core::protocol`.
use dunky_core::protocol::{FIELD_SHIFT, HIGH_FIELD, encode_commands, take_change_mask};

/// Bad input from JS, thrown as an `Error` with this message.
#[derive(Debug, uniffi::Error)]
#[uniffi(flat_error)]
pub enum MachineError {
    Invalid(String),
}

impl std::fmt::Display for MachineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let Self::Invalid(message) = self;
        f.write_str(message)
    }
}

impl std::error::Error for MachineError {}

/// Confines a `!Send` value to the thread that created it. uniffi objects must be
/// `Send + Sync`, but the engine is single-threaded (`Rc`/`RefCell`). JSI calls arrive
/// on the JS thread, so a call from any other thread is a bug: it panics instead of
/// racing.
struct ThreadBound<T> {
    owner: ThreadId,
    value: ManuallyDrop<T>,
}

// SAFETY: `value` is only reachable through `get`, which panics off the owner thread,
// and `drop` never drops it on another thread.
unsafe impl<T> Send for ThreadBound<T> {}
unsafe impl<T> Sync for ThreadBound<T> {}

impl<T> ThreadBound<T> {
    fn new(value: T) -> Self {
        Self {
            owner: thread::current().id(),
            value: ManuallyDrop::new(value),
        }
    }

    fn get(&self) -> &T {
        assert!(
            thread::current().id() == self.owner,
            "[machine] called off the thread that created it"
        );
        &self.value
    }
}

impl<T> Drop for ThreadBound<T> {
    fn drop(&mut self) {
        // Off the owner thread (a GC finalizer, say) the value leaks: freeing the `Rc`
        // graph there would race the owner.
        if thread::current().id() == self.owner {
            // SAFETY: dropped once, here; `value` is never read again.
            unsafe { ManuallyDrop::drop(&mut self.value) }
        }
    }
}

/// The event type name at `kind`, or the error for an unknown kind.
fn event_name<T: Types>(kind: u32) -> Result<&'static str, MachineError> {
    <T::Event as EventEnum>::KIND_NAMES
        .get(kind as usize)
        .copied()
        .ok_or_else(|| MachineError::Invalid(format!("[machine] no event type #{kind}")))
}

/// Appends field `index` as JSON. `None` is `null`, matching the TS machines.
fn write_field<C: SerializeFields>(context: &C, index: usize, out: &mut Vec<u8>) {
    let start = out.len();
    let mut serializer = serde_json::Serializer::new(&mut *out);
    if context.serialize_field(index, &mut serializer).is_err() {
        out.truncate(start);
        out.extend_from_slice(b"null");
    }
}

/// Every field, in order, as a JSON array.
fn fields_json<C: SerializeFields>(context: &C) -> String {
    let mut out = vec![b'['];
    for i in 0..C::FIELDS.len() {
        if i > 0 {
            out.push(b',');
        }
        write_field(context, i, &mut out);
    }
    out.push(b']');
    String::from_utf8(out).expect("serde_json writes UTF-8")
}

/// The static description the TS adapter reads once per machine type.
fn meta_json<T: Types>(machine: &Machine<T>) -> String {
    let config = machine.config();
    let states = <T::State as StateEnum>::NAMES;
    let events = <T::Event as EventEnum>::KIND_NAMES;
    let unit_events: Vec<bool> = (0..events.len())
        .map(|i| {
            let kind = <T::Event as EventEnum>::kind_from_index(i);
            <T::Event as EventEnum>::from_kind(kind).is_some()
        })
        .collect();
    let tags: Vec<&[&str]> = (0..states.len())
        .map(|i| config.tags(<T::State as StateEnum>::from_index(i)))
        .collect();
    serde_json::json!({
        "states": states,
        "events": events,
        "unitEvents": unit_events,
        "fields": <T::Context as Context>::FIELDS,
        "computed": config.computed_names().collect::<Vec<_>>(),
        "tags": tags,
        "fieldShift": FIELD_SHIFT,
        "highField": HIGH_FIELD,
    })
    .to_string()
}

thread_local! {
    // One config shared by every palette, as in the sandbox wasm. Palettes never leave
    // the JS thread, so a thread-local is enough.
    static PALETTE: Config<Palette> = palette::config(Vec::new());
}

/// The sandbox command palette (`dunky_sandbox::palette`), behind the handle protocol.
#[derive(uniffi::Object)]
pub struct PaletteMachine {
    machine: ThreadBound<Machine<Palette>>,
}

#[uniffi::export]
impl PaletteMachine {
    /// `commands_json`: the commands, a JSON array of `{ id, label, hint?, group? }`.
    #[uniffi::constructor]
    pub fn new(commands_json: String) -> Result<Arc<Self>, MachineError> {
        let commands = serde_json::from_str(&commands_json)
            .map_err(|e| MachineError::Invalid(format!("[machine] bad commands: {e}")))?;
        let machine =
            PALETTE.with(|config| Machine::with_context(config, palette::context(commands)));
        Ok(Arc::new(Self {
            machine: ThreadBound::new(machine),
        }))
    }

    /// Payload-less event by kind index. Returns the change mask.
    pub fn send_kind(&self, kind: u32) -> Result<u32, MachineError> {
        let name = event_name::<Palette>(kind)?;
        let event = PaletteEvent::from_kind(PaletteEvent::kind_from_index(kind as usize))
            .ok_or_else(|| {
                MachineError::Invalid(format!(
                    "[machine] event \"{name}\" carries data; use sendEvent"
                ))
            })?;
        let machine = self.machine.get();
        machine.send(event);
        Ok(take_change_mask(machine))
    }

    /// An event with a payload, by kind index; `json` holds its fields. Returns the
    /// change mask.
    pub fn send_payload_json(&self, kind: u32, json: String) -> Result<u32, MachineError> {
        let name = event_name::<Palette>(kind)?;
        let bad = |e: serde_json::Error| {
            MachineError::Invalid(format!("[machine] bad \"{name}\" event: {e}"))
        };
        let payload: serde_json::Value = serde_json::from_str(&json).map_err(bad)?;
        let event = PaletteEvent::deserialize_payload(kind as usize, payload).map_err(bad)?;
        let machine = self.machine.get();
        machine.send(event);
        Ok(take_change_mask(machine))
    }

    pub fn state_index(&self) -> u32 {
        self.machine.get().state().index() as u32
    }

    /// Context field `index` as JSON.
    pub fn field_json(&self, index: u32) -> String {
        let mut out = Vec::new();
        write_field(&*self.machine.get().context(), index as usize, &mut out);
        String::from_utf8(out).expect("serde_json writes UTF-8")
    }

    /// Every context field, in order, as a JSON array (the adapter's initial mirror).
    pub fn fields_json(&self) -> String {
        fields_json(&*self.machine.get().context())
    }

    /// Computed `index` as JSON (`results`, `activeId`, `resultIndices`); `null` for
    /// any other index.
    pub fn computed_json(&self, index: u32) -> String {
        let machine = self.machine.get();
        let id = index as usize;
        let json = if id == palette::RESULTS.id() {
            serde_json::to_string(&*machine.computed(palette::RESULTS))
        } else if id == palette::ACTIVE_ID.id() {
            serde_json::to_string(&*machine.computed(palette::ACTIVE_ID))
        } else if id == palette::RESULT_INDICES.id() {
            serde_json::to_string(&*machine.computed(palette::RESULT_INDICES))
        } else {
            return "null".to_string();
        };
        json.unwrap_or_else(|_| "null".to_string())
    }

    /// Changes exactly when computed `index` changes.
    pub fn computed_version(&self, index: u32) -> f64 {
        self.machine.get().computed_version(index as usize) as f64
    }

    pub fn start(&self) -> u32 {
        let machine = self.machine.get();
        machine.start();
        take_change_mask(machine)
    }

    pub fn stop(&self) -> u32 {
        let machine = self.machine.get();
        machine.stop();
        take_change_mask(machine)
    }

    pub fn fire_timer(&self, id: u32) -> u32 {
        let machine = self.machine.get();
        machine.fire_timer(id);
        take_change_mask(machine)
    }

    /// Timer commands since the last call: `[op, id, ms, …]`, op 1 = start, 2 = cancel.
    pub fn take_commands(&self) -> Vec<u32> {
        encode_commands(&self.machine.get().take_commands())
    }

    /// Names, payload-less events, tags and the mask layout, as JSON.
    pub fn meta_json(&self) -> String {
        meta_json(self.machine.get())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use dunky_sandbox::palette::{PaletteCtx, PaletteEventKind};
    use serde_json::{Value, json};
    use std::panic::{AssertUnwindSafe, catch_unwind};
    use std::sync::atomic::{AtomicBool, Ordering};

    fn kind(kind: PaletteEventKind) -> u32 {
        PaletteEvent::kind_index(kind) as u32
    }

    fn palette() -> Arc<PaletteMachine> {
        PaletteMachine::new(serde_json::to_string(&palette::demo_commands()).unwrap()).unwrap()
    }

    #[test]
    fn thread_bound_refuses_other_threads_and_leaks_there() {
        struct Flag(Arc<AtomicBool>);
        impl Drop for Flag {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }

        let dropped = Arc::new(AtomicBool::new(false));
        let bound = ThreadBound::new(Flag(dropped.clone()));
        let refused = thread::spawn(move || {
            let refused = catch_unwind(AssertUnwindSafe(|| {
                bound.get();
            }))
            .is_err();
            drop(bound);
            refused
        })
        .join()
        .unwrap();
        assert!(refused);
        assert!(!dropped.load(Ordering::SeqCst));

        drop(ThreadBound::new(Flag(dropped.clone())));
        assert!(dropped.load(Ordering::SeqCst));
    }

    #[test]
    fn values_cross_as_json() {
        let m = palette();
        m.start();
        m.send_kind(kind(PaletteEventKind::Open)).unwrap();
        m.send_payload_json(
            kind(PaletteEventKind::QuerySet),
            r#"{"type":"query.set","query":"gpr"}"#.into(),
        )
        .unwrap();

        assert_eq!(m.field_json(PaletteCtx::QUERY.index() as u32), r#""gpr""#);
        assert_eq!(
            m.field_json(PaletteCtx::LAST_EXECUTED.index() as u32),
            "null"
        );
        assert_eq!(m.computed_json(palette::RESULT_INDICES.id() as u32), "[2]");
        assert_eq!(m.computed_json(palette::ACTIVE_ID.id() as u32), r#""prs""#);
        let fields: Value = serde_json::from_str(&m.fields_json()).unwrap();
        assert_eq!(fields.as_array().unwrap().len(), PaletteCtx::FIELDS.len());
        assert_eq!(fields[PaletteCtx::QUERY.index()], "gpr");
    }

    #[test]
    fn bad_input_throws_instead_of_panicking() {
        assert!(PaletteMachine::new("{".into()).is_err());
        let m = palette();
        assert!(m.send_kind(99).is_err());
        assert!(m.send_kind(kind(PaletteEventKind::QuerySet)).is_err());
        assert!(
            m.send_payload_json(kind(PaletteEventKind::Highlight), r#"{"index":"x"}"#.into())
                .is_err()
        );
    }

    #[test]
    fn meta_describes_the_palette() {
        let meta: Value = serde_json::from_str(&palette().meta_json()).unwrap();
        assert_eq!(
            meta,
            json!({
                "states": ["closed", "open"],
                "events": ["open", "close", "query.set", "move", "highlight", "execute"],
                "unitEvents": [true, true, false, false, false, true],
                "fields": ["commands", "query", "activeIndex", "lastExecuted"],
                "computed": ["results", "activeId", "resultIndices"],
                "tags": [[], []],
                "fieldShift": 2,
                "highField": 29,
            })
        );
    }
}
