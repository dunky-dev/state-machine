//! Lifecycle: a machine is built stopped; start boots the current state's effects and
//! stop runs their cleanups, both idempotent; events still work while stopped.

mod common;

use common::{Ab, AbEvent, AbEventKind, AbState, Calls, Log, ab, build};
use dunky_state_machine::Config;

#[test]
fn is_built_stopped_and_start_boots_the_effects() {
    let fx = Calls::default();
    let mut b = ab();
    b.state(AbState::A, |s| s.effect_run(fx.effect(None)));
    let m = build(&mut b);
    assert_eq!(fx.count(), 0);
    m.start();
    assert_eq!(fx.count(), 1);
}

#[test]
fn start_is_idempotent() {
    let fx = Calls::default();
    let mut b = ab();
    b.state(AbState::A, |s| s.effect_run(fx.effect(None)));
    let m = build(&mut b);
    m.start();
    m.start();
    assert_eq!(fx.count(), 1);
}

#[test]
fn stop_runs_the_cleanups_and_is_idempotent() {
    let fx = Calls::default();
    let cleanup = Calls::default();
    let mut b = ab();
    b.state(AbState::A, |s| s.effect_run(fx.effect(Some(&cleanup))));
    let m = build(&mut b);
    m.start();
    m.stop();
    assert_eq!(cleanup.count(), 1);
    m.stop();
    assert_eq!(cleanup.count(), 1);
}

#[test]
fn events_work_while_stopped_but_effects_do_not_run() {
    let log = Log::default();
    let m = build(
        Config::<Ab>::builder(AbState::A, ())
            .state(AbState::A, |s| {
                s.exit_run(log.action("exit-action"))
                    .effect_run(log.effect(None, Some("effect-cleanup")))
                    .on(AbEventKind::ToB, |t| {
                        t.target(AbState::B).run(log.action("transition-action"))
                    })
            })
            .state(AbState::B, |s| {
                s.entry_run(log.action("entry-action"))
                    .effect_run(log.effect(Some("effect-start"), None))
            }),
    );
    m.send(AbEvent::ToB); // never started
    assert_eq!(m.state(), AbState::B);
    assert_eq!(
        log.entries(),
        ["exit-action", "transition-action", "entry-action"]
    );
}

#[test]
fn start_boots_the_current_state_after_moving_while_stopped() {
    let a_fx = Calls::default();
    let b_fx = Calls::default();
    let mut b = ab();
    b.state(AbState::A, |s| s.effect_run(a_fx.effect(None)))
        .state(AbState::B, |s| s.effect_run(b_fx.effect(None)));
    let m = build(&mut b);
    m.send(AbEvent::ToB);
    m.start();
    assert_eq!(a_fx.count(), 0);
    assert_eq!(b_fx.count(), 1);
}

#[test]
fn a_restart_boots_the_state_the_machine_is_in() {
    let a_fx = Calls::default();
    let b_fx = Calls::default();
    let b_cleanup = Calls::default();
    let mut b = ab();
    b.state(AbState::A, |s| s.effect_run(a_fx.effect(None)))
        .state(AbState::B, |s| s.effect_run(b_fx.effect(Some(&b_cleanup))));
    let m = build(&mut b);
    m.start();
    m.send(AbEvent::ToB);
    m.stop();
    assert_eq!(b_cleanup.count(), 1);
    m.start(); // still in b
    assert_eq!(a_fx.count(), 1);
    assert_eq!(b_fx.count(), 2);
}

#[test]
fn while_running_a_transition_cleans_up_the_old_effects_then_starts_the_new() {
    let log = Log::default();
    let mut b = ab();
    b.state(AbState::A, |s| {
        s.effect_run(log.effect(None, Some("a:cleanup")))
    })
    .state(AbState::B, |s| {
        s.effect_run(log.effect(Some("b:start"), None))
    });
    let m = build(&mut b);
    m.start();
    m.send(AbEvent::ToB);
    assert_eq!(log.entries(), ["a:cleanup", "b:start"]);
}
