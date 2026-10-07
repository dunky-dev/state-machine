use std::cell::RefCell;
use std::rc::Rc;

use crate::broadcast::Subscription;
use crate::machine::Machine;
use crate::params::View;
use crate::traits::Types;

type Selector<T, V> = Rc<dyn Fn(&View<'_, T>) -> V>;

/// A narrowed, value-deduped view of a machine.
pub struct Selection<T: Types, V> {
    machine: Machine<T>,
    selector: Selector<T, V>,
}

impl<T: Types, V> Clone for Selection<T, V> {
    fn clone(&self) -> Self {
        Self {
            machine: self.machine.clone(),
            selector: self.selector.clone(),
        }
    }
}

impl<T: Types, V: 'static> Selection<T, V> {
    pub(crate) fn new(machine: Machine<T>, selector: Selector<T, V>) -> Self {
        Self { machine, selector }
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
        inner.bus().add(Rc::new(move || {
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
            let next = Rc::new(next);
            *prev.borrow_mut() = Some(next.clone());
            if seeded {
                listener(&next);
            }
        }))
    }
}
