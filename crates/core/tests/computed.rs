//! Computed values: lazy, memoized derivations of context, state and other computed
//! values, recomputed only when an input they read has changed.
//!
//! Not ported:
//! - "no computed config → params.computed is an empty bag": JS params carry a `computed`
//!   object; Rust reads computed values by typed key, so there is no such object.
//! - "derives a value from context, readable in an action", "a computed can derive from
//!   another computed" and "reads the current state": each is the opening step of other
//!   tests here (recomputes_after_the_context_it_reads_changes,
//!   an_upstream_change_propagates_through_a_chain, and the two state-reader tests).
//! - "a computed selection fires on change and dedups (value-gated)": the same
//!   `select_computed` contract as subscribe.rs (select_computed_selects_a_derived_value).

mod common;

use common::{Calls, Log, build};
use dunky_state_machine::{
    ComputedKey, Config, ConfigBuilder, Context, Event, Machine, State, StateEnum, Types,
};

struct M;

#[derive(Clone, Copy, PartialEq, Eq, Debug, State)]
enum S {
    Idle,
    Busy,
    Done,
}

#[derive(Clone, Debug, Event)]
enum Ev {
    Read,
    Add,
    BumpN,
    BumpOther,
    Rename,
    UseDiscount,
    SetDiscount(i32),
    SetNote,
    Go,
    Finish,
}

#[derive(Clone, Debug, Default, Context)]
struct Ctx {
    items: Vec<i32>,
    n: i32,
    other: i32,
    first: String,
    last: String,
    use_discount: bool,
    price: i32,
    discount: i32,
    note: String,
}

impl Types for M {
    type State = S;
    type Event = Ev;
    type Context = Ctx;
}

/// Any-state handlers write the context; `go` / `finish` walk idle -> busy -> done.
/// Tests add their computed values and a `read` handler.
fn builder(ctx: Ctx) -> ConfigBuilder<M> {
    let mut b = Config::<M>::builder(S::Idle, ctx);
    b.on(EvKind::Add, |t| {
        t.act(|p| {
            let mut items = p.context().items.clone();
            items.push(1);
            Ctx::patch().items(items)
        })
    })
    .on(EvKind::BumpN, |t| {
        t.act(|p| Ctx::patch().n(p.context().n + 1))
    })
    .on(EvKind::BumpOther, |t| {
        t.act(|p| Ctx::patch().other(p.context().other + 1))
    })
    .on(EvKind::Rename, |t| t.act(|_| Ctx::patch().first("Grace")))
    .on(EvKind::UseDiscount, |t| {
        t.act(|_| Ctx::patch().use_discount(true))
    })
    .on(EvKind::SetDiscount, |t| {
        t.act(|p| match p.event() {
            Some(Ev::SetDiscount(discount)) => Ctx::patch().discount(*discount),
            _ => Ctx::patch(),
        })
    })
    .on(EvKind::SetNote, |t| t.act(|_| Ctx::patch().note("hi")))
    .state(S::Idle, |s| s.on(EvKind::Go, |t| t.target(S::Busy)))
    .state(S::Busy, |s| s.on(EvKind::Finish, |t| t.target(S::Done)));
    b
}

fn names() -> Ctx {
    Ctx {
        first: "Ada".into(),
        last: "Lovelace".into(),
        ..Ctx::default()
    }
}

#[test]
fn recomputes_after_the_context_it_reads_changes() {
    let seen: Log<bool> = Log::default();
    let mut b = builder(Ctx::default());
    let is_empty = b.computed("isEmpty", |p| p.context.items().is_empty());
    b.on(EvKind::Read, |t| {
        let seen = seen.clone();
        t.run(move |p| seen.push(*p.computed(is_empty)))
    });
    let m = build(&mut b);
    m.send(Ev::Read);
    m.send(Ev::Add);
    m.send(Ev::Read);
    assert_eq!(seen.entries(), [true, false]);
}

#[test]
fn is_readable_in_a_guard() {
    let mut b = builder(Ctx::default());
    let is_empty = b.computed("isEmpty", |p| p.context.items().is_empty());
    b.state(S::Idle, |s| {
        s.on(EvKind::Finish, |t| {
            t.guard_fn(move |p| !*p.computed(is_empty)).target(S::Done)
        })
    });
    let m = build(&mut b);
    m.send(Ev::Finish); // empty: blocked
    assert_eq!(m.state(), S::Idle);
    m.send(Ev::Add);
    m.send(Ev::Finish);
    assert_eq!(m.state(), S::Done);
}

#[test]
fn is_readable_in_an_effect_at_start() {
    let seen: Log<usize> = Log::default();
    let mut b = builder(Ctx {
        items: vec![1, 2, 3],
        ..Ctx::default()
    });
    let count = b.computed("count", |p| p.context.items().len());
    b.state(S::Idle, |s| {
        let seen = seen.clone();
        s.effect_run(move |p| {
            seen.push(*p.computed(count));
            None
        })
    });
    let m = build(&mut b);
    m.start();
    assert_eq!(seen.entries(), [3]);
}

#[test]
fn memoizes_across_writes_to_fields_it_does_not_read() {
    let runs = Calls::default();
    let mut b = builder(Ctx {
        n: 2,
        ..Ctx::default()
    });
    let double = b.computed("double", {
        let runs = runs.clone();
        move |p| {
            runs.hit();
            p.context.n() * 2
        }
    });
    b.on(EvKind::Read, |t| {
        t.run(move |p| {
            p.computed(double);
        })
    });
    let m = build(&mut b);
    m.send(Ev::Read);
    assert_eq!(runs.count(), 1);
    m.send(Ev::Read);
    assert_eq!(runs.count(), 1);
    m.send(Ev::BumpOther); // `double` does not read `other`
    m.send(Ev::Read);
    assert_eq!(runs.count(), 1);
}

#[test]
fn an_upstream_change_propagates_through_a_chain() {
    let seen: Log<String> = Log::default();
    let mut b = builder(names());
    let full_name = b.computed("fullName", |p| {
        format!("{} {}", p.context.first(), p.context.last())
    });
    let greeting = b.computed("greeting", move |p| {
        format!("Hi, {}", p.computed(full_name))
    });
    b.on(EvKind::Read, |t| {
        let seen = seen.clone();
        t.run(move |p| seen.push((*p.computed(greeting)).clone()))
    });
    let m = build(&mut b);
    m.send(Ev::Read);
    m.send(Ev::Rename);
    m.send(Ev::Read);
    assert_eq!(seen.entries(), ["Hi, Ada Lovelace", "Hi, Grace Lovelace"]);
}

#[test]
fn a_computed_may_read_one_defined_after_it() {
    // Keys are numbered in definition order, so a forward reference is a const key.
    const FULL_NAME: ComputedKey<String> = ComputedKey::new(1);
    let mut b = builder(names());
    let greeting = b.computed("greeting", |p| format!("Hi, {}", p.computed(FULL_NAME)));
    let full_name = b.computed("fullName", |p| {
        format!("{} {}", p.context.first(), p.context.last())
    });
    assert_eq!(full_name.id(), FULL_NAME.id());
    let m = build(&mut b);
    assert_eq!(*m.computed(greeting), "Hi, Ada Lovelace");
}

#[test]
fn a_chain_recomputes_only_when_its_inputs_change() {
    let base_runs = Calls::default();
    let derived_runs = Calls::default();
    let mut b = builder(Ctx {
        n: 1,
        ..Ctx::default()
    });
    let base = b.computed("base", {
        let runs = base_runs.clone();
        move |p| {
            runs.hit();
            p.context.n() * 10
        }
    });
    let derived = b.computed("derived", {
        let runs = derived_runs.clone();
        move |p| {
            runs.hit();
            *p.computed(base) + 1
        }
    });
    b.on(EvKind::Read, |t| {
        t.run(move |p| {
            p.computed(derived);
        })
    });
    let m = build(&mut b);
    let runs = || (base_runs.count(), derived_runs.count());
    m.send(Ev::Read);
    assert_eq!(runs(), (1, 1));
    m.send(Ev::BumpOther); // neither reads `other`
    m.send(Ev::Read);
    assert_eq!(runs(), (1, 1));
    m.send(Ev::BumpN); // base reads n: the whole chain invalidates
    m.send(Ev::Read);
    assert_eq!(runs(), (2, 2));
}

#[test]
fn the_machine_exposes_the_current_value() {
    let mut b = builder(Ctx::default());
    let count = b.computed("count", |p| p.context.items().len());
    let m = build(&mut b);
    assert_eq!(*m.computed(count), 0);
    m.send(Ev::Add);
    assert_eq!(*m.computed(count), 1);
}

#[test]
fn the_machine_exposes_chained_values() {
    let mut b = builder(names());
    let full = b.computed("full", |p| {
        format!("{} {}", p.context.first(), p.context.last())
    });
    let greet = b.computed("greet", move |p| format!("Hi, {}", p.computed(full)));
    let m = build(&mut b);
    assert_eq!(*m.computed(full), "Ada Lovelace");
    assert_eq!(*m.computed(greet), "Hi, Ada Lovelace");
}

/// `total` reads `discount` only while `use_discount` is on.
fn discounted() -> (Machine<M>, ComputedKey<i32>, Calls) {
    let runs = Calls::default();
    let mut b = builder(Ctx {
        price: 100,
        discount: 10,
        ..Ctx::default()
    });
    let total = b.computed("total", {
        let runs = runs.clone();
        move |p| {
            runs.hit();
            if *p.context.use_discount() {
                p.context.price() - p.context.discount()
            } else {
                *p.context.price()
            }
        }
    });
    (build(&mut b), total, runs)
}

#[test]
fn a_field_read_only_on_an_untaken_branch_is_not_a_dependency() {
    let (m, total, runs) = discounted();
    assert_eq!(*m.computed(total), 100);
    assert_eq!(runs.count(), 1);
    m.send(Ev::SetDiscount(50));
    assert_eq!(*m.computed(total), 100);
    assert_eq!(runs.count(), 1);
}

#[test]
fn flipping_the_branch_re_tracks_the_dependencies() {
    let (m, total, runs) = discounted();
    assert_eq!(*m.computed(total), 100);
    m.send(Ev::UseDiscount);
    assert_eq!(*m.computed(total), 90);
    assert_eq!(runs.count(), 2);
    m.send(Ev::SetDiscount(30)); // read on the new branch: now a dependency
    assert_eq!(*m.computed(total), 70);
    assert_eq!(runs.count(), 3);
}

/// `is_busy` and `label` read only the state.
fn state_reader() -> (Machine<M>, ComputedKey<bool>, ComputedKey<String>, Calls) {
    let runs = Calls::default();
    let mut b = builder(Ctx::default());
    let is_busy = b.computed("isBusy", |p| p.state() == S::Busy);
    let label = b.computed("label", {
        let runs = runs.clone();
        move |p| {
            runs.hit();
            format!("state={}", p.state().name())
        }
    });
    let m = build(&mut b);
    m.start();
    (m, is_busy, label, runs)
}

#[test]
fn a_transition_invalidates_a_state_reading_computed() {
    let (m, is_busy, label, _) = state_reader();
    assert!(!*m.computed(is_busy));
    m.send(Ev::Go);
    assert!(*m.computed(is_busy));
    assert_eq!(*m.computed(label), "state=busy");
    m.send(Ev::Finish);
    assert!(!*m.computed(is_busy));
    assert_eq!(*m.computed(label), "state=done");
}

#[test]
fn a_context_write_does_not_recompute_a_state_only_computed() {
    let (m, _, label, runs) = state_reader();
    assert_eq!(*m.computed(label), "state=idle");
    assert_eq!(runs.count(), 1);
    m.send(Ev::SetNote);
    assert_eq!(*m.computed(label), "state=idle");
    assert_eq!(runs.count(), 1);
    m.send(Ev::Go);
    assert_eq!(*m.computed(label), "state=busy");
    assert_eq!(runs.count(), 2);
}

// Rust-only: a recompute reuses the value's memory when nothing else holds it, so a
// value a reader still holds must keep what it was.
#[test]
fn a_value_still_held_keeps_its_contents_after_a_recompute() {
    let mut b = builder(Ctx::default());
    let double = b.computed("double", |p| p.context.n() * 2);
    let m = Machine::new(&b.build());
    m.start();
    let held = m.computed(double);
    m.send(Ev::BumpN);
    assert_eq!(*held, 0);
    assert_eq!(*m.computed(double), 2);
    drop(held);
    m.send(Ev::BumpN);
    assert_eq!(*m.computed(double), 4);
}
