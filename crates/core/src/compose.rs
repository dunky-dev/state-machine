use std::cell::RefCell;
use std::rc::Rc;

use crate::broadcast::Subscription;
use crate::machine::Machine;
use crate::traits::Types;

/// The lifecycle + observation surface a composition needs from any machine.
pub trait Member {
    fn start(&self);
    fn stop(&self);
    fn subscribe_any(&self, listener: Rc<dyn Fn()>) -> Subscription;
}

impl<T: Types> Member for Machine<T> {
    fn start(&self) {
        Machine::start(self)
    }
    fn stop(&self) {
        Machine::stop(self)
    }
    fn subscribe_any(&self, listener: Rc<dyn Fn()>) -> Subscription {
        self.subscribe(move || listener())
    }
}

type Registry = Rc<RefCell<Vec<(u64, Vec<Subscription>)>>>;

/// Several machines run as one unit (orthogonal regions): shared start/stop plus
/// cross-member `sync` and `combine`. Members stay independent — keep your own handles
/// to read and send to each.
pub struct Composition {
    members: Vec<Rc<dyn Member>>,
    registry: Registry,
    next_id: RefCell<u64>,
}

impl Default for Composition {
    fn default() -> Self {
        Self::new()
    }
}

impl Composition {
    pub fn new() -> Self {
        Self {
            members: Vec::new(),
            registry: Rc::new(RefCell::new(Vec::new())),
            next_id: RefCell::new(0),
        }
    }

    /// Add a member. Members start in the order they are added.
    pub fn with<M: Member + Clone + 'static>(mut self, member: &M) -> Self {
        self.members.push(Rc::new(member.clone()));
        self
    }

    pub fn start(&self) {
        for m in &self.members {
            m.start();
        }
    }

    /// Dispose every sync/combine subscription, then stop members in reverse order.
    pub fn stop(&self) {
        let all = std::mem::take(&mut *self.registry.borrow_mut());
        for (_, subs) in all {
            for s in subs {
                s.unsubscribe();
            }
        }
        for m in self.members.iter().rev() {
            m.stop();
        }
    }

    fn register(&self, subs: Vec<Subscription>) -> Subscription {
        let id = {
            let mut next = self.next_id.borrow_mut();
            *next += 1;
            *next
        };
        self.registry.borrow_mut().push((id, subs));
        let registry = Rc::downgrade(&self.registry);
        Subscription::new(move || {
            let Some(registry) = registry.upgrade() else {
                return;
            };
            let found = {
                let mut reg = registry.borrow_mut();
                reg.iter()
                    .position(|(i, _)| *i == id)
                    .map(|pos| reg.remove(pos))
            };
            if let Some((_, subs)) = found {
                for s in subs {
                    s.unsubscribe();
                }
            }
        })
    }

    /// Run `reaction` whenever any member changes. Does not fire on setup; disposed on stop.
    pub fn sync(&self, reaction: impl Fn() + 'static) -> Subscription {
        let reaction: Rc<dyn Fn()> = Rc::new(reaction);
        let subs = self
            .members
            .iter()
            .map(|m| m.subscribe_any(reaction.clone()))
            .collect();
        self.register(subs)
    }

    /// A value-deduped derivation across members.
    pub fn combine<V: 'static>(&self, selector: impl Fn() -> V + 'static) -> Combined<'_, V> {
        Combined {
            composition: self,
            selector: Rc::new(selector),
        }
    }
}

/// A value-deduped selection across a composition's members.
pub struct Combined<'c, V> {
    composition: &'c Composition,
    selector: Rc<dyn Fn() -> V>,
}

impl<V: PartialEq + 'static> Combined<'_, V> {
    pub fn value(&self) -> V {
        (self.selector)()
    }

    /// Fires only when the combined value changes. Disposed with the composition's stop.
    pub fn subscribe(&self, listener: impl Fn(&V) + 'static) -> Subscription {
        let selector = self.selector.clone();
        // `Rc` so the listener runs with no borrow of `prev` held (it may send to a member,
        // which notifies and re-enters this wake).
        let prev = Rc::new(RefCell::new(Rc::new(selector())));
        let listener = Rc::new(listener);
        let wake: Rc<dyn Fn()> = Rc::new(move || {
            let next = selector();
            if **prev.borrow() == next {
                return;
            }
            let next = Rc::new(next);
            *prev.borrow_mut() = next.clone();
            listener(&next);
        });
        let subs = self
            .composition
            .members
            .iter()
            .map(|m| m.subscribe_any(wake.clone()))
            .collect();
        self.composition.register(subs)
    }
}
