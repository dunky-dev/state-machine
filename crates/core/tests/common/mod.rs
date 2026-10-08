//! Fixtures shared by several test files: recorders (the stand-ins for pushing into an
//! array and for `vi.fn()`) and the two small machines most behaviors are pinned on.
#![allow(dead_code)]

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use dunky_core::{
    ActionParams, Cleanup, Config, ConfigBuilder, Context, Event, Machine, State, Types,
};

/// Records entries in order.
pub struct Log<T = String>(Rc<RefCell<Vec<T>>>);

impl<T> Clone for Log<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl<T> Default for Log<T> {
    fn default() -> Self {
        Self(Rc::default())
    }
}

impl<T: Clone + 'static> Log<T> {
    pub fn push(&self, entry: impl Into<T>) {
        self.0.borrow_mut().push(entry.into());
    }
    pub fn entries(&self) -> Vec<T> {
        self.0.borrow().clone()
    }
    pub fn is_empty(&self) -> bool {
        self.0.borrow().is_empty()
    }
    pub fn clear(&self) {
        self.0.borrow_mut().clear();
    }
}

impl Log<String> {
    /// An action that records `entry`.
    pub fn action<T: Types>(
        &self,
        entry: &'static str,
    ) -> impl Fn(&mut ActionParams<'_, T>) + 'static {
        let log = self.clone();
        move |_| log.push(entry)
    }
    /// An effect cleanup that records `entry`.
    fn cleanup(&self, entry: &'static str) -> Cleanup {
        let log = self.clone();
        Box::new(move || log.push(entry))
    }
    /// A plain listener that records `entry`.
    pub fn listener(&self, entry: &'static str) -> impl Fn() + 'static {
        let log = self.clone();
        move || log.push(entry)
    }
    /// An effect that records `start` when it starts and returns a cleanup recording
    /// `cleanup`; either may be omitted.
    pub fn effect<T: Types>(
        &self,
        start: Option<&'static str>,
        cleanup: Option<&'static str>,
    ) -> impl Fn(&mut ActionParams<'_, T>) -> Option<Cleanup> + 'static {
        let log = self.clone();
        move |_| {
            if let Some(entry) = start {
                log.push(entry);
            }
            cleanup.map(|entry| log.cleanup(entry))
        }
    }
}

/// Counts calls.
#[derive(Clone, Default)]
pub struct Calls(Rc<Cell<usize>>);

impl Calls {
    pub fn hit(&self) {
        self.0.set(self.0.get() + 1);
    }
    pub fn count(&self) -> usize {
        self.0.get()
    }
    pub fn listener(&self) -> impl Fn() + 'static {
        let calls = self.clone();
        move || calls.hit()
    }
    pub fn action<T: Types>(&self) -> impl Fn(&mut ActionParams<'_, T>) + 'static {
        let calls = self.clone();
        move |_| calls.hit()
    }
    /// An effect that counts its starts; its cleanup, if `cleanups` is given, counts there.
    pub fn effect<T: Types>(
        &self,
        cleanups: Option<&Calls>,
    ) -> impl Fn(&mut ActionParams<'_, T>) -> Option<Cleanup> + 'static {
        let calls = self.clone();
        let cleanups = cleanups.cloned();
        move |_| {
            calls.hit();
            cleanups
                .clone()
                .map(|c| Box::new(move || c.hit()) as Cleanup)
        }
    }
}

pub fn build<T: Types>(builder: &mut ConfigBuilder<T>) -> Machine<T> {
    Machine::new(&builder.build())
}

/// Two states, no context: `a --toB--> b --toA--> a`.
pub struct Ab;

#[derive(Clone, Copy, PartialEq, Eq, Debug, State)]
pub enum AbState {
    A,
    B,
}

#[derive(Clone, Debug, Event)]
pub enum AbEvent {
    ToB,
    ToA,
}

impl Types for Ab {
    type State = AbState;
    type Event = AbEvent;
    type Context = ();
}

pub fn ab() -> ConfigBuilder<Ab> {
    let mut b = Config::<Ab>::builder(AbState::A, ());
    b.state(AbState::A, |s| {
        s.on(AbEventKind::ToB, |t| t.target(AbState::B))
    })
    .state(AbState::B, |s| {
        s.on(AbEventKind::ToA, |t| t.target(AbState::A))
    });
    b
}

/// One state counting `inc` events in `n`.
pub struct Counter;

#[derive(Clone, Copy, PartialEq, Eq, Debug, State)]
pub enum CounterState {
    Idle,
}

#[derive(Clone, Debug, Event)]
pub enum CounterEvent {
    Inc,
}

#[derive(Clone, Debug, PartialEq, Context)]
pub struct Count {
    pub n: i32,
}

impl Types for Counter {
    type State = CounterState;
    type Event = CounterEvent;
    type Context = Count;
}

pub fn counter() -> ConfigBuilder<Counter> {
    let mut b = Config::<Counter>::builder(CounterState::Idle, Count { n: 0 });
    b.state(CounterState::Idle, |s| {
        s.on(CounterEventKind::Inc, |t| {
            t.act(|p| Count::patch().n(p.context().n + 1))
        })
    });
    b
}
