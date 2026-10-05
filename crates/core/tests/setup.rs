//! The builder's registries (`guard`, `action`, `effect`, `delay`): the runtime half of
//! TS `setup`. Named references resolve when the config is built.
//!
//! Not ported (TypeScript type-level cases with no Rust equivalent):
//! - "infer path: setup.infer().createMachine(literal) builds a valid config, types
//!   inferred": a Rust config is always typed by its `Types` bundle.
//! - "checks names at compile time (the @ts-expect-error blocks are the test)": Rust names
//!   are strings resolved at build; a missing one fails when it runs (the "panics in
//!   debug" tests in guards.rs, actions.rs, effects.rs and after.rs).
//! - "valid names + numeric delays coexist, and inline fns still work": a compile-time
//!   check; its runtime content (named and fixed delays, named and inline guards) is
//!   covered below and in guards.rs.

mod common;

use common::{Calls, Log, build};
use dunky_core::testing::Clock;
use dunky_core::{Config, Context, Event, State, Types};

struct M;

#[derive(Clone, Copy, PartialEq, Eq, Debug, State)]
enum S {
    Closed,
    Open,
}

#[derive(Clone, Debug, Event)]
enum Ev {
    Open,
    Close,
}

#[derive(Clone, Debug, Context)]
struct Ctx {
    id: String,
    open_ms: u32,
    open: bool,
}

impl Types for M {
    type State = S;
    type Event = Ev;
    type Context = Ctx;
}

#[test]
fn named_implementations_resolve_at_runtime() {
    let set_id: Log = Log::default();
    let track = Calls::default();
    let m = build(
        Config::<M>::builder(
            S::Closed,
            Ctx {
                id: "a".into(),
                open_ms: 5,
                open: false,
            },
        )
        .guard("isOpen", |p| p.context().open)
        .action("setId", {
            let set_id = set_id.clone();
            move |p| set_id.push(p.context().id.clone())
        })
        .effect("track", track.effect(None))
        .delay("openDelay", |p| p.context().open_ms)
        .state(S::Closed, |s| s.on(EvKind::Open, |t| t.target(S::Open)))
        .state(S::Open, |s| {
            s.entry("setId")
                .effect("track")
                .after("openDelay", |t| t.target(S::Closed))
                .after(200, |t| t.target(S::Closed))
                .on(EvKind::Close, |t| t.target(S::Closed).guard("isOpen"))
        }),
    );
    m.start();
    assert_eq!(m.state(), S::Closed);
    m.send(Ev::Open);
    assert_eq!(m.state(), S::Open);
    assert_eq!(set_id.entries(), ["a"]);
    assert_eq!(track.count(), 1);
    m.send(Ev::Close); // `isOpen` reads open = false
    assert_eq!(m.state(), S::Open);
    let mut clock = Clock::new(&m);
    clock.advance(4); // `openDelay` reads open_ms = 5
    assert_eq!(m.state(), S::Open);
    clock.advance(1);
    assert_eq!(m.state(), S::Closed);
}
