//! Guards gate transitions: inline predicates, named ones from the builder's registry,
//! and the and / or / not combinators.
//!
//! Not ported:
//! - "guard params include `computed` (empty when no computed configured)": JS params
//!   carry a `computed` object; Rust reads computed values by typed key, so there is no
//!   such object to inspect (a guard reading a computed value is pinned in computed.rs).

mod common;

use common::{Calls, build};
use dunky_state_machine::{Config, ConfigBuilder, Context, Event, Guard, State, Types};

struct M;

#[derive(Clone, Copy, PartialEq, Eq, Debug, State)]
enum S {
    Idle,
}

#[derive(Clone, Debug, Event)]
enum Ev {
    Go,
    Add { by: i32 },
    Push { force: bool },
}

#[derive(Clone, Debug, Default, Context)]
struct Ctx {
    allow: bool,
    n: i32,
    a: bool,
    b: bool,
    locked: bool,
}

impl Types for M {
    type State = S;
    type Event = Ev;
    type Context = Ctx;
}

/// Every named guard the tests reference.
fn registry(b: &mut ConfigBuilder<M>) -> &mut ConfigBuilder<M> {
    b.guard("isAllowed", |p| p.context().allow)
        .guard("never", |_| false)
        .guard("isA", |p| p.context().a)
        .guard("isB", |p| p.context().b)
        .guard("isLocked", |p| p.context().locked)
        .guard("isTwo", |p| p.context().n == 2)
        .guard("isThree", |p| p.context().n == 3)
        .guard("isOdd", |p| p.context().n % 2 == 1)
}

/// Whether `go` is taken under `guard`, against `ctx` and the registry.
fn go_taken(ctx: Ctx, guard: Guard<M>) -> bool {
    let ran = Calls::default();
    let mut b = Config::<M>::builder(S::Idle, ctx);
    registry(&mut b).state(S::Idle, |s| {
        s.on(EvKind::Go, |t| t.guard_expr(guard).run(ran.action()))
    });
    build(&mut b).send(Ev::Go);
    ran.count() == 1
}

#[test]
fn an_inline_guard_gates_the_transition() {
    let m = build(
        Config::<M>::builder(
            S::Idle,
            Ctx {
                allow: true,
                ..Ctx::default()
            },
        )
        .state(S::Idle, |s| {
            s.on(EvKind::Go, |t| {
                t.guard_fn(|p| p.context().allow)
                    .act(|p| Ctx::patch().n(p.context().n + 1).allow(false))
            })
        }),
    );
    m.send(Ev::Go); // allowed: runs, then disallows itself
    assert_eq!(m.context().n, 1);
    m.send(Ev::Go); // blocked
    assert_eq!(m.context().n, 1);
}

#[test]
fn a_guard_can_read_the_event_payload() {
    let m = build(
        Config::<M>::builder(S::Idle, Ctx::default()).state(S::Idle, |s| {
            s.on(EvKind::Add, |t| {
                t.guard_fn(|p| matches!(p.event(), Some(Ev::Add { by }) if *by > 0))
                    .act(|p| {
                        let Some(Ev::Add { by }) = p.event() else {
                            unreachable!()
                        };
                        Ctx::patch().n(p.context().n + by)
                    })
            })
        }),
    );
    m.send(Ev::Add { by: 5 });
    assert_eq!(m.context().n, 5);
    m.send(Ev::Add { by: -3 }); // only positive additions pass
    assert_eq!(m.context().n, 5);
}

#[test]
fn resolves_a_guard_by_name() {
    let mut b = Config::<M>::builder(
        S::Idle,
        Ctx {
            allow: true,
            ..Ctx::default()
        },
    );
    registry(&mut b).state(S::Idle, |s| {
        s.on(EvKind::Go, |t| {
            t.guard("isAllowed")
                .act(|p| Ctx::patch().n(p.context().n + 1).allow(false))
        })
    });
    let m = build(&mut b);
    m.send(Ev::Go);
    assert_eq!(m.context().n, 1);
    m.send(Ev::Go);
    assert_eq!(m.context().n, 1);
}

#[test]
fn named_and_inline_guards_coexist_in_a_fallthrough_list() {
    let mut b = Config::<M>::builder(S::Idle, Ctx::default());
    registry(&mut b).state(S::Idle, |s| {
        s.on(EvKind::Go, |t| t.guard("never").act(|_| Ctx::patch().n(99)))
            .on(EvKind::Go, |t| {
                t.guard_fn(|p| p.context().n < 3)
                    .act(|p| Ctx::patch().n(p.context().n + 1))
            })
    });
    let m = build(&mut b);
    m.send(Ev::Go); // `never` fails, the inline guard passes
    assert_eq!(m.context().n, 1);
}

#[test]
#[cfg(debug_assertions)]
#[should_panic(expected = "no guard \"missing\"")]
fn panics_in_debug_when_a_guard_name_is_not_registered() {
    let m = build(
        Config::<M>::builder(S::Idle, Ctx::default())
            .state(S::Idle, |s| s.on(EvKind::Go, |t| t.guard("missing"))),
    );
    m.send(Ev::Go);
}

#[test]
fn and_passes_when_every_guard_passes() {
    let ctx = Ctx {
        a: true,
        b: true,
        ..Ctx::default()
    };
    assert!(go_taken(ctx, Guard::and(["isA".into(), "isB".into()])));
}

#[test]
fn and_blocks_when_one_guard_fails() {
    let ctx = Ctx {
        a: true,
        b: false,
        ..Ctx::default()
    };
    assert!(!go_taken(ctx, Guard::and(["isA".into(), "isB".into()])));
}

#[test]
fn or_passes_when_any_guard_passes_and_not_negates() {
    let ran = Calls::default();
    let mut b = Config::<M>::builder(
        S::Idle,
        Ctx {
            locked: true,
            ..Ctx::default()
        },
    );
    registry(&mut b).state(S::Idle, |s| {
        s.on(EvKind::Push, |t| {
            t.guard_expr(Guard::or([
                Guard::<M>::when(|p| matches!(p.event(), Some(Ev::Push { force: true }))),
                Guard::not("isLocked".into()),
            ]))
            .run(ran.action())
        })
    });
    let m = build(&mut b);
    m.send(Ev::Push { force: false }); // locked and not forced
    assert_eq!(ran.count(), 0);
    m.send(Ev::Push { force: true });
    assert_eq!(ran.count(), 1);
}

#[test]
fn combinators_accept_inline_guards() {
    let ctx = Ctx {
        n: 5,
        ..Ctx::default()
    };
    let guard = Guard::and([
        Guard::<M>::when(|p| p.context().n > 0),
        Guard::not(Guard::<M>::when(|p| p.context().n > 100)),
    ]);
    assert!(go_taken(ctx, guard));
}

#[test]
fn combinators_nest() {
    let ctx = Ctx {
        n: 2,
        ..Ctx::default()
    };
    // or(isTwo, isThree) = true; and(isTwo, isOdd) = false; not(false) = true
    let guard = Guard::and([
        Guard::or(["isTwo".into(), "isThree".into()]),
        Guard::not(Guard::and(["isTwo".into(), "isOdd".into()])),
    ]);
    assert!(go_taken(ctx, guard));
}
