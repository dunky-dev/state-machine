//! `dunky-wasm` — run `dunky-core` machines from JavaScript.
//!
//! [`export_machine!`] turns a machine written in Rust into a JS class, in your own wasm
//! module. `@dunky.dev/state-machine-wasm` wraps an instance with `fromWasm`, so the
//! connector and every target — react, solid, native, opentui — consume it as a
//! `Machine`, next to the machines of the TS engine.
//!
//! A class speaks one protocol with that package's JS host: events in by kind number,
//! a `notify(state, changedLo, changedHi)` per effective change (synchronously,
//! like the TS subscribers), timers on the host clock (`startTimer` / `cancelTimer`, then
//! `fire(id)`), and a status code back from every call (see [`bridge`]).
//!
//! The crate using the macro must also depend on `wasm-bindgen`.
//!
//! A class also knows its TS types (`typescript`, natively): they come from the machine's
//! Rust types (`TsType`), and `pnpm build:wasm` adds them to the module's `.d.ts`, where
//! `fromWasm` reads them.

use std::cell::RefCell;
use std::rc::Rc;

use dunky_core::{
    ComputedKey, Context, DeserializeEvent, EventEnum, Machine, SerializeFields, StateEnum,
    Subscription, Types,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;

pub mod bridge;

use bridge::Link;
pub use bridge::{Bridge, ENGINE_FAILED, FAILED, HostObject, OK};

#[doc(hidden)]
pub mod __private {
    pub use dunky_core::{ComputedKey, Config, TsType};

    use dunky_core::__private::{ts_key, ts_object};
    use dunky_core::{Context, Types};

    /// The declaration that gives exported class `class` its machine's types: a
    /// `__types` member, only in the types, that `fromWasm` reads. `computed` holds the
    /// computed values of the types by id, with their TS types.
    pub fn class_types<T: Types>(
        class: &str,
        config: &Config<T>,
        computed: &[(usize, String)],
    ) -> String
    where
        T::State: TsType,
        T::Event: TsType,
        T::Context: TsType,
    {
        let names: Vec<&str> = config.computed_names().collect();
        let computed: Vec<String> = computed
            .iter()
            .map(|(id, ts)| format!("{}: {ts}", ts_key(names[*id])))
            .collect();
        // The facade builds the context from the fields: none gives an empty object.
        let empty = || String::from("Record<string, never>");
        let context = if <T::Context as Context>::FIELDS.is_empty() {
            empty()
        } else {
            <T::Context as TsType>::ts()
        };
        let computed = if computed.is_empty() {
            empty()
        } else {
            ts_object(&computed)
        };
        format!(
            "\nexport interface {class} {{\n  /** Generated from the Rust machine's types; `fromWasm` reads them. */\n  readonly __types?: {{\n    state: {};\n    context: {};\n    event: {};\n    computed: {};\n  }};\n}}\n",
            <T::State as TsType>::ts(),
            context,
            <T::Event as TsType>::ts(),
            computed,
        )
    }
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

/// The implementation behind every class [`export_machine!`] generates.
pub struct Exported<T: Types> {
    bridge: Bridge<T>,
    /// Per computed value: the version and the JS value last served.
    computed: RefCell<Vec<Option<(u64, JsValue)>>>,
    /// The engine subscription that tells JS each change (set on attach). It holds the
    /// machine, so it is undone on drop: the class is freed, the cycle goes with it.
    changes: RefCell<Option<Subscription>>,
}

impl<T: Types> Drop for Exported<T> {
    fn drop(&mut self) {
        if let Some(sub) = self.changes.get_mut().take() {
            sub.unsubscribe();
        }
    }
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
            changes: RefCell::new(None),
        }
    }

    pub fn machine(&self) -> &Machine<T> {
        self.bridge.machine()
    }

    /// Connect to the JS host. Returns a status; a second attach is an engine failure.
    /// From then on, call the machine through its `fromWasm` facade: the host functions
    /// run for the facade whose call is in progress.
    pub fn attach(&self, host: HostObject) -> u32 {
        let link = Rc::new(Link::new(host));
        if !self.bridge.connect(link.clone()) {
            return self.bridge.fail("[machine] already attached".into());
        }
        // Once per effective change, in order, with what changed since the last one.
        let machine = self.machine().clone();
        let sub = self.machine().subscribe(move || {
            let changes = machine.take_changes();
            link.notify(machine.state().index() as u32, changes);
        });
        *self.changes.borrow_mut() = Some(sub);
        // Run what the machine did before it had a host (e.g. timers of a start in Rust).
        self.bridge.call(|_| {})
    }

    /// Send event `kind`; `event` (the JS event object) supplies the payload, if any.
    pub fn send(&self, kind: u32, event: JsValue) -> u32 {
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
        self.bridge.call(|m| m.send(event))
    }

    pub fn start(&self) -> u32 {
        self.bridge.start()
    }

    pub fn stop(&self) -> u32 {
        self.bridge.stop()
    }

    pub fn fire(&self, id: u32) -> u32 {
        self.bridge.fire(id)
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
///     // Optional: served too, but left out of the machine's TS types.
///     internal { palette::RESULT_INDICES => Vec<u32> }
/// }
/// ```
///
/// Natively, the class also has `typescript(&config)`: its TS types, from the machine's
/// Rust types, for `pnpm build:wasm` to add to the module's `.d.ts`.
#[macro_export]
macro_rules! export_machine {
    (
        $(#[$meta:meta])*
        $vis:vis struct $name:ident($types:ty);
        new($($arg:ident : $argty:ty),* $(,)?) $make:block
        computed { $($key:expr => $cty:ty),* $(,)? }
        $(internal { $($ikey:expr => $ity:ty),* $(,)? })?
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
            pub fn attach(&self, host: $crate::HostObject) -> u32 {
                self.inner.attach(host)
            }
            pub fn send(&self, kind: u32, event: ::wasm_bindgen::JsValue) -> u32 {
                self.inner.send(kind, event)
            }
            pub fn start(&self) -> u32 {
                self.inner.start()
            }
            pub fn stop(&self) -> u32 {
                self.inner.stop()
            }
            pub fn fire(&self, id: u32) -> u32 {
                self.inner.fire(id)
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
                $($(
                    let key: $crate::__private::ComputedKey<$ity> = $ikey;
                    if id as usize == key.id() {
                        return self.inner.computed(key);
                    }
                )*)?
                ::wasm_bindgen::JsValue::UNDEFINED
            }
            pub fn meta(&self) -> ::wasm_bindgen::JsValue {
                self.inner.meta()
            }
        }

        #[cfg(not(target_arch = "wasm32"))]
        impl $name {
            /// This class's TS types, from the machine's Rust types.
            pub fn typescript(config: &$crate::__private::Config<$types>) -> ::std::string::String {
                $crate::__private::class_types::<$types>(
                    ::core::stringify!($name),
                    config,
                    &[$({
                        let key: $crate::__private::ComputedKey<$cty> = $key;
                        (key.id(), <$cty as $crate::__private::TsType>::ts())
                    }),*],
                )
            }
        }
    };
}
