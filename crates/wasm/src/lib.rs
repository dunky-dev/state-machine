//! `dunky-wasm` — export a `dunky-core` machine to JavaScript.
//!
//! One macro, [`export_machine!`], turns a machine type into a `#[wasm_bindgen]` class that
//! speaks the handle protocol the TS adapter (`@dunky.dev/state-machine-wasm`) consumes:
//!
//! - **Event in**: `sendKind(kind)` for payload-less events (one number across the
//!   boundary), `sendPayload(kind, { ...fields })` for the rest (only the payload fields
//!   are read), `sendEvent({ type, ... })` as the generic serde path.
//! - **Changes out**: every mutating call returns a `u32` change mask (see [`STATE_BIT`],
//!   [`COMMANDS_BIT`], [`FIELD_SHIFT`]), so JS re-reads only the fields that changed.
//! - **Commands out**: `takeCommands()` returns the timer commands as a flat `Uint32Array`
//!   (`[op, id, ms, …]`, op 1 = start, 2 = cancel); JS runs them with `setTimeout` and
//!   calls `fireTimer(id)`.
//!
//! The crate using the macro must also depend on `wasm-bindgen`.

use dunky_core::{
    Context, DeserializeEvent, EventEnum, Machine, SerializeFields, StateEnum, Types,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::*;

// The protocol layout is shared with every binding (see `dunky_core::protocol`).
pub use dunky_core::protocol::{COMMANDS_BIT, FIELD_SHIFT, HIGH_FIELD, STATE_BIT};

#[doc(hidden)]
pub mod __private {
    pub use js_sys;
}

/// What an [`export_machine!`] constructor body may evaluate to: a machine, or a
/// `Result` whose error is thrown from the JS constructor.
pub trait IntoMachine<T: Types> {
    fn into_machine(self) -> Result<Machine<T>, JsError>;
}

impl<T: Types> IntoMachine<T> for Machine<T> {
    fn into_machine(self) -> Result<Machine<T>, JsError> {
        Ok(self)
    }
}

impl<T: Types> IntoMachine<T> for Result<Machine<T>, JsError> {
    fn into_machine(self) -> Result<Machine<T>, JsError> {
        self
    }
}

/// Deserialize a JS value (constructor arguments, props).
pub fn from_js<V: DeserializeOwned>(value: JsValue) -> Result<V, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|e| JsError::new(&e.to_string()))
}

/// The protocol implementation behind every exported class.
pub struct Handle<T: Types> {
    pub machine: Machine<T>,
}

// `None` becomes `null`, matching the TS machines (`lastExecuted: null`, `activeId: null`).
fn serializer() -> serde_wasm_bindgen::Serializer {
    serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true)
}

/// Serialize any value for JS (plain objects, arrays, `undefined` for `None`).
pub fn to_js<V: Serialize + ?Sized>(value: &V) -> JsValue {
    value.serialize(&serializer()).unwrap_or(JsValue::UNDEFINED)
}

impl<T: Types> Handle<T>
where
    T::Event: DeserializeOwned + DeserializeEvent,
    T::Context: SerializeFields,
{
    pub fn new(machine: Machine<T>) -> Self {
        Self { machine }
    }

    /// Pack what changed since the last call into the change mask.
    pub fn changes(&self) -> u32 {
        dunky_core::protocol::take_change_mask(&self.machine)
    }

    pub fn send_kind(&self, kind: u32) -> Result<u32, JsError> {
        let names = <T::Event as EventEnum>::KIND_NAMES;
        if kind as usize >= names.len() {
            return Err(JsError::new(&format!("[machine] no event type #{kind}")));
        }
        let k = <T::Event as EventEnum>::kind_from_index(kind as usize);
        match <T::Event as EventEnum>::from_kind(k) {
            Some(event) => {
                self.machine.send(event);
                Ok(self.changes())
            }
            None => Err(JsError::new(&format!(
                "[machine] event \"{}\" carries data; use sendEvent",
                names[kind as usize]
            ))),
        }
    }

    pub fn send_event(&self, event: JsValue) -> Result<u32, JsError> {
        let event: T::Event = serde_wasm_bindgen::from_value(event)
            .map_err(|e| JsError::new(&format!("[machine] bad event: {e}")))?;
        self.machine.send(event);
        Ok(self.changes())
    }

    /// The fast path for events with a payload: the caller already knows the kind, so
    /// only the payload fields are read from the object (no tagged-enum buffering).
    pub fn send_payload(&self, kind: u32, event: JsValue) -> Result<u32, JsError> {
        let names = <T::Event as EventEnum>::KIND_NAMES;
        if kind as usize >= names.len() {
            return Err(JsError::new(&format!("[machine] no event type #{kind}")));
        }
        let deserializer = serde_wasm_bindgen::Deserializer::from(event);
        let event =
            <T::Event as DeserializeEvent>::deserialize_payload(kind as usize, deserializer)
                .map_err(|e| {
                    JsError::new(&format!(
                        "[machine] bad \"{}\" event: {e}",
                        names[kind as usize]
                    ))
                })?;
        self.machine.send(event);
        Ok(self.changes())
    }

    pub fn state_index(&self) -> u32 {
        self.machine.state().index() as u32
    }

    pub fn field(&self, index: u32) -> JsValue {
        let ctx = self.machine.context();
        ctx.serialize_field(index as usize, &serializer())
            .unwrap_or(JsValue::UNDEFINED)
    }

    /// Every field, in order (the initial mirror).
    pub fn fields(&self) -> js_sys::Array {
        let ctx = self.machine.context();
        let out = js_sys::Array::new();
        for i in 0..<T::Context as Context>::FIELDS.len() {
            out.push(
                &ctx.serialize_field(i, &serializer())
                    .unwrap_or(JsValue::UNDEFINED),
            );
        }
        out
    }

    pub fn computed_version(&self, index: u32) -> f64 {
        self.machine.computed_version(index as usize) as f64
    }

    pub fn start(&self) -> u32 {
        self.machine.start();
        self.changes()
    }

    pub fn stop(&self) -> u32 {
        self.machine.stop();
        self.changes()
    }

    pub fn fire_timer(&self, id: u32) -> u32 {
        self.machine.fire_timer(id);
        self.changes()
    }

    pub fn take_commands(&self) -> Vec<u32> {
        dunky_core::protocol::encode_commands(&self.machine.take_commands())
    }

    /// Static description for the adapter: names, which events are payload-less, tags.
    pub fn meta(&self) -> JsValue {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Meta<'a> {
            states: &'a [&'a str],
            events: &'a [&'a str],
            unit_events: Vec<bool>,
            fields: &'a [&'a str],
            computed: Vec<&'a str>,
            tags: Vec<&'a [&'a str]>,
            field_shift: u32,
            high_field: usize,
        }
        let config = self.machine.config();
        let events = <T::Event as EventEnum>::KIND_NAMES;
        let states = <T::State as StateEnum>::NAMES;
        to_js(&Meta {
            states,
            events,
            unit_events: (0..events.len())
                .map(|i| {
                    let k = <T::Event as EventEnum>::kind_from_index(i);
                    <T::Event as EventEnum>::from_kind(k).is_some()
                })
                .collect(),
            fields: <T::Context as Context>::FIELDS,
            computed: config.computed_names().collect(),
            tags: (0..states.len())
                .map(|i| config.tags(<T::State as StateEnum>::from_index(i)))
                .collect(),
            field_shift: FIELD_SHIFT,
            high_field: HIGH_FIELD,
        })
    }
}

/// Export a machine type as a JS class.
///
/// ```ignore
/// dunky_wasm::export_machine! {
///     /// The command palette.
///     pub struct PaletteMachine(dunky_demo::palette::Palette);
///     new(commands: JsValue) {
///         // A `Result` body throws its error from the JS constructor.
///         dunky_wasm::from_js(commands).map(|c| Machine::new(&dunky_demo::palette::config(c)))
///     }
///     computed { palette::RESULTS => Vec<Command>, palette::ACTIVE_ID => Option<String> }
/// }
/// ```
#[macro_export]
macro_rules! export_machine {
    (
        $(#[$meta:meta])*
        $vis:vis struct $name:ident($types:ty);
        new($($arg:ident : $argty:ty),* $(,)?) $make:block
        computed { $($key:expr => $cty:ty),* $(,)? }
    ) => {
        $(#[$meta])*
        #[::wasm_bindgen::prelude::wasm_bindgen]
        $vis struct $name {
            handle: $crate::Handle<$types>,
        }

        #[::wasm_bindgen::prelude::wasm_bindgen]
        impl $name {
            /// Throws when the constructor body returns an error (bad arguments).
            #[wasm_bindgen(constructor)]
            #[allow(unused_braces)] // `$make` is the caller's block, passed as an argument
            pub fn new($($arg: $argty),*) -> ::core::result::Result<$name, ::wasm_bindgen::JsError> {
                let machine = $crate::IntoMachine::<$types>::into_machine($make)?;
                ::core::result::Result::Ok($name { handle: $crate::Handle::new(machine) })
            }
            /// Payload-less event by kind index. Returns the change mask.
            #[wasm_bindgen(js_name = sendKind)]
            pub fn send_kind(&self, kind: u32) -> ::core::result::Result<u32, ::wasm_bindgen::JsError> {
                self.handle.send_kind(kind)
            }
            /// Any event object `{ type, ...payload }`. Returns the change mask.
            #[wasm_bindgen(js_name = sendEvent)]
            pub fn send_event(&self, event: ::wasm_bindgen::JsValue) -> ::core::result::Result<u32, ::wasm_bindgen::JsError> {
                self.handle.send_event(event)
            }
            /// An event with a payload, by kind index. Returns the change mask.
            #[wasm_bindgen(js_name = sendPayload)]
            pub fn send_payload(&self, kind: u32, event: ::wasm_bindgen::JsValue) -> ::core::result::Result<u32, ::wasm_bindgen::JsError> {
                self.handle.send_payload(kind, event)
            }
            #[wasm_bindgen(js_name = stateIndex)]
            pub fn state_index(&self) -> u32 {
                self.handle.state_index()
            }
            pub fn field(&self, index: u32) -> ::wasm_bindgen::JsValue {
                self.handle.field(index)
            }
            pub fn fields(&self) -> $crate::__private::js_sys::Array {
                self.handle.fields()
            }
            #[allow(unused_variables)]
            pub fn computed(&self, index: u32) -> ::wasm_bindgen::JsValue {
                $(
                    if index as usize == ($key).id() {
                        let value: ::std::rc::Rc<$cty> = self.handle.machine.computed($key);
                        return $crate::to_js(&*value);
                    }
                )*
                ::wasm_bindgen::JsValue::UNDEFINED
            }
            #[wasm_bindgen(js_name = computedVersion)]
            pub fn computed_version(&self, index: u32) -> f64 {
                self.handle.computed_version(index)
            }
            pub fn start(&self) -> u32 {
                self.handle.start()
            }
            pub fn stop(&self) -> u32 {
                self.handle.stop()
            }
            #[wasm_bindgen(js_name = fireTimer)]
            pub fn fire_timer(&self, id: u32) -> u32 {
                self.handle.fire_timer(id)
            }
            #[wasm_bindgen(js_name = takeCommands)]
            pub fn take_commands(&self) -> ::std::vec::Vec<u32> {
                self.handle.take_commands()
            }
            pub fn meta(&self) -> ::wasm_bindgen::JsValue {
                self.handle.meta()
            }
        }
    };
}
