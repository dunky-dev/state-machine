//! The runtime for TS-authored machines (cargo feature `runtime`).
//!
//! The Rust engine runs the graph: queue, transition resolution, entry/exit order,
//! effects lifecycle, `after` timers, watchers and computed bookkeeping. JS runs the
//! user code — guards, actions, effects, delays, computed definitions — through the
//! host functions (see `crate::bridge`), by the callback's number in the JS-side tables.
//!
//! The context lives in JS (it holds arbitrary JS values). JS reports which fields a
//! write changed (`markChanged`) and which fields a computed value read (`reportDeps`);
//! Rust keeps the change stamps that drive watchers and computed staleness.

use std::any::Any;
use std::cell::{Cell, RefCell};
use std::rc::Rc;

use dunky_core::{
    Action, Branch, Changes, Cleanup, ComputedParams, Config, Context, Delay, Effect, EventEnum,
    Field, Guard, Host, Machine, StateEnum, TransitionBuilder, Types,
};
use serde::Deserialize;
use wasm_bindgen::prelude::*;

use crate::bridge::{Bridge, HostObject, Link, OK};

// ---------------------------------------------------------------------------------
// The machine type of every TS-authored machine: states and event types are numbers
// assigned by the JS compiler; the context is owned by JS.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct DynState(pub u32);

impl StateEnum for DynState {
    // Names live in JS; the engine only needs indices.
    const NAMES: &'static [&'static str] = &[];
    fn index(self) -> usize {
        self.0 as usize
    }
    fn from_index(index: usize) -> Self {
        DynState(index as u32)
    }
}

/// An event object sent from JS, with its type number.
#[derive(Clone, Debug)]
pub struct JsEvent {
    kind: u32,
    value: JsValue,
}

impl EventEnum for JsEvent {
    type Kind = u32;
    const KIND_NAMES: &'static [&'static str] = &[];
    fn kind(&self) -> u32 {
        self.kind
    }
    fn kind_index(kind: u32) -> usize {
        kind as usize
    }
    fn kind_from_index(index: usize) -> u32 {
        index as u32
    }
    fn from_kind(_kind: u32) -> Option<Self> {
        None
    }
}

/// The context of a TS machine lives in JS. Its patch is the change mask JS computed.
#[derive(Clone, Default)]
pub struct JsContext;

/// Records the fields a computed value read, as reported by JS.
#[derive(Clone, Copy)]
pub struct JsReader<'a> {
    deps: &'a Cell<u64>,
}

impl JsReader<'_> {
    fn mark(&self, fields: u64) {
        self.deps.set(self.deps.get() | fields);
    }
}

impl Context for JsContext {
    type Patch = u64;
    type Reader<'a> = JsReader<'a>;
    const FIELDS: &'static [&'static str] = &[];
    fn apply(&mut self, changed: u64) -> u64 {
        changed
    }
    fn reader<'a>(&'a self, deps: &'a Cell<u64>) -> JsReader<'a> {
        JsReader { deps }
    }
}

pub struct Js;

impl Types for Js {
    type State = DynState;
    type Event = JsEvent;
    type Context = JsContext;
}

// ---------------------------------------------------------------------------------
// The compiled config the JS side sends. Every callback is a number into the JS-side
// tables of that config.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Spec {
    initial: u32,
    kinds: u32,
    states: Vec<StateSpec>,
    #[serde(default)]
    on_any: Vec<EntrySpec>,
    #[serde(default)]
    computed: u32,
    #[serde(default)]
    watch: Vec<WatchSpec>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct StateSpec {
    on: Vec<EntrySpec>,
    entry: Vec<ActionSpec>,
    exit: Vec<ActionSpec>,
    effects: Vec<u32>,
    after: Vec<AfterSpec>,
}

/// The handler for one event type: candidates in order. With `pick`, the host evaluates
/// their guards in one call (its guard list `pick`).
#[derive(Deserialize)]
struct EntrySpec {
    kind: u32,
    candidates: Vec<CandidateSpec>,
    #[serde(default)]
    pick: Option<u32>,
}

#[derive(Deserialize)]
struct AfterSpec {
    delay: DelaySpec,
    candidates: Vec<CandidateSpec>,
    #[serde(default)]
    pick: Option<u32>,
}

#[derive(Deserialize)]
struct CandidateSpec {
    #[serde(default)]
    target: Option<u32>,
    #[serde(default)]
    guard: Option<u32>,
    #[serde(default)]
    actions: Vec<ActionSpec>,
}

/// `{ id }` for a callback, `{ list }` for a run of callbacks the host runs in one call,
/// `{ oneOf: [...] }` for a conditional.
#[derive(Deserialize)]
struct ActionSpec {
    #[serde(default)]
    id: Option<u32>,
    #[serde(default)]
    list: Option<u32>,
    #[serde(default, rename = "oneOf")]
    one_of: Option<Vec<BranchSpec>>,
}

#[derive(Deserialize)]
struct BranchSpec {
    #[serde(default)]
    guard: Option<u32>,
    #[serde(default)]
    actions: Vec<ActionSpec>,
}

/// `{ ms }` for a fixed delay, `{ id }` for a named one.
#[derive(Deserialize)]
struct DelaySpec {
    #[serde(default)]
    ms: Option<u32>,
    #[serde(default)]
    id: Option<u32>,
}

#[derive(Deserialize)]
struct WatchSpec {
    #[serde(default)]
    field: Option<u32>,
    #[serde(default)]
    computed: Option<u32>,
    actions: Vec<ActionSpec>,
}

fn action(spec: &ActionSpec) -> Action<Js> {
    if let Some(branches) = &spec.one_of {
        return Action::one_of(branches.iter().map(|b| {
            let actions = b.actions.iter().map(action);
            match b.guard {
                Some(guard) => Branch::when(Guard::External(guard), actions),
                None => Branch::otherwise(actions),
            }
        }));
    }
    match (spec.list, spec.id) {
        (Some(list), _) => Action::ExternalList(list),
        (None, Some(id)) => Action::External(id),
        (None, None) => Action::one_of([]),
    }
}

fn candidate(mut t: TransitionBuilder<Js>, spec: &CandidateSpec) -> TransitionBuilder<Js> {
    if let Some(target) = spec.target {
        t = t.target(DynState(target));
    }
    if let Some(guard) = spec.guard {
        t = t.guard_expr(Guard::External(guard));
    }
    for a in &spec.actions {
        t = t.push(action(a));
    }
    t
}

/// Computed values of a TS machine compare like the TS engine: `Object.is`.
fn js_is(a: &dyn Any, b: &dyn Any) -> bool {
    match (a.downcast_ref::<JsValue>(), b.downcast_ref::<JsValue>()) {
        (Some(a), Some(b)) => js_sys::Object::is(a, b),
        _ => false,
    }
}

fn build(spec: &Spec) -> Config<Js> {
    let mut b = Config::<Js>::builder_sized(
        DynState(spec.initial),
        JsContext,
        spec.states.len(),
        spec.kinds as usize,
    );
    for _ in 0..spec.computed {
        b.computed_external("", js_is);
    }
    for (index, state) in spec.states.iter().enumerate() {
        b.state(DynState(index as u32), |mut s| {
            for entry in &state.on {
                for c in &entry.candidates {
                    s = s.on(entry.kind, |t| candidate(t, c));
                }
                if let Some(list) = entry.pick {
                    s = s.pick(entry.kind, list);
                }
            }
            for a in &state.entry {
                s = s.entry(action(a));
            }
            for a in &state.exit {
                s = s.exit(action(a));
            }
            for id in &state.effects {
                s = s.effect(Effect::External(*id));
            }
            for after in &state.after {
                let delay = match (after.delay.ms, after.delay.id) {
                    (_, Some(id)) => Delay::External(id),
                    (ms, None) => Delay::Ms(ms.unwrap_or(0)),
                };
                let mut rest = after.candidates.iter();
                if let Some(first) = rest.next() {
                    s = s.after(delay, |t| candidate(t, first));
                    for c in rest {
                        s = s.after_or(|t| candidate(t, c));
                    }
                    if let Some(list) = after.pick {
                        s = s.after_pick(list);
                    }
                }
            }
            s
        });
    }
    for entry in &spec.on_any {
        for c in &entry.candidates {
            b.on(entry.kind, |t| candidate(t, c));
        }
        if let Some(list) = entry.pick {
            b.pick_any(entry.kind, list);
        }
    }
    for w in &spec.watch {
        let actions = w.actions.iter().map(action).collect::<Vec<_>>();
        match (w.field, w.computed) {
            (Some(field), _) => {
                b.watch(Field::new(field.min(63) as usize), actions);
            }
            (None, Some(id)) => {
                b.watch_computed_id(id as usize, actions);
            }
            (None, None) => {}
        }
    }
    b.build()
}

// ---------------------------------------------------------------------------------
// The host: the JS functions run the user code by its index in the JS tables, and
// return status codes (they catch what user code throws and keep it).

#[wasm_bindgen]
extern "C" {
    /// 0 false, 1 true, 2 failed.
    #[wasm_bindgen(method)]
    fn guard(this: &HostObject, facade: &JsValue, f: u32, event: &JsValue) -> u32;
    /// 0, or 1 when it failed. `notify` is a state change to deliver first, or -1.
    #[wasm_bindgen(method)]
    fn action(this: &HostObject, facade: &JsValue, f: u32, event: &JsValue, notify: i32) -> u32;
    /// The cleanup's id, 0 for no cleanup, or -1 when it failed. `notify` as for `action`.
    #[wasm_bindgen(method)]
    fn effect(this: &HostObject, facade: &JsValue, f: u32, event: &JsValue, notify: i32) -> i32;
    /// 0, or 1 when it failed.
    #[wasm_bindgen(method)]
    fn cleanup(this: &HostObject, facade: &JsValue, id: u32) -> u32;
    /// The delay in ms, or -1 when it failed.
    #[wasm_bindgen(method)]
    fn delay(this: &HostObject, facade: &JsValue, f: u32, event: &JsValue) -> f64;
    /// 0 once the value is reported (`JsMachine::report`), or 1 when it failed.
    #[wasm_bindgen(method)]
    fn computed(this: &HostObject, facade: &JsValue, id: u32) -> u32;
    /// The index of the first candidate of guard list `list` that passes, -1 for none,
    /// -2 when a guard failed.
    #[wasm_bindgen(method)]
    fn pick(this: &HostObject, facade: &JsValue, list: u32, event: &JsValue) -> i32;
    /// Run action list `list` in order. 0, or 1 when an action failed. `notify` as for
    /// `action`.
    #[wasm_bindgen(method)]
    fn actions(this: &HostObject, facade: &JsValue, list: u32, event: &JsValue, notify: i32)
    -> u32;
}

/// What one computed evaluation returned and read, reported by JS before it returns.
struct Report {
    value: JsValue,
    fields: u64,
    state: bool,
    computed: Option<Vec<u32>>,
}

struct JsHost {
    link: Rc<Link>,
    report: RefCell<Option<Report>>,
    /// A state change held back to ride on the next action or effect call (one crossing
    /// instead of two); -1 for none. Delivered first, or at `settle`.
    pending: Cell<i32>,
}

impl JsHost {
    /// The held-back state change, for a call that delivers it first.
    fn take_pending(&self) -> i32 {
        self.pending.replace(-1)
    }

    /// Deliver the held-back state change now.
    fn deliver(&self) {
        let state = self.take_pending();
        if state >= 0 {
            self.link.notify(state as u32, Changes::default());
        }
    }
}

/// Run `f` with the event's JS value (`undefined` for a boot or a data-reaction).
fn with_event<R>(event: Option<&JsEvent>, f: impl FnOnce(&JsValue) -> R) -> R {
    match event {
        Some(e) => f(&e.value),
        None => f(&JsValue::UNDEFINED),
    }
}

impl Host<Js> for JsHost {
    fn guard(&self, id: u32, event: Option<&JsEvent>) -> bool {
        self.deliver();
        match with_event(event, |e| self.link.host.guard(&self.link.facade(), id, e)) {
            0 => false,
            1 => true,
            _ => {
                self.link.fail();
                false
            }
        }
    }

    fn action(&self, id: u32, event: Option<&JsEvent>) {
        let notify = self.take_pending();
        if with_event(event, |e| {
            self.link.host.action(&self.link.facade(), id, e, notify)
        }) != OK
        {
            self.link.fail();
        }
    }

    fn effect(&self, id: u32, event: Option<&JsEvent>) -> Option<Cleanup> {
        let notify = self.take_pending();
        let cleanup = with_event(event, |e| {
            self.link.host.effect(&self.link.facade(), id, e, notify)
        });
        if cleanup < 0 {
            self.link.fail();
        }
        if cleanup <= 0 {
            return None;
        }
        let link = self.link.clone();
        Some(Box::new(move || {
            if link.host.cleanup(&link.facade(), cleanup as u32) != OK {
                link.fail();
            }
        }))
    }

    fn delay(&self, id: u32, event: Option<&JsEvent>) -> u32 {
        self.deliver();
        let ms = with_event(event, |e| self.link.host.delay(&self.link.facade(), id, e));
        if ms.is_nan() || ms < 0.0 {
            self.link.fail();
            return 0;
        }
        ms as u32
    }

    fn computed(&self, id: u32, params: &ComputedParams<'_, Js>) -> Rc<dyn Any> {
        self.deliver();
        if self.link.host.computed(&self.link.facade(), id) != OK {
            self.link.fail();
        }
        let Some(report) = self.report.borrow_mut().take() else {
            return Rc::new(JsValue::UNDEFINED);
        };
        params.context.mark(report.fields);
        if report.state {
            params.state();
        }
        for c in report.computed.into_iter().flatten() {
            params.track_computed(c as usize);
        }
        Rc::new(report.value)
    }

    fn pick(&self, list: u32, event: Option<&JsEvent>) -> Option<usize> {
        self.deliver();
        match with_event(event, |e| self.link.host.pick(&self.link.facade(), list, e)) {
            -2 => {
                self.link.fail();
                None
            }
            picked => usize::try_from(picked).ok(),
        }
    }

    fn actions(&self, list: u32, event: Option<&JsEvent>) {
        let notify = self.take_pending();
        if with_event(event, |e| {
            self.link.host.actions(&self.link.facade(), list, e, notify)
        }) != OK
        {
            self.link.fail();
        }
    }

    fn notify(&self, state: DynState, changes: Changes) {
        // Context writes are JS's to announce; a state change waits for the next call.
        self.deliver();
        if changes.fields == 0 {
            self.pending.set(state.0 as i32);
        } else {
            self.link.notify(state.0, changes);
        }
    }

    fn settle(&self) {
        self.deliver();
    }
}

// ---------------------------------------------------------------------------------
// The JS classes.

/// A compiled TS config, shared by every machine built from it.
#[wasm_bindgen]
pub struct JsConfig {
    config: Config<Js>,
}

#[wasm_bindgen]
impl JsConfig {
    #[wasm_bindgen(constructor)]
    pub fn new(spec: JsValue) -> Result<JsConfig, JsError> {
        let spec: Spec = serde_wasm_bindgen::from_value(spec)
            .map_err(|e| JsError::new(&format!("[machine] bad config: {e}")))?;
        Ok(JsConfig {
            config: build(&spec),
        })
    }
}

/// One TS-authored machine running on the Rust engine. Calls return a status: 0, 1 when
/// user code failed (the JS side holds the error), 3 when the engine failed
/// (`takeFailure`).
#[wasm_bindgen]
pub struct JsMachine {
    bridge: Bridge<Js>,
    host: Rc<JsHost>,
}

#[wasm_bindgen]
impl JsMachine {
    /// `host` is the JS host object. Each call takes the facade calling (`facade`), which
    /// the host functions of that call receive.
    #[wasm_bindgen(constructor)]
    pub fn new(config: &JsConfig, host: HostObject) -> JsMachine {
        let machine = Machine::new(&config.config);
        let link = Rc::new(Link::new(host, machine.halt_flag()));
        let bridge = Bridge::new(machine);
        bridge.connect(link.clone());
        let host = Rc::new(JsHost {
            link,
            report: RefCell::new(None),
            pending: Cell::new(-1),
        });
        bridge.machine().set_host(host.clone());
        JsMachine { bridge, host }
    }

    pub fn send(&self, kind: u32, event: JsValue, facade: JsValue) -> u32 {
        self.bridge
            .call(facade, |m| m.send(JsEvent { kind, value: event }))
    }

    pub fn start(&self, facade: JsValue) -> u32 {
        self.bridge.start(facade)
    }

    pub fn stop(&self, facade: JsValue) -> u32 {
        self.bridge.stop(facade)
    }

    pub fn running(&self) -> bool {
        self.bridge.machine().is_running()
    }

    pub fn state(&self) -> u32 {
        self.bridge.machine().state().0
    }

    /// JS changed context fields (`lo`/`hi`: the low and high 32 bits of the mask). Only
    /// a machine with watchers or computed values needs to say so.
    #[wasm_bindgen(js_name = markChanged)]
    pub fn mark_changed(&self, lo: u32, hi: u32, facade: JsValue) -> u32 {
        self.bridge.call(facade, |m| {
            m.mark_changed((u64::from(hi) << 32) | u64::from(lo));
        })
    }

    /// The value of computed `id` (`undefined` when its definition failed).
    pub fn computed(&self, id: u32, facade: JsValue) -> JsValue {
        let mut value = JsValue::UNDEFINED;
        self.bridge.call(facade, |m| {
            if let Some(v) = m.computed_any(id as usize).downcast_ref::<JsValue>() {
                value = v.clone();
            }
        });
        value
    }

    /// What the computed evaluation in progress returned and read.
    pub fn report(
        &self,
        value: JsValue,
        lo: u32,
        hi: u32,
        state: bool,
        computed: Option<Vec<u32>>,
    ) {
        *self.host.report.borrow_mut() = Some(Report {
            value,
            fields: (u64::from(hi) << 32) | u64::from(lo),
            state,
            computed,
        });
    }

    /// The host clock: timer `id` (from `startTimer`) came due.
    pub fn fire(&self, id: u32, facade: JsValue) -> u32 {
        self.bridge.fire(id, facade)
    }

    /// The engine's failure behind status 3.
    #[wasm_bindgen(js_name = takeFailure)]
    pub fn take_failure(&self) -> Option<String> {
        self.bridge.take_failure()
    }
}
