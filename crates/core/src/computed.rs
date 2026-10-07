//! Derived data: lazy, memoized, dependency-tracked per field.
//!
//! Each computed value records what it read on its last evaluation — context fields (as a
//! bit mask, through the tracked reader), other computed values, and whether it read the
//! state. It recomputes only when one of those inputs changed since. Change detection is
//! by tick: every effective write bumps a machine-wide tick and stamps the written fields;
//! a computed value is stale iff an input was stamped after the value was last validated.

use std::any::Any;
use std::cell::{Cell, RefCell};
use std::marker::PhantomData;
use std::rc::Rc;

use crate::machine::{Core, Inner};
use crate::traits::{Context, Types};

pub(crate) type ComputedEval<T> = Rc<dyn for<'a> Fn(&ComputedParams<'a, T>) -> Rc<dyn Any>>;

pub(crate) enum ComputedSource<T: Types> {
    Fn(ComputedEval<T>),
    /// Evaluated by the machine's host, by the binding's own id.
    #[cfg(feature = "host")]
    External(u32),
}

pub(crate) struct ComputedDef<T: Types> {
    pub(crate) name: &'static str,
    pub(crate) eval: ComputedSource<T>,
    pub(crate) eq: fn(&dyn Any, &dyn Any) -> bool,
}

/// A typed handle to one computed value, returned by `ConfigBuilder::computed`.
pub struct ComputedKey<V> {
    id: usize,
    _value: PhantomData<fn() -> V>,
}

impl<V> ComputedKey<V> {
    /// Keys are numbered in definition order; a const key must match that order.
    pub const fn new(id: usize) -> Self {
        Self {
            id,
            _value: PhantomData,
        }
    }
    pub const fn id(self) -> usize {
        self.id
    }
}

impl<V> Clone for ComputedKey<V> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<V> Copy for ComputedKey<V> {}
impl<V> std::fmt::Debug for ComputedKey<V> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ComputedKey({})", self.id)
    }
}

/// What a host's evaluation of an external computed value reports ([`Host::computed`]).
///
/// [`Host::computed`]: crate::Host::computed
#[cfg_attr(not(feature = "host"), allow(dead_code))]
pub struct Evaluation {
    /// The value changed, by the host's own equality.
    pub changed: bool,
    /// What the evaluation read, or `None` when it read the same inputs as the previous one.
    pub reads: Option<Reads>,
}

/// The inputs an evaluation read.
#[cfg_attr(not(feature = "host"), allow(dead_code))]
pub struct Reads {
    /// Context fields, one bit each.
    pub fields: u64,
    pub state: bool,
    /// Other computed values, by id.
    pub computed: Vec<usize>,
}

/// What a computed definition reads. Reads are tracked: `context.<field>()`, `state()` and
/// `computed(key)` each become an input of this value.
pub struct ComputedParams<'a, T: Types> {
    pub context: <T::Context as Context>::Reader<'a>,
    core: &'a Core<T>,
    inner: &'a Inner<T>,
    computed_deps: &'a RefCell<Vec<usize>>,
    reads_state: &'a Cell<bool>,
}

impl<T: Types> ComputedParams<'_, T> {
    pub fn state(&self) -> T::State {
        self.reads_state.set(true);
        self.core.state
    }
    pub fn computed<V: 'static>(&self, key: ComputedKey<V>) -> Rc<V> {
        {
            let mut deps = self.computed_deps.borrow_mut();
            if !deps.contains(&key.id) {
                deps.push(key.id);
            }
        }
        downcast(get(self.core, self.inner, key.id), self.inner, key.id)
    }
}

#[derive(Default)]
pub(crate) struct Slot {
    value: Option<Rc<dyn Any>>,
    /// Tick at which the value was last computed or validated.
    validated_at: u64,
    /// Tick at which the value last changed (by `eq`).
    changed_at: u64,
    ctx_deps: u64,
    reads_state: bool,
    computed_deps: Vec<usize>,
    evaluating: bool,
}

pub(crate) struct ComputedRuntime {
    slots: Vec<RefCell<Slot>>,
}

impl ComputedRuntime {
    pub(crate) fn new(count: usize) -> Self {
        Self {
            slots: (0..count).map(|_| RefCell::new(Slot::default())).collect(),
        }
    }
}

pub(crate) fn downcast<T: Types, V: 'static>(
    value: Rc<dyn Any>,
    inner: &Inner<T>,
    id: usize,
) -> Rc<V> {
    value.downcast::<V>().unwrap_or_else(|_| {
        panic!(
            "[machine] computed \"{}\" read with the wrong type",
            inner.config.0.computed[id].name
        )
    })
}

/// The current value of computed `id`, recomputing it only if an input changed.
pub(crate) fn get<T: Types>(core: &Core<T>, inner: &Inner<T>, id: usize) -> Rc<dyn Any> {
    if let Some(value) = fresh(core, inner, id) {
        return value;
    }
    recompute(core, inner, id)
}

/// The tick at which computed `id` last changed value (after bringing it up to date).
/// Bindings compare it to skip re-reading an unchanged value.
pub(crate) fn changed_at<T: Types>(core: &Core<T>, inner: &Inner<T>, id: usize) -> u64 {
    get(core, inner, id);
    core.computed.slots[id].borrow().changed_at
}

/// The value of `id` if no input changed since it was validated (re-validating it).
fn fresh<T: Types>(core: &Core<T>, inner: &Inner<T>, id: usize) -> Option<Rc<dyn Any>> {
    let slots = &core.computed.slots;
    let (at, n) = {
        let slot = slots[id].borrow();
        slot.value.as_ref()?;
        if slot.validated_at == core.tick {
            return slot.value.clone();
        }
        let at = slot.validated_at;
        let mut bits = slot.ctx_deps;
        while bits != 0 {
            let i = bits.trailing_zeros() as usize;
            if core
                .field_changed_at
                .get(i)
                .is_some_and(|&changed| changed > at)
            {
                return None;
            }
            bits &= bits - 1;
        }
        if slot.reads_state && core.state_changed_at > at {
            return None;
        }
        (at, slot.computed_deps.len())
    };
    // A computed input resolves its own staleness first, so changes surface transitively.
    for k in 0..n {
        let dep = slots[id].borrow().computed_deps[k];
        get(core, inner, dep);
        if slots[dep].borrow().changed_at > at {
            return None;
        }
    }
    let mut slot = slots[id].borrow_mut();
    slot.validated_at = core.tick;
    slot.value.clone()
}

fn recompute<T: Types>(core: &Core<T>, inner: &Inner<T>, id: usize) -> Rc<dyn Any> {
    let def = &inner.config.0.computed[id];
    // One arm without the `host` feature.
    #[allow(clippy::infallible_destructuring_match)]
    let eval = match &def.eval {
        ComputedSource::Fn(f) => f,
        #[cfg(feature = "host")]
        ComputedSource::External(ext) => return recompute_external(core, inner, id, *ext),
    };
    let slot_cell = &core.computed.slots[id];
    let buffer = {
        let mut slot = slot_cell.borrow_mut();
        if slot.evaluating {
            panic!("[machine] computed \"{}\" depends on itself", def.name);
        }
        slot.evaluating = true;
        let mut buffer = std::mem::take(&mut slot.computed_deps);
        buffer.clear();
        buffer
    };
    // A panicking definition must not leave the slot flagged as evaluating.
    struct Reset<'s>(&'s RefCell<Slot>);
    impl Drop for Reset<'_> {
        fn drop(&mut self) {
            if let Ok(mut slot) = self.0.try_borrow_mut() {
                if slot.evaluating {
                    slot.evaluating = false;
                    slot.value = None;
                }
            }
        }
    }
    let reset = Reset(slot_cell);

    let ctx_deps = Cell::new(0u64);
    let computed_deps = RefCell::new(buffer);
    let reads_state = Cell::new(false);
    let params = ComputedParams {
        context: core.ctx.reader(&ctx_deps),
        core,
        inner,
        computed_deps: &computed_deps,
        reads_state: &reads_state,
    };
    let next = eval(&params);
    if inner.aborted() {
        // A host callback failed mid-evaluation: do not cache what it returned.
        let mut slot = slot_cell.borrow_mut();
        slot.evaluating = false;
        slot.value = None;
        slot.computed_deps = computed_deps.into_inner();
        std::mem::forget(reset);
        return next;
    }

    let mut slot = slot_cell.borrow_mut();
    slot.evaluating = false;
    std::mem::forget(reset);
    let changed = match &slot.value {
        Some(prev) => !(def.eq)(&**prev, &*next),
        None => true,
    };
    if changed {
        slot.value = Some(next);
        slot.changed_at = core.tick;
    }
    slot.validated_at = core.tick;
    slot.ctx_deps = ctx_deps.get();
    slot.reads_state = reads_state.get();
    slot.computed_deps = computed_deps.into_inner();
    slot.value.clone().expect("computed value just set")
}

/// The host evaluates an external value and keeps it; the slot keeps what it read, and a
/// marker in place of the value.
#[cfg(feature = "host")]
fn recompute_external<T: Types>(
    core: &Core<T>,
    inner: &Inner<T>,
    id: usize,
    ext: u32,
) -> Rc<dyn Any> {
    let def = &inner.config.0.computed[id];
    let Some(host) = inner.host() else {
        panic!("[machine] computed \"{}\" needs a host", def.name)
    };
    let slot_cell = &core.computed.slots[id];
    {
        let mut slot = slot_cell.borrow_mut();
        if slot.evaluating {
            panic!("[machine] computed \"{}\" depends on itself", def.name);
        }
        slot.evaluating = true;
    }
    let evaluation = host.computed(ext);
    let mut slot = slot_cell.borrow_mut();
    slot.evaluating = false;
    // Kept even after a failure: the host compares its next reads with these.
    if let Some(reads) = evaluation.reads {
        slot.ctx_deps = reads.fields;
        slot.reads_state = reads.state;
        slot.computed_deps = reads.computed;
    }
    if inner.aborted() {
        slot.value = None;
        return Rc::new(());
    }
    let changed = evaluation.changed || slot.value.is_none();
    let marker = slot.value.get_or_insert_with(|| Rc::new(())).clone();
    if changed {
        slot.changed_at = core.tick;
    }
    slot.validated_at = core.tick;
    marker
}
