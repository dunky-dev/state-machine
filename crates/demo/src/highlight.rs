//! The rendering bench's per-row machine: each row owns one boolean
//! (mirrors `makeCoreHighlightMachine` in benchmark/tests/rendering/bench.tsx).

use dunky_core::{Config, Context, Event, State, Types};
use serde::Deserialize;

#[derive(State, Clone, Copy, PartialEq, Eq, Debug)]
pub enum HighlightState {
    Idle,
}

#[derive(Event, Clone, Debug, Deserialize)]
#[event(deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HighlightEvent {
    Set { on: bool },
}

#[derive(Context, Clone, Debug, PartialEq, Default)]
#[context(serialize)]
pub struct HighlightCtx {
    pub on: bool,
}

pub struct Highlight;

impl Types for Highlight {
    type State = HighlightState;
    type Event = HighlightEvent;
    type Context = HighlightCtx;
}

pub fn config() -> Config<Highlight> {
    let mut b = Config::<Highlight>::builder(HighlightState::Idle, HighlightCtx::default());
    b.state(HighlightState::Idle, |s| {
        s.on(HighlightEventKind::Set, |t| {
            t.act(|p| match p.event() {
                Some(HighlightEvent::Set { on }) => HighlightCtx::patch().on(*on),
                None => HighlightCtx::patch(),
            })
        })
    });
    b.build()
}
