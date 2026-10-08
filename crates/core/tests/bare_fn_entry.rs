//! An action-only candidate (no target, no guard), the Rust form of the TS bare-fn entry,
//! is a guardless fallback in a fallthrough list.
//!
//! Not ported. Rust has no bare-fn shorthand: an action-only candidate is built like any
//! other transition, so these collapse into tests elsewhere:
//! - "a standalone bare fn runs as an action, no state change": transitions.rs
//!   (a_targetless_transition_runs_its_actions_and_stays_in_the_state).
//! - "act(...) works bare in the entry slot": act.rs (writes_a_static_patch).
//! - "the bare fn sees the (narrowed) event": actions.rs (an_action_can_read_the_event_payload).
//! - "object form still works for targets alongside a bare-fn sibling event": there is one
//!   form only; targets and action-only handlers are covered by transitions.rs.

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
    Go,
}

#[derive(Clone, Debug, Default, Context)]
struct Ctx {
    hit: bool,
}

impl Types for M {
    type State = S;
    type Event = Ev;
    type Context = Ctx;
}

#[test]
fn an_action_only_candidate_after_failing_guards_is_the_fallback() {
    let log = Log::default();
    let m = build(Config::<M>::builder(S::A, Ctx::default()).state(S::A, |s| {
        s.on(EvKind::Go, |t| t.guard_fn(|_| false).target(S::B))
            .on(EvKind::Go, |t| {
                t.run(log.action("fallback"))
                    .act(|_| Ctx::patch().hit(true))
            })
    }));
    m.send(Ev::Go);
    assert_eq!(log.entries(), ["fallback"]);
    assert!(m.context().hit);
    assert_eq!(m.state(), S::A); // the fallback has no target
}

#[test]
fn a_passing_guarded_candidate_before_an_action_only_one_wins() {
    let log = Log::default();
    let m = build(Config::<M>::builder(S::A, Ctx::default()).state(S::A, |s| {
        s.on(EvKind::Go, |t| {
            t.guard_fn(|_| true)
                .target(S::B)
                .run(log.action("transition"))
        })
        .on(EvKind::Go, |t| {
            t.run(log.action("fallback"))
                .act(|_| Ctx::patch().hit(true))
        })
    }));
    m.send(Ev::Go);
    assert_eq!(log.entries(), ["transition"]);
    assert!(!m.context().hit);
    assert_eq!(m.state(), S::B);
}
