//! The runtime for TS-authored machines (cargo feature `runtime`).
//!
//! The Rust engine runs the graph: queue, transition resolution, entry/exit order,
//! effects lifecycle, `after` timers, watchers and computed bookkeeping. JS runs the
//! user code — guards, actions, effects, delays, computed definitions — through the
//! host functions (see `crate::bridge`), by the callback's number in the JS-side tables.
//!
//! The context and the computed values live in JS (they hold arbitrary JS values). JS
//! reports which fields a write changed (`markChanged`, or `stamp` without watchers) and
//! what a computed evaluation read (`report`); Rust keeps the change stamps that drive
//! watchers and computed staleness.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use dunky_core::{
    Action, Branch, Changes, Config, Context, Delay, Effect, Evaluation, EventEnum, Field, Guard,
    Host, HostTransition, Machine, Reads, StateEnum, TransitionBuilder, Types,
};
use serde::Deserialize;
use wasm_bindgen::prelude::*;

use crate::bridge::{Bridge, FAILED, HostObject, Link, OK};

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

impl Context for JsContext {
    type Patch = u64;
    // JS evaluates the computed values and reports what they read.
    type Reader<'a> = ();
    const FIELDS: &'static [&'static str] = &[];
    fn apply(&mut self, changed: u64) -> u64 {
        changed
    }
    fn reader<'a>(&'a self, _deps: &'a Cell<u64>) {}
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
    /// When set, the host runs the transition whole when it leaves the state.
    #[serde(default)]
    id: Option<u32>,
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
    if let Some(id) = spec.id {
        t = t.host_id(id);
    }
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

fn build(spec: &Spec) -> Config<Js> {
    let mut b = Config::<Js>::builder_sized(
        DynState(spec.initial),
        JsContext,
        spec.states.len(),
        spec.kinds as usize,
    );
    for _ in 0..spec.computed {
        b.computed_external("");
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
    fn guard(this: &HostObject, f: u32, event: &JsValue) -> u32;
    /// 0, or 1 when it failed. `pre` is what to deliver first (see `Pre`), or 0.
    #[wasm_bindgen(method)]
    fn action(this: &HostObject, f: u32, event: &JsValue, pre: u32) -> u32;
    /// Start an effect; the host keeps its cleanup. 0, or 1 when it failed. `pre` as for
    /// `action`.
    #[wasm_bindgen(method)]
    fn effect(this: &HostObject, f: u32, event: &JsValue, pre: u32) -> u32;
    /// Deliver `pre` on its own. 0, or 1 when it failed.
    #[wasm_bindgen(method)]
    fn pre(this: &HostObject, pre: u32) -> u32;
    /// The delay in ms, or -1 when it failed.
    #[wasm_bindgen(method)]
    fn delay(this: &HostObject, f: u32, event: &JsValue) -> f64;
    /// 0, `CHANGED` when the value changed (it stays in JS), or 1 when it failed. What
    /// the evaluation read arrives first (`JsMachine::report`) when it differs from the
    /// previous evaluation.
    #[wasm_bindgen(method)]
    fn computed(this: &HostObject, id: u32) -> u32;
    /// The index of the first candidate of guard list `list` that passes, -1 for none,
    /// -2 when a guard failed.
    #[wasm_bindgen(method)]
    fn pick(this: &HostObject, list: u32, event: &JsValue) -> i32;
    /// Run action list `list` in order. 0, or 1 when an action failed. `pre` as for
    /// `action`.
    #[wasm_bindgen(method)]
    fn actions(this: &HostObject, list: u32, event: &JsValue, pre: u32) -> u32;
    /// Run transition `id` whole, from `from` to `to` (`flags`: 1 stops the effects, 2
    /// starts the target's). 0 done, 1 failed before the switch, 2 failed after it, 3
    /// failed while starting the effects. `pre` as for `action`.
    #[wasm_bindgen(method)]
    fn transition(
        this: &HostObject,
        id: u32,
        from: u32,
        to: u32,
        event: &JsValue,
        flags: u32,
        pre: u32,
    ) -> u32;
}

/// The host's `computed` status bit: the value changed.
const CHANGED: u32 = 2;

struct JsHost {
    link: Rc<Link>,
    /// What the computed evaluation in progress read, when JS reported it.
    report: RefCell<Option<Reads>>,
    /// What rides on the next action or effect call, delivered first (one crossing
    /// instead of two), or at `settle`: bit 0 stops the effects, the bits above hold a
    /// state change (the state + 1; 0 for none).
    pre: Cell<u32>,
}

const STOP_EFFECTS: u32 = 1;

impl JsHost {
    /// What is held back, for a call that delivers it first.
    fn take_pre(&self) -> u32 {
        self.pre.replace(0)
    }

    /// Deliver what is held back, now.
    fn deliver(&self) {
        let pre = self.take_pre();
        if pre != 0 && self.link.host.pre(pre) != OK {
            self.link.fail();
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
        match with_event(event, |e| self.link.host.guard(id, e)) {
            0 => false,
            1 => true,
            _ => {
                self.link.fail();
                false
            }
        }
    }

    fn action(&self, id: u32, event: Option<&JsEvent>) {
        let pre = self.take_pre();
        if with_event(event, |e| self.link.host.action(id, e, pre)) != OK {
            self.link.fail();
        }
    }

    fn effect(&self, id: u32, event: Option<&JsEvent>) {
        let pre = self.take_pre();
        if with_event(event, |e| self.link.host.effect(id, e, pre)) != OK {
            self.link.fail();
        }
    }

    fn stop_effects(&self) {
        // A state change held back belongs before this stop.
        if self.pre.get() > STOP_EFFECTS {
            self.deliver();
        }
        self.pre.set(self.pre.get() | STOP_EFFECTS);
    }

    fn delay(&self, id: u32, event: Option<&JsEvent>) -> u32 {
        self.deliver();
        let ms = with_event(event, |e| self.link.host.delay(id, e));
        if ms.is_nan() || ms < 0.0 {
            self.link.fail();
            return 0;
        }
        ms as u32
    }

    fn computed(&self, id: u32) -> Evaluation {
        self.deliver();
        let status = self.link.host.computed(id);
        if status & FAILED != 0 {
            self.link.fail();
        }
        Evaluation {
            changed: status & CHANGED != 0,
            reads: self.report.borrow_mut().take(),
        }
    }

    fn pick(&self, list: u32, event: Option<&JsEvent>) -> Option<usize> {
        self.deliver();
        match with_event(event, |e| self.link.host.pick(list, e)) {
            -2 => {
                self.link.fail();
                None
            }
            picked => usize::try_from(picked).ok(),
        }
    }

    fn actions(&self, list: u32, event: Option<&JsEvent>) {
        let pre = self.take_pre();
        if with_event(event, |e| self.link.host.actions(list, e, pre)) != OK {
            self.link.fail();
        }
    }

    fn notify(&self, state: DynState, changes: Changes) {
        // Context writes are JS's to announce; a state change waits for the next call.
        if changes.fields != 0 {
            self.deliver();
            self.link.notify(state.0, changes);
            return;
        }
        if self.pre.get() > STOP_EFFECTS {
            self.deliver();
        }
        self.pre.set(self.pre.get() | ((state.0 + 1) << 1));
    }

    fn settle(&self) {
        self.deliver();
    }

    fn transition(
        &self,
        id: u32,
        from: DynState,
        to: DynState,
        event: Option<&JsEvent>,
        stop: bool,
        start: bool,
    ) -> HostTransition {
        let pre = self.take_pre();
        let flags = u32::from(stop) | (u32::from(start) << 1);
        let outcome = with_event(event, |e| {
            self.link.host.transition(id, from.0, to.0, e, flags, pre)
        });
        if outcome != OK {
            self.link.fail();
        }
        match outcome {
            0 => HostTransition::Done,
            1 => HostTransition::FailedBefore,
            2 => HostTransition::FailedAfter,
            _ => HostTransition::FailedInEffects,
        }
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
    /// `host` is the JS host object; its functions run for the machine whose call is in
    /// progress.
    #[wasm_bindgen(constructor)]
    pub fn new(config: &JsConfig, host: HostObject) -> JsMachine {
        let machine = Machine::new(&config.config);
        let link = Rc::new(Link::new(host, machine.halt_flag()));
        let bridge = Bridge::new(machine);
        bridge.connect(link.clone());
        let host = Rc::new(JsHost {
            link,
            report: RefCell::new(None),
            pre: Cell::new(0),
        });
        bridge.machine().set_host(host.clone());
        JsMachine { bridge, host }
    }

    pub fn send(&self, kind: u32, event: JsValue) -> u32 {
        self.bridge.call(|m| m.send(JsEvent { kind, value: event }))
    }

    pub fn start(&self) -> u32 {
        self.bridge.start()
    }

    pub fn stop(&self) -> u32 {
        self.bridge.stop()
    }

    pub fn running(&self) -> bool {
        self.bridge.machine().is_running()
    }

    pub fn state(&self) -> u32 {
        self.bridge.machine().state().0
    }

    /// JS changed context fields (`lo`/`hi`: the low and high 32 bits of the mask), and
    /// the machine has watchers: they may run.
    #[wasm_bindgen(js_name = markChanged)]
    pub fn mark_changed(&self, lo: u32, hi: u32) -> u32 {
        self.bridge.call(|m| {
            m.mark_changed((u64::from(hi) << 32) | u64::from(lo));
        })
    }

    /// JS changed context fields, and the machine has computed values but no watchers:
    /// only stamp them. No code runs, so there is no status.
    pub fn stamp(&self, lo: u32, hi: u32) {
        self.bridge
            .machine()
            .mark_changed((u64::from(hi) << 32) | u64::from(lo));
    }

    /// Bring computed `id` up to date, evaluating what changed. JS holds the values.
    pub fn computed(&self, id: u32) -> u32 {
        self.bridge.call(|m| {
            m.computed_version(id as usize);
        })
    }

    /// What the computed evaluation in progress read, when it differs from the previous
    /// evaluation (`lo`/`hi`: the fields; `state`; the other computed values).
    pub fn report(&self, lo: u32, hi: u32, state: bool, computed: Option<Vec<u32>>) {
        *self.host.report.borrow_mut() = Some(Reads {
            fields: (u64::from(hi) << 32) | u64::from(lo),
            state,
            computed: computed
                .into_iter()
                .flatten()
                .map(|id| id as usize)
                .collect(),
        });
    }

    /// The host clock: timer `id` (from `startTimer`) came due.
    pub fn fire(&self, id: u32) -> u32 {
        self.bridge.fire(id)
    }

    /// The engine's failure behind status 3.
    #[wasm_bindgen(js_name = takeFailure)]
    pub fn take_failure(&self) -> Option<String> {
        self.bridge.take_failure()
    }
}
