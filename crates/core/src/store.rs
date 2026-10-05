use std::cell::RefCell;
use std::rc::Rc;

use crate::broadcast::{Broadcast, Subscription};
use crate::traits::Context;

/// A tiny reactive cell for state shared between machine instances ("only one tooltip
/// open at a time"). Updates shallow-merge and notify only on an actual change.
pub struct Store<S: Context> {
    state: Rc<RefCell<Rc<S>>>,
    bus: Rc<Broadcast>,
}

impl<S: Context> Clone for Store<S> {
    fn clone(&self) -> Self {
        Self {
            state: self.state.clone(),
            bus: self.bus.clone(),
        }
    }
}

impl<S: Context> Store<S> {
    pub fn new(initial: S) -> Self {
        Self {
            state: Rc::new(RefCell::new(Rc::new(initial))),
            bus: Broadcast::new(),
        }
    }

    /// The current value. Each effective update yields a fresh `Rc`, so identity change
    /// is the change signal.
    pub fn get(&self) -> Rc<S> {
        self.state.borrow().clone()
    }

    pub fn set(&self, patch: S::Patch) {
        let changed = {
            let mut state = self.state.borrow_mut();
            let mut next = (**state).clone();
            if next.apply(patch) == 0 {
                false
            } else {
                *state = Rc::new(next);
                true
            }
        };
        if changed {
            self.bus.notify();
        }
    }

    pub fn update(&self, f: impl FnOnce(&S) -> S::Patch) {
        let patch = f(&self.get());
        self.set(patch);
    }

    /// Fires on every later change (not on subscribe).
    pub fn subscribe(&self, listener: impl Fn(&Rc<S>) + 'static) -> Subscription {
        let state = self.state.clone();
        self.bus.add(Rc::new(move || {
            let value = state.borrow().clone();
            listener(&value);
        }))
    }
}
