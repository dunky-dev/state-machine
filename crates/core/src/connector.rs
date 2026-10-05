use std::cell::RefCell;
use std::rc::{Rc, Weak};

use crate::broadcast::{Broadcast, Subscription};
use crate::machine::{Machine, Sender};
use crate::params::View;
use crate::traits::Types;

/// What a connect() reads: the live machine plus the consumer props.
pub struct ConnectSnapshot<'a, T: Types, P> {
    pub view: View<'a, T>,
    pub props: &'a P,
    pub sender: Sender<T>,
}

type SetupReaction<T, P> = Rc<dyn Fn(&Machine<T>, Weak<RefCell<P>>) -> Subscription>;

/// "A selected machine value" → "a consumer callback", wired on start, torn down on stop.
pub struct Reaction<T: Types, P> {
    setup: SetupReaction<T, P>,
}

impl<T: Types, P: 'static> Reaction<T, P> {
    pub fn new<V: PartialEq + 'static>(
        selector: impl Fn(&View<'_, T>) -> V + 'static,
        callback: impl Fn(&V, &P) + 'static,
    ) -> Self {
        let selector = Rc::new(selector);
        let callback = Rc::new(callback);
        Self {
            setup: Rc::new(move |machine: &Machine<T>, props: Weak<RefCell<P>>| {
                let selector = selector.clone();
                let callback = callback.clone();
                machine
                    .select(move |v| selector(v))
                    .subscribe(move |value| {
                        if let Some(props) = props.upgrade() {
                            callback(value, &props.borrow());
                        }
                    })
            }),
        }
    }
}

type ConnectFn<T, P, A> = Box<dyn Fn(&ConnectSnapshot<'_, T, P>) -> A>;

struct ConnectorInner<T: Types, P, A> {
    machine: Machine<T>,
    connect: ConnectFn<T, P, A>,
    props: Rc<RefCell<P>>,
    cached: RefCell<Option<Rc<A>>>,
    bus: Rc<Broadcast>,
    reactions: Vec<Reaction<T, P>>,
    reaction_subs: RefCell<Vec<Subscription>>,
    machine_subs: RefCell<Vec<Subscription>>,
}

/// The view boundary: a memoized view surface over a machine + props. Passive — the
/// bridge owns the machine's lifecycle.
pub struct Connector<T: Types, P, A>(Rc<ConnectorInner<T, P, A>>);

impl<T: Types, P: PartialEq + 'static, A: 'static> Connector<T, P, A> {
    pub fn new(
        machine: &Machine<T>,
        connect: impl Fn(&ConnectSnapshot<'_, T, P>) -> A + 'static,
        props: P,
        reactions: Vec<Reaction<T, P>>,
    ) -> Self {
        let inner = Rc::new(ConnectorInner {
            machine: machine.clone(),
            connect: Box::new(connect),
            props: Rc::new(RefCell::new(props)),
            cached: RefCell::new(None),
            bus: Broadcast::new(),
            reactions,
            reaction_subs: RefCell::new(Vec::new()),
            machine_subs: RefCell::new(Vec::new()),
        });
        let weak = Rc::downgrade(&inner);
        let wake = machine.subscribe({
            let weak = weak.clone();
            move || {
                if let Some(c) = weak.upgrade() {
                    c.wake();
                }
            }
        });
        let on_start = machine.on_start({
            let weak = weak.clone();
            move || {
                let Some(c) = weak.upgrade() else { return };
                let subs: Vec<Subscription> = c
                    .reactions
                    .iter()
                    .map(|r| (r.setup)(&c.machine, Rc::downgrade(&c.props)))
                    .collect();
                c.reaction_subs.borrow_mut().extend(subs);
            }
        });
        let on_stop = machine.on_stop(move || {
            if let Some(c) = weak.upgrade() {
                for s in c.reaction_subs.borrow_mut().drain(..) {
                    s.unsubscribe();
                }
            }
        });
        inner
            .machine_subs
            .borrow_mut()
            .extend([wake, on_start, on_stop]);
        Self(inner)
    }

    /// The memoized connect() output: the same `Rc` while machine and props are unchanged.
    pub fn snapshot(&self) -> Rc<A> {
        if let Some(cached) = self.0.cached.borrow().as_ref() {
            return cached.clone();
        }
        let api = {
            let inner = &self.0.machine.0;
            let core = inner.core.borrow();
            let props = self.0.props.borrow();
            let snap = ConnectSnapshot {
                view: View { core: &core, inner },
                props: &*props,
                sender: self.0.machine.sender(),
            };
            Rc::new((self.0.connect)(&snap))
        };
        *self.0.cached.borrow_mut() = Some(api.clone());
        api
    }

    pub fn subscribe(&self, listener: impl Fn() + 'static) -> Subscription {
        self.0.bus.add(Rc::new(listener))
    }

    /// Update the consumer props. Equal props change nothing.
    pub fn set_props(&self, props: P) {
        if *self.0.props.borrow() == props {
            return;
        }
        *self.0.props.borrow_mut() = props;
        self.0.wake();
    }

    /// Detach from the machine (only needed when discarding the connector on its own).
    pub fn destroy(&self) {
        for s in self.0.machine_subs.borrow_mut().drain(..) {
            s.unsubscribe();
        }
        for s in self.0.reaction_subs.borrow_mut().drain(..) {
            s.unsubscribe();
        }
        self.0.bus.clear();
    }
}

impl<T: Types, P, A> ConnectorInner<T, P, A> {
    fn wake(&self) {
        *self.cached.borrow_mut() = None;
        self.bus.notify();
    }
}
