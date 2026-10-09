//! Actions: inline and named, run in order; `one_of` picks one branch by guard; entry and
//! exit run around the state switch; every machine owns its context.
//!
//! Not ported:
//! - "action params include `computed` (empty when none configured)": JS params carry a
//!   `computed` object; Rust reads computed values by typed key (see computed.rs).
//! - "the context object identity is permanent across writes": JS object identity. A Rust
//!   machine owns its context and every read borrows the live value, so no reference can
//!   be held across a write.

mod common;

use common::{CounterEvent, Log, build, counter};
use dunky_state_machine::{
    Action, Branch, Config, Context, Event, Guard, GuardParams, Machine, State, Types,
};

struct M;

#[derive(Clone, Copy, PartialEq, Eq, Debug, State)]
enum S {
    A,
    B,
    C,
}

#[derive(Clone, Debug, Event)]
enum Ev {
    Go,
    ToB,
    Auto,
    Mark,
    Stay,
    Set { value: String },
}

#[derive(Clone, Debug, Default, Context)]
struct Ctx {
    n: i32,
    kind: char,
    mobile: bool,
    admin: bool,
    last: String,
}

impl Types for M {
    type State = S;
    type Event = Ev;
    type Context = Ctx;
}

fn when(f: impl Fn(&GuardParams<'_, M>) -> bool + 'static) -> Guard<M> {
    Guard::when(f)
}

#[test]
fn runs_an_inline_action_that_updates_the_context() {
    let m = build(&mut counter());
    m.send(CounterEvent::Inc);
    m.send(CounterEvent::Inc);
    assert_eq!(m.context().n, 2);
}

#[test]
fn runs_multiple_actions_in_order() {
    let log = Log::default();
    let m = build(Config::<M>::builder(S::A, Ctx::default()).state(S::A, |s| {
        s.on(EvKind::Go, |t| {
            t.run(log.action("a"))
                .run(log.action("b"))
                .run(log.action("c"))
        })
    }));
    m.send(Ev::Go);
    assert_eq!(log.entries(), ["a", "b", "c"]);
}

#[test]
fn an_action_can_read_the_event_payload() {
    let m = build(Config::<M>::builder(S::A, Ctx::default()).state(S::A, |s| {
        s.on(EvKind::Set, |t| {
            t.act(|p| match p.event() {
                Some(Ev::Set { value }) => Ctx::patch().last(value.clone()),
                _ => Ctx::patch(),
            })
        })
    }));
    m.send(Ev::Set { value: "hi".into() });
    assert_eq!(m.context().last, "hi");
}

#[test]
fn an_action_can_queue_an_event_via_send() {
    let log = Log::default();
    let m = build(
        Config::<M>::builder(S::A, Ctx::default())
            .state(S::A, |s| {
                s.on(EvKind::ToB, |t| t.target(S::B).run(|p| p.send(Ev::Mark)))
            })
            .state(S::B, |s| {
                s.on(EvKind::Mark, |t| t.run(log.action("marked")))
            }),
    );
    m.send(Ev::ToB);
    assert_eq!(m.state(), S::B);
    assert_eq!(log.entries(), ["marked"]);
}

#[test]
fn resolves_actions_by_name() {
    let m = build(
        Config::<M>::builder(S::A, Ctx::default())
            .action("inc", |p| {
                let n = p.context().n;
                p.set_context(Ctx::patch().n(n + 1));
            })
            .state(S::A, |s| {
                s.on(EvKind::Go, |t| t.action("inc").action("inc"))
            }),
    );
    m.send(Ev::Go);
    assert_eq!(m.context().n, 2);
}

#[test]
fn named_and_inline_actions_run_in_order() {
    let log = Log::default();
    let m = build(
        Config::<M>::builder(S::A, Ctx::default())
            .action("first", log.action("first"))
            .action("last", log.action("last"))
            .state(S::A, |s| {
                s.on(EvKind::Go, |t| {
                    t.action("first").run(log.action("inline")).action("last")
                })
            }),
    );
    m.send(Ev::Go);
    assert_eq!(log.entries(), ["first", "inline", "last"]);
}

#[test]
#[cfg(debug_assertions)]
#[should_panic(expected = "no action \"missing\"")]
fn panics_in_debug_when_an_action_name_is_not_registered() {
    let m = build(
        Config::<M>::builder(S::A, Ctx::default())
            .state(S::A, |s| s.on(EvKind::Go, |t| t.action("missing"))),
    );
    m.send(Ev::Go);
}

#[test]
fn one_of_runs_the_first_branch_whose_guard_passes() {
    let log = Log::default();
    let m = build(
        Config::<M>::builder(
            S::A,
            Ctx {
                kind: 'b',
                ..Ctx::default()
            },
        )
        .state(S::A, |s| {
            s.on(EvKind::Go, |t| {
                t.push(Action::one_of([
                    Branch::when(
                        when(|p| p.context().kind == 'a'),
                        [Action::run(log.action("a"))],
                    ),
                    Branch::when(
                        when(|p| p.context().kind == 'b'),
                        [Action::run(log.action("b"))],
                    ),
                    Branch::otherwise([Action::run(log.action("fallback"))]),
                ]))
            })
        }),
    );
    m.send(Ev::Go);
    assert_eq!(log.entries(), ["b"]);
}

#[test]
fn one_of_falls_back_to_the_guardless_branch() {
    let log = Log::default();
    let m = build(Config::<M>::builder(S::A, Ctx::default()).state(S::A, |s| {
        s.on(EvKind::Go, |t| {
            t.push(Action::one_of([
                Branch::when(
                    when(|p| p.context().n > 0),
                    [Action::run(log.action("positive"))],
                ),
                Branch::otherwise([Action::run(log.action("fallback"))]),
            ]))
        })
    }));
    m.send(Ev::Go);
    assert_eq!(log.entries(), ["fallback"]);
}

#[test]
fn one_of_runs_nothing_when_no_branch_matches_and_there_is_no_fallback() {
    let log = Log::default();
    let m = build(Config::<M>::builder(S::A, Ctx::default()).state(S::A, |s| {
        s.on(EvKind::Go, |t| {
            t.push(Action::one_of([Branch::when(
                when(|p| p.context().n > 0),
                [Action::run(log.action("x"))],
            )]))
        })
    }));
    m.send(Ev::Go);
    assert!(log.is_empty());
}

#[test]
fn one_of_composes_with_unconditional_actions_in_order() {
    let log = Log::default();
    let m = build(
        Config::<M>::builder(
            S::A,
            Ctx {
                mobile: true,
                ..Ctx::default()
            },
        )
        .guard("isMobile", |p| p.context().mobile)
        .action("lockScroll", log.action("lockScroll"))
        .state(S::A, |s| {
            s.on(EvKind::Go, |t| {
                t.run(log.action("always-before"))
                    .push(Action::one_of([Branch::when(
                        "isMobile",
                        [Action::named("lockScroll")],
                    )]))
                    .run(log.action("always-after"))
            })
        }),
    );
    m.send(Ev::Go);
    assert_eq!(
        log.entries(),
        ["always-before", "lockScroll", "always-after"]
    );
}

#[test]
fn one_of_branch_guards_accept_registered_names() {
    let log = Log::default();
    let m = build(
        Config::<M>::builder(
            S::A,
            Ctx {
                admin: true,
                ..Ctx::default()
            },
        )
        .guard("isAdmin", |p| p.context().admin)
        .action("adminPath", log.action("admin"))
        .action("userPath", log.action("user"))
        .state(S::A, |s| {
            s.on(EvKind::Go, |t| {
                t.push(Action::one_of([
                    Branch::when("isAdmin", [Action::named("adminPath")]),
                    Branch::otherwise([Action::named("userPath")]),
                ]))
            })
        }),
    );
    m.send(Ev::Go);
    assert_eq!(log.entries(), ["admin"]);
}

#[test]
fn exit_runs_before_the_transition_actions_and_entry_after() {
    let log = Log::default();
    let m = build(
        Config::<M>::builder(S::A, Ctx::default())
            .state(S::A, |s| {
                s.exit_run(log.action("exit:a")).on(EvKind::ToB, |t| {
                    t.target(S::B).run(log.action("action:toB"))
                })
            })
            .state(S::B, |s| s.entry_run(log.action("entry:b"))),
    );
    m.send(Ev::ToB);
    assert_eq!(log.entries(), ["exit:a", "action:toB", "entry:b"]);
    assert_eq!(m.state(), S::B);
}

#[test]
fn the_initial_state_entry_does_not_run_at_construction() {
    let log = Log::default();
    let _m = build(
        Config::<M>::builder(S::A, Ctx::default())
            .state(S::A, |s| s.entry_run(log.action("entry:a"))),
    );
    assert!(log.is_empty());
}

#[test]
fn a_targetless_transition_skips_entry_and_exit() {
    let log = Log::default();
    let m = build(Config::<M>::builder(S::A, Ctx::default()).state(S::A, |s| {
        s.entry_run(log.action("entry:a"))
            .exit_run(log.action("exit:a"))
            .on(EvKind::Go, |t| t.act(|p| Ctx::patch().n(p.context().n + 1)))
    }));
    m.send(Ev::Go);
    assert!(log.is_empty());
    assert_eq!(m.context().n, 1);
}

#[test]
fn a_transition_targeting_the_current_state_also_skips_entry_and_exit() {
    let log = Log::default();
    let m = build(Config::<M>::builder(S::A, Ctx::default()).state(S::A, |s| {
        s.entry_run(log.action("entry:a"))
            .exit_run(log.action("exit:a"))
            .on(EvKind::Stay, |t| t.target(S::A).run(log.action("action")))
    }));
    m.send(Ev::Stay);
    assert_eq!(log.entries(), ["action"]);
}

#[test]
fn entry_and_exit_run_named_actions_and_one_of() {
    let log = Log::default();
    let m = build(
        Config::<M>::builder(
            S::A,
            Ctx {
                mobile: true,
                ..Ctx::default()
            },
        )
        .guard("isMobile", |p| p.context().mobile)
        .action("logExit", log.action("exit:a"))
        .action("mobileSetup", log.action("mobile"))
        .action("desktopSetup", log.action("desktop"))
        .state(S::A, |s| {
            s.exit("logExit").on(EvKind::ToB, |t| t.target(S::B))
        })
        .state(S::B, |s| {
            s.entry(Action::one_of([
                Branch::when("isMobile", [Action::named("mobileSetup")]),
                Branch::otherwise([Action::named("desktopSetup")]),
            ]))
        }),
    );
    m.send(Ev::ToB);
    assert_eq!(log.entries(), ["exit:a", "mobile"]);
}

#[test]
fn an_entry_action_can_queue_the_next_transition() {
    let log = Log::default();
    let m = build(
        Config::<M>::builder(S::A, Ctx::default())
            .state(S::A, |s| s.on(EvKind::ToB, |t| t.target(S::B)))
            .state(S::B, |s| {
                s.entry_run(|p| p.send(Ev::Auto))
                    .entry_run(log.action("entry:b"))
                    .on(EvKind::Auto, |t| t.target(S::C))
            })
            .state(S::C, |s| s.entry_run(log.action("entry:c"))),
    );
    m.send(Ev::ToB);
    assert_eq!(log.entries(), ["entry:b", "entry:c"]);
    assert_eq!(m.state(), S::C);
}

#[test]
fn a_machine_never_mutates_the_config_seed_context() {
    let config = counter().build();
    let m = Machine::new(&config);
    m.send(CounterEvent::Inc);
    assert_eq!(m.context().n, 1);
    assert_eq!(config.context().n, 0);
}

#[test]
fn machines_built_from_one_config_are_isolated() {
    let config = counter().build();
    let a = Machine::new(&config);
    let b = Machine::new(&config);
    a.send(CounterEvent::Inc);
    assert_eq!(a.context().n, 1);
    assert_eq!(b.context().n, 0);
}
