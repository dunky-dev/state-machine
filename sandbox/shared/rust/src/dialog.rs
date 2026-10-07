//! A dialog with an exit phase: `closing` lasts `exit_ms` (a named, context-driven delay)
//! before `closed`, so a renderer can animate out. Shows `after` timers running through
//! the host's clock.

use dunky_core::{Config, Context, Event, State, Types};
use serde::Deserialize;

#[derive(State, Clone, Copy, PartialEq, Eq, Debug)]
pub enum DialogState {
    Closed,
    Open,
    Closing,
}

#[derive(Event, Clone, Debug, Deserialize)]
#[event(deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DialogEvent {
    Open,
    Close,
    Toggle,
}

#[derive(Context, Clone, Debug, PartialEq)]
#[context(serialize)]
pub struct DialogCtx {
    /// How long `closing` lasts. Seeded from props.
    pub exit_ms: u32,
    /// How many times the dialog opened (demo data for the change mask).
    pub open_count: u32,
}

pub struct Dialog;

impl Types for Dialog {
    type State = DialogState;
    type Event = DialogEvent;
    type Context = DialogCtx;
}

pub fn config(exit_ms: u32) -> Config<Dialog> {
    use DialogEventKind as E;
    use DialogState::{Closed, Closing, Open};
    let mut b = Config::<Dialog>::builder(
        Closed,
        DialogCtx {
            exit_ms,
            open_count: 0,
        },
    );
    b.delay("exitDelay", |g| g.context().exit_ms);
    b.action("countOpen", |p| {
        let n = p.context().open_count + 1;
        p.set_context(DialogCtx::patch().open_count(n));
    });
    b.state(Closed, |s| {
        s.on(E::Open, |t| t.target(Open).action("countOpen"))
            .on(E::Toggle, |t| t.target(Open).action("countOpen"))
    });
    b.state(Open, |s| {
        s.tag("visible")
            .on(E::Close, |t| t.target(Closing))
            .on(E::Toggle, |t| t.target(Closing))
    });
    b.state(Closing, |s| {
        s.tag("visible")
            .after("exitDelay", |t| t.target(Closed))
            .on(E::Open, |t| t.target(Open).action("countOpen"))
            .on(E::Toggle, |t| t.target(Open).action("countOpen"))
    });
    b.build()
}
