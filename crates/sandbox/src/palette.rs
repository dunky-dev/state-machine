//! The command palette — a faithful port of `sandbox/shared/src/machine.ts`.
//!
//! Two states (`closed` / `open`); all the interesting logic (filter, navigate with
//! wraparound, clamp) lives in context + computed, driven by logical events. A renderer
//! never computes an index: it sends `move` / `query.set` and reads `results` / `activeId`.

use dunky_state_machine::{ComputedKey, Config, Context, Event, State, TsType, Types};
use serde::{Deserialize, Serialize};

#[derive(TsType, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Command {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
}

/// Stamped on every execute; the nonce makes each execution a distinct value.
#[derive(TsType, Clone, Debug, PartialEq, Serialize)]
pub struct Executed {
    pub id: String,
    pub nonce: u32,
}

#[derive(State, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PaletteState {
    Closed,
    Open,
}

#[derive(TsType, Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MoveTo {
    Up,
    Down,
    First,
    Last,
}

#[derive(Event, Clone, Debug, Deserialize)]
#[event(deserialize)]
#[serde(tag = "type")]
pub enum PaletteEvent {
    #[serde(rename = "open")]
    Open,
    #[serde(rename = "close")]
    Close,
    #[serde(rename = "query.set")]
    QuerySet { query: String },
    #[serde(rename = "move")]
    Move { to: MoveTo },
    #[serde(rename = "highlight")]
    Highlight { index: i64 },
    #[serde(rename = "execute")]
    Execute,
}

#[derive(Context, Clone, Debug, PartialEq)]
#[context(serialize)]
pub struct PaletteCtx {
    /// Every command, in source order. Filtering is derived, never stored.
    pub commands: Vec<Command>,
    pub query: String,
    /// Highlighted row, as an index into the FILTERED list.
    pub active_index: u32,
    pub last_executed: Option<Executed>,
}

pub struct Palette;

impl Types for Palette {
    type State = PaletteState;
    type Event = PaletteEvent;
    type Context = PaletteCtx;
}

/// The filtered list — what every renderer reads.
pub const RESULTS: ComputedKey<Vec<Command>> = ComputedKey::new(0);
/// The highlighted command's id, clamped to the current results.
pub const ACTIVE_ID: ComputedKey<Option<String>> = ComputedKey::new(1);
/// The filtered list as indices into `commands` — lets a JS host keep its own command
/// objects and only receive numbers across the boundary.
pub const RESULT_INDICES: ComputedKey<Vec<u32>> = ComputedKey::new(2);

/// Subsequence match on the lowercased label ("gpr" matches "Go to Pull Requests").
pub fn matches(query: &str, label: &str) -> bool {
    let q = query.trim().to_lowercase();
    q.is_empty() || is_subsequence(&q, &label.to_lowercase())
}

pub fn filter_commands(commands: &[Command], query: &str) -> Vec<Command> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return commands.to_vec();
    }
    commands
        .iter()
        .filter(|c| is_subsequence(&q, &c.label.to_lowercase()))
        .cloned()
        .collect()
}

pub fn filter_indices(commands: &[Command], query: &str) -> Vec<u32> {
    let q = query.trim().to_lowercase();
    commands
        .iter()
        .enumerate()
        .filter(|(_, c)| q.is_empty() || is_subsequence(&q, &c.label.to_lowercase()))
        .map(|(i, _)| i as u32)
        .collect()
}

fn is_subsequence(needle: &str, haystack: &str) -> bool {
    let mut needle = needle.chars().peekable();
    for ch in haystack.chars() {
        match needle.peek() {
            Some(n) if *n == ch => {
                needle.next();
            }
            Some(_) => {}
            None => break,
        }
    }
    needle.peek().is_none()
}

/// A fresh palette context over `commands` (pair with a shared config via
/// `Machine::with_context`).
pub fn context(commands: Vec<Command>) -> PaletteCtx {
    PaletteCtx {
        commands,
        query: String::new(),
        active_index: 0,
        last_executed: None,
    }
}

pub fn config(commands: Vec<Command>) -> Config<Palette> {
    use PaletteEventKind as E;
    use PaletteState::{Closed, Open};
    let mut b = Config::<Palette>::builder(Closed, context(commands));

    let results = b.computed("results", |c| {
        filter_commands(c.context.commands(), c.context.query())
    });
    let active_id = b.computed("activeId", move |c| {
        let results = c.computed(results);
        let last = results.len().checked_sub(1)?;
        let i = (*c.context.active_index() as usize).min(last);
        Some(results[i].id.clone())
    });
    let indices = b.computed("resultIndices", |c| {
        filter_indices(c.context.commands(), c.context.query())
    });
    assert_eq!(
        (results.id(), active_id.id(), indices.id()),
        (RESULTS.id(), ACTIVE_ID.id(), RESULT_INDICES.id())
    );

    // Set the query and reset the highlight to the top of the new result set.
    b.action("setQuery", |p| {
        if let Some(PaletteEvent::QuerySet { query }) = p.event() {
            p.set_context(PaletteCtx::patch().query(query.clone()).active_index(0u32));
        }
    });
    // Move within the FILTERED list, wrapping at both ends.
    b.action("move", |p| {
        let Some(PaletteEvent::Move { to }) = p.event() else {
            return;
        };
        let count = p.computed(RESULTS).len() as u32;
        if count == 0 {
            return;
        }
        let cur = p.context().active_index;
        let next = match to {
            MoveTo::First => 0,
            MoveTo::Last => count - 1,
            MoveTo::Down => (cur + 1) % count,
            MoveTo::Up => (cur + count - 1) % count,
        };
        p.set_context(PaletteCtx::patch().active_index(next));
    });
    // Jump straight to a row (pointer hover / click).
    b.action("highlight", |p| {
        let Some(PaletteEvent::Highlight { index }) = p.event() else {
            return;
        };
        let count = p.computed(RESULTS).len() as i64;
        if count == 0 {
            return;
        }
        let i = (*index).clamp(0, count - 1) as u32;
        p.set_context(PaletteCtx::patch().active_index(i));
    });
    // Stamp the highlighted command as executed; no-op when nothing matches.
    b.action("execute", |p| {
        let Some(id) = (*p.computed(ACTIVE_ID)).clone() else {
            return;
        };
        let nonce = p.context().last_executed.as_ref().map_or(0, |e| e.nonce) + 1;
        p.set_context(PaletteCtx::patch().last_executed(Executed { id, nonce }));
    });
    // Each open starts fresh.
    b.action("reset", |p| {
        p.set_context(PaletteCtx::patch().query("").active_index(0u32))
    });

    b.state(Closed, |s| {
        s.on(E::Open, |t| t.target(Open).action("reset"))
    });
    b.state(Open, |s| {
        s.on(E::Close, |t| t.target(Closed))
            .on(E::QuerySet, |t| t.action("setQuery"))
            .on(E::Move, |t| t.action("move"))
            .on(E::Highlight, |t| t.action("highlight"))
            // Stamp the selection, then close. The connector's reaction observes the stamp.
            .on(E::Execute, |t| t.target(Closed).action("execute"))
    });
    b.build()
}

/// The demo command set from `sandbox/shared/src/commands.ts`.
pub fn demo_commands() -> Vec<Command> {
    let c = |id: &str, label: &str, hint: Option<&str>, group: &str| Command {
        id: id.into(),
        label: label.into(),
        hint: hint.map(Into::into),
        group: Some(group.into()),
    };
    vec![
        c("home", "Go to Dashboard", Some("g h"), "Navigation"),
        c("issues", "Go to Issues", Some("g i"), "Navigation"),
        c("prs", "Go to Pull Requests", Some("g p"), "Navigation"),
        c("settings", "Open Settings", Some(","), "Navigation"),
        c("new-issue", "Create New Issue", Some("c i"), "Actions"),
        c("new-pr", "Open a Pull Request", Some("c p"), "Actions"),
        c("invite", "Invite Teammate", None, "Actions"),
        c("theme-light", "Theme: Light", None, "Preferences"),
        c("theme-dark", "Theme: Dark", None, "Preferences"),
        c("theme-system", "Theme: System", None, "Preferences"),
        c("logout", "Log Out", None, "Account"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use dunky_state_machine::Machine;

    fn open_palette() -> Machine<Palette> {
        let m = Machine::new(&config(demo_commands()));
        m.start();
        m.send(PaletteEvent::Open);
        m
    }

    #[test]
    fn filters_by_subsequence_and_resets_highlight() {
        let m = open_palette();
        m.send(PaletteEvent::Move { to: MoveTo::Down });
        assert_eq!(m.context().active_index, 1);
        m.send(PaletteEvent::QuerySet {
            query: "gpr".into(),
        });
        assert_eq!(m.context().active_index, 0);
        let results = m.computed(RESULTS);
        assert_eq!(
            results.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            ["prs"]
        );
        assert_eq!(*m.computed(RESULT_INDICES), vec![2]);
    }

    #[test]
    fn navigation_wraps_and_execute_stamps_then_closes() {
        let m = open_palette();
        m.send(PaletteEvent::Move { to: MoveTo::Up });
        assert_eq!(*m.computed(ACTIVE_ID), Some("logout".to_string()));
        m.send(PaletteEvent::Execute);
        assert_eq!(m.state(), PaletteState::Closed);
        assert_eq!(
            m.context().last_executed,
            Some(Executed {
                id: "logout".into(),
                nonce: 1
            })
        );
    }

    #[test]
    fn payload_events_rebuild_from_kind_and_fields_only() {
        use dunky_state_machine::{DeserializeEvent, EventEnum};
        let decode = |kind: PaletteEventKind, value: serde_json::Value| {
            PaletteEvent::deserialize_payload(PaletteEvent::kind_index(kind), value)
        };
        let set = decode(
            PaletteEventKind::QuerySet,
            serde_json::json!({ "type": "query.set", "query": "gpr" }),
        );
        assert!(matches!(set, Ok(PaletteEvent::QuerySet { ref query }) if query == "gpr"));
        let moved = decode(PaletteEventKind::Move, serde_json::json!({ "to": "last" }));
        assert!(matches!(moved, Ok(PaletteEvent::Move { to: MoveTo::Last })));
        assert!(matches!(
            decode(PaletteEventKind::Open, serde_json::json!({})),
            Ok(PaletteEvent::Open)
        ));
        assert!(
            decode(
                PaletteEventKind::Highlight,
                serde_json::json!({ "index": "x" })
            )
            .is_err()
        );
    }

    #[test]
    fn computed_results_are_memoized_until_an_input_changes() {
        let m = open_palette();
        let a = m.computed(RESULTS);
        let b = m.computed(RESULTS);
        assert!(std::rc::Rc::ptr_eq(&a, &b));
        let v1 = m.computed_version(RESULTS.id());
        m.send(PaletteEvent::Move { to: MoveTo::Down }); // active_index only
        assert_eq!(m.computed_version(RESULTS.id()), v1);
        m.send(PaletteEvent::QuerySet {
            query: "theme".into(),
        });
        assert_ne!(m.computed_version(RESULTS.id()), v1);
    }
}
