use std::cell::RefCell;
use std::rc::Rc;

use crate::broadcast::{ALL, Subscription};
use crate::machine::Machine;
use crate::params::View;
use crate::traits::Types;

type Selector<T, V> = Rc<dyn Fn(&View<'_, T>) -> V>;

/// A narrowed, value-deduped view of a machine.
pub struct Selection<T: Types, V> {
    machine: Machine<T>,
    selector: Selector<T, V>,
    /// The change bits that can change the value; other notifications skip it.
    wake: u64,
}

impl<T: Types, V> Clone for Selection<T, V> {
    fn clone(&self) -> Self {
        Self {
            machine: self.machine.clone(),
            selector: self.selector.clone(),
            wake: self.wake,
        }
    }
}

impl<T: Types, V: 'static> Selection<T, V> {
    pub(crate) fn new(machine: Machine<T>, selector: Selector<T, V>) -> Self {
        Self::waking(machine, selector, ALL)
    }

    /// A selection whose value can change only on the change bits in `wake`.
    pub(crate) fn waking(machine: Machine<T>, selector: Selector<T, V>, wake: u64) -> Self {
        Self {
            machine,
            selector,
            wake,
        }
    }

    /// The current selected value, evaluated on read.
    pub fn value(&self) -> V {
        let inner = &self.machine.0;
        let core = inner.core.borrow();
        (self.selector)(&View { core: &core, inner })
    }

    /// Fire `listener(value)` only when the selected value changes (`==`). Never fires on
    /// subscribe.
    pub fn subscribe(&self, listener: impl Fn(&V) + 'static) -> Subscription
    where
        V: PartialEq,
    {
        self.subscribe_with(listener, |a: &V, b: &V| a == b)
    }

    /// Like [`Selection::subscribe`] with a custom equality.
    pub fn subscribe_with(
        &self,
        listener: impl Fn(&V) + 'static,
        equals: impl Fn(&V, &V) -> bool + 'static,
    ) -> Subscription {
        let inner = &self.machine.0;
        // Seed at subscribe. If the machine is mid-action (core borrowed), seed on the
        // first wake instead.
        let seed = inner
            .core
            .try_borrow()
            .ok()
            .map(|core| (self.selector)(&View { core: &core, inner }));
        // `Rc` so the listener runs with no borrow of `prev` held: it may patch the machine,
        // which notifies (and re-enters this wake) before the listener returns.
        let prev: RefCell<Option<Rc<V>>> = RefCell::new(seed.map(Rc::new));
        let selector = self.selector.clone();
        let weak = Rc::downgrade(inner);
        // Unseeded, it must take its first wake whatever changed, or it would seed on the
        // change it should report.
        let wake = if prev.borrow().is_some() {
            self.wake
        } else {
            ALL
        };
        inner.bus().add_waking(
            wake,
            Rc::new(move || {
                let Some(inner) = weak.upgrade() else { return };
                let next = {
                    let core = inner.core.borrow();
                    selector(&View {
                        core: &core,
                        inner: &inner,
                    })
                };
                let seeded = match prev.borrow().as_deref() {
                    Some(old) if equals(old, &next) => return,
                    Some(_) => true,
                    None => false,
                };
                let current = {
                    let mut slot = prev.borrow_mut();
                    // Nobody else holds the last value (no listener of this wake still runs):
                    // overwrite it in place, so a steady stream of changes allocates nothing.
                    match slot.as_mut().and_then(Rc::get_mut) {
                        Some(old) => *old = next,
                        None => *slot = Some(Rc::new(next)),
                    }
                    slot.clone().expect("value just set")
                };
                if seeded {
                    listener(&current);
                }
            }),
        )
    }
}
