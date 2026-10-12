//! Store: a tiny reactive cell for state shared between machine instances. Updates
//! shallow-merge and notify only on an actual change.
//!
//! Not ported:
//! - "builder adds named methods alongside the base, with store access": a JS builder
//!   API; in Rust, domain methods are ordinary functions or impls over a `Store`.

mod common;

use std::cell::RefCell;
use std::rc::Rc;

use common::{Calls, Count, Log};
use dunky_state_machine::{Context, Store, Subscription};

#[derive(Clone, Debug, PartialEq, Context)]
struct Pair {
    a: i32,
    b: i32,
}

#[test]
fn set_and_update_shallow_merge() {
    let store = Store::new(Pair { a: 1, b: 2 });
    assert_eq!(*store.get(), Pair { a: 1, b: 2 });
    store.set(Pair::patch().a(9));
    assert_eq!(*store.get(), Pair { a: 9, b: 2 });
    store.update(|s| Pair::patch().b(s.b + 1));
    assert_eq!(*store.get(), Pair { a: 9, b: 3 });
}

#[test]
fn subscribe_fires_on_a_change_but_not_on_subscribe() {
    let store = Store::new(Count { n: 0 });
    let calls = Calls::default();
    let sub = store.subscribe({
        let calls = calls.clone();
        move |_| calls.hit()
    });
    assert_eq!(calls.count(), 0);
    store.set(Count::patch().n(1));
    assert_eq!(calls.count(), 1);
    sub.unsubscribe();
    store.set(Count::patch().n(2));
    assert_eq!(calls.count(), 1);
}

#[test]
fn an_effective_set_yields_a_fresh_value() {
    let store = Store::new(Count { n: 0 });
    let before = store.get();
    store.set(Count::patch().n(1));
    assert!(!Rc::ptr_eq(&before, &store.get()));
}

#[test]
fn a_listener_unsubscribed_mid_notify_does_not_fire_in_that_pass() {
    let store = Store::new(Count { n: 0 });
    let log: Log = Log::default();
    let off_b: Rc<RefCell<Option<Subscription>>> = Rc::default();
    let _ = store.subscribe({
        let (log, off_b) = (log.clone(), off_b.clone());
        move |_| {
            log.push("a");
            if let Some(sub) = off_b.borrow_mut().take() {
                sub.unsubscribe();
            }
        }
    });
    *off_b.borrow_mut() = Some(store.subscribe({
        let log = log.clone();
        move |_| log.push("b")
    }));
    store.set(Count::patch().n(1));
    assert_eq!(log.entries(), ["a"]);
}

#[test]
fn a_set_that_changes_nothing_is_silent() {
    let store = Store::new(Count { n: 5 });
    let calls = Calls::default();
    let _ = store.subscribe({
        let calls = calls.clone();
        move |_| calls.hit()
    });
    store.set(Count::patch().n(5));
    assert_eq!(calls.count(), 0);
    store.set(Count::patch().n(6));
    assert_eq!(calls.count(), 1);
}
