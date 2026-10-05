//! Guard fallthrough: `k` guarded candidates for one event where only the LAST passes
//! (mirrors benchmark/tests/engine.ts, section A).

use dunky_core::{Config, Context, Event, State, Types};
use serde::Deserialize;

use crate::bump;

#[derive(State, Clone, Copy, PartialEq, Eq, Debug)]
pub enum GuardsState {
    Idle,
}

#[derive(Event, Clone, Debug, Deserialize)]
#[event(deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GuardsEvent {
    Go,
}

#[derive(Context, Clone, Debug, PartialEq)]
#[context(serialize)]
pub struct GuardsCtx {
    pub pick: u32,
}

pub struct Guards;

impl Types for Guards {
    type State = GuardsState;
    type Event = GuardsEvent;
    type Context = GuardsCtx;
}

pub fn config(k: u32) -> Config<Guards> {
    assert!(k > 0, "at least one candidate");
    let mut b = Config::<Guards>::builder(GuardsState::Idle, GuardsCtx { pick: k - 1 });
    b.state(GuardsState::Idle, |mut s| {
        for i in 0..k {
            s = s.on(GuardsEventKind::Go, move |t| {
                t.guard_fn(move |g| g.context().pick == i).run(|_| bump())
            });
        }
        s
    });
    b.build()
}
