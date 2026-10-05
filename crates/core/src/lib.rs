//! `dunky-core` — the Rust port of `@dunky.dev/state-machine`.
//!
//! The behavior contract is `packages/core/SPEC.md`; this crate implements the same
//! engine (flat states, run-to-completion, guards, actions, effects, `after` timers,
//! computed data, watchers, selections, connector, composition, store) for Rust hosts and
//! for the wasm / native bindings.
//!
//! Rust-specific shape:
//! - **Typed**: states, events and context are Rust types (`#[derive(State, Event, Context)]`).
//! - **Sans-IO timers**: the core owns no clock. `after` emits [`Command`]s; the host runs
//!   them and calls [`Machine::fire_timer`].
//! - **Change mask**: [`Machine::take_changes`] reports which fields changed, so a binding
//!   can mirror only those into another runtime.

// Lets the derive macros (which emit `::dunky_core::...`) work inside this crate too.
extern crate self as dunky_core;

mod broadcast;
mod compose;
mod computed;
mod config;
mod connector;
mod machine;
mod params;
pub mod protocol;
mod selection;
mod store;
mod timers;
mod traits;

pub mod testing;

pub use broadcast::Subscription;
pub use compose::{Combined, Composition, Member};
pub use computed::{ComputedKey, ComputedParams};
pub use config::{
    Action, ActionFn, Branch, Cleanup, Config, ConfigBuilder, Delay, Effect, Guard, StateBuilder,
    TransitionBuilder,
};
pub use connector::{ConnectSnapshot, Connector, Reaction};
pub use machine::{Changes, Machine, Sender};
pub use params::{ActionParams, GuardParams, View};
pub use selection::Selection;
pub use store::Store;
pub use timers::{Command, TimerId};
pub use traits::{Context, EventEnum, Field, StateEnum, Types};
#[cfg(feature = "serde")]
pub use traits::{DeserializeEvent, SerializeFields};

#[cfg(feature = "derive")]
pub use dunky_macros::{Context, Event, State};

/// The `machine.init` marker name: what a boot effect or a data-reaction sees as its
/// event type (`ActionParams::event()` returns `None` for it).
pub const MACHINE_INIT: &str = "machine.init";

#[doc(hidden)]
pub mod __private {
    #[cfg(feature = "serde")]
    pub use serde;
}
