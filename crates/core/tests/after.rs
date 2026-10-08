//! `after`: timed transitions while a state is active. Time is driven by the sans-IO test
//! `Clock` (the counterpart of vitest fake timers): it runs the machine's timer commands
//! and fires due timers as virtual time advances.
//!
//! Rust-only (a sans-IO host can fire a timer at any moment, which JS timers cannot): the
//! last three tests pin the SPEC's stale-timer and no-interleaving rules.

mod common;

use common::{Log, build};
use dunky_core::testing::Clock;
use dunky_core::{Command, Config, Context, Event, State, Types};

struct M;

#[derive(Clone, Copy, PartialEq, Eq, Debug, State)]
enum S {
    A,
    B,
    C,
}

#[derive(Clone, Debug, Event)]
enum Ev {
    Leave,
    Back,
    Chain,
    Show,
}

#[derive(Clone, Debug, Default, Context)]
struct Ctx {
    ms: u32,
    n: i32,
}

impl Types for M {
    type State = S;
    type Event = Ev;
    type Context = Ctx;
}

#[test]
fn fires_a_fixed_delay_transition_after_the_delay() {
    let m = build(
        Config::<M>::builder(S::A, Ctx::default())
            .state(S::A, |s| s.after(200, |t| t.target(S::B))),
    );
    m.start();
    let mut clock = Clock::new(&m);
    clock.advance(199);
    assert_eq!(m.state(), S::A);
    clock.advance(1);
    assert_eq!(m.state(), S::B);
}

#[test]
fn resolves_a_named_delay_that_reads_the_context() {
    let m = build(
        Config::<M>::builder(
            S::A,
            Ctx {
                ms: 500,
                ..Ctx::default()
            },
        )
        .delay("openDelay", |p| p.context().ms)
        .state(S::A, |s| s.after("openDelay", |t| t.target(S::B))),
    );
    m.start();
    let mut clock = Clock::new(&m);
    clock.advance(499);
    assert_eq!(m.state(), S::A);
    clock.advance(1);
    assert_eq!(m.state(), S::B);
}

#[test]
fn leaving_the_state_first_cancels_its_timer() {
    let m = build(Config::<M>::builder(S::A, Ctx::default()).state(S::A, |s| {
        s.after(200, |t| t.target(S::B))
            .on(EvKind::Leave, |t| t.target(S::C))
    }));
    m.start();
    let mut clock = Clock::new(&m);
    m.send(Ev::Leave);
    assert_eq!(m.state(), S::C);
    clock.advance(500);
    assert_eq!(m.state(), S::C);
}

#[test]
fn timers_run_only_while_started_and_stop_cancels_a_pending_one() {
    let m = build(
        Config::<M>::builder(S::A, Ctx::default())
            .state(S::A, |s| s.after(100, |t| t.target(S::B))),
    );
    let mut clock = Clock::new(&m);
    clock.advance(500); // never started: nothing scheduled
    assert_eq!(m.state(), S::A);

    m.start();
    m.stop();
    clock.advance(500);
    assert_eq!(m.state(), S::A);
}

#[test]
fn an_after_handler_falls_through_to_the_first_passing_candidate() {
    let m = build(
        Config::<M>::builder(
            S::A,
            Ctx {
                n: 8,
                ..Ctx::default()
            },
        )
        .state(S::A, |s| {
            s.after(100, |t| t.guard_fn(|p| p.context().n >= 10).target(S::B))
                .after_or(|t| t.target(S::C))
        }),
    );
    m.start();
    Clock::new(&m).advance(100);
    assert_eq!(m.state(), S::C); // n=8 < 10: the fallback
}

#[test]
fn a_timed_transition_runs_its_actions_on_the_way() {
    let log = Log::default();
    let m = build(
        Config::<M>::builder(S::A, Ctx::default())
            .state(S::A, |s| {
                s.after(50, |t| t.target(S::B).run(log.action("tick")))
            })
            .state(S::B, |s| s.entry_run(log.action("entered-b"))),
    );
    m.start();
    Clock::new(&m).advance(50);
    assert_eq!(log.entries(), ["tick", "entered-b"]);
    assert_eq!(m.state(), S::B);
}

#[test]
fn a_state_entered_later_schedules_its_timer_on_entry() {
    let m = build(
        Config::<M>::builder(S::A, Ctx::default())
            .state(S::A, |s| s.on(EvKind::Show, |t| t.target(S::B)))
            .state(S::B, |s| s.after(300, |t| t.target(S::A))),
    );
    m.start();
    let mut clock = Clock::new(&m);
    m.send(Ev::Show);
    assert_eq!(m.state(), S::B);
    clock.advance(300);
    assert_eq!(m.state(), S::A);
}

#[test]
#[cfg(debug_assertions)]
#[should_panic(expected = "no delay \"missing\"")]
fn panics_in_debug_when_a_delay_name_is_not_registered() {
    let m = build(
        Config::<M>::builder(S::A, Ctx::default())
            .state(S::A, |s| s.after("missing", |t| t.target(S::B))),
    );
    m.start();
}

#[test]
fn events_sent_by_a_timed_transition_drain_in_the_same_run() {
    let log = Log::default();
    let m = build(
        Config::<M>::builder(S::A, Ctx::default())
            .state(S::A, |s| {
                s.after(10, |t| t.target(S::B).run(|p| p.send(Ev::Chain)))
            })
            .state(S::B, |s| {
                s.on(EvKind::Chain, |t| t.target(S::C).run(log.action("chained")))
            })
            .state(S::C, |s| s.entry_run(log.action("entered-c"))),
    );
    m.start();
    Clock::new(&m).advance(10);
    assert_eq!(m.state(), S::C);
    assert_eq!(log.entries(), ["chained", "entered-c"]);
}

#[test]
fn re_entering_a_timed_state_restarts_its_timer() {
    let m = build(
        Config::<M>::builder(S::A, Ctx::default())
            .state(S::A, |s| {
                s.after(100, |t| t.target(S::C))
                    .on(EvKind::Leave, |t| t.target(S::B))
            })
            .state(S::B, |s| s.on(EvKind::Back, |t| t.target(S::A))),
    );
    m.start();
    let mut clock = Clock::new(&m);
    clock.advance(60);
    m.send(Ev::Leave);
    assert_eq!(m.state(), S::B);
    clock.advance(50); // past the first entry's deadline, but that timer is gone
    assert_eq!(m.state(), S::B);
    m.send(Ev::Back); // a fresh 100ms timer
    clock.advance(60);
    assert_eq!(m.state(), S::A);
    clock.advance(40);
    assert_eq!(m.state(), S::C);
}

#[test]
fn a_cancelled_timer_fired_anyway_is_ignored() {
    let m = build(
        Config::<M>::builder(S::A, Ctx::default())
            .state(S::A, |s| {
                s.after(100, |t| t.target(S::C))
                    .on(EvKind::Leave, |t| t.target(S::B))
            })
            .state(S::B, |s| s.on(EvKind::Back, |t| t.target(S::A))),
    );
    m.start();
    let [Command::StartTimer { id, .. }] = m.take_commands()[..] else {
        panic!("expected one StartTimer")
    };
    m.send(Ev::Leave); // emits the cancel; this host fires the timer anyway
    m.fire_timer(id);
    assert_eq!(m.state(), S::B);
    m.send(Ev::Back); // a re-entry schedules a new timer; the old id stays dead
    m.fire_timer(id);
    assert_eq!(m.state(), S::A);
}

#[test]
fn a_timer_fired_mid_transition_waits_for_it_to_complete() {
    let log = Log::default();
    let m = build(Config::<M>::builder(S::A, Ctx::default()).state(S::A, |s| {
        s.after(10, |t| t.target(S::C).run(log.action("timer")))
            .on(EvKind::Chain, |t| {
                t.run(log.action("chain:start"))
                    .act(|p| Ctx::patch().n(p.context().n + 1))
                    .run(log.action("chain:end"))
            })
    }));
    m.start();
    let [Command::StartTimer { id, .. }] = m.take_commands()[..] else {
        panic!("expected one StartTimer")
    };
    let _ = m.subscribe({
        let m = m.clone();
        move || m.fire_timer(id) // the host fires while `chain` is in flight
    });
    m.send(Ev::Chain);
    assert_eq!(log.entries(), ["chain:start", "chain:end", "timer"]);
    assert_eq!(m.state(), S::C);
}

#[test]
fn a_timer_queued_behind_an_exit_and_re_entry_of_its_state_is_stale() {
    let m = build(
        Config::<M>::builder(S::A, Ctx::default())
            .state(S::A, |s| {
                s.after(100, |t| t.target(S::C))
                    .on(EvKind::Leave, |t| t.target(S::B))
                    .on(EvKind::Chain, |t| {
                        t.run(|p| {
                            p.send(Ev::Leave);
                            p.send(Ev::Back);
                        })
                        .act(|p| Ctx::patch().n(p.context().n + 1))
                    })
            })
            .state(S::B, |s| s.on(EvKind::Back, |t| t.target(S::A))),
    );
    m.start();
    let [Command::StartTimer { id, .. }] = m.take_commands()[..] else {
        panic!("expected one StartTimer")
    };
    // Fired at the `chain` patch, the timer queues behind `leave` and `back`. By the time
    // it runs, `a` was exited and re-entered: the timer belongs to the previous entry.
    let _ = m.subscribe({
        let m = m.clone();
        move || m.fire_timer(id)
    });
    m.send(Ev::Chain);
    assert_eq!(m.state(), S::A);
}
