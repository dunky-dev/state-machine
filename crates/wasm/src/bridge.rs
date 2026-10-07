//! What every machine exported to JS shares, TS-authored (the runtime) or Rust
//! (`export_machine!`): the JS host it calls back into, the failure flag of a call, and
//! the host clock that runs its timers.
//!
//! The host is one JS object per module. Its functions take numbers and return status
//! codes, so a call crosses the boundary once, with nothing to box or free. They run for
//! the machine whose call is in progress, which JS keeps track of itself: no reference to
//! the facade crosses, and Rust holds no JS object of a machine, so no JS <-> wasm
//! reference cycle keeps a machine alive.
//!
//! JS owns the errors: a host function catches what user code throws, keeps it, and
//! returns a failure status. Rust only stops the step and reports the status back.

use std::cell::{Cell, OnceCell, RefCell};
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
    fn notify(this: &HostObject, state: u32, lo: u32, hi: u32) -> u32;

    /// Returns the host's timeout.
    #[wasm_bindgen(method, js_name = startTimer)]
    fn start_timer(this: &HostObject, id: u32, ms: u32) -> JsValue;

    #[wasm_bindgen(method, js_name = cancelTimer)]
    fn cancel_timer(this: &HostObject, timeout: &JsValue);
}

/// One machine's line to the JS host.
pub(crate) struct Link {
    pub(crate) host: HostObject,
    /// The machine's halt flag: a host function failed during the current call.
    failed: Rc<Cell<bool>>,
}

impl Link {
    pub(crate) fn new(host: HostObject, halt: Rc<Cell<bool>>) -> Self {
        Self { host, failed: halt }
    }

    pub(crate) fn fail(&self) {
        self.failed.set(true);
    }

    pub(crate) fn failed(&self) -> bool {
        self.failed.get()
    }

    pub(crate) fn notify(&self, state: u32, changes: Changes) {
        let (lo, hi) = (changes.fields as u32, (changes.fields >> 32) as u32);
        if self.host.notify(state, lo, hi) != OK {
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

    /// Run `f` on the machine and report a status. The outermost call also runs the
    /// timer commands. `FAILED` means user code failed during this very call: a nested
    /// call (JS calling back in) does not report a failure from before it.
    pub fn call(&self, f: impl FnOnce(&Machine<T>)) -> u32 {
        let depth = self.depth.get();
        let link = self.link.get();
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
            // The flag is the machine's: the engine raises it for its own failure too.
            if link.failed.replace(false) {
                return match self.machine.take_failure() {
                    Some(message) => self.fail(message),
                    None => FAILED,
                };
            }
            return OK;
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

    pub fn start(&self) -> u32 {
        self.call(|m| m.start())
    }

    pub fn stop(&self) -> u32 {
        self.call(|m| m.stop())
    }

    /// The host clock: timer `id` came due.
    pub fn fire(&self, id: u32) -> u32 {
        {
            let mut timers = self.timers.borrow_mut();
            if let Some(pos) = timers.iter().position(|(t, _)| *t == id) {
                timers.swap_remove(pos);
            }
        }
        self.call(|m| m.fire_timer(id))
    }

    /// The core emits timer commands; the host runs them on its clock (`setTimeout`).
    pub(crate) fn run_timers(&self, link: &Link) {
        if !self.machine.has_commands() {
            return;
        }
        for command in self.machine.take_commands() {
            match command {
                Command::StartTimer { id, ms } => {
                    let timeout = link.host.start_timer(id, ms);
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
