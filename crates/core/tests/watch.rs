//! `watch`: data-reactions on a context field or a computed value. Their actions run,
//! deferred onto the queue, when the value changes, in any state, only while running.
//!
//! Port note: the TS "watches a computed field" case only checks that an unchanged
//! computed value stays silent; this port also checks that a changed one fires.
//!
//! Like the TS engine, a write is observed as it happens: the last four tests pin that a
//! watcher run is queued at the write itself, in order with the sends around it.

mod common;

use common::{Log, build};
use dunky_state_machine::{Action, Config, ConfigBuilder, Context, Event, State, Types};

struct M;

#[derive(Clone, Copy, PartialEq, Eq, Debug, State)]
enum S {
    A,
    B,
}

#[derive(Clone, Debug, Event)]
enum Ev {
    Bump,
    BumpOther,
    BumpA,
    BumpB,
    Add,
    Clear,
    Toggle,
    SetN(i32),
    Go,
    Ping,
    ToB,
}

#[derive(Clone, Debug, Default, Context)]
struct Ctx {
    n: i32,
    other: i32,
    a: i32,
    b: i32,
    items: Vec<i32>,
    flag: bool,
}

impl Types for M {
    type State = S;
    type Event = Ev;
    type Context = Ctx;
}

/// Any-state handlers write the context; `toB` moves a -> b. Tests add their watchers.
fn builder(ctx: Ctx) -> ConfigBuilder<M> {
    let mut b = Config::<M>::builder(S::A, ctx);
    b.on(EvKind::Bump, |t| {
        t.act(|p| Ctx::patch().n(p.context().n + 1))
    })
    .on(EvKind::BumpOther, |t| {
        t.act(|p| Ctx::patch().other(p.context().other + 1))
    })
    .on(EvKind::BumpA, |t| {
        t.act(|p| Ctx::patch().a(p.context().a + 1))
    })
    .on(EvKind::BumpB, |t| {
        t.act(|p| Ctx::patch().b(p.context().b + 1))
    })
    .on(EvKind::Add, |t| {
        t.act(|p| {
            let mut items = p.context().items.clone();
            items.push(1);
            Ctx::patch().items(items)
        })
    })
    .on(EvKind::Clear, |t| t.act(|_| Ctx::patch().items(Vec::new())))
    .on(EvKind::Toggle, |t| {
        t.act(|p| Ctx::patch().flag(!p.context().flag))
    })
    .on(EvKind::SetN, |t| {
        t.act(|p| match p.event() {
            Some(Ev::SetN(n)) => Ctx::patch().n(*n),
            _ => Ctx::patch(),
        })
    })
    .state(S::A, |s| s.on(EvKind::ToB, |t| t.target(S::B)));
    b
}

/// A watcher action that records `n`.
fn record_n(seen: &Log<i32>) -> Action<M> {
    let seen = seen.clone();
    Action::<M>::run(move |p| seen.push(p.context().n))
}

#[test]
fn runs_when_a_watched_field_changes_but_not_on_start() {
    let seen = Log::default();
    let mut b = builder(Ctx::default());
    b.watch(Ctx::N, [record_n(&seen)]);
    let m = build(&mut b);
    m.start();
    assert!(seen.is_empty());
    m.send(Ev::Bump);
    m.send(Ev::Bump);
    assert_eq!(seen.entries(), [1, 2]);
}

#[test]
fn ignores_writes_to_other_fields() {
    let log = Log::default();
    let mut b = builder(Ctx::default());
    b.watch(Ctx::N, [Action::<M>::run(log.action("fired"))]);
    let m = build(&mut b);
    m.start();
    m.send(Ev::BumpOther);
    assert!(log.is_empty());
    m.send(Ev::Bump);
    assert_eq!(log.entries(), ["fired"]);
}

#[test]
fn watches_a_computed_value() {
    let seen: Log<bool> = Log::default();
    let mut b = builder(Ctx {
        items: vec![1],
        ..Ctx::default()
    });
    let is_empty = b.computed("isEmpty", |p| p.context.items().is_empty());
    b.watch_computed(
        is_empty,
        [Action::<M>::run({
            let seen = seen.clone();
            move |p| seen.push(*p.computed(is_empty))
        })],
    );
    let m = build(&mut b);
    m.start();
    m.send(Ev::Add); // items changed, isEmpty stayed false: silent
    assert!(seen.is_empty());
    m.send(Ev::Clear);
    assert_eq!(seen.entries(), [true]);
}

#[test]
fn reacts_in_any_state_and_can_send() {
    let log = Log::default();
    let mut b = builder(Ctx::default());
    b.on(EvKind::Ping, |t| t.run(log.action("ping")))
        .watch(Ctx::FLAG, [Action::<M>::run(|p| p.send(Ev::Ping))]);
    let m = build(&mut b);
    m.start();
    m.send(Ev::Toggle); // in a
    m.send(Ev::ToB);
    m.send(Ev::Toggle); // in b
    assert_eq!(log.entries(), ["ping", "ping"]);
}

#[test]
fn does_not_run_while_stopped_and_stop_disposes_it() {
    let seen = Log::default();
    let mut b = builder(Ctx::default());
    b.watch(Ctx::N, [record_n(&seen)]);
    let m = build(&mut b);
    m.send(Ev::Bump); // never started
    assert!(seen.is_empty());
    m.start();
    m.send(Ev::Bump);
    assert_eq!(seen.entries(), [2]);
    m.stop();
    m.send(Ev::Bump);
    assert_eq!(seen.entries(), [2]);
}

#[test]
fn a_run_still_pending_at_stop_is_dropped() {
    let seen = Log::default();
    let mut b = builder(Ctx::default());
    b.watch(Ctx::N, [record_n(&seen)]);
    let m = build(&mut b);
    m.start();
    let _ = m.subscribe({
        let m = m.clone();
        move || m.stop() // the write already queued the run; it must not run now
    });
    m.send(Ev::Bump);
    assert!(seen.is_empty());
}

#[test]
fn runs_after_the_whole_transition_settles() {
    let seen: Log<(i32, i32)> = Log::default();
    let mut b = builder(Ctx::default());
    b.on(EvKind::Go, |t| {
        t.act(|_| Ctx::patch().a(1)).act(|_| Ctx::patch().b(1))
    })
    .watch(
        Ctx::A,
        [Action::<M>::run({
            let seen = seen.clone();
            move |p| seen.push((p.context().a, p.context().b))
        })],
    );
    let m = build(&mut b);
    m.start();
    m.send(Ev::Go);
    // One run, after the full action list: never mid-transition with b still 0.
    assert_eq!(seen.entries(), [(1, 1)]);
}

#[test]
fn a_watcher_writing_its_own_field_converges() {
    let mut b = builder(Ctx::default());
    b.watch(
        Ctx::N,
        [Action::<M>::run(|p| {
            if p.context().n > 10 {
                p.set_context(Ctx::patch().n(10));
            }
        })],
    );
    let m = build(&mut b);
    m.start();
    m.send(Ev::SetN(50));
    assert_eq!(m.context().n, 10);
}

#[test]
#[cfg(debug_assertions)]
#[should_panic(expected = "feedback loop")]
fn panics_in_debug_on_a_watcher_feedback_loop() {
    let mut b = builder(Ctx::default());
    b.watch(
        Ctx::N,
        [Action::<M>::act(|p| Ctx::patch().n(p.context().n + 1))],
    );
    let m = build(&mut b);
    m.start();
    m.send(Ev::Bump);
}

#[test]
fn watched_fields_react_independently() {
    let log = Log::default();
    let mut b = builder(Ctx::default());
    b.watch(Ctx::A, [Action::<M>::run(log.action("a"))])
        .watch(Ctx::B, [Action::<M>::run(log.action("b"))]);
    let m = build(&mut b);
    m.start();
    m.send(Ev::BumpA);
    m.send(Ev::BumpB);
    m.send(Ev::BumpA);
    assert_eq!(log.entries(), ["a", "b", "a"]);
}

#[test]
fn a_watcher_runs_before_an_event_sent_later_by_the_same_action() {
    let log = Log::default();
    let mut b = builder(Ctx::default());
    b.on(EvKind::Go, |t| {
        t.run(|p| {
            p.set_context(Ctx::patch().n(1));
            p.send(Ev::Ping);
        })
    })
    .on(EvKind::Ping, |t| t.run(log.action("ping")))
    .watch(Ctx::N, [Action::<M>::run(log.action("watch"))]);
    let m = build(&mut b);
    m.start();
    m.send(Ev::Go);
    assert_eq!(log.entries(), ["watch", "ping"]);
}

#[test]
fn a_field_written_away_and_back_in_one_action_runs_the_watcher_per_write() {
    let seen = Log::default();
    let mut b = builder(Ctx::default());
    b.on(EvKind::Go, |t| {
        t.run(|p| {
            p.set_context(Ctx::patch().n(1));
            p.set_context(Ctx::patch().n(0));
        })
    })
    .watch(Ctx::N, [record_n(&seen)]);
    let m = build(&mut b);
    m.start();
    m.send(Ev::Go);
    assert_eq!(seen.entries(), [0, 0]); // both runs come after the action
}

#[test]
fn a_computed_watcher_runs_before_an_event_sent_later_by_the_same_action() {
    let log = Log::default();
    let mut b = builder(Ctx {
        items: vec![1],
        ..Ctx::default()
    });
    let is_empty = b.computed("isEmpty", |p| p.context.items().is_empty());
    b.on(EvKind::Go, |t| {
        t.run(|p| {
            p.set_context(Ctx::patch().items(Vec::new()));
            p.send(Ev::Ping);
        })
    })
    .on(EvKind::Ping, |t| t.run(log.action("ping")))
    .watch_computed(is_empty, [Action::<M>::run(log.action("watch"))]);
    let m = build(&mut b);
    m.start();
    m.send(Ev::Go);
    assert_eq!(log.entries(), ["watch", "ping"]);
}

#[test]
fn a_computed_watcher_reading_the_state_runs_on_a_transition() {
    let seen: Log<bool> = Log::default();
    let mut b = builder(Ctx::default());
    let in_b = b.computed("inB", |p| p.state() == S::B);
    b.watch_computed(
        in_b,
        [Action::<M>::run({
            let seen = seen.clone();
            move |p| seen.push(*p.computed(in_b))
        })],
    );
    let m = build(&mut b);
    m.start();
    m.send(Ev::ToB);
    assert_eq!(seen.entries(), [true]);
}
