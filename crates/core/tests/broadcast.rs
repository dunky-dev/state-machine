//! The notify bus behind `Machine::subscribe` (and the connector's wake): who fires in
//! the pass where membership changes. The bus is private, so it is driven through the
//! machine.
//!
//! Not ported:
//! - "the remover detaches; removing twice is harmless": `Subscription::unsubscribe`
//!   consumes the handle, so a second removal does not compile; detaching is pinned in
//!   subscribe.rs.
//!
//! Port note: "clear() drops everyone at once" goes through `Connector::destroy`, the only
//! public path that clears a bus.

mod common;

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use common::{Count, CounterEvent, Log, build, counter};
use dunky_state_machine::{Connector, Subscription};

/// A slot for a subscription made after the listener that will remove it.
type Slot = Rc<RefCell<Option<Subscription>>>;

fn unsubscribe(slot: &Slot) {
    if let Some(sub) = slot.borrow_mut().take() {
        sub.unsubscribe();
    }
}

#[test]
fn a_change_wakes_every_listener_in_subscription_order() {
    let m = build(&mut counter());
    let log = Log::default();
    let _ = m.subscribe(log.listener("a"));
    let _ = m.subscribe(log.listener("b"));
    assert!(log.is_empty());
    m.send(CounterEvent::Inc);
    assert_eq!(log.entries(), ["a", "b"]);
}

#[test]
fn a_listener_removed_mid_pass_does_not_fire_in_that_pass() {
    let m = build(&mut counter());
    let log = Log::default();
    let off_b = Slot::default();
    let _ = m.subscribe({
        let (log, off_b) = (log.clone(), off_b.clone());
        move || {
            log.push("a");
            unsubscribe(&off_b);
        }
    });
    *off_b.borrow_mut() = Some(m.subscribe(log.listener("b")));
    m.send(CounterEvent::Inc);
    assert_eq!(log.entries(), ["a"]);
    m.send(CounterEvent::Inc);
    assert_eq!(log.entries(), ["a", "a"]);
}

#[test]
fn a_listener_added_mid_pass_waits_for_the_next_notify() {
    let m = build(&mut counter());
    let log = Log::default();
    let added = Cell::new(false);
    let _ = m.subscribe({
        let (m, log) = (m.clone(), log.clone());
        move || {
            log.push("a");
            if !added.replace(true) {
                let _ = m.subscribe(log.listener("late"));
            }
        }
    });
    m.send(CounterEvent::Inc);
    assert_eq!(log.entries(), ["a"]);
    m.send(CounterEvent::Inc);
    assert_eq!(log.entries(), ["a", "a", "late"]);
}

#[test]
fn a_nested_notify_does_not_resurrect_a_listener_removed_in_the_outer_pass() {
    let m = build(&mut counter());
    let log = Log::default();
    let off_b = Slot::default();
    let nested = Cell::new(false);
    let _ = m.subscribe({
        let (m, log, off_b) = (m.clone(), log.clone(), off_b.clone());
        move || {
            log.push("a");
            if !nested.replace(true) {
                unsubscribe(&off_b);
                m.set_context(Count::patch().n(99)); // notifies while the outer pass runs
            }
        }
    });
    *off_b.borrow_mut() = Some(m.subscribe(log.listener("b")));
    m.send(CounterEvent::Inc);
    assert_eq!(log.entries(), ["a", "a"]); // b fired in neither pass
}

#[test]
fn clearing_drops_every_listener_at_once() {
    let m = build(&mut counter());
    let c = Connector::new(&m, |snap| snap.view.context().n, 0, Vec::new());
    let log = Log::default();
    let _ = c.subscribe(log.listener("a"));
    let _ = c.subscribe(log.listener("b"));
    c.destroy();
    c.set_props(1); // a props change wakes the connector's own bus
    assert!(log.is_empty());
}
