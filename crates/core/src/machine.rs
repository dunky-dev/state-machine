//! The live service: run-to-completion queue, transition resolution, lifecycle.
//!
//! Borrow discipline (the Rust shape of the TS engine's re-entrancy rules):
//! - Rust actions, guards, effects, delays and computed definitions run while the core is
//!   borrowed; they get params instead of the machine handle.
//! - Host callbacks (`External` guards/actions/effects/delays/computed — e.g. the JS
//!   functions of a TS-authored machine) run with no MUTABLE borrow held: they may read
//!   the machine, mark context changes ([`Machine::mark_changed`]) and send.
//! - Observers (subscribe, selections, lifecycle listeners, effect cleanups) run with NO
//!   borrow held, so they may read the machine, send to it, or patch it. Sends made while
//!   a flush is in progress are queued and run after the current item, never interleaved.

use std::any::Any;
use std::cell::{Cell, OnceCell, Ref, RefCell};
use std::collections::VecDeque;
use std::rc::{Rc, Weak};

use crate::broadcast::{Broadcast, Subscription};
use crate::computed::{self, ComputedKey, ComputedParams, ComputedRuntime};
use crate::config::{
    Action, Cleanup, Config, Delay, Effect, Entry, Guard, Transition, WatchSource, missing,
};
use crate::params::{ActionParams, GuardParams, View};
use crate::selection::Selection;
use crate::timers::{Command, TimerId};
use crate::traits::{Context, EventEnum, StateEnum, Types};

/// Runaway guard for one flush. A real chain is a handful of items; thousands means a
/// feedback loop (a watcher writing what it watches, actions sending in a cycle).
const MAX_FLUSH: u32 = 10_000;

/// The binding that runs a machine's `External` parts — e.g. the JS functions of a
/// TS-authored machine — and hears about its changes. On a failure (a JS exception) the
/// host keeps the error, returns a placeholder, and raises the machine's halt flag
/// ([`Machine::halt_flag`]); the engine then stops the current step and the binding
/// rethrows.
///
/// Part of the binding API (cargo feature `host`).
#[cfg_attr(not(feature = "host"), allow(dead_code))]
pub trait Host<T: Types> {
    fn guard(&self, id: u32, event: Option<&T::Event>) -> bool;
    fn action(&self, id: u32, event: Option<&T::Event>);
    /// Start an effect; return its cleanup, if any.
    fn effect(&self, id: u32, event: Option<&T::Event>) -> Option<Cleanup>;
    fn delay(&self, id: u32, event: Option<&T::Event>) -> u32;
    /// Evaluate computed value `id`, reporting what it read through `params`.
    fn computed(&self, id: u32, params: &ComputedParams<'_, T>) -> Rc<dyn Any>;
    /// Evaluate the guards of candidate list `list` in order: the index of the first that
    /// passes (a candidate without a guard passes).
    fn pick(&self, list: u32, event: Option<&T::Event>) -> Option<usize>;
    /// Run the actions of list `list` in order, stopping at the first failure.
    fn actions(&self, list: u32, event: Option<&T::Event>);
    /// The machine changed (once per effective change, like a coarse subscriber), with
    /// no borrow held. `state` is the current state; `changes` is what changed since the
    /// previous notify. A host may hold a notification back to deliver it with its next
    /// callback, as long as it delivers it first and no later than [`Host::settle`].
    fn notify(&self, state: T::State, changes: Changes);
    /// A transition finished: deliver any notification held back.
    fn settle(&self);
}

pub(crate) enum Item<T: Types> {
    Event(T::Event),
    After {
        state: T::State,
        index: usize,
        event: Option<T::Event>,
        generation: u64,
    },
    Watch {
        index: usize,
    },
}

struct TimerRecord<T: Types> {
    id: TimerId,
    state: T::State,
    index: usize,
    event: Option<T::Event>,
    generation: u64,
}

pub(crate) struct Core<T: Types> {
    pub(crate) ctx: T::Context,
    pub(crate) state: T::State,
    pub(crate) running: bool,
    /// Bumped on every state entry; a timer scheduled under another generation is stale.
    entry_counter: u64,
    state_cleanups: Vec<Cleanup>,
    timers: Vec<TimerRecord<T>>,
    next_timer_id: u32,
    commands: Vec<Command>,
    pub(crate) computed: ComputedRuntime,
    /// Machine-wide change counter; fields and the state are stamped with it when they change.
    pub(crate) tick: u64,
    /// Per field, the tick it last changed at; grown on first write, so a machine pays
    /// only for the fields it writes.
    pub(crate) field_changed_at: Vec<u64>,
    pub(crate) state_changed_at: u64,
    /// Effective changes made inside the current borrow; drained into notifications.
    pending_notifies: u32,
    /// What those changes touched, for the host's next notify.
    notify_changes: Changes,
    /// Changes since the last `take_changes()`, for bindings.
    changed_fields: u64,
    changed_state: bool,
}

impl<T: Types> Core<T> {
    /// Apply `patch`; return the mask of the fields that actually changed.
    pub(crate) fn patch(&mut self, patch: <T::Context as Context>::Patch) -> u64 {
        let mask = self.ctx.apply(patch);
        self.mark_fields(mask);
        mask
    }

    /// Stamp the fields in `mask` as changed now and owe one notification.
    fn mark_fields(&mut self, mask: u64) {
        if mask == 0 {
            return;
        }
        self.stamp_fields(mask);
        self.changed_fields |= mask;
        self.notify_changes.fields |= mask;
        self.pending_notifies += 1;
    }

    /// Stamp the fields in `mask` as changed now.
    fn stamp_fields(&mut self, mask: u64) {
        self.tick += 1;
        let top = 64 - mask.leading_zeros() as usize;
        if self.field_changed_at.len() < top {
            self.field_changed_at.resize(top, 0);
        }
        let mut bits = mask;
        while bits != 0 {
            let i = bits.trailing_zeros() as usize;
            self.field_changed_at[i] = self.tick;
            bits &= bits - 1;
        }
    }

    fn set_state(&mut self, next: T::State) {
        self.state = next;
        self.tick += 1;
        self.state_changed_at = self.tick;
        self.changed_state = true;
        self.notify_changes.state = true;
        self.pending_notifies += 1;
    }
}

pub(crate) struct Inner<T: Types> {
    pub(crate) config: Config<T>,
    pub(crate) core: RefCell<Core<T>>,
    pub(crate) queue: RefCell<VecDeque<Item<T>>>,
    flushing: Cell<bool>,
    // Created on first use: a machine nobody subscribes to pays nothing.
    bus: OnceCell<Rc<Broadcast>>,
    /// Per watch: the change stamp a computed watch last saw (unused by field watches).
    watch_stamps: RefCell<Vec<u64>>,
    lifecycle: OnceCell<Rc<Broadcast>>,
    stop_listeners: OnceCell<Rc<Broadcast>>,
    host: OnceCell<Rc<dyn Host<T>>>,
    /// Context changes a host marked while the core was borrowed; applied at the next
    /// safe point.
    external_mask: Cell<u64>,
    /// The engine's own failure (a feedback loop) when a host is attached.
    failure: RefCell<Option<String>>,
    /// The current step must stop: a host callback failed (the host raises it) or the
    /// engine did. Shared with the host, so a check is a load.
    halt: Rc<Cell<bool>>,
    pub(crate) weak_self: Weak<Inner<T>>,
}

/// A live machine service. Built stopped; [`Machine::start`] boots effects and watchers,
/// [`Machine::stop`] runs their cleanups. Cloning shares the same service.
pub struct Machine<T: Types>(pub(crate) Rc<Inner<T>>);

impl<T: Types> Clone for Machine<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

/// A handle that sends events to a machine without keeping it alive.
pub struct Sender<T: Types>(pub(crate) Weak<Inner<T>>);

impl<T: Types> Clone for Sender<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl<T: Types> Sender<T> {
    /// Send `event` if the machine still exists. Returns whether it did.
    pub fn send(&self, event: T::Event) -> bool {
        match self.0.upgrade() {
            Some(inner) => {
                inner.queue.borrow_mut().push_back(Item::Event(event));
                inner.flush();
                true
            }
            None => false,
        }
    }
}

/// What changed since the last [`Machine::take_changes`]: a bit per context field, plus the state.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Changes {
    pub state: bool,
    pub fields: u64,
}

impl Changes {
    pub fn any(self) -> bool {
        self.state || self.fields != 0
    }
}

impl<T: Types> Machine<T> {
    /// Build a stopped service from `config`, with its own copy of the seed context.
    pub fn new(config: &Config<T>) -> Self {
        assert!(
            <T::Context as Context>::FIELDS.len() <= 64,
            "[machine] a context supports at most 64 fields"
        );
        let core = Core {
            ctx: config.0.context.clone(),
            state: config.0.initial,
            running: false,
            entry_counter: 0,
            state_cleanups: Vec::new(),
            timers: Vec::new(),
            next_timer_id: 1,
            commands: Vec::new(),
            computed: ComputedRuntime::new(config.0.computed.len()),
            tick: 0,
            field_changed_at: Vec::new(),
            state_changed_at: 0,
            pending_notifies: 0,
            notify_changes: Changes::default(),
            changed_fields: 0,
            changed_state: false,
        };
        Self(Rc::new_cyclic(|weak| Inner {
            config: config.clone(),
            core: RefCell::new(core),
            queue: RefCell::new(VecDeque::new()),
            flushing: Cell::new(false),
            bus: OnceCell::new(),
            watch_stamps: RefCell::new(vec![0; config.0.watch.len()]),
            lifecycle: OnceCell::new(),
            stop_listeners: OnceCell::new(),
            host: OnceCell::new(),
            external_mask: Cell::new(0),
            failure: RefCell::new(None),
            halt: Rc::new(Cell::new(false)),
            weak_self: weak.clone(),
        }))
    }

    /// Like [`Machine::new`], but seeds the context from `context` instead of the config's.
    pub fn with_context(config: &Config<T>, context: T::Context) -> Self {
        let m = Self::new(config);
        m.0.core.borrow_mut().ctx = context;
        m
    }

    /// Attach the host that runs this machine's `External` parts. A machine has one host
    /// for life: returns false when it already has one.
    #[cfg(feature = "host")]
    pub fn set_host(&self, host: Rc<dyn Host<T>>) -> bool {
        self.0.host.set(host).is_ok()
    }

    pub fn config(&self) -> &Config<T> {
        &self.0.config
    }

    pub fn state(&self) -> T::State {
        self.0.core.borrow().state
    }

    /// Borrow the live context. Do not hold the guard across `send`.
    pub fn context(&self) -> Ref<'_, T::Context> {
        Ref::map(self.0.core.borrow(), |c| &c.ctx)
    }

    pub fn computed<V: 'static>(&self, key: ComputedKey<V>) -> Rc<V> {
        let core = self.0.core.borrow();
        computed::downcast(computed::get(&core, &self.0, key.id()), &self.0, key.id())
    }

    /// The type-erased value of computed `id` (for bindings that know the type elsewhere).
    pub fn computed_any(&self, id: usize) -> Rc<dyn Any> {
        let core = self.0.core.borrow();
        computed::get(&core, &self.0, id)
    }

    /// A version stamp for computed `id`: it changes exactly when the value changes.
    pub fn computed_version(&self, id: usize) -> u64 {
        let core = self.0.core.borrow();
        computed::changed_at(&core, &self.0, id)
    }

    pub fn matches(&self, state: T::State) -> bool {
        self.state() == state
    }

    pub fn has_tag(&self, tag: &str) -> bool {
        let state = self.state();
        self.0.config.0.states[state.index()].tags.contains(&tag)
    }

    pub fn is_running(&self) -> bool {
        self.0.core.borrow().running
    }

    /// Dispatch an event. It runs to completion before the next queued item.
    pub fn send(&self, event: T::Event) {
        let inner = &*self.0;
        if inner.flushing.get() || !inner.queue.borrow().is_empty() {
            inner.queue.borrow_mut().push_back(Item::Event(event));
            inner.flush();
            return;
        }
        // Idle: run it now, then whatever it queued — no trip through the queue.
        inner.flushing.set(true);
        let reset = FlushReset(&inner.flushing, false);
        inner.process(Item::Event(event));
        drop(reset);
        inner.flush();
    }

    /// Shallow-merge `patch` into the context (bridges use this to refresh prop-seeded
    /// context). Observers are notified only if a field actually changed.
    pub fn set_context(&self, patch: <T::Context as Context>::Patch) {
        self.0.with_flush(|inner| {
            let fields = inner.core.borrow_mut().patch(patch);
            if fields != 0 {
                inner.detect_watched(&inner.core.borrow(), fields);
            }
            inner.drain_notifies();
        });
    }

    /// A host changed fields of a context it owns (a TS machine's JS context): stamp them
    /// and run the watchers — right away when possible, else at the next safe point. The
    /// host notifies its own observers of the write.
    #[cfg(feature = "host")]
    pub fn mark_changed(&self, mask: u64) {
        if mask == 0 {
            return;
        }
        let inner = &*self.0;
        let applied = match inner.core.try_borrow_mut() {
            Ok(mut core) => {
                core.stamp_fields(mask);
                true
            }
            Err(_) => false,
        };
        if !applied {
            inner.external_mask.set(inner.external_mask.get() | mask);
            return;
        }
        inner.with_flush(|inner| {
            if let Ok(core) = inner.core.try_borrow() {
                inner.detect_watched(&core, mask);
            }
            inner.drain_notifies();
        });
    }

    /// The engine's own failure since the last call (a feedback loop), when a host is attached.
    #[cfg(feature = "host")]
    pub fn take_failure(&self) -> Option<String> {
        self.0.failure.borrow_mut().take()
    }

    /// The flag that stops the current step. A host raises it when a callback fails and
    /// lowers it once the binding has rethrown, before the next call.
    #[cfg(feature = "host")]
    pub fn halt_flag(&self) -> Rc<Cell<bool>> {
        self.0.halt.clone()
    }

    /// Coarse subscription: fires on any later change (state or context), never on subscribe.
    pub fn subscribe(&self, listener: impl Fn() + 'static) -> Subscription {
        self.0.bus().add(Rc::new(listener))
    }

    /// A value-deduped view of anything the machine exposes.
    pub fn select<V: 'static>(
        &self,
        selector: impl Fn(&View<'_, T>) -> V + 'static,
    ) -> Selection<T, V> {
        Selection::new(self.clone(), Rc::new(selector))
    }

    pub fn select_state(&self) -> Selection<T, T::State> {
        self.select(|v| v.state())
    }

    pub fn select_computed<V: 'static>(&self, key: ComputedKey<V>) -> Selection<T, Rc<V>> {
        self.select(move |v| v.computed(key))
    }

    /// Boot the watchers and the CURRENT state's effects. No-op if already running.
    pub fn start(&self) {
        let inner = &*self.0;
        let started = inner.with_flush(|inner| {
            let state = {
                let mut core = inner.core.borrow_mut();
                if core.running {
                    return false;
                }
                core.running = true;
                core.state
            };
            inner.start_watchers();
            inner.start_effects(state, None);
            true
        });
        if started && !inner.aborted() {
            if let Some(listeners) = inner.lifecycle.get() {
                inner.with_flush(|_| listeners.notify());
            }
        }
    }

    /// Run every active effect's cleanup and dispose the watchers. Keeps state and context.
    pub fn stop(&self) {
        let inner = &*self.0;
        let stopped = inner.with_flush(|inner| {
            {
                let mut core = inner.core.borrow_mut();
                if !core.running {
                    return false;
                }
                core.running = false;
            }
            // Watchers need no teardown: they detect only while running, and a run
            // still queued is dropped when it comes up.
            inner.stop_effects();
            true
        });
        if stopped && !inner.aborted() {
            if let Some(listeners) = inner.stop_listeners.get() {
                inner.with_flush(|_| listeners.notify());
            }
        }
    }

    /// Fires on every `start()` — immediately if already running.
    pub fn on_start(&self, listener: impl Fn() + 'static) -> Subscription {
        let listener: Rc<dyn Fn()> = Rc::new(listener);
        let sub = self
            .0
            .lifecycle
            .get_or_init(Broadcast::new)
            .add(listener.clone());
        if self.is_running() {
            listener();
        }
        sub
    }

    /// Fires on every `stop()`.
    pub fn on_stop(&self, listener: impl Fn() + 'static) -> Subscription {
        self.0
            .stop_listeners
            .get_or_init(Broadcast::new)
            .add(Rc::new(listener))
    }

    /// Host callback: the timer `id` (from a [`Command::StartTimer`]) came due.
    pub fn fire_timer(&self, id: TimerId) {
        let item = {
            let mut core = self.0.core.borrow_mut();
            match core.timers.iter().position(|t| t.id == id) {
                Some(pos) => {
                    let t = core.timers.swap_remove(pos);
                    Item::After {
                        state: t.state,
                        index: t.index,
                        event: t.event,
                        generation: t.generation,
                    }
                }
                None => return, // cancelled or already fired
            }
        };
        self.0.queue.borrow_mut().push_back(item);
        self.0.flush();
    }

    /// Take the timer commands emitted since the last call. A host runs them.
    pub fn take_commands(&self) -> Vec<Command> {
        std::mem::take(&mut self.0.core.borrow_mut().commands)
    }

    pub fn has_commands(&self) -> bool {
        !self.0.core.borrow().commands.is_empty()
    }

    /// Take what changed since the last call (for bindings that mirror state elsewhere).
    pub fn take_changes(&self) -> Changes {
        let mut core = self.0.core.borrow_mut();
        let changes = Changes {
            state: core.changed_state,
            fields: core.changed_fields,
        };
        core.changed_state = false;
        core.changed_fields = 0;
        changes
    }

    pub fn sender(&self) -> Sender<T> {
        Sender(Rc::downgrade(&self.0))
    }

    /// Number of coarse subscribers (diagnostics).
    pub fn subscriber_count(&self) -> usize {
        self.0.bus.get().map_or(0, |bus| bus.len())
    }
}

impl<T: Types> Inner<T> {
    pub(crate) fn bus(&self) -> &Rc<Broadcast> {
        self.bus.get_or_init(Broadcast::new)
    }

    pub(crate) fn host(&self) -> Option<&Rc<dyn Host<T>>> {
        self.host.get()
    }

    /// The current step must stop: a host callback failed, or the engine itself did.
    pub(crate) fn aborted(&self) -> bool {
        self.halt.get()
    }

    /// Run `f` as part of a flush: re-entrant sends queue instead of nesting, and the queue
    /// drains after `f` unless an outer flush owns it.
    fn with_flush<R>(&self, f: impl FnOnce(&Self) -> R) -> R {
        let outer = self.flushing.replace(true);
        let reset = FlushReset(&self.flushing, outer);
        let result = f(self);
        drop(reset);
        if !outer {
            self.flush();
        }
        result
    }

    pub(crate) fn flush(&self) {
        if self.flushing.get() {
            return;
        }
        self.flushing.set(true);
        let _reset = FlushReset(&self.flushing, false);
        let mut ticks = 0u32;
        loop {
            if self.aborted() {
                break; // the binding rethrows; what is still queued stays queued
            }
            let item = self.queue.borrow_mut().pop_front();
            let Some(item) = item else { break };
            ticks += 1;
            if ticks > MAX_FLUSH {
                self.queue.borrow_mut().clear();
                let msg = format!(
                    "[machine] one flush exceeded {MAX_FLUSH} steps — feedback loop \
                     (e.g. a watcher writing the field it watches, or actions sending in a cycle)"
                );
                if self.host.get().is_some() {
                    *self.failure.borrow_mut() = Some(msg);
                    self.halt.set(true);
                    break;
                }
                if cfg!(debug_assertions) {
                    panic!("{msg}");
                }
            }
            self.process(item);
        }
    }

    fn process(&self, item: Item<T>) {
        match item {
            Item::Event(event) => {
                let kind = <T::Event as EventEnum>::kind_index(event.kind());
                let state = self.core.borrow().state;
                let Some(entry) = self.config.lookup(state, kind) else {
                    return;
                };
                if let Some(t) = self.resolve(entry, Some(&event)) {
                    self.apply(t, Some(&event));
                }
            }
            Item::After {
                state,
                index,
                event,
                generation,
            } => {
                {
                    let core = self.core.borrow();
                    if !core.running || core.entry_counter != generation {
                        return;
                    }
                }
                let entry = &self.config.0.states[state.index()].after[index].1;
                if let Some(t) = self.resolve(entry, event.as_ref()) {
                    self.apply(t, event.as_ref());
                }
            }
            Item::Watch { index } => {
                if self.core.borrow().running {
                    self.run_actions(&self.config.0.watch[index].actions, None);
                }
            }
        }
        self.absorb_external();
    }

    /// The first candidate whose guard passes.
    fn resolve<'c>(
        &self,
        entry: &'c Entry<T>,
        event: Option<&T::Event>,
    ) -> Option<&'c Transition<T>> {
        // The host evaluates the whole list in one call, with no borrow held.
        #[cfg(feature = "host")]
        if let Some(list) = entry.pick
            && let Some(host) = self.host()
        {
            let picked = host.pick(list, event);
            self.absorb_external();
            return if self.aborted() {
                None
            } else {
                picked.and_then(|i| entry.get(i))
            };
        }
        let picked = {
            let core = self.core.borrow();
            let params = GuardParams {
                core: &core,
                inner: self,
                event,
            };
            entry.iter().find(|t| {
                t.guard
                    .as_ref()
                    .is_none_or(|g| eval_guard(g, &params) && !self.aborted())
                    || self.aborted()
            })
        };
        if self.aborted() { None } else { picked }
    }

    fn apply(&self, t: &Transition<T>, event: Option<&T::Event>) {
        let cur = self.core.borrow().state;
        let next = t.target.unwrap_or(cur);
        self.apply_steps(t, event, cur, next);
        if next != cur
            && let Some(host) = self.host()
        {
            host.settle();
        }
    }

    fn apply_steps(
        &self,
        t: &Transition<T>,
        event: Option<&T::Event>,
        cur: T::State,
        next: T::State,
    ) {
        let running = self.core.borrow().running;
        let leaving = next != cur;
        let states = &self.config.0.states;
        if leaving {
            if running {
                self.stop_effects();
                if self.aborted() {
                    return;
                }
            }
            self.run_actions(&states[cur.index()].exit, event);
            if self.aborted() {
                return;
            }
        }
        self.run_actions(&t.actions, event);
        if self.aborted() {
            return;
        }
        if leaving {
            self.core.borrow_mut().set_state(next);
            self.detect_watched(&self.core.borrow(), 0);
            self.drain_notifies();
            self.run_actions(&states[next.index()].entry, event);
            if self.aborted() {
                return;
            }
            if self.core.borrow().running {
                self.start_effects(next, event);
            }
        }
    }

    pub(crate) fn run_actions(&self, actions: &[Action<T>], event: Option<&T::Event>) {
        for action in actions {
            self.run_action(action, event);
            if self.aborted() {
                return;
            }
        }
    }

    fn run_action(&self, action: &Action<T>, event: Option<&T::Event>) {
        match action {
            Action::Fn(f) => self.call_action(f, event),
            Action::Named(n) => match &n.imp {
                Some(f) => self.call_action(f, event),
                None => missing("action", n.name),
            },
            Action::OneOf(branches) => {
                let picked = {
                    let core = self.core.borrow();
                    let params = GuardParams {
                        core: &core,
                        inner: self,
                        event,
                    };
                    branches
                        .iter()
                        .find(|b| b.guard.as_ref().is_none_or(|g| eval_guard(g, &params)))
                };
                if self.aborted() {
                    return;
                }
                if let Some(branch) = picked {
                    self.run_actions(&branch.actions, event);
                }
            }
            #[cfg(feature = "host")]
            Action::External(id) => {
                // No borrow held: the host may read computed values, mark changes, send.
                if let Some(host) = self.host() {
                    host.action(*id, event);
                } else {
                    missing("action host for", &id.to_string());
                }
                self.absorb_external();
                self.drain_notifies();
            }
            #[cfg(feature = "host")]
            Action::ExternalList(list) => {
                if let Some(host) = self.host() {
                    host.actions(*list, event);
                } else {
                    missing("action host for list", &list.to_string());
                }
                self.absorb_external();
                self.drain_notifies();
            }
        }
    }

    fn call_action(&self, f: &crate::config::ActionFn<T>, event: Option<&T::Event>) {
        {
            let mut core = self.core.borrow_mut();
            let mut params = ActionParams {
                core: &mut core,
                inner: self,
                event,
            };
            f(&mut params);
        }
        self.drain_notifies();
    }

    /// Apply context changes a host marked while the core was borrowed.
    fn absorb_external(&self) {
        let mask = self.external_mask.replace(0);
        if mask == 0 {
            return;
        }
        self.core.borrow_mut().stamp_fields(mask);
        self.detect_watched(&self.core.borrow(), mask);
    }

    /// Deliver the notifications owed by the changes made in the last borrow — once per
    /// effective change, with no borrow held so observers can read and send.
    pub(crate) fn drain_notifies(&self) {
        let (n, state, mut changes) = {
            let mut core = self.core.borrow_mut();
            (
                std::mem::take(&mut core.pending_notifies),
                core.state,
                std::mem::take(&mut core.notify_changes),
            )
        };
        if n == 0 {
            return;
        }
        let host = self.host.get();
        let bus = self.bus.get();
        for _ in 0..n {
            if let Some(bus) = bus {
                bus.notify();
            }
            if let Some(host) = &host {
                host.notify(state, std::mem::take(&mut changes));
            }
        }
    }

    fn start_effects(&self, state: T::State, event: Option<&T::Event>) {
        let node = &self.config.0.states[state.index()];
        let generation = {
            let mut core = self.core.borrow_mut();
            core.entry_counter += 1;
            core.entry_counter
        };
        for (index, (delay, _)) in node.after.iter().enumerate() {
            let ms = match delay {
                Delay::Ms(ms) => *ms,
                Delay::Named(n) => match &n.imp {
                    Some(f) => f(&GuardParams {
                        core: &self.core.borrow(),
                        inner: self,
                        event,
                    }),
                    None => {
                        missing("delay", n.name);
                        0
                    }
                },
                #[cfg(feature = "host")]
                Delay::External(id) => match self.host() {
                    Some(host) => host.delay(*id, event),
                    None => {
                        missing("delay host for", &id.to_string());
                        0
                    }
                },
            };
            if self.aborted() {
                return;
            }
            let mut core = self.core.borrow_mut();
            let id = core.next_timer_id;
            core.next_timer_id = core.next_timer_id.wrapping_add(1).max(1);
            core.timers.push(TimerRecord {
                id,
                state,
                index,
                event: event.cloned(),
                generation,
            });
            core.commands.push(Command::StartTimer { id, ms });
        }
        for effect in &node.effects {
            let cleanup = match effect {
                Effect::Fn(f) => self.call_effect(f, event),
                Effect::Named(n) => match &n.imp {
                    Some(f) => self.call_effect(f, event),
                    None => {
                        missing("effect", n.name);
                        continue;
                    }
                },
                // No borrow held: the host may read computed values, mark changes, send.
                #[cfg(feature = "host")]
                Effect::External(id) => match self.host() {
                    Some(host) => host.effect(*id, event),
                    None => {
                        missing("effect host for", &id.to_string());
                        None
                    }
                },
            };
            if let Some(cleanup) = cleanup {
                self.core.borrow_mut().state_cleanups.push(cleanup);
            }
            self.absorb_external();
            self.drain_notifies();
            if self.aborted() {
                return;
            }
        }
    }

    fn call_effect(
        &self,
        f: &crate::config::EffectFn<T>,
        event: Option<&T::Event>,
    ) -> Option<Cleanup> {
        let mut core = self.core.borrow_mut();
        let mut params = ActionParams {
            core: &mut core,
            inner: self,
            event,
        };
        f(&mut params)
    }

    /// Cancel the state's timers and run its effect cleanups. A failing cleanup must not
    /// leak the others: finish the pass, then report the first failure (a Rust panic is
    /// resumed; a host failure is left for the binding to rethrow).
    fn stop_effects(&self) {
        let cleanups = {
            let mut core = self.core.borrow_mut();
            let core = &mut *core;
            if core.timers.is_empty() && core.state_cleanups.is_empty() {
                return;
            }
            for t in core.timers.drain(..) {
                core.commands.push(Command::CancelTimer { id: t.id });
            }
            std::mem::take(&mut core.state_cleanups)
        };
        let mut first_panic = None;
        for cleanup in cleanups {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(cleanup));
            if let Err(payload) = result {
                first_panic.get_or_insert(payload);
            }
        }
        if let Some(payload) = first_panic {
            std::panic::resume_unwind(payload);
        }
    }

    /// Seed each computed watch with its value's change stamp. A field watch needs no
    /// seed: a write's change mask names the fields it changed.
    fn start_watchers(&self) {
        let core = self.core.borrow();
        let mut stamps = Vec::with_capacity(self.config.0.watch.len());
        for watch in &self.config.0.watch {
            stamps.push(match watch.source {
                WatchSource::Computed(id) => computed::changed_at(&core, self, id),
                WatchSource::Field(_) => 0,
            });
        }
        *self.watch_stamps.borrow_mut() = stamps;
    }

    /// Watchers observe a change as it happens, like the TS selections they mirror: each
    /// write of a watched field, and each change of a watched computed value, queues that
    /// watch's run right away, in order with the sends around it (its actions are still
    /// deferred). `fields` is the write's change mask; a state switch passes 0, since
    /// only a computed value can observe it.
    pub(crate) fn detect_watched(&self, core: &Core<T>, fields: u64) {
        if !core.running || self.config.0.watch.is_empty() {
            return;
        }
        for (index, watch) in self.config.0.watch.iter().enumerate() {
            let changed = match watch.source {
                WatchSource::Field(field) => fields & (1u64 << field) != 0,
                WatchSource::Computed(id) => {
                    // The stamp moves exactly when the value changes (by `eq`).
                    let now = computed::changed_at(core, self, id);
                    let mut stamps = self.watch_stamps.borrow_mut();
                    let changed = stamps[index] != now;
                    stamps[index] = now;
                    changed
                }
            };
            if changed {
                self.queue.borrow_mut().push_back(Item::Watch { index });
            }
        }
    }
}

pub(crate) fn eval_guard<T: Types>(guard: &Guard<T>, params: &GuardParams<'_, T>) -> bool {
    match guard {
        Guard::Fn(f) => f(params),
        Guard::Named(n) => match n
            .imp
            .as_ref()
            .or_else(|| params.inner.config.0.guards.get(n.name))
        {
            Some(f) => f(params),
            None => {
                missing("guard", n.name);
                false
            }
        },
        Guard::And(gs) => gs.iter().all(|g| eval_guard(g, params)),
        Guard::Or(gs) => gs.iter().any(|g| eval_guard(g, params)),
        Guard::Not(g) => !eval_guard(g, params),
        #[cfg(feature = "host")]
        Guard::External(id) => match params.inner.host() {
            Some(host) => host.guard(*id, params.event),
            None => {
                missing("guard host for", &id.to_string());
                false
            }
        },
    }
}

struct FlushReset<'a>(&'a Cell<bool>, bool);

impl Drop for FlushReset<'_> {
    fn drop(&mut self) {
        self.0.set(self.1);
    }
}
