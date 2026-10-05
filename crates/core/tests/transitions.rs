//! Transitions: per-state and any-state handlers, guard fallthrough, targetless
//! self-transitions, and the queued (run-to-completion) send.
//!
//! Port note: the TS "events from outside also serialize" case sends from an action,
//! which duplicates the re-entrant-send case; here it sends from an observer instead,
//! which is what its title describes.

mod common;

use common::{Calls, Count, Counter, CounterEvent, CounterEventKind, CounterState, Log, build};
use dunky_core::{Config, ConfigBuilder, Event, State, Types};

struct Door;

#[derive(Clone, Copy, PartialEq, Eq, Debug, State)]
enum DoorState {
    Closed,
    Open,
    Gone,
}

#[derive(Clone, Debug, Event)]
enum DoorEvent {
    Open,
    Close,
    AutoClose,
    Kill,
}

impl Types for Door {
    type State = DoorState;
    type Event = DoorEvent;
    type Context = ();
}

/// closed --open--> open --close--> closed
fn door() -> ConfigBuilder<Door> {
    let mut b = Config::<Door>::builder(DoorState::Closed, ());
    b.state(DoorState::Closed, |s| {
        s.on(DoorEventKind::Open, |t| t.target(DoorState::Open))
    })
    .state(DoorState::Open, |s| {
        s.on(DoorEventKind::Close, |t| t.target(DoorState::Closed))
    });
    b
}

#[test]
fn moves_between_states_on_a_matching_event() {
    let m = build(&mut door());
    assert_eq!(m.state(), DoorState::Closed);
    m.send(DoorEvent::Open);
    assert_eq!(m.state(), DoorState::Open);
    m.send(DoorEvent::Close);
    assert_eq!(m.state(), DoorState::Closed);
}

#[test]
fn ignores_an_event_the_current_state_does_not_handle() {
    let m = build(&mut door());
    m.send(DoorEvent::Close);
    assert_eq!(m.state(), DoorState::Closed);
}

#[test]
fn any_state_handlers_work_from_every_state_and_a_state_handler_takes_precedence() {
    let log = Log::default();
    let mut b = door();
    b.on(DoorEventKind::Kill, |t| t.target(DoorState::Gone))
        .state(DoorState::Closed, |s| {
            s.on(DoorEventKind::Kill, |t| {
                t.run(log.action("closed handled kill"))
            })
        });
    let m = build(&mut b);
    m.send(DoorEvent::Kill); // closed has its own handler: it wins
    assert_eq!(m.state(), DoorState::Closed);
    assert_eq!(log.entries(), ["closed handled kill"]);
    m.send(DoorEvent::Open);
    m.send(DoorEvent::Kill); // open has none: the any-state handler applies
    assert_eq!(m.state(), DoorState::Gone);
}

#[test]
fn guard_fallthrough_takes_the_first_candidate_whose_guard_passes() {
    let m = build(
        Config::<Counter>::builder(CounterState::Idle, Count { n: 5 }).state(
            CounterState::Idle,
            |s| {
                s.on(CounterEventKind::Inc, |t| {
                    t.guard_fn(|p| p.context().n > 10)
                        .act(|_| Count::patch().n(999))
                })
                .on(CounterEventKind::Inc, |t| {
                    t.guard_fn(|p| p.context().n > 0)
                        .act(|_| Count::patch().n(1))
                })
                .on(CounterEventKind::Inc, |t| t.act(|_| Count::patch().n(-1)))
            },
        ),
    );
    m.send(CounterEvent::Inc); // n=5: first guard fails, second passes
    assert_eq!(m.context().n, 1);
}

#[test]
fn a_targetless_transition_runs_its_actions_and_stays_in_the_state() {
    let ran = Calls::default();
    let m = build(
        Config::<Counter>::builder(CounterState::Idle, Count { n: 0 }).state(
            CounterState::Idle,
            |s| {
                s.on(CounterEventKind::Inc, |t| {
                    t.run(ran.action())
                        .act(|p| Count::patch().n(p.context().n + 1))
                })
            },
        ),
    );
    m.send(CounterEvent::Inc);
    m.send(CounterEvent::Inc);
    assert_eq!(ran.count(), 2);
    assert_eq!(m.context().n, 2);
    assert_eq!(m.state(), CounterState::Idle);
}

#[test]
fn a_send_from_an_action_runs_after_the_current_transition_completes() {
    let log = Log::default();
    let m = build(
        Config::<Door>::builder(DoorState::Closed, ())
            .state(DoorState::Closed, |s| {
                s.on(DoorEventKind::Open, |t| {
                    let log = log.clone();
                    t.target(DoorState::Open).run(move |p| {
                        log.push("announce");
                        p.send(DoorEvent::AutoClose);
                    })
                })
            })
            .state(DoorState::Open, |s| {
                s.on(DoorEventKind::AutoClose, |t| {
                    t.target(DoorState::Closed).run(log.action("closed"))
                })
            }),
    );
    m.send(DoorEvent::Open);
    // autoClose was processed against `open` (the new state), so it matched.
    assert_eq!(log.entries(), ["announce", "closed"]);
    assert_eq!(m.state(), DoorState::Closed);
}

#[test]
fn a_send_from_an_observer_mid_transition_waits_for_the_transition_to_complete() {
    let log = Log::default();
    let m = build(
        Config::<Door>::builder(DoorState::Closed, ())
            .state(DoorState::Closed, |s| {
                s.on(DoorEventKind::Open, |t| t.target(DoorState::Open))
            })
            .state(DoorState::Open, |s| {
                s.entry_run(log.action("entry:open"))
                    .on(DoorEventKind::AutoClose, |t| {
                        t.target(DoorState::Closed).run(log.action("auto-closed"))
                    })
            }),
    );
    let _ = m.subscribe({
        let m = m.clone();
        move || {
            if m.state() == DoorState::Open {
                m.send(DoorEvent::AutoClose);
            }
        }
    });
    m.send(DoorEvent::Open);
    // The observer fired at the switch to `open`, before its entry actions.
    assert_eq!(log.entries(), ["entry:open", "auto-closed"]);
    assert_eq!(m.state(), DoorState::Closed);
}
