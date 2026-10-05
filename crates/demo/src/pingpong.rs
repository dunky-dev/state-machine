//! Real state churn: every `go` exits one state and enters the other, running exit and
//! entry actions (mirrors benchmark/tests/engine.ts, section B).

use dunky_core::{Config, Event, State, Types};
use serde::Deserialize;

use crate::bump;

#[derive(State, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PingPongState {
    Ping,
    Pong,
}

#[derive(Event, Clone, Debug, Deserialize)]
#[event(deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PingPongEvent {
    Go,
}

pub struct PingPong;

impl Types for PingPong {
    type State = PingPongState;
    type Event = PingPongEvent;
    type Context = ();
}

pub fn config() -> Config<PingPong> {
    use PingPongState::{Ping, Pong};
    let mut b = Config::<PingPong>::builder(Ping, ());
    b.state(Ping, |s| {
        s.entry_run(|_| bump())
            .exit_run(|_| bump())
            .on(PingPongEventKind::Go, |t| t.target(Pong))
    });
    b.state(Pong, |s| {
        s.entry_run(|_| bump())
            .exit_run(|_| bump())
            .on(PingPongEventKind::Go, |t| t.target(Ping))
    });
    b.build()
}
