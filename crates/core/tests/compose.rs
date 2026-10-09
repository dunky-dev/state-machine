//! Composition: several machines run as one unit with a shared start / stop, plus `sync`
//! (a cross-member reaction) and `combine` (a value-deduped derivation across members).
//!
//! Not ported:
//! - the "members are reachable by name" half of "start() starts every member": the JS
//!   `members` map. A Rust composition keeps no names; callers keep their own handles.
//! - "re-entrant send from sync is queued, not run mid-drain": the damped-forward test runs
//!   the same rule for 200 sends and asserts the same end state.

mod common;

use std::rc::Rc;

use common::{AbState, Calls, CounterEvent, Log, ab, build, counter};
use dunky_state_machine::{Composition, Config, Event, Machine, Member, State, Subscription, Types};

struct Popup;

#[derive(Clone, Copy, PartialEq, Eq, Debug, State)]
enum PopupState {
    Closed,
    Open,
}

#[derive(Clone, Debug, Event)]
enum PopupEvent {
    Focus,
    Escape,
}

impl Types for Popup {
    type State = PopupState;
    type Event = PopupEvent;
    type Context = ();
}

struct Submenu;

#[derive(Clone, Copy, PartialEq, Eq, Debug, State)]
enum SubmenuState {
    Hidden,
    Shown,
}

#[derive(Clone, Debug, Event)]
enum SubmenuEvent {
    Open,
    Close,
}

impl Types for Submenu {
    type State = SubmenuState;
    type Event = SubmenuEvent;
    type Context = ();
}

/// A started composition of a popup (closed <-> open) and a submenu (hidden <-> shown).
fn menu() -> (Composition, Machine<Popup>, Machine<Submenu>) {
    let popup = build(
        Config::<Popup>::builder(PopupState::Closed, ())
            .state(PopupState::Closed, |s| {
                s.on(PopupEventKind::Focus, |t| t.target(PopupState::Open))
            })
            .state(PopupState::Open, |s| {
                s.on(PopupEventKind::Escape, |t| t.target(PopupState::Closed))
            }),
    );
    let submenu = build(
        Config::<Submenu>::builder(SubmenuState::Hidden, ())
            .state(SubmenuState::Hidden, |s| {
                s.on(SubmenuEventKind::Open, |t| t.target(SubmenuState::Shown))
            })
            .state(SubmenuState::Shown, |s| {
                s.on(SubmenuEventKind::Close, |t| t.target(SubmenuState::Hidden))
            }),
    );
    let group = Composition::new().with(&popup).with(&submenu);
    group.start();
    (group, popup, submenu)
}

#[test]
fn start_starts_every_member_in_order() {
    let log = Log::default();
    let a = build(ab().state(AbState::A, |s| s.effect_run(log.effect(Some("a"), None))));
    let b = build(ab().state(AbState::A, |s| s.effect_run(log.effect(Some("b"), None))));
    let group = Composition::new().with(&a).with(&b);
    assert!(log.is_empty());
    group.start();
    assert_eq!(log.entries(), ["a", "b"]);
}

#[test]
fn stop_stops_members_in_reverse_order() {
    let log = Log::default();
    let a = build(ab().state(AbState::A, |s| {
        s.effect_run(log.effect(None, Some("a:cleanup")))
    }));
    let b = build(ab().state(AbState::A, |s| {
        s.effect_run(log.effect(None, Some("b:cleanup")))
    }));
    let group = Composition::new().with(&a).with(&b);
    group.start();
    group.stop();
    assert_eq!(log.entries(), ["b:cleanup", "a:cleanup"]);
}

#[test]
fn members_stay_independent() {
    let (_group, popup, submenu) = menu();
    popup.send(PopupEvent::Focus);
    submenu.send(SubmenuEvent::Open);
    assert_eq!(popup.state(), PopupState::Open);
    assert_eq!(submenu.state(), SubmenuState::Shown);
}

#[test]
fn sync_reacts_to_any_member_change_but_not_on_setup() {
    let (group, popup, submenu) = menu();
    popup.send(PopupEvent::Focus);
    submenu.send(SubmenuEvent::Open);
    // Rule: when the popup closes, close the submenu too.
    let _ = group.sync({
        let (popup, submenu) = (popup.clone(), submenu.clone());
        move || {
            if popup.matches(PopupState::Closed) {
                submenu.send(SubmenuEvent::Close);
            }
        }
    });
    assert_eq!(submenu.state(), SubmenuState::Shown);
    popup.send(PopupEvent::Escape);
    assert_eq!(submenu.state(), SubmenuState::Hidden);
}

#[test]
fn a_sync_rule_is_disposed_on_stop() {
    let (group, popup, _submenu) = menu();
    let calls = Calls::default();
    let _ = group.sync(calls.listener());
    popup.send(PopupEvent::Focus);
    assert_eq!(calls.count(), 1);
    group.stop();
    popup.start(); // the member still runs, the rule is gone
    popup.send(PopupEvent::Escape);
    assert_eq!(calls.count(), 1);
}

#[test]
fn a_sync_rule_detaches_early_when_unsubscribed() {
    let (group, popup, _submenu) = menu();
    let calls = Calls::default();
    let sub = group.sync(calls.listener());
    popup.send(PopupEvent::Focus);
    assert_eq!(calls.count(), 1);
    sub.unsubscribe();
    popup.send(PopupEvent::Escape);
    assert_eq!(calls.count(), 1);
}

#[test]
fn combine_derives_one_value_across_members() {
    let (group, popup, submenu) = menu();
    let view = group.combine({
        let (popup, submenu) = (popup.clone(), submenu.clone());
        move || (popup.matches(PopupState::Open), submenu.state())
    });
    assert_eq!(view.value(), (false, SubmenuState::Hidden));
    popup.send(PopupEvent::Focus);
    submenu.send(SubmenuEvent::Open);
    assert_eq!(view.value(), (true, SubmenuState::Shown));
}

#[test]
fn a_combined_subscription_fires_only_when_the_value_changes() {
    let (group, popup, submenu) = menu();
    let seen: Log<bool> = Log::default();
    let _ = group
        .combine({
            let popup = popup.clone();
            move || popup.matches(PopupState::Open)
        })
        .subscribe({
            let seen = seen.clone();
            move |open| seen.push(*open)
        });
    submenu.send(SubmenuEvent::Open); // a member changed, the value did not: silent
    assert!(seen.is_empty());
    popup.send(PopupEvent::Focus);
    assert_eq!(seen.entries(), [true]);
}

#[test]
fn a_combined_subscription_is_disposed_on_stop() {
    let (group, popup, _submenu) = menu();
    let calls = Calls::default();
    let _ = group
        .combine({
            let popup = popup.clone();
            move || popup.state()
        })
        .subscribe({
            let calls = calls.clone();
            move |_| calls.hit()
        });
    popup.send(PopupEvent::Focus);
    assert_eq!(calls.count(), 1);
    group.stop();
    popup.start();
    popup.send(PopupEvent::Escape);
    assert_eq!(calls.count(), 1);
}

/// A member that counts unsubscribes, to see whether a detach runs twice.
#[derive(Clone)]
struct CountingMember(Calls);

impl Member for CountingMember {
    fn start(&self) {}
    fn stop(&self) {}
    fn subscribe_any(&self, _listener: Rc<dyn Fn()>) -> Subscription {
        let unsubscribes = self.0.clone();
        Subscription::new(move || unsubscribes.hit())
    }
}

#[test]
fn stop_does_not_re_run_a_detach_already_run_by_hand() {
    let unsubscribes = Calls::default();
    let member = CountingMember(unsubscribes.clone());
    let group = Composition::new().with(&member).with(&member);
    group.start();
    let sync = group.sync(|| {});
    let combined = group.combine(|| 0).subscribe(|_| {});
    sync.unsubscribe();
    combined.unsubscribe();
    assert_eq!(unsubscribes.count(), 4); // one per member per subscription
    group.stop();
    assert_eq!(unsubscribes.count(), 4);
}

#[test]
fn a_damped_cross_member_forward_converges_with_linear_sync_calls() {
    // `sync` wakes on every member, including the one it sends to, so the rule must damp
    // its own forward (send only while b is behind a).
    let a = build(&mut counter());
    let b = build(&mut counter());
    let group = Composition::new().with(&a).with(&b);
    group.start();
    let calls = Calls::default();
    let _ = group.sync({
        let (a, b, calls) = (a.clone(), b.clone(), calls.clone());
        move || {
            calls.hit();
            if a.context().n > b.context().n {
                b.send(CounterEvent::Inc);
            }
        }
    });
    const OPS: usize = 200;
    for _ in 0..OPS {
        a.send(CounterEvent::Inc);
    }
    assert_eq!(a.context().n, OPS as i32);
    assert_eq!(b.context().n, OPS as i32);
    assert_eq!(calls.count(), OPS * 2); // one wake from a, one from b, per send
}

#[test]
fn a_combined_listener_may_send_to_a_member() {
    let (group, popup, submenu) = menu();
    let seen: Log<(bool, SubmenuState)> = Log::default();
    let _ = group
        .combine({
            let (popup, submenu) = (popup.clone(), submenu.clone());
            move || (popup.matches(PopupState::Open), submenu.state())
        })
        .subscribe({
            let (submenu, seen) = (submenu.clone(), seen.clone());
            move |value| {
                seen.push(*value);
                if *value == (true, SubmenuState::Hidden) {
                    submenu.send(SubmenuEvent::Open); // the member notifies at once
                }
            }
        });
    popup.send(PopupEvent::Focus);
    assert_eq!(
        seen.entries(),
        [(true, SubmenuState::Hidden), (true, SubmenuState::Shown)]
    );
}
