//! The rendering bench's shared list: one machine holds the highlighted row
//! (mirrors `makeListMachine` in benchmark/tests/rendering/bench.tsx).

use dunky_core::{Config, Context, Event, State, Types};
use serde::Deserialize;

#[derive(State, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ListState {
    Idle,
}

#[derive(Event, Clone, Debug, Deserialize)]
#[event(deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ListEvent {
    Move { to: u32 },
}

#[derive(Context, Clone, Debug, PartialEq, Default)]
#[context(serialize)]
pub struct ListCtx {
    pub highlighted: u32,
}

pub struct List;

impl Types for List {
    type State = ListState;
    type Event = ListEvent;
    type Context = ListCtx;
}

pub fn config() -> Config<List> {
    let mut b = Config::<List>::builder(ListState::Idle, ListCtx::default());
    b.state(ListState::Idle, |s| {
        s.on(ListEventKind::Move, |t| {
            t.act(|p| match p.event() {
                Some(ListEvent::Move { to }) => ListCtx::patch().highlighted(*to),
                None => ListCtx::patch(),
            })
        })
    });
    b.build()
}
