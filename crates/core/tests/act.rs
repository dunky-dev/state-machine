//! `act`: write-sugar for the most common action, a context patch computed from the
//! params. It slots in wherever an action does.
//!
//! Not ported:
//! - "infers Context from the slot — no per-call generics, even with computed": a
//!   TypeScript inference check. A Rust patch is a typed builder (`Ctx::patch().field(v)`),
//!   so a wrong value type is a compile error by construction.
//!
//! Port note: TS `act(a, b)` applies several patches; Rust's `act` takes one, so the
//! multi-patch form is consecutive `act`s.

mod common;

use common::{Log, build};
use dunky_core::{Config, Context, Event, State, Types};

struct M;

#[derive(Clone, Copy, PartialEq, Eq, Debug, State)]
enum S {
    A,
    B,
}

#[derive(Clone, Debug, Event)]
enum Ev {
    Focus,
    Set { value: i32 },
    Inc,
    Bump,
    Go,
}

#[derive(Clone, Debug, Default, Context)]
struct Ctx {
    focused: bool,
    value: i32,
    n: i32,
    label: String,
    hit: bool,
}

impl Types for M {
    type State = S;
    type Event = Ev;
    type Context = Ctx;
}

#[test]
fn writes_a_static_patch() {
    let m = build(Config::<M>::builder(S::A, Ctx::default()).state(S::A, |s| {
        s.on(EvKind::Focus, |t| t.act(|_| Ctx::patch().focused(true)))
    }));
    m.send(Ev::Focus);
    assert!(m.context().focused);
}

#[test]
fn writes_a_patch_derived_from_the_event() {
    let m = build(Config::<M>::builder(S::A, Ctx::default()).state(S::A, |s| {
        s.on(EvKind::Set, |t| {
            t.act(|p| match p.event() {
                Some(Ev::Set { value }) => Ctx::patch().value(*value),
                _ => Ctx::patch(),
            })
        })
    }));
    m.send(Ev::Set { value: 42 });
    assert_eq!(m.context().value, 42);
}

#[test]
fn reads_the_context() {
    let m = build(
        Config::<M>::builder(
            S::A,
            Ctx {
                n: 1,
                ..Ctx::default()
            },
        )
        .state(S::A, |s| {
            s.on(EvKind::Inc, |t| {
                t.act(|p| Ctx::patch().n(p.context().n + 1))
            })
        }),
    );
    m.send(Ev::Inc);
    m.send(Ev::Inc);
    assert_eq!(m.context().n, 3);
}

#[test]
fn a_later_patch_sees_earlier_writes() {
    let m = build(Config::<M>::builder(S::A, Ctx::default()).state(S::A, |s| {
        s.on(EvKind::Bump, |t| {
            t.act(|_| Ctx::patch().n(5))
                .act(|p| Ctx::patch().label(format!("n={}", p.context().n)))
        })
    }));
    m.send(Ev::Bump);
    assert_eq!(m.context().n, 5);
    assert_eq!(m.context().label, "n=5");
}

#[test]
fn composes_with_a_target_and_other_actions_in_order() {
    let log: Log = Log::default();
    let record = |phase: &'static str| {
        let log = log.clone();
        move |p: &mut dunky_core::ActionParams<'_, M>| {
            log.push(format!("{phase}: hit={}", p.context().hit));
        }
    };
    let m = build(Config::<M>::builder(S::A, Ctx::default()).state(S::A, |s| {
        s.on(EvKind::Go, |t| {
            t.target(S::B)
                .run(record("before"))
                .act(|_| Ctx::patch().hit(true))
                .run(record("after"))
        })
    }));
    m.send(Ev::Go);
    assert_eq!(m.state(), S::B);
    assert_eq!(log.entries(), ["before: hit=false", "after: hit=true"]);
}
