//! What every machine exported to JS shares, TS-authored (the runtime) or Rust
//! (`export_machine!`): the JS host it calls back into, the failure flag of a call, and
//! the host clock that runs its timers.
//!
//! The host is one JS object per module. Its functions take numbers and return status
//! codes, so a call crosses the boundary once, with nothing to box or free. JS passes the
//! machine's facade with each call into Rust, and Rust hands it to every host function
//! of that call, then lets it go: Rust holds no JS object between calls, so no
//! JS <-> wasm reference cycle keeps a machine alive.
//!
//! JS owns the errors: a host function catches what user code throws, keeps it, and
//! returns a failure status. Rust only stops the step and reports the status back.

use std::cell::{Cell, OnceCell, Ref, RefCell};
use std::rc::Rc;

use dunky_core::{Changes, Command, Machine, Types};
use wasm_bindgen::prelude::*;

/// A call finished.
pub const OK: u32 = 0;
/// User code failed during the call; the JS side holds the error.
pub const FAILED: u32 = 1;
/// The engine failed (a feedback loop, a malformed event): read `takeFailure()`.
pub const ENGINE_FAILED: u32 = 3;

#[wasm_bindgen]
extern "C" {
    /// The JS host object.
    #[derive(Clone)]
    pub type HostObject;

    /// Once per effective change. Returns 0, or 1 when an observer threw.
    #[wasm_bindgen(method)]
    fn notify(this: &HostObject, facade: &JsValue, state: u32, lo: u32, hi: u32) -> u32;

    /// Returns the host's timeout.
    #[wasm_bindgen(method, js_name = startTimer)]
    fn start_timer(this: &HostObject, facade: &JsValue, id: u32, ms: u32) -> JsValue;

    #[wasm_bindgen(method, js_name = cancelTimer)]
    fn cancel_timer(this: &HostObject, timeout: &JsValue);
}

/// One machine's line to the JS host.
pub(crate) struct Link {
    pub(crate) host: HostObject,
    /// The facade of the call in progress; `undefined` between calls.
    facade: RefCell<JsValue>,
    /// The machine's halt flag: a host function failed during the current call.
    failed: Rc<Cell<bool>>,
}

impl Link {
    pub(crate) fn new(host: HostObject, halt: Rc<Cell<bool>>) -> Self {
        Self {
            host,
            facade: RefCell::new(JsValue::UNDEFINED),
            failed: halt,
        }
    }

    /// What every host function of the call in progress receives.
    pub(crate) fn facade(&self) -> Ref<'_, JsValue> {
        self.facade.borrow()
    }

    pub(crate) fn fail(&self) {
        self.failed.set(true);
    }

    pub(crate) fn failed(&self) -> bool {
        self.failed.get()
    }

    pub(crate) fn notify(&self, state: u32, changes: Changes) {
        let (lo, hi) = (changes.fields as u32, (changes.fields >> 32) as u32);
        if self.host.notify(&self.facade(), state, lo, hi) != OK {
            self.fail();
        }
    }
}

/// A machine exported to JS: runs each call to completion, then the timer commands, and
/// reports a status.
pub struct Bridge<T: Types> {
    machine: Machine<T>,
    link: OnceCell<Rc<Link>>,
    /// Pending timers: the engine's timer id, and the host's timeout.
    timers: RefCell<Vec<(u32, JsValue)>>,
    /// Nesting of calls (JS code calls back in); the outermost one runs the timers.
    depth: Cell<u32>,
    /// The engine's own failure, until JS takes it.
    failure: RefCell<Option<String>>,
}

impl<T: Types> Bridge<T> {
    pub fn new(machine: Machine<T>) -> Self {
        Self {
            machine,
            link: OnceCell::new(),
            timers: RefCell::default(),
            depth: Cell::new(0),
            failure: RefCell::new(None),
        }
    }

    pub fn machine(&self) -> &Machine<T> {
        &self.machine
    }

    /// Connect to the JS host. Returns false when already connected.
    pub(crate) fn connect(&self, link: Rc<Link>) -> bool {
        self.link.set(link).is_ok()
    }

    pub(crate) fn attached(&self) -> bool {
        self.link.get().is_some()
    }

    /// Run `f` on the machine and report a status. `facade` is the JS facade calling;
    /// the outermost call keeps it for the host functions, runs the timer commands, then
    /// lets it go. `FAILED` means user code failed during this very call: a nested call
    /// (JS calling back in) does not report a failure from before it.
    pub fn call(&self, facade: JsValue, f: impl FnOnce(&Machine<T>)) -> u32 {
        let depth = self.depth.get();
        let link = self.link.get();
        if depth == 0
            && let Some(link) = link
        {
            *link.facade.borrow_mut() = facade;
        }
        let failed_before = link.is_some_and(|l| l.failed());
        self.depth.set(depth + 1);
        f(&self.machine);
        self.depth.set(depth);
        let failed = link.is_some_and(|l| l.failed());
        if depth > 0 {
            return if failed && !failed_before { FAILED } else { OK };
        }
        if let Some(link) = link {
            self.run_timers(link);
            *link.facade.borrow_mut() = JsValue::UNDEFINED;
            // The flag is the machine's: the engine raises it for its own failure too.
            let halted = link.failed.replace(false);
            if let Some(message) = self.machine.take_failure() {
                return self.fail(message);
            }
            if halted {
                return FAILED;
            }
        }
        match self.machine.take_failure() {
            Some(message) => self.fail(message),
            None => OK,
        }
    }

    /// Keep the engine's `message` for `take_failure`.
    pub fn fail(&self, message: String) -> u32 {
        *self.failure.borrow_mut() = Some(message);
        ENGINE_FAILED
    }

    pub fn take_failure(&self) -> Option<String> {
        self.failure.borrow_mut().take()
    }

    pub fn start(&self, facade: JsValue) -> u32 {
        self.call(facade, |m| m.start())
    }

    pub fn stop(&self, facade: JsValue) -> u32 {
        self.call(facade, |m| m.stop())
    }

    /// The host clock: timer `id` came due.
    pub fn fire(&self, id: u32, facade: JsValue) -> u32 {
        {
            let mut timers = self.timers.borrow_mut();
            if let Some(pos) = timers.iter().position(|(t, _)| *t == id) {
                timers.swap_remove(pos);
            }
        }
        self.call(facade, |m| m.fire_timer(id))
    }

    /// The core emits timer commands; the host runs them on its clock (`setTimeout`).
    pub(crate) fn run_timers(&self, link: &Link) {
        if !self.machine.has_commands() {
            return;
        }
        for command in self.machine.take_commands() {
            match command {
                Command::StartTimer { id, ms } => {
                    let timeout = link.host.start_timer(&link.facade(), id, ms);
                    self.timers.borrow_mut().push((id, timeout));
                }
                Command::CancelTimer { id } => {
                    let timeout = {
                        let mut timers = self.timers.borrow_mut();
                        let pos = timers.iter().position(|(t, _)| *t == id);
                        pos.map(|pos| timers.swap_remove(pos).1)
                    };
                    if let Some(timeout) = timeout {
                        link.host.cancel_timer(&timeout);
                    }
                }
            }
        }
    }
}
