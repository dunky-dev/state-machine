//! `dunky-wasm` — run `dunky-core` machines from JavaScript.
//!
//! - [`export_machine!`] turns a machine written in Rust into a JS class. The core package
//!   (`@dunky.dev/state-machine`) wraps an instance with `fromWasm`, so every target —
//!   react, solid, native, opentui — consumes it as a `Machine`.
//! - The `runtime` feature is the engine for machines written in TS: the core package
//!   ships it (`crates/core-wasm`).
//!
//! Both speak one protocol with the core package's JS host: events in by kind number,
//! a `notify(handle, state, changedLo, changedHi)` per effective change (synchronously,
//! like the TS subscribers), timers on the host clock (`startTimer` / `cancelTimer`, then
//! `fire(id)`), and a status code back from every call (see [`bridge`]).
//!
//! The crate using the macro must also depend on `wasm-bindgen`.

use std::cell::RefCell;
use std::rc::Rc;

use dunky_core::{
    Changes, ComputedKey, Context, DeserializeEvent, Evaluation, EventEnum, Host, Machine,
    SerializeFields, StateEnum, Types,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;

pub mod bridge;
#[cfg(feature = "runtime")]
pub mod runtime;

use bridge::Link;
pub use bridge::{Bridge, ENGINE_FAILED, FAILED, HostObject, OK};

#[doc(hidden)]
pub mod __private {
    pub use dunky_core::ComputedKey;
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
    serde_wasm_bindgen::from_value(value).map_err(|e| {
        let error: js_sys::Error = JsValue::from(e).unchecked_into();
        JsError::new(&format!(
            "[machine] bad argument: {}",
            String::from(error.message())
        ))
    })
}

// `None` becomes `null`, matching the TS machines (`lastExecuted: null`, `activeId: null`).
fn serializer() -> serde_wasm_bindgen::Serializer {
    serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true)
}

/// Serialize any value for JS (plain objects, arrays, `null` for `None`).
pub fn to_js<V: Serialize + ?Sized>(value: &V) -> JsValue {
    value.serialize(&serializer()).unwrap_or(JsValue::UNDEFINED)
}

/// A Rust machine's host: it only hears changes (its guards, actions and effects are Rust).
struct Observer {
    link: Rc<Link>,
}

impl<T: Types> Host<T> for Observer {
    fn guard(&self, _: u32, _: Option<&T::Event>) -> bool {
        unreachable!("a Rust machine has no external guards")
    }
    fn action(&self, _: u32, _: Option<&T::Event>) {
        unreachable!("a Rust machine has no external actions")
    }
    fn effect(&self, _: u32, _: Option<&T::Event>) {
        unreachable!("a Rust machine has no external effects")
    }
    fn stop_effects(&self) {}
    fn delay(&self, _: u32, _: Option<&T::Event>) -> u32 {
        unreachable!("a Rust machine has no external delays")
    }
    fn computed(&self, _: u32) -> Evaluation {
        unreachable!("a Rust machine has no external computed values")
    }
    fn pick(&self, _: u32, _: Option<&T::Event>) -> Option<usize> {
        unreachable!("a Rust machine has no external guards")
    }
    fn actions(&self, _: u32, _: Option<&T::Event>) {
        unreachable!("a Rust machine has no external actions")
    }
    fn notify(&self, state: T::State, changes: Changes) {
        self.link.notify(state.index() as u32, changes);
    }
    fn settle(&self) {}
    fn transition(
        &self,
        _: u32,
        _: T::State,
        _: T::State,
        _: Option<&T::Event>,
        _: bool,
        _: bool,
    ) -> dunky_core::HostTransition {
        unreachable!("a Rust machine has no host transitions")
    }
}

/// The implementation behind every class [`export_machine!`] generates.
pub struct Exported<T: Types> {
    bridge: Bridge<T>,
    /// Per computed value: the version and the JS value last served.
    computed: RefCell<Vec<Option<(u64, JsValue)>>>,
}

impl<T: Types> Exported<T>
where
    T::Event: DeserializeEvent,
    T::Context: SerializeFields,
{
    pub fn new(machine: Machine<T>) -> Self {
        let count = machine.config().computed_names().count();
        Self {
            bridge: Bridge::new(machine),
            computed: RefCell::new(vec![None; count]),
        }
    }

    pub fn machine(&self) -> &Machine<T> {
        self.bridge.machine()
    }

    /// Connect to the JS host; `facade` is the JS facade calling. Returns a status; a
    /// second attach is an engine failure.
    pub fn attach(&self, host: HostObject, facade: JsValue) -> u32 {
        let link = Rc::new(Link::new(host, self.machine().halt_flag()));
        if !self.bridge.connect(link.clone()) {
            return self.bridge.fail("[machine] already attached".into());
        }
        self.machine().set_host(Rc::new(Observer { link }));
        // Run what the machine did before it had a host (e.g. timers of a start in Rust).
        self.bridge.call(facade, |_| {})
    }

    /// The facade a call runs for. `fromWasm` passes it; a bare call has none, which is
    /// fine until a host is attached: then the host needs it for every callback.
    fn facade(&self, facade: Option<JsValue>) -> Result<JsValue, u32> {
        match facade {
            Some(facade) => Ok(facade),
            None if self.bridge.attached() => Err(self.bridge.fail(
                "[machine] this machine is attached: call it through its fromWasm machine".into(),
            )),
            None => Ok(JsValue::UNDEFINED),
        }
    }

    /// Send event `kind`; `event` (the JS event object) supplies the payload, if any.
    pub fn send(&self, kind: u32, event: JsValue, facade: Option<JsValue>) -> u32 {
        let facade = match self.facade(facade) {
            Ok(facade) => facade,
            Err(status) => return status,
        };
        let names = <T::Event as EventEnum>::KIND_NAMES;
        let Some(name) = names.get(kind as usize) else {
            return self.bridge.fail(format!("[machine] no event type #{kind}"));
        };
        let k = <T::Event as EventEnum>::kind_from_index(kind as usize);
        let event = match <T::Event as EventEnum>::from_kind(k) {
            Some(event) => event,
            None => {
                let deserializer = serde_wasm_bindgen::Deserializer::from(event);
                match <T::Event as DeserializeEvent>::deserialize_payload(
                    kind as usize,
                    deserializer,
                ) {
                    Ok(event) => event,
                    Err(e) => {
                        return self
                            .bridge
                            .fail(format!("[machine] bad \"{name}\" event: {e}"));
                    }
                }
            }
        };
        self.bridge.call(facade, |m| m.send(event))
    }

    pub fn start(&self, facade: Option<JsValue>) -> u32 {
        self.facade(facade)
            .map_or_else(|status| status, |facade| self.bridge.start(facade))
    }

    pub fn stop(&self, facade: Option<JsValue>) -> u32 {
        self.facade(facade)
            .map_or_else(|status| status, |facade| self.bridge.stop(facade))
    }

    pub fn fire(&self, id: u32, facade: Option<JsValue>) -> u32 {
        self.facade(facade)
            .map_or_else(|status| status, |facade| self.bridge.fire(id, facade))
    }

    /// The engine's failure behind status 3.
    pub fn take_failure(&self) -> Option<String> {
        self.bridge.take_failure()
    }

    pub fn running(&self) -> bool {
        self.machine().is_running()
    }

    pub fn state(&self) -> u32 {
        self.machine().state().index() as u32
    }

    pub fn field(&self, index: u32) -> JsValue {
        self.machine()
            .context()
            .serialize_field(index as usize, &serializer())
            .unwrap_or(JsValue::UNDEFINED)
    }

    /// The value of `key`, serialized only when it changed since the last read.
    pub fn computed<V: Serialize + 'static>(&self, key: ComputedKey<V>) -> JsValue {
        let version = self.machine().computed_version(key.id());
        if let Some((seen, value)) = &self.computed.borrow()[key.id()]
            && *seen == version
        {
            return value.clone();
        }
        let value = to_js(&*self.machine().computed(key));
        self.computed.borrow_mut()[key.id()] = Some((version, value.clone()));
        value
    }

    /// The names `fromWasm` maps the numbers onto, once per machine type.
    pub fn meta(&self) -> JsValue {
        #[derive(Serialize)]
        struct Meta<'a> {
            states: &'a [&'a str],
            events: &'a [&'a str],
            fields: &'a [&'a str],
            computed: Vec<&'a str>,
            tags: Vec<&'a [&'a str]>,
        }
        let config = self.machine().config();
        let states = <T::State as StateEnum>::NAMES;
        to_js(&Meta {
            states,
            events: <T::Event as EventEnum>::KIND_NAMES,
            fields: <T::Context as Context>::FIELDS,
            computed: config.computed_names().collect(),
            tags: (0..states.len())
                .map(|i| config.tags(<T::State as StateEnum>::from_index(i)))
                .collect(),
        })
    }
}

/// Export a machine type as a JS class. Wrap an instance with `fromWasm` from
/// `@dunky.dev/state-machine`.
///
/// ```ignore
/// dunky_wasm::export_machine! {
///     /// The command palette.
///     pub struct PaletteMachine(palette::Palette);
///     new(commands: JsValue) {
///         // A `Result` body throws its error from the JS constructor.
///         dunky_wasm::from_js(commands).map(|c| Machine::new(&palette::config(c)))
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
            inner: $crate::Exported<$types>,
        }

        #[::wasm_bindgen::prelude::wasm_bindgen]
        impl $name {
            /// Throws when the constructor body returns an error (bad arguments).
            #[wasm_bindgen(constructor)]
            #[allow(unused_braces)] // `$make` is the caller's block, passed as an argument
            pub fn new($($arg: $argty),*) -> ::core::result::Result<$name, ::wasm_bindgen::JsError> {
                let machine = $crate::IntoMachine::<$types>::into_machine($make)?;
                ::core::result::Result::Ok($name { inner: $crate::Exported::new(machine) })
            }
            /// Connect to the JS host (`fromWasm` does). Calls return a status: 0, 1 when
            /// JS code failed (the host holds the error), 3 when the engine failed.
            pub fn attach(&self, host: $crate::HostObject, facade: ::wasm_bindgen::JsValue) -> u32 {
                self.inner.attach(host, facade)
            }
            /// `facade` is passed by `fromWasm`; leave it out when calling directly.
            pub fn send(&self, kind: u32, event: ::wasm_bindgen::JsValue, facade: ::core::option::Option<::wasm_bindgen::JsValue>) -> u32 {
                self.inner.send(kind, event, facade)
            }
            pub fn start(&self, facade: ::core::option::Option<::wasm_bindgen::JsValue>) -> u32 {
                self.inner.start(facade)
            }
            pub fn stop(&self, facade: ::core::option::Option<::wasm_bindgen::JsValue>) -> u32 {
                self.inner.stop(facade)
            }
            pub fn fire(&self, id: u32, facade: ::core::option::Option<::wasm_bindgen::JsValue>) -> u32 {
                self.inner.fire(id, facade)
            }
            #[wasm_bindgen(js_name = takeFailure)]
            pub fn take_failure(&self) -> ::core::option::Option<::std::string::String> {
                self.inner.take_failure()
            }
            pub fn running(&self) -> bool {
                self.inner.running()
            }
            pub fn state(&self) -> u32 {
                self.inner.state()
            }
            pub fn field(&self, index: u32) -> ::wasm_bindgen::JsValue {
                self.inner.field(index)
            }
            #[allow(unused_variables)]
            pub fn computed(&self, id: u32) -> ::wasm_bindgen::JsValue {
                $(
                    let key: $crate::__private::ComputedKey<$cty> = $key;
                    if id as usize == key.id() {
                        return self.inner.computed(key);
                    }
                )*
                ::wasm_bindgen::JsValue::UNDEFINED
            }
            pub fn meta(&self) -> ::wasm_bindgen::JsValue {
                self.inner.meta()
            }
        }
    };
}
