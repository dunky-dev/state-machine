//! Effects: started when their state is entered (and, on start, for the current state),
//! cleaned up when it is left or the machine stops.
//!
//! Not ported:
//! - "does NOT start effects at construction; starts them on start()": the same test as
//!   lifecycle.rs (is_built_stopped_and_start_boots_the_effects).
//! - "stop() runs the active effect cleanups": covered by lifecycle.rs
//!   (stop_runs_the_cleanups_and_is_idempotent).
//! - "cleanup of the initial effect runs on the first transition out": covered by
//!   lifecycle.rs (is_built_stopped_and_start_boots_the_effects and
//!   while_running_a_transition_cleans_up_the_old_effects_then_starts_the_new).
//! - "is restartable — start after stop re-boots the initial effect": covered by
//!   lifecycle.rs (a_restart_boots_the_state_the_machine_is_in).
//! - "effect closures read LIVE context across later writes": effect params are borrowed
//!   for the call, so no closure can keep them past it (the borrow checker rejects it);
//!   there is no captured context reference that could go stale.

mod common;

use std::panic::{AssertUnwindSafe, catch_unwind};

use common::{Ab, AbEvent, AbState, Count, Counter, CounterState, Log, ab, build};
use dunky_core::{
    ActionParams, Cleanup, Config, Context, Event, EventEnum, MACHINE_INIT, State, Types,
};

#[test]
fn runs_the_effect_on_enter_and_its_cleanup_on_exit() {
    let log = Log::default();
    let mut b = ab();
    b.state(AbState::B, |s| {
        s.effect_run(log.effect(Some("start:b"), Some("cleanup:b")))
    });
    let m = build(&mut b);
    m.start();
    m.send(AbEvent::ToB);
    assert_eq!(log.entries(), ["start:b"]);
    m.send(AbEvent::ToA);
    assert_eq!(log.entries(), ["start:b", "cleanup:b"]);
}

#[test]
fn the_cleanup_runs_before_exit_actions() {
    let log = Log::default();
    let mut b = ab();
    b.state(AbState::B, |s| {
        s.effect_run(log.effect(None, Some("cleanup")))
            .exit_run(log.action("exit-action"))
    });
    let m = build(&mut b);
    m.start();
    m.send(AbEvent::ToB);
    m.send(AbEvent::ToA);
    assert_eq!(log.entries(), ["cleanup", "exit-action"]);
}

#[test]
fn an_effect_starts_after_entry_actions() {
    let log = Log::default();
    let mut b = ab();
    b.state(AbState::B, |s| {
        s.entry_run(log.action("entry-action"))
            .effect_run(log.effect(Some("start"), None))
    });
    let m = build(&mut b);
    m.start();
    m.send(AbEvent::ToB);
    assert_eq!(log.entries(), ["entry-action", "start"]);
}

#[test]
fn an_effect_may_return_no_cleanup() {
    let log = Log::default();
    let mut b = ab();
    b.state(AbState::B, |s| {
        s.effect_run(log.effect(Some("fire-and-forget"), None))
    });
    let m = build(&mut b);
    m.start();
    m.send(AbEvent::ToB);
    m.send(AbEvent::ToA);
    assert_eq!(log.entries(), ["fire-and-forget"]);
    assert_eq!(m.state(), AbState::A);
}

#[test]
fn resolves_an_effect_by_name() {
    let log = Log::default();
    let mut b = ab();
    b.effect(
        "watch",
        log.effect(Some("watch:start"), Some("watch:cleanup")),
    )
    .state(AbState::B, |s| s.effect("watch"));
    let m = build(&mut b);
    m.start();
    m.send(AbEvent::ToB);
    m.send(AbEvent::ToA);
    assert_eq!(log.entries(), ["watch:start", "watch:cleanup"]);
}

#[test]
fn every_effect_of_the_state_is_cleaned_up_on_exit() {
    let log = Log::default();
    let mut b = ab();
    b.state(AbState::B, |s| {
        s.effect_run(log.effect(None, Some("c1")))
            .effect_run(log.effect(None, Some("c2")))
    });
    let m = build(&mut b);
    m.start();
    m.send(AbEvent::ToB);
    m.send(AbEvent::ToA);
    assert_eq!(log.entries(), ["c1", "c2"]);
}

#[test]
#[cfg(debug_assertions)]
#[should_panic(expected = "no effect \"missing\"")]
fn panics_in_debug_when_an_effect_name_is_not_registered() {
    let mut b = ab();
    b.state(AbState::B, |s| s.effect("missing"));
    let m = build(&mut b);
    m.start();
    m.send(AbEvent::ToB);
}

#[test]
fn a_panicking_cleanup_still_runs_the_others_and_clears_the_pass() {
    let log = Log::default();
    let panicking = {
        let log = log.clone();
        move |_: &mut ActionParams<'_, Ab>| {
            let log = log.clone();
            let cleanup: Cleanup = Box::new(move || {
                log.push("c1");
                panic!("boom");
            });
            Some(cleanup)
        }
    };
    let mut b = ab();
    b.state(AbState::B, |s| {
        s.effect_run(panicking)
            .effect_run(log.effect(None, Some("c2")))
    });
    let m = build(&mut b);
    m.start();
    m.send(AbEvent::ToB);
    let payload = catch_unwind(AssertUnwindSafe(|| m.send(AbEvent::ToA))).unwrap_err();
    assert_eq!(payload.downcast_ref::<&str>(), Some(&"boom"));
    assert_eq!(log.entries(), ["c1", "c2"]);
    m.stop(); // the failed pass already ran every cleanup: nothing runs twice
    assert_eq!(log.entries(), ["c1", "c2"]);
}

struct Labeled;

#[derive(Clone, Copy, PartialEq, Eq, Debug, State)]
enum LabeledState {
    A,
    B,
}

#[derive(Clone, Debug, Event)]
enum LabeledEvent {
    ToB,
    Mark,
}

#[derive(Clone, Debug, Context)]
struct Label {
    label: String,
}

impl Types for Labeled {
    type State = LabeledState;
    type Event = LabeledEvent;
    type Context = Label;
}

#[test]
fn an_effect_can_read_the_context_and_queue_events() {
    let log = Log::default();
    let m = build(
        Config::<Labeled>::builder(
            LabeledState::A,
            Label {
                label: "hello".into(),
            },
        )
        .state(LabeledState::A, |s| {
            s.on(LabeledEventKind::ToB, |t| t.target(LabeledState::B))
        })
        .state(LabeledState::B, |s| {
            let effect_log = log.clone();
            s.effect_run(move |p| {
                effect_log.push(p.context().label.clone());
                p.send(LabeledEvent::Mark);
                None
            })
            .on(LabeledEventKind::Mark, |t| t.run(log.action("marked")))
        }),
    );
    m.start();
    m.send(LabeledEvent::ToB);
    assert_eq!(log.entries(), ["hello", "marked"]);
}

#[test]
fn a_boot_effect_sees_the_machine_init_marker() {
    let seen: Log<&'static str> = Log::default();
    let mut b = ab();
    b.state(AbState::A, |s| {
        let seen = seen.clone();
        s.effect_run(move |p| {
            seen.push(p.event().map_or(MACHINE_INIT, |e| e.type_name()));
            None
        })
    });
    let m = build(&mut b);
    m.start();
    assert_eq!(seen.entries(), ["machine.init"]);
    assert_eq!(MACHINE_INIT, "machine.init");
}

#[test]
fn start_runs_the_initial_effects_but_not_the_initial_entry() {
    let log = Log::default();
    let mut b = ab();
    b.state(AbState::A, |s| {
        s.entry_run(log.action("entry"))
            .effect_run(log.effect(Some("effect"), None))
    });
    let m = build(&mut b);
    m.start();
    assert_eq!(log.entries(), ["effect"]);
}

#[test]
fn an_effect_can_read_the_context_at_start() {
    let seen: Log<i32> = Log::default();
    let m = build(
        Config::<Counter>::builder(CounterState::Idle, Count { n: 7 }).state(
            CounterState::Idle,
            |s| {
                let seen = seen.clone();
                s.effect_run(move |p| {
                    seen.push(p.context().n);
                    None
                })
            },
        ),
    );
    m.start();
    assert_eq!(seen.entries(), [7]);
}
