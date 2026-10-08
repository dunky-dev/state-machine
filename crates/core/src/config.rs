use std::any::Any;
use std::collections::HashMap;
use std::rc::Rc;

use crate::computed::{ComputedDef, ComputedKey, ComputedParams};
use crate::params::{ActionParams, GuardParams};
use crate::traits::{Context, EventEnum, Field, StateEnum, Types};

pub type ActionFn<T> = Rc<dyn Fn(&mut ActionParams<'_, T>)>;
pub type GuardFn<T> = Rc<dyn Fn(&GuardParams<'_, T>) -> bool>;
pub type EffectFn<T> = Rc<dyn Fn(&mut ActionParams<'_, T>) -> Option<Cleanup>>;
pub type DelayFn<T> = Rc<dyn Fn(&GuardParams<'_, T>) -> u32>;
/// What an effect returns to undo itself; run when its state is left or the machine stops.
pub type Cleanup = Box<dyn FnOnce()>;

/// A reference to a named implementation. Resolved once, when the config is built.
pub struct Named<F> {
    pub(crate) name: &'static str,
    pub(crate) imp: Option<F>,
}

impl<F: Clone> Clone for Named<F> {
    fn clone(&self) -> Self {
        Self {
            name: self.name,
            imp: self.imp.clone(),
        }
    }
}

/// A guard: an inline predicate, a named one, or a combination.
pub enum Guard<T: Types> {
    Fn(GuardFn<T>),
    Named(Named<GuardFn<T>>),
    /// True iff every guard passes. Empty → true.
    And(Vec<Guard<T>>),
    /// True iff any guard passes. Empty → false.
    Or(Vec<Guard<T>>),
    Not(Box<Guard<T>>),
}

impl<T: Types> Guard<T> {
    pub fn when(f: impl Fn(&GuardParams<'_, T>) -> bool + 'static) -> Self {
        Guard::Fn(Rc::new(f))
    }
    pub fn named(name: &'static str) -> Self {
        Guard::Named(Named { name, imp: None })
    }
    pub fn and(guards: impl IntoIterator<Item = Guard<T>>) -> Self {
        Guard::And(guards.into_iter().collect())
    }
    pub fn or(guards: impl IntoIterator<Item = Guard<T>>) -> Self {
        Guard::Or(guards.into_iter().collect())
    }
    #[allow(clippy::should_implement_trait)]
    pub fn not(guard: Guard<T>) -> Self {
        Guard::Not(Box::new(guard))
    }
}

impl<T: Types> From<&'static str> for Guard<T> {
    fn from(name: &'static str) -> Self {
        Guard::named(name)
    }
}

/// An action: an inline fn, a named one, or a conditional (`one_of`).
pub enum Action<T: Types> {
    Fn(ActionFn<T>),
    Named(Named<ActionFn<T>>),
    OneOf(Vec<Branch<T>>),
}

impl<T: Types> Action<T> {
    pub fn run(f: impl Fn(&mut ActionParams<'_, T>) + 'static) -> Self {
        Action::Fn(Rc::new(f))
    }
    pub fn named(name: &'static str) -> Self {
        Action::Named(Named { name, imp: None })
    }
    /// Write-sugar for the most common action: patch the context.
    pub fn act(
        patch: impl Fn(&ActionParams<'_, T>) -> <T::Context as Context>::Patch + 'static,
    ) -> Self {
        Action::Fn(Rc::new(move |p: &mut ActionParams<'_, T>| {
            let next = patch(p);
            p.set_context(next);
        }))
    }
    /// Run the first branch whose guard passes; a guardless branch is the fallback.
    pub fn one_of(branches: impl IntoIterator<Item = Branch<T>>) -> Self {
        Action::OneOf(branches.into_iter().collect())
    }
}

impl<T: Types> From<&'static str> for Action<T> {
    fn from(name: &'static str) -> Self {
        Action::named(name)
    }
}

/// One branch of a `one_of`.
pub struct Branch<T: Types> {
    pub(crate) guard: Option<Guard<T>>,
    pub(crate) actions: Vec<Action<T>>,
}

impl<T: Types> Branch<T> {
    pub fn when(guard: impl Into<Guard<T>>, actions: impl IntoIterator<Item = Action<T>>) -> Self {
        Self {
            guard: Some(guard.into()),
            actions: actions.into_iter().collect(),
        }
    }
    pub fn otherwise(actions: impl IntoIterator<Item = Action<T>>) -> Self {
        Self {
            guard: None,
            actions: actions.into_iter().collect(),
        }
    }
}

/// An effect: started when its state is entered, cleaned up when it is left.
pub enum Effect<T: Types> {
    Fn(EffectFn<T>),
    Named(Named<EffectFn<T>>),
}

impl<T: Types> Effect<T> {
    pub fn run(f: impl Fn(&mut ActionParams<'_, T>) -> Option<Cleanup> + 'static) -> Self {
        Effect::Fn(Rc::new(f))
    }
    pub fn named(name: &'static str) -> Self {
        Effect::Named(Named { name, imp: None })
    }
}

impl<T: Types> From<&'static str> for Effect<T> {
    fn from(name: &'static str) -> Self {
        Effect::named(name)
    }
}

/// A delay for an `after` transition: fixed milliseconds or a named, dynamic delay.
pub enum Delay<T: Types> {
    Ms(u32),
    Named(Named<DelayFn<T>>),
}

impl<T: Types> From<u32> for Delay<T> {
    fn from(ms: u32) -> Self {
        Delay::Ms(ms)
    }
}

impl<T: Types> From<&'static str> for Delay<T> {
    fn from(name: &'static str) -> Self {
        Delay::Named(Named { name, imp: None })
    }
}

/// One transition: optional target, optional guard, actions in order.
pub struct Transition<T: Types> {
    pub(crate) target: Option<T::State>,
    pub(crate) guard: Option<Guard<T>>,
    pub(crate) actions: Vec<Action<T>>,
}

/// Builds one transition candidate inside `StateBuilder::on` / `after`.
pub struct TransitionBuilder<T: Types>(Transition<T>);

impl<T: Types> TransitionBuilder<T> {
    pub fn target(mut self, state: T::State) -> Self {
        self.0.target = Some(state);
        self
    }
    /// A named guard.
    pub fn guard(mut self, name: &'static str) -> Self {
        self.0.guard = Some(Guard::named(name));
        self
    }
    /// An inline guard.
    pub fn guard_fn(mut self, f: impl Fn(&GuardParams<'_, T>) -> bool + 'static) -> Self {
        self.0.guard = Some(Guard::when(f));
        self
    }
    /// Any guard value, e.g. `Guard::and([...])`.
    pub fn guard_expr(mut self, guard: Guard<T>) -> Self {
        self.0.guard = Some(guard);
        self
    }
    /// A named action.
    pub fn action(mut self, name: &'static str) -> Self {
        self.0.actions.push(Action::named(name));
        self
    }
    /// An inline action.
    pub fn run(mut self, f: impl Fn(&mut ActionParams<'_, T>) + 'static) -> Self {
        self.0.actions.push(Action::run(f));
        self
    }
    /// An inline context patch.
    pub fn act(
        mut self,
        patch: impl Fn(&ActionParams<'_, T>) -> <T::Context as Context>::Patch + 'static,
    ) -> Self {
        self.0.actions.push(Action::act(patch));
        self
    }
    /// Any action value, e.g. `Action::one_of([...])`.
    pub fn push(mut self, action: Action<T>) -> Self {
        self.0.actions.push(action);
        self
    }
}

/// A handler for one event (or one `after` delay): candidates in order, first passing guard wins.
pub(crate) struct Entry<T: Types> {
    candidates: Vec<Transition<T>>,
}

impl<T: Types> Default for Entry<T> {
    fn default() -> Self {
        Self {
            candidates: Vec::new(),
        }
    }
}

impl<T: Types> std::ops::Deref for Entry<T> {
    type Target = Vec<Transition<T>>;
    fn deref(&self) -> &Self::Target {
        &self.candidates
    }
}

impl<T: Types> std::ops::DerefMut for Entry<T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.candidates
    }
}

pub(crate) struct StateNode<T: Types> {
    /// Indexed by event kind.
    pub(crate) on: Vec<Entry<T>>,
    pub(crate) entry: Vec<Action<T>>,
    pub(crate) exit: Vec<Action<T>>,
    pub(crate) effects: Vec<Effect<T>>,
    pub(crate) after: Vec<(Delay<T>, Entry<T>)>,
    pub(crate) tags: Vec<&'static str>,
}

impl<T: Types> StateNode<T> {
    fn new(kinds: usize) -> Self {
        Self {
            on: (0..kinds).map(|_| Entry::default()).collect(),
            entry: Vec::new(),
            exit: Vec::new(),
            effects: Vec::new(),
            after: Vec::new(),
            tags: Vec::new(),
        }
    }
}

/// Builds one state inside `ConfigBuilder::state`.
pub struct StateBuilder<T: Types>(StateNode<T>);

impl<T: Types> StateBuilder<T> {
    /// Add a candidate for `kind`. Calling `on` again for the same kind appends the next
    /// candidate (guard fallthrough: the first whose guard passes wins).
    pub fn on(
        mut self,
        kind: <T::Event as EventEnum>::Kind,
        build: impl FnOnce(TransitionBuilder<T>) -> TransitionBuilder<T>,
    ) -> Self {
        let t = build(TransitionBuilder(empty_transition()));
        self.0.on[<T::Event as EventEnum>::kind_index(kind)].push(t.0);
        self
    }
    pub fn entry(mut self, action: impl Into<Action<T>>) -> Self {
        self.0.entry.push(action.into());
        self
    }
    pub fn entry_run(mut self, f: impl Fn(&mut ActionParams<'_, T>) + 'static) -> Self {
        self.0.entry.push(Action::run(f));
        self
    }
    pub fn exit(mut self, action: impl Into<Action<T>>) -> Self {
        self.0.exit.push(action.into());
        self
    }
    pub fn exit_run(mut self, f: impl Fn(&mut ActionParams<'_, T>) + 'static) -> Self {
        self.0.exit.push(Action::run(f));
        self
    }
    pub fn effect(mut self, effect: impl Into<Effect<T>>) -> Self {
        self.0.effects.push(effect.into());
        self
    }
    pub fn effect_run(
        mut self,
        f: impl Fn(&mut ActionParams<'_, T>) -> Option<Cleanup> + 'static,
    ) -> Self {
        self.0.effects.push(Effect::run(f));
        self
    }
    /// A timed transition while in this state. Calling `after` again with an equal delay
    /// adds an independent timer (like a second key in the TS `after` map).
    pub fn after(
        mut self,
        delay: impl Into<Delay<T>>,
        build: impl FnOnce(TransitionBuilder<T>) -> TransitionBuilder<T>,
    ) -> Self {
        let t = build(TransitionBuilder(empty_transition()));
        let mut entry = Entry::default();
        entry.push(t.0);
        self.0.after.push((delay.into(), entry));
        self
    }
    /// Add a fallthrough candidate to the most recent `after`.
    pub fn after_or(
        mut self,
        build: impl FnOnce(TransitionBuilder<T>) -> TransitionBuilder<T>,
    ) -> Self {
        let t = build(TransitionBuilder(empty_transition()));
        self.0
            .after
            .last_mut()
            .expect("after_or() needs a preceding after()")
            .1
            .push(t.0);
        self
    }
    pub fn tag(mut self, tag: &'static str) -> Self {
        self.0.tags.push(tag);
        self
    }
}

fn empty_transition<T: Types>() -> Transition<T> {
    Transition {
        target: None,
        guard: None,
        actions: Vec::new(),
    }
}

pub(crate) enum WatchSource {
    Field(usize),
    Computed(usize),
}

pub(crate) struct Watch<T: Types> {
    pub(crate) source: WatchSource,
    pub(crate) actions: Vec<Action<T>>,
}

pub(crate) struct ConfigInner<T: Types> {
    pub(crate) initial: T::State,
    pub(crate) context: T::Context,
    pub(crate) states: Vec<StateNode<T>>,
    /// Any-state handlers, indexed by event kind.
    pub(crate) on_any: Vec<Entry<T>>,
    pub(crate) computed: Vec<ComputedDef<T>>,
    pub(crate) watch: Vec<Watch<T>>,
    pub(crate) guards: HashMap<&'static str, GuardFn<T>>,
}

/// A built machine config — static description, shared by every machine built from it.
pub struct Config<T: Types>(pub(crate) Rc<ConfigInner<T>>);

impl<T: Types> Clone for Config<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl<T: Types> Config<T> {
    pub fn builder(initial: T::State, context: T::Context) -> ConfigBuilder<T> {
        Self::builder_with_counts(
            initial,
            context,
            <T::State as StateEnum>::NAMES.len(),
            <T::Event as EventEnum>::KIND_NAMES.len(),
        )
    }

    fn builder_with_counts(
        initial: T::State,
        context: T::Context,
        states: usize,
        kinds: usize,
    ) -> ConfigBuilder<T> {
        ConfigBuilder {
            inner: ConfigInner {
                initial,
                context,
                states: (0..states).map(|_| StateNode::new(kinds)).collect(),
                on_any: (0..kinds).map(|_| Entry::default()).collect(),
                computed: Vec::new(),
                watch: Vec::new(),
                guards: HashMap::new(),
            },
            actions: HashMap::new(),
            effects: HashMap::new(),
            delays: HashMap::new(),
            kinds,
        }
    }

    pub fn initial(&self) -> T::State {
        self.0.initial
    }

    /// The seed context every new machine copies.
    pub fn context(&self) -> &T::Context {
        &self.0.context
    }

    pub fn computed_names(&self) -> impl Iterator<Item = &'static str> + '_ {
        self.0.computed.iter().map(|d| d.name)
    }

    pub fn tags(&self, state: T::State) -> &[&'static str] {
        &self.0.states[state.index()].tags
    }

    /// The handler for `kind` in `state`: the state's own, else the any-state one.
    pub(crate) fn lookup(&self, state: T::State, kind: usize) -> Option<&Entry<T>> {
        let own = &self.0.states[state.index()].on[kind];
        if !own.is_empty() {
            return Some(own);
        }
        let any = &self.0.on_any[kind];
        (!any.is_empty()).then_some(any)
    }
}

/// Builds a [`Config`]. Register named implementations and computed values first, then
/// describe the states; `build()` resolves every name.
pub struct ConfigBuilder<T: Types> {
    inner: ConfigInner<T>,
    actions: HashMap<&'static str, ActionFn<T>>,
    effects: HashMap<&'static str, EffectFn<T>>,
    delays: HashMap<&'static str, DelayFn<T>>,
    /// Number of event types (each state's `on` table has one slot per type).
    kinds: usize,
}

impl<T: Types> ConfigBuilder<T> {
    pub fn state(
        &mut self,
        state: T::State,
        build: impl FnOnce(StateBuilder<T>) -> StateBuilder<T>,
    ) -> &mut Self {
        let index = state.index();
        let kinds = self.kinds;
        let node = std::mem::replace(&mut self.inner.states[index], StateNode::new(kinds));
        self.inner.states[index] = build(StateBuilder(node)).0;
        self
    }

    /// An any-state handler. A state's own handler for the same kind wins.
    pub fn on(
        &mut self,
        kind: <T::Event as EventEnum>::Kind,
        build: impl FnOnce(TransitionBuilder<T>) -> TransitionBuilder<T>,
    ) -> &mut Self {
        let t = build(TransitionBuilder(empty_transition()));
        self.inner.on_any[<T::Event as EventEnum>::kind_index(kind)].push(t.0);
        self
    }

    pub fn guard(
        &mut self,
        name: &'static str,
        f: impl Fn(&GuardParams<'_, T>) -> bool + 'static,
    ) -> &mut Self {
        self.inner.guards.insert(name, Rc::new(f));
        self
    }

    pub fn action(
        &mut self,
        name: &'static str,
        f: impl Fn(&mut ActionParams<'_, T>) + 'static,
    ) -> &mut Self {
        self.actions.insert(name, Rc::new(f));
        self
    }

    pub fn effect(
        &mut self,
        name: &'static str,
        f: impl Fn(&mut ActionParams<'_, T>) -> Option<Cleanup> + 'static,
    ) -> &mut Self {
        self.effects.insert(name, Rc::new(f));
        self
    }

    pub fn delay(
        &mut self,
        name: &'static str,
        f: impl Fn(&GuardParams<'_, T>) -> u32 + 'static,
    ) -> &mut Self {
        self.delays.insert(name, Rc::new(f));
        self
    }

    /// Derived data: lazy, memoized, recomputed only when a field (or computed value, or the
    /// state) it read has changed. Returns the typed key used to read it.
    pub fn computed<V: PartialEq + 'static>(
        &mut self,
        name: &'static str,
        f: impl for<'a> Fn(&ComputedParams<'a, T>) -> V + 'static,
    ) -> ComputedKey<V> {
        let id = self.inner.computed.len();
        self.inner.computed.push(ComputedDef {
            name,
            eval: Rc::new(
                move |p: &ComputedParams<'_, T>, slot: &mut Option<Rc<dyn Any>>| {
                    let next = f(p);
                    if let Some(rc) = slot {
                        if let Some(old) = Rc::get_mut(rc).and_then(|old| old.downcast_mut::<V>()) {
                            if *old == next {
                                return false;
                            }
                            *old = next;
                            return true;
                        }
                        if rc.downcast_ref::<V>().is_some_and(|old| *old == next) {
                            return false;
                        }
                    }
                    *slot = Some(Rc::new(next));
                    true
                },
            ),
        });
        ComputedKey::new(id)
    }

    /// Data-reaction on a context field: its actions run (deferred) whenever the field
    /// changes, in any state, while the machine runs.
    pub fn watch(
        &mut self,
        field: Field<T::Context>,
        actions: impl IntoIterator<Item = Action<T>>,
    ) -> &mut Self {
        self.inner.watch.push(Watch {
            source: WatchSource::Field(field.index()),
            actions: actions.into_iter().collect(),
        });
        self
    }

    /// Data-reaction on a computed value.
    pub fn watch_computed<V>(
        &mut self,
        key: ComputedKey<V>,
        actions: impl IntoIterator<Item = Action<T>>,
    ) -> &mut Self {
        self.inner.watch.push(Watch {
            source: WatchSource::Computed(key.id()),
            actions: actions.into_iter().collect(),
        });
        self
    }

    /// Resolve every named reference. A name with no implementation stays unresolved and
    /// fails when it runs: a panic in debug builds, a warning + no-op in release builds.
    pub fn build(&mut self) -> Config<T> {
        let kinds = self.kinds;
        let empty = ConfigInner {
            initial: self.inner.initial,
            context: self.inner.context.clone(),
            states: Vec::new(),
            on_any: (0..kinds).map(|_| Entry::default()).collect(),
            computed: Vec::new(),
            watch: Vec::new(),
            guards: HashMap::new(),
        };
        let mut inner = std::mem::replace(&mut self.inner, empty);
        let reg = Registry {
            guards: &inner.guards.clone(),
            actions: &self.actions,
            effects: &self.effects,
            delays: &self.delays,
        };
        for node in &mut inner.states {
            for entry in &mut node.on {
                reg.entry(entry);
            }
            reg.actions(&mut node.entry);
            reg.actions(&mut node.exit);
            for effect in &mut node.effects {
                if let Effect::Named(n) = effect {
                    n.imp = reg.effects.get(n.name).cloned();
                }
            }
            for (delay, entry) in &mut node.after {
                if let Delay::Named(n) = delay {
                    n.imp = reg.delays.get(n.name).cloned();
                }
                reg.entry(entry);
            }
        }
        for entry in &mut inner.on_any {
            reg.entry(entry);
        }
        for w in &mut inner.watch {
            reg.actions(&mut w.actions);
        }
        Config(Rc::new(inner))
    }
}

struct Registry<'r, T: Types> {
    guards: &'r HashMap<&'static str, GuardFn<T>>,
    actions: &'r HashMap<&'static str, ActionFn<T>>,
    effects: &'r HashMap<&'static str, EffectFn<T>>,
    delays: &'r HashMap<&'static str, DelayFn<T>>,
}

impl<T: Types> Registry<'_, T> {
    fn entry(&self, entry: &mut Entry<T>) {
        for t in entry.iter_mut() {
            if let Some(g) = &mut t.guard {
                self.guard(g);
            }
            self.actions(&mut t.actions);
        }
    }
    fn guard(&self, guard: &mut Guard<T>) {
        match guard {
            Guard::Fn(_) => {}
            Guard::Named(n) => n.imp = self.guards.get(n.name).cloned(),
            Guard::And(gs) | Guard::Or(gs) => gs.iter_mut().for_each(|g| self.guard(g)),
            Guard::Not(g) => self.guard(g),
        }
    }
    fn actions(&self, actions: &mut [Action<T>]) {
        for a in actions {
            match a {
                Action::Fn(_) => {}
                Action::Named(n) => n.imp = self.actions.get(n.name).cloned(),
                Action::OneOf(branches) => {
                    for b in branches {
                        if let Some(g) = &mut b.guard {
                            self.guard(g);
                        }
                        self.actions(&mut b.actions);
                    }
                }
            }
        }
    }
}

/// The dev/prod rule for a missing named implementation, shared by every resolver.
pub(crate) fn missing(kind: &str, name: &str) {
    let msg = format!("[machine] no {kind} \"{name}\"");
    if cfg!(debug_assertions) {
        panic!("{msg}");
    }
    #[cfg(not(target_arch = "wasm32"))]
    eprintln!("{msg}");
}
