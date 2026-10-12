//! Connector: a memoized view surface over a machine and props, its coarse subscription,
//! and reactions (machine change -> consumer callback) wired on start, torn down on stop.
//!
//! Not ported:
//! - "forwards select for per-field (canvas/Lit) consumption": Rust's `Connector` does not
//!   forward `select`; per-field selections come from the machine (`Machine::select`,
//!   pinned in subscribe.rs).

mod common;

use std::cell::RefCell;
use std::rc::Rc;

use common::{Ab, AbEvent, AbState, Calls, Log, ab, build};
use dunky_state_machine::{
    Config, Connector, Context, Event, Machine, Reaction, State, Subscription, Types,
};

struct M;

#[derive(Clone, Copy, PartialEq, Eq, Debug, State)]
enum S {
    A,
    B,
}

#[derive(Clone, Debug, Event)]
enum Ev {
    Inc,
    ToB,
}

#[derive(Clone, Debug, Context)]
struct Ctx {
    count: i32,
}

impl Types for M {
    type State = S;
    type Event = Ev;
    type Context = Ctx;
}

#[derive(PartialEq)]
struct Props {
    label: String,
}

struct Api {
    state: S,
    count: i32,
    label: String,
}

/// `inc` works in any state; `toB` moves a -> b. The connector is shared so listeners can
/// read it.
fn setup(label: &str) -> (Machine<M>, Rc<Connector<M, Props, Api>>) {
    let m = build(
        Config::<M>::builder(S::A, Ctx { count: 0 })
            .on(EvKind::Inc, |t| {
                t.act(|p| Ctx::patch().count(p.context().count + 1))
            })
            .state(S::A, |s| s.on(EvKind::ToB, |t| t.target(S::B))),
    );
    let c = Connector::new(
        &m,
        |snap| Api {
            state: snap.view.state(),
            count: snap.view.context().count,
            label: snap.props.label.clone(),
        },
        Props {
            label: label.into(),
        },
        Vec::new(),
    );
    (m, Rc::new(c))
}

#[test]
fn the_snapshot_reflects_the_connect_output() {
    let (_m, c) = setup("hi");
    let snap = c.snapshot();
    assert_eq!(snap.state, S::A);
    assert_eq!(snap.count, 0);
    assert_eq!(snap.label, "hi");
}

#[test]
fn the_snapshot_is_the_same_rc_while_nothing_changes() {
    let (_m, c) = setup("hi");
    assert!(Rc::ptr_eq(&c.snapshot(), &c.snapshot()));
}

#[test]
fn the_snapshot_changes_after_a_context_change() {
    let (m, c) = setup("hi");
    let before = c.snapshot();
    m.send(Ev::Inc);
    let after = c.snapshot();
    assert!(!Rc::ptr_eq(&before, &after));
    assert_eq!(after.count, 1);
}

#[test]
fn the_snapshot_reads_the_live_state() {
    let (m, c) = setup("hi");
    m.send(Ev::ToB);
    assert_eq!(c.snapshot().state, S::B);
}

#[test]
fn subscribe_fires_on_any_change_but_not_on_subscribe() {
    let (m, c) = setup("hi");
    let calls = Calls::default();
    let sub = c.subscribe(calls.listener());
    assert_eq!(calls.count(), 0);
    m.send(Ev::Inc);
    assert_eq!(calls.count(), 1);
    sub.unsubscribe();
    m.send(Ev::Inc);
    assert_eq!(calls.count(), 1);
}

#[test]
fn a_listener_unsubscribed_mid_notify_does_not_fire_in_that_pass() {
    let (m, c) = setup("hi");
    let log = Log::default();
    let off_b: Rc<RefCell<Option<Subscription>>> = Rc::default();
    let _ = c.subscribe({
        let (log, off_b) = (log.clone(), off_b.clone());
        move || {
            log.push("a");
            if let Some(sub) = off_b.borrow_mut().take() {
                sub.unsubscribe();
            }
        }
    });
    *off_b.borrow_mut() = Some(c.subscribe(log.listener("b")));
    m.send(Ev::Inc);
    assert_eq!(log.entries(), ["a"]);
}

#[test]
fn new_props_rebuild_the_snapshot_and_wake_subscribers() {
    let (_m, c) = setup("one");
    let calls = Calls::default();
    let _ = c.subscribe(calls.listener());
    assert_eq!(c.snapshot().label, "one");
    c.set_props(Props {
        label: "two".into(),
    });
    assert_eq!(c.snapshot().label, "two");
    assert_eq!(calls.count(), 1);
}

#[test]
fn drives_a_use_sync_external_store_loop_without_churn() {
    let (m, c) = setup("hi");
    let renders = Calls::default();
    let read = Rc::new({
        let (c, renders) = (c.clone(), renders.clone());
        move || {
            renders.hit();
            c.snapshot()
        }
    });
    let snap = Rc::new(RefCell::new(read()));
    let _ = c.subscribe({
        let (read, snap) = (read.clone(), snap.clone());
        move || {
            let next = read();
            assert!(
                !Rc::ptr_eq(&next, &snap.borrow()),
                "a notify carries a new snapshot"
            );
            *snap.borrow_mut() = next;
        }
    });
    let before = renders.count();
    m.send(Ev::Inc); // one change: one notify, one re-read
    assert_eq!(renders.count(), before + 1);
}

/// Props carrying a callback; equal when they carry the same one.
struct ReactionProps {
    on_b: Rc<dyn Fn(bool)>,
}

impl PartialEq for ReactionProps {
    fn eq(&self, other: &Self) -> bool {
        Rc::ptr_eq(&self.on_b, &other.on_b)
    }
}

fn recording(log: &Log<bool>) -> ReactionProps {
    let log = log.clone();
    ReactionProps {
        on_b: Rc::new(move |in_b| log.push(in_b)),
    }
}

/// A connector whose reaction calls `props.on_b(in_b)` when "in b" changes.
fn connect(m: &Machine<Ab>, props: ReactionProps) -> Connector<Ab, ReactionProps, AbState> {
    let reaction = Reaction::new(
        |v| v.matches(AbState::B),
        |in_b: &bool, props: &ReactionProps| (props.on_b)(*in_b),
    );
    Connector::new(m, |snap| snap.view.state(), props, vec![reaction])
}

#[test]
fn a_reaction_fires_on_a_change_once_the_machine_starts() {
    let seen = Log::default();
    let m = build(&mut ab());
    let _c = connect(&m, recording(&seen));
    m.start();
    assert!(seen.is_empty());
    m.send(AbEvent::ToB);
    assert_eq!(seen.entries(), [true]);
}

#[test]
fn reactions_stay_inert_until_the_machine_starts() {
    let seen = Log::default();
    let m = build(&mut ab());
    let _c = connect(&m, recording(&seen));
    m.send(AbEvent::ToB);
    assert!(seen.is_empty());
}

#[test]
fn stop_tears_reactions_down_and_a_restart_re_establishes_them() {
    let seen = Log::default();
    let m = build(&mut ab());
    let _c = connect(&m, recording(&seen));
    m.start();
    m.send(AbEvent::ToB);
    assert_eq!(seen.entries(), [true]);
    m.stop();
    m.send(AbEvent::ToA);
    m.send(AbEvent::ToB);
    assert_eq!(seen.entries(), [true]);
    m.start();
    seen.clear();
    m.send(AbEvent::ToA);
    m.send(AbEvent::ToB);
    assert_eq!(seen.entries(), [false, true]);
}

#[test]
fn a_reaction_reads_the_latest_props() {
    let first = Log::default();
    let second = Log::default();
    let m = build(&mut ab());
    let c = connect(&m, recording(&first));
    m.start();
    c.set_props(recording(&second));
    m.send(AbEvent::ToB);
    assert!(first.is_empty());
    assert_eq!(second.entries(), [true]);
}
