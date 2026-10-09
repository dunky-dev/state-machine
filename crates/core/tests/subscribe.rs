//! Observation: the coarse `subscribe` (wakes on any change) and value-deduped
//! selections (`select`, `select_computed`, `select_state`). Neither fires on subscribe.
//!
//! Not ported:
//! - "the select facade is a stable identity across accesses": a JS facade object; Rust's
//!   `select` is a method.
//! - "without equals, a fresh-object selector fires every change (Object.is)": identity
//!   semantics. Rust selections compare with `PartialEq`, which the value-dedup test pins.
//! - "select(fn) function form still works alongside the scope methods": a JS facade
//!   shape; in Rust `select` and `select_field` are plain methods.
//! - ".value reads the current selected value": the first of two such TS tests; the
//!   second ("on demand") covers it.
//! - "does NOT fire on subscribe; fires on a context change", "multiple subscribers all
//!   fire" and the "reentrancy" group (subscribing or unsubscribing during a notify,
//!   nested notify): the same bus behind the same `Machine::subscribe`, pinned in
//!   broadcast.rs.

mod common;

use common::{
    AbEvent, AbState, Calls, Count, Counter, CounterEvent, CounterEventKind, CounterState, Log, ab,
    build, counter,
};
use dunky_state_machine::{Config, Context, Event, State, Types};

/// A machine whose events write `x`, `y` and `other`.
struct Plane;

#[derive(Clone, Copy, PartialEq, Eq, Debug, State)]
enum PlaneState {
    Idle,
}

#[derive(Clone, Debug, Event)]
enum PlaneEvent {
    MoveX,
    BumpOther,
    Both,
}

#[derive(Clone, Debug, Default, Context)]
struct Pos {
    x: i32,
    y: i32,
    other: i32,
}

impl Types for Plane {
    type State = PlaneState;
    type Event = PlaneEvent;
    type Context = Pos;
}

fn plane() -> dunky_state_machine::Machine<Plane> {
    build(
        Config::<Plane>::builder(PlaneState::Idle, Pos::default()).state(PlaneState::Idle, |s| {
            s.on(PlaneEventKind::MoveX, |t| {
                t.act(|p| Pos::patch().x(p.context().x + 1))
            })
            .on(PlaneEventKind::BumpOther, |t| {
                t.act(|p| Pos::patch().other(p.context().other + 1))
            })
            .on(PlaneEventKind::Both, |t| t.act(|_| Pos::patch().x(1).y(1)))
        }),
    )
}

#[test]
fn subscribe_fires_on_a_state_change() {
    let m = build(&mut ab());
    let calls = Calls::default();
    let _ = m.subscribe(calls.listener());
    m.send(AbEvent::ToB);
    assert_eq!(calls.count(), 1);
}

#[test]
fn unsubscribe_stops_notifications() {
    let m = build(&mut counter());
    let calls = Calls::default();
    let sub = m.subscribe(calls.listener());
    m.send(CounterEvent::Inc);
    assert_eq!(calls.count(), 1);
    sub.unsubscribe();
    m.send(CounterEvent::Inc);
    assert_eq!(calls.count(), 1);
}

#[test]
fn a_multi_field_patch_notifies_once() {
    let m = plane();
    let calls = Calls::default();
    let _ = m.subscribe(calls.listener());
    m.send(PlaneEvent::Both);
    assert_eq!(calls.count(), 1);
}

#[test]
fn a_patch_that_changes_nothing_is_silent() {
    let m = build(
        Config::<Counter>::builder(CounterState::Idle, Count { n: 5 })
            .state(CounterState::Idle, |s| {
                s.on(CounterEventKind::Inc, |t| t.act(|_| Count::patch().n(5)))
            }),
    );
    let calls = Calls::default();
    let _ = m.subscribe(calls.listener());
    m.send(CounterEvent::Inc);
    assert_eq!(calls.count(), 0);
}

#[test]
fn a_selection_fires_with_the_new_value_but_not_on_subscribe() {
    let m = build(&mut counter());
    let seen: Log<i32> = Log::default();
    let _ = m.select(|v| v.context().n).subscribe({
        let seen = seen.clone();
        move |n| seen.push(*n)
    });
    assert!(seen.is_empty());
    m.send(CounterEvent::Inc);
    assert_eq!(seen.entries(), [1]);
}

#[test]
fn a_selection_is_silent_while_the_selected_value_is_unchanged() {
    let m = build(&mut counter());
    let seen: Log<bool> = Log::default();
    let _ = m.select(|v| v.context().n == 0).subscribe({
        let seen = seen.clone();
        move |is_zero| seen.push(*is_zero)
    });
    m.send(CounterEvent::Inc); // true -> false: fires
    assert_eq!(seen.entries(), [false]);
    m.send(CounterEvent::Inc); // false -> false: silent
    assert_eq!(seen.entries(), [false]);
}

#[test]
fn unsubscribing_a_selection_stops_it() {
    let m = build(&mut counter());
    let seen: Log<i32> = Log::default();
    let sub = m.select(|v| v.context().n).subscribe({
        let seen = seen.clone();
        move |n| seen.push(*n)
    });
    m.send(CounterEvent::Inc);
    sub.unsubscribe();
    m.send(CounterEvent::Inc);
    assert_eq!(seen.entries(), [1]);
}

/// A selected value with no `PartialEq`, so only a supplied equality can dedup it.
struct Point {
    x: i32,
    y: i32,
}

#[test]
fn a_supplied_equality_decides_what_counts_as_a_change() {
    let m = plane();
    let seen: Log<(i32, i32)> = Log::default();
    let _ = m
        .select(|v| Point {
            x: v.context().x,
            y: v.context().y,
        })
        .subscribe_with(
            {
                let seen = seen.clone();
                move |p| seen.push((p.x, p.y))
            },
            |a, b| a.x == b.x && a.y == b.y,
        );
    m.send(PlaneEvent::BumpOther); // {x, y} unchanged by the equality: silent
    assert!(seen.is_empty());
    m.send(PlaneEvent::MoveX);
    assert_eq!(seen.entries(), [(1, 0)]);
}

#[test]
fn value_reads_the_current_selection_on_demand() {
    let m = build(&mut counter());
    let n = m.select(|v| v.context().n);
    assert_eq!(n.value(), 0);
    m.send(CounterEvent::Inc);
    assert_eq!(n.value(), 1);
    m.send(CounterEvent::Inc);
    assert_eq!(n.value(), 2);
}

#[test]
fn select_computed_selects_a_derived_value() {
    let mut b = counter();
    let is_zero = b.computed("isZero", |p| *p.context.n() == 0);
    let m = build(&mut b);
    let selection = m.select_computed(is_zero);
    assert!(*selection.value());
    let seen: Log<bool> = Log::default();
    let _ = selection.subscribe({
        let seen = seen.clone();
        move |v| seen.push(**v)
    });
    m.send(CounterEvent::Inc); // true -> false: fires
    m.send(CounterEvent::Inc); // false -> false: silent
    assert_eq!(seen.entries(), [false]);
}

#[test]
fn select_state_fires_on_transitions() {
    let m = build(&mut ab());
    let state = m.select_state();
    assert_eq!(state.value(), AbState::A);
    let seen: Log<AbState> = Log::default();
    let _ = state.subscribe({
        let seen = seen.clone();
        move |s| seen.push(*s)
    });
    m.send(AbEvent::ToB);
    m.send(AbEvent::ToA);
    assert_eq!(seen.entries(), [AbState::B, AbState::A]);
}

#[test]
fn a_selection_listener_may_patch_the_machine_it_observes() {
    let m = plane();
    let seen: Log<i32> = Log::default();
    let _ = m.select(|v| v.context().x).subscribe({
        let (m, seen) = (m.clone(), seen.clone());
        move |x| {
            seen.push(*x);
            if *x == 1 {
                m.set_context(Pos::patch().x(5)); // notifies again before this call returns
            }
        }
    });
    m.send(PlaneEvent::MoveX);
    assert_eq!(seen.entries(), [1, 5]);
}

#[test]
fn select_field_selects_one_field_with_its_type() {
    let m = plane();
    let x = m.select_field(Pos::X);
    let xv: i32 = x.value();
    assert_eq!(xv, 0);
    let seen: Log<i32> = Log::default();
    let _ = x.subscribe({
        let seen = seen.clone();
        move |x| seen.push(*x)
    });
    m.send(PlaneEvent::BumpOther); // changed `other`, not `x`: silent
    assert!(seen.entries().is_empty());
    m.send(PlaneEvent::MoveX);
    assert_eq!(seen.entries(), [1]);
}

// Rust-only: a selection made inside an action cannot read the machine yet, so it seeds
// on its first wake. A field selection must still report the next change of its field,
// even when that first wake came from another field.
#[test]
fn a_field_selection_made_mid_action_reports_the_next_change() {
    type Slot = std::rc::Rc<std::cell::RefCell<Option<dunky_state_machine::Machine<Plane>>>>;
    let handle: Slot = Slot::default();
    let seen: Log<i32> = Log::default();
    let m = build(
        Config::<Plane>::builder(PlaneState::Idle, Pos::default()).state(PlaneState::Idle, |s| {
            let (handle, seen) = (handle.clone(), seen.clone());
            s.on(PlaneEventKind::MoveX, |t| {
                t.act(|p| Pos::patch().x(p.context().x + 1))
            })
            .on(PlaneEventKind::BumpOther, move |t| {
                t.run(move |p| {
                    if p.context().other == 0 {
                        // The core is borrowed by this action: the selection seeds later.
                        let m = handle.borrow().clone().expect("machine");
                        std::mem::forget(m.select_field(Pos::X).subscribe({
                            let seen = seen.clone();
                            move |x| seen.push(*x)
                        }));
                    }
                    p.set_context(Pos::patch().other(p.context().other + 1));
                })
            })
        }),
    );
    *handle.borrow_mut() = Some(m.clone());
    m.send(PlaneEvent::BumpOther);
    m.send(PlaneEvent::MoveX);
    assert_eq!(seen.entries(), [1]);
}
