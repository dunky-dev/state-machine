use std::rc::Rc;

use crate::computed::{self, ComputedKey};
use crate::config::Guard;
use crate::machine::{Core, Inner, Item, Sender};
use crate::traits::{StateEnum, Types};

/// Everything an action (and an effect) can read and do.
pub struct ActionParams<'a, T: Types> {
    pub(crate) core: &'a mut Core<T>,
    pub(crate) inner: &'a Inner<T>,
    pub(crate) event: Option<&'a T::Event>,
}

impl<'a, T: Types> ActionParams<'a, T> {
    pub fn context(&self) -> &T::Context {
        &self.core.ctx
    }
    /// The event being processed. `None` is the `machine.init` marker: a boot effect on
    /// `start()`, or a data-reaction (a data change is not a domain event).
    pub fn event(&self) -> Option<&'a T::Event> {
        self.event
    }
    pub fn state(&self) -> T::State {
        self.core.state
    }
    /// Shallow-merge `patch` into the context. Observers are notified only if a field
    /// actually changed.
    pub fn set_context(&mut self, patch: <T::Context as crate::Context>::Patch) {
        let fields = self.core.patch(patch);
        if fields != 0 {
            self.inner.detect_watched(self.core, fields);
        }
    }
    /// Dispatch another event. It is queued and runs after the current one completes.
    pub fn send(&mut self, event: T::Event) {
        self.inner.queue.borrow_mut().push_back(Item::Event(event));
    }
    pub fn computed<V: 'static>(&self, key: ComputedKey<V>) -> Rc<V> {
        computed::downcast(
            computed::get(self.core, self.inner, key.id()),
            self.inner,
            key.id(),
        )
    }
    /// A handle that can send events later (e.g. from a store subscription in an effect).
    pub fn sender(&self) -> Sender<T> {
        Sender(self.inner.weak_self.clone())
    }
}

/// Everything a guard (and a named delay) can read.
pub struct GuardParams<'a, T: Types> {
    pub(crate) core: &'a Core<T>,
    pub(crate) inner: &'a Inner<T>,
    pub(crate) event: Option<&'a T::Event>,
}

impl<'a, T: Types> GuardParams<'a, T> {
    pub fn context(&self) -> &'a T::Context {
        &self.core.ctx
    }
    pub fn event(&self) -> Option<&'a T::Event> {
        self.event
    }
    pub fn state(&self) -> T::State {
        self.core.state
    }
    pub fn computed<V: 'static>(&self, key: ComputedKey<V>) -> Rc<V> {
        computed::downcast(
            computed::get(self.core, self.inner, key.id()),
            self.inner,
            key.id(),
        )
    }
    /// Evaluate another guard against these same params (for hand-written combinators).
    pub fn check(&self, guard: &Guard<T>) -> bool {
        crate::machine::eval_guard(guard, self)
    }
}

/// A read-only view of the machine, handed to selectors.
pub struct View<'a, T: Types> {
    pub(crate) core: &'a Core<T>,
    pub(crate) inner: &'a Inner<T>,
}

impl<'a, T: Types> View<'a, T> {
    pub fn state(&self) -> T::State {
        self.core.state
    }
    pub fn context(&self) -> &'a T::Context {
        &self.core.ctx
    }
    pub fn computed<V: 'static>(&self, key: ComputedKey<V>) -> Rc<V> {
        computed::downcast(
            computed::get(self.core, self.inner, key.id()),
            self.inner,
            key.id(),
        )
    }
    pub fn matches(&self, state: T::State) -> bool {
        self.core.state == state
    }
    pub fn has_tag(&self, tag: &str) -> bool {
        self.inner.config.0.states[self.core.state.index()]
            .tags
            .contains(&tag)
    }
}
