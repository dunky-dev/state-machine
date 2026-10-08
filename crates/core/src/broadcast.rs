use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

type Listener = Rc<dyn Fn()>;

/// Wakes on every notification.
pub(crate) const ALL: u64 = u64::MAX;

/// Payload-less one-to-all notify.
///
/// Steady-state notifies allocate nothing: iteration runs over a cached snapshot, rebuilt
/// only when membership changes. Mid-pass (un)subscribes still take effect within the pass —
/// a dirty flag flips iteration to membership-checked mode, and a swapped snapshot (from a
/// nested notify) counts as mid-pass churn too.
pub(crate) struct Broadcast {
    /// Per listener: its id, the change bits it wakes on, and the listener.
    listeners: RefCell<Vec<(u64, u64, Listener)>>,
    snapshot: RefCell<Rc<[(u64, u64, Listener)]>>,
    /// Bumped each time the snapshot is rebuilt, so a pass sees a nested rebuild with one
    /// load per listener.
    generation: Cell<u64>,
    dirty: Cell<bool>,
    next_id: Cell<u64>,
}

impl Broadcast {
    pub(crate) fn new() -> Rc<Self> {
        Rc::new(Self {
            listeners: RefCell::new(Vec::new()),
            snapshot: RefCell::new(Rc::from(Vec::new())),
            generation: Cell::new(0),
            dirty: Cell::new(false),
            next_id: Cell::new(0),
        })
    }

    pub(crate) fn add(self: &Rc<Self>, listener: Listener) -> Subscription {
        self.add_waking(ALL, listener)
    }

    /// A listener that skips notifications whose change bits miss `wake` (a selection of
    /// one field cannot change when another field does). Order stays subscription order.
    pub(crate) fn add_waking(self: &Rc<Self>, wake: u64, listener: Listener) -> Subscription {
        let id = self.next_id.get();
        self.next_id.set(id + 1);
        self.listeners.borrow_mut().push((id, wake, listener));
        self.dirty.set(true);
        let weak: Weak<Self> = Rc::downgrade(self);
        Subscription::new(move || {
            if let Some(bus) = weak.upgrade() {
                bus.remove(id);
            }
        })
    }

    fn remove(&self, id: u64) {
        let mut listeners = self.listeners.borrow_mut();
        if let Some(pos) = listeners.iter().position(|(i, _, _)| *i == id) {
            listeners.remove(pos);
            self.dirty.set(true);
        }
    }

    fn has(&self, id: u64) -> bool {
        self.listeners.borrow().iter().any(|(i, _, _)| *i == id)
    }

    pub(crate) fn notify(&self) {
        self.notify_changed(ALL);
    }

    /// Notify the listeners whose wake bits meet `changed`.
    pub(crate) fn notify_changed(&self, changed: u64) {
        if self.dirty.get() {
            let fresh: Rc<[(u64, u64, Listener)]> =
                self.listeners.borrow().iter().cloned().collect();
            *self.snapshot.borrow_mut() = fresh;
            self.generation.set(self.generation.get() + 1);
            self.dirty.set(false);
        }
        let snap = self.snapshot.borrow().clone();
        let generation = self.generation.get();
        for (id, wake, listener) in snap.iter() {
            if wake & changed == 0 {
                continue;
            }
            let undisturbed = !self.dirty.get() && self.generation.get() == generation;
            if undisturbed || self.has(*id) {
                listener();
            }
        }
    }

    pub(crate) fn clear(&self) {
        self.listeners.borrow_mut().clear();
        self.dirty.set(true);
    }

    pub(crate) fn len(&self) -> usize {
        self.listeners.borrow().len()
    }
}

/// A live subscription. Call [`Subscription::unsubscribe`] to detach; dropping the handle
/// does NOT detach (like the bare unsubscribe function the TS API returns).
#[must_use = "dropping a Subscription keeps the listener attached; call unsubscribe() to detach"]
pub struct Subscription {
    off: Option<Box<dyn FnOnce()>>,
}

impl Subscription {
    /// A subscription whose `unsubscribe` runs `off` (for custom [`Member`](crate::Member)
    /// implementations).
    pub fn new(off: impl FnOnce() + 'static) -> Self {
        Self {
            off: Some(Box::new(off)),
        }
    }
    pub fn unsubscribe(mut self) {
        if let Some(off) = self.off.take() {
            off();
        }
    }
}

impl std::fmt::Debug for Subscription {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Subscription")
    }
}
