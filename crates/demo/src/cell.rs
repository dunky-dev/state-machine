//! The benchmark "cell": one state, two counters. `hit` changes the observed field,
//! `miss` an unobserved one (mirrors `makeCoreMachine` in benchmark/competitors.ts).

use dunky_core::{Config, Context, Event, State, Types};
use serde::Deserialize;

#[derive(State, Clone, Copy, PartialEq, Eq, Debug)]
pub enum CellState {
    Idle,
}

#[derive(Event, Clone, Debug, Deserialize)]
#[event(deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CellEvent {
    Hit,
    Miss,
}

#[derive(Context, Clone, Debug, PartialEq, Default)]
#[context(serialize)]
pub struct CellCtx {
    pub value: u32,
    pub other: u32,
}

pub struct Cell;

impl Types for Cell {
    type State = CellState;
    type Event = CellEvent;
    type Context = CellCtx;
}

pub fn config() -> Config<Cell> {
    let mut b = Config::<Cell>::builder(CellState::Idle, CellCtx::default());
    b.state(CellState::Idle, |s| {
        s.on(CellEventKind::Hit, |t| {
            t.run(|p| {
                let value = p.context().value + 1;
                p.set_context(CellCtx::patch().value(value));
            })
        })
        .on(CellEventKind::Miss, |t| {
            t.run(|p| {
                let other = p.context().other + 1;
                p.set_context(CellCtx::patch().other(other));
            })
        })
    });
    b.build()
}
