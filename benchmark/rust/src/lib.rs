//! The machines of the Rust benchmark: twins of the TS suite's machines
//! (`benchmark/ts/competitors.ts` and `benchmark/ts/tests`), so a row measures the same
//! work on each engine. `benches/engine.rs` runs them.

use std::cell::Cell;

use dunky_core::{ComputedKey, Config, Context, Event, Machine, State, Types};

thread_local! {
    static SINK: Cell<u64> = const { Cell::new(0) };
}

/// Side work an action or a listener does, so nothing is optimized away.
pub fn bump() {
    SINK.with(|s| s.set(s.get() + 1));
}

pub fn sink() -> u64 {
    SINK.with(Cell::get)
}

#[derive(State, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Idle {
    Idle,
}

// ---------------------------------------------------------------------------------
// The cell: `hit` bumps `value`, `miss` bumps `other` (makeCoreCell).

#[derive(Event, Clone, Debug)]
pub enum CellEvent {
    Hit,
    Miss,
}

#[derive(Context, Clone, Debug, PartialEq)]
pub struct CellCtx {
    pub value: u32,
    pub other: u32,
}

pub struct CellMachine;
impl Types for CellMachine {
    type State = Idle;
    type Event = CellEvent;
    type Context = CellCtx;
}

pub fn cell_config() -> Config<CellMachine> {
    let mut b = Config::<CellMachine>::builder(Idle::Idle, CellCtx { value: 0, other: 0 });
    b.state(Idle::Idle, |s| {
        s.on(CellEventKind::Hit, |t| {
            t.act(|p| CellCtx::patch().value(p.context().value + 1))
        })
        .on(CellEventKind::Miss, |t| {
            t.act(|p| CellCtx::patch().other(p.context().other + 1))
        })
    });
    b.build()
}

/// A started cell whose `value` is observed (a value-deduped selection), like the TS cell.
pub fn observed_cell(config: &Config<CellMachine>) -> Machine<CellMachine> {
    let m = Machine::new(config);
    m.start();
    std::mem::forget(m.select(|v| v.context().value).subscribe(|_| bump()));
    m
}

// ---------------------------------------------------------------------------------
// The widest context: 64 fields, one observer per field (makeCoreFanout, at the most a
// typed Rust context holds).

#[derive(Event, Clone, Debug)]
pub enum WideEvent {
    Set { key: usize },
}

#[derive(Context, Clone, Debug, PartialEq)]
pub struct W64 {
    pub f0: u32,
    pub f1: u32,
    pub f2: u32,
    pub f3: u32,
    pub f4: u32,
    pub f5: u32,
    pub f6: u32,
    pub f7: u32,
    pub f8: u32,
    pub f9: u32,
    pub f10: u32,
    pub f11: u32,
    pub f12: u32,
    pub f13: u32,
    pub f14: u32,
    pub f15: u32,
    pub f16: u32,
    pub f17: u32,
    pub f18: u32,
    pub f19: u32,
    pub f20: u32,
    pub f21: u32,
    pub f22: u32,
    pub f23: u32,
    pub f24: u32,
    pub f25: u32,
    pub f26: u32,
    pub f27: u32,
    pub f28: u32,
    pub f29: u32,
    pub f30: u32,
    pub f31: u32,
    pub f32: u32,
    pub f33: u32,
    pub f34: u32,
    pub f35: u32,
    pub f36: u32,
    pub f37: u32,
    pub f38: u32,
    pub f39: u32,
    pub f40: u32,
    pub f41: u32,
    pub f42: u32,
    pub f43: u32,
    pub f44: u32,
    pub f45: u32,
    pub f46: u32,
    pub f47: u32,
    pub f48: u32,
    pub f49: u32,
    pub f50: u32,
    pub f51: u32,
    pub f52: u32,
    pub f53: u32,
    pub f54: u32,
    pub f55: u32,
    pub f56: u32,
    pub f57: u32,
    pub f58: u32,
    pub f59: u32,
    pub f60: u32,
    pub f61: u32,
    pub f62: u32,
    pub f63: u32,
}

pub struct Wide;
impl Types for Wide {
    type State = Idle;
    type Event = WideEvent;
    type Context = W64;
}

/// Field `k` of the wide context (a typed context has no field by index).
pub fn wide_field(c: &W64, k: usize) -> u32 {
    match k % 64 {
        0 => c.f0,
        1 => c.f1,
        2 => c.f2,
        3 => c.f3,
        4 => c.f4,
        5 => c.f5,
        6 => c.f6,
        7 => c.f7,
        8 => c.f8,
        9 => c.f9,
        10 => c.f10,
        11 => c.f11,
        12 => c.f12,
        13 => c.f13,
        14 => c.f14,
        15 => c.f15,
        16 => c.f16,
        17 => c.f17,
        18 => c.f18,
        19 => c.f19,
        20 => c.f20,
        21 => c.f21,
        22 => c.f22,
        23 => c.f23,
        24 => c.f24,
        25 => c.f25,
        26 => c.f26,
        27 => c.f27,
        28 => c.f28,
        29 => c.f29,
        30 => c.f30,
        31 => c.f31,
        32 => c.f32,
        33 => c.f33,
        34 => c.f34,
        35 => c.f35,
        36 => c.f36,
        37 => c.f37,
        38 => c.f38,
        39 => c.f39,
        40 => c.f40,
        41 => c.f41,
        42 => c.f42,
        43 => c.f43,
        44 => c.f44,
        45 => c.f45,
        46 => c.f46,
        47 => c.f47,
        48 => c.f48,
        49 => c.f49,
        50 => c.f50,
        51 => c.f51,
        52 => c.f52,
        53 => c.f53,
        54 => c.f54,
        55 => c.f55,
        56 => c.f56,
        57 => c.f57,
        58 => c.f58,
        59 => c.f59,
        60 => c.f60,
        61 => c.f61,
        62 => c.f62,
        63 => c.f63,
        _ => unreachable!(),
    }
}

pub fn wide_config() -> Config<Wide> {
    let mut b = Config::<Wide>::builder(
        Idle::Idle,
        W64 {
            f0: 0,
            f1: 0,
            f2: 0,
            f3: 0,
            f4: 0,
            f5: 0,
            f6: 0,
            f7: 0,
            f8: 0,
            f9: 0,
            f10: 0,
            f11: 0,
            f12: 0,
            f13: 0,
            f14: 0,
            f15: 0,
            f16: 0,
            f17: 0,
            f18: 0,
            f19: 0,
            f20: 0,
            f21: 0,
            f22: 0,
            f23: 0,
            f24: 0,
            f25: 0,
            f26: 0,
            f27: 0,
            f28: 0,
            f29: 0,
            f30: 0,
            f31: 0,
            f32: 0,
            f33: 0,
            f34: 0,
            f35: 0,
            f36: 0,
            f37: 0,
            f38: 0,
            f39: 0,
            f40: 0,
            f41: 0,
            f42: 0,
            f43: 0,
            f44: 0,
            f45: 0,
            f46: 0,
            f47: 0,
            f48: 0,
            f49: 0,
            f50: 0,
            f51: 0,
            f52: 0,
            f53: 0,
            f54: 0,
            f55: 0,
            f56: 0,
            f57: 0,
            f58: 0,
            f59: 0,
            f60: 0,
            f61: 0,
            f62: 0,
            f63: 0,
        },
    );
    b.state(Idle::Idle, |s| {
        s.on(WideEventKind::Set, |t| {
            t.act(|p| {
                let Some(WideEvent::Set { key }) = p.event() else {
                    return W64::patch();
                };
                let c = p.context();
                match key % 64 {
                    0 => W64::patch().f0(c.f0 + 1),
                    1 => W64::patch().f1(c.f1 + 1),
                    2 => W64::patch().f2(c.f2 + 1),
                    3 => W64::patch().f3(c.f3 + 1),
                    4 => W64::patch().f4(c.f4 + 1),
                    5 => W64::patch().f5(c.f5 + 1),
                    6 => W64::patch().f6(c.f6 + 1),
                    7 => W64::patch().f7(c.f7 + 1),
                    8 => W64::patch().f8(c.f8 + 1),
                    9 => W64::patch().f9(c.f9 + 1),
                    10 => W64::patch().f10(c.f10 + 1),
                    11 => W64::patch().f11(c.f11 + 1),
                    12 => W64::patch().f12(c.f12 + 1),
                    13 => W64::patch().f13(c.f13 + 1),
                    14 => W64::patch().f14(c.f14 + 1),
                    15 => W64::patch().f15(c.f15 + 1),
                    16 => W64::patch().f16(c.f16 + 1),
                    17 => W64::patch().f17(c.f17 + 1),
                    18 => W64::patch().f18(c.f18 + 1),
                    19 => W64::patch().f19(c.f19 + 1),
                    20 => W64::patch().f20(c.f20 + 1),
                    21 => W64::patch().f21(c.f21 + 1),
                    22 => W64::patch().f22(c.f22 + 1),
                    23 => W64::patch().f23(c.f23 + 1),
                    24 => W64::patch().f24(c.f24 + 1),
                    25 => W64::patch().f25(c.f25 + 1),
                    26 => W64::patch().f26(c.f26 + 1),
                    27 => W64::patch().f27(c.f27 + 1),
                    28 => W64::patch().f28(c.f28 + 1),
                    29 => W64::patch().f29(c.f29 + 1),
                    30 => W64::patch().f30(c.f30 + 1),
                    31 => W64::patch().f31(c.f31 + 1),
                    32 => W64::patch().f32(c.f32 + 1),
                    33 => W64::patch().f33(c.f33 + 1),
                    34 => W64::patch().f34(c.f34 + 1),
                    35 => W64::patch().f35(c.f35 + 1),
                    36 => W64::patch().f36(c.f36 + 1),
                    37 => W64::patch().f37(c.f37 + 1),
                    38 => W64::patch().f38(c.f38 + 1),
                    39 => W64::patch().f39(c.f39 + 1),
                    40 => W64::patch().f40(c.f40 + 1),
                    41 => W64::patch().f41(c.f41 + 1),
                    42 => W64::patch().f42(c.f42 + 1),
                    43 => W64::patch().f43(c.f43 + 1),
                    44 => W64::patch().f44(c.f44 + 1),
                    45 => W64::patch().f45(c.f45 + 1),
                    46 => W64::patch().f46(c.f46 + 1),
                    47 => W64::patch().f47(c.f47 + 1),
                    48 => W64::patch().f48(c.f48 + 1),
                    49 => W64::patch().f49(c.f49 + 1),
                    50 => W64::patch().f50(c.f50 + 1),
                    51 => W64::patch().f51(c.f51 + 1),
                    52 => W64::patch().f52(c.f52 + 1),
                    53 => W64::patch().f53(c.f53 + 1),
                    54 => W64::patch().f54(c.f54 + 1),
                    55 => W64::patch().f55(c.f55 + 1),
                    56 => W64::patch().f56(c.f56 + 1),
                    57 => W64::patch().f57(c.f57 + 1),
                    58 => W64::patch().f58(c.f58 + 1),
                    59 => W64::patch().f59(c.f59 + 1),
                    60 => W64::patch().f60(c.f60 + 1),
                    61 => W64::patch().f61(c.f61 + 1),
                    62 => W64::patch().f62(c.f62 + 1),
                    63 => W64::patch().f63(c.f63 + 1),
                    _ => unreachable!(),
                }
            })
        })
    });
    b.build()
}

// ---------------------------------------------------------------------------------
// Computed: `sum` reads a + b; a 4-deep chain off `a` (benchmark/ts/tests/computed.ts).

#[derive(Event, Clone, Debug)]
pub enum ComputedEvent {
    BumpA,
    BumpUnrelated,
}

#[derive(Context, Clone, Debug, PartialEq)]
pub struct ComputedCtx {
    pub a: u32,
    pub b: u32,
    pub unrelated: u32,
}

pub struct Computed;
impl Types for Computed {
    type State = Idle;
    type Event = ComputedEvent;
    type Context = ComputedCtx;
}

pub struct ComputedKeys {
    pub sum: ComputedKey<u32>,
    pub c4: ComputedKey<u32>,
}

pub fn computed_config() -> (Config<Computed>, ComputedKeys) {
    let mut b = Config::<Computed>::builder(
        Idle::Idle,
        ComputedCtx {
            a: 0,
            b: 0,
            unrelated: 0,
        },
    );
    let sum = b.computed("sum", |c| c.context.a() + c.context.b());
    let c1 = b.computed("c1", |c| c.context.a() + 1);
    let c2 = b.computed("c2", move |c| *c.computed(c1) + 1);
    let c3 = b.computed("c3", move |c| *c.computed(c2) + 1);
    let c4 = b.computed("c4", move |c| *c.computed(c3) + 1);
    b.state(Idle::Idle, |s| {
        s.on(ComputedEventKind::BumpA, |t| {
            t.act(|p| ComputedCtx::patch().a(p.context().a + 1))
        })
        .on(ComputedEventKind::BumpUnrelated, |t| {
            t.act(|p| ComputedCtx::patch().unrelated(p.context().unrelated + 1))
        })
    });
    (b.build(), ComputedKeys { sum, c4 })
}

// ---------------------------------------------------------------------------------
// Engine paths (benchmark/ts/tests/engine.ts).

#[derive(Event, Clone, Debug)]
pub enum Go {
    Go,
}

#[derive(Context, Clone, Debug, PartialEq)]
pub struct PickCtx {
    pub pick: u32,
}

pub struct Guards;
impl Types for Guards {
    type State = Idle;
    type Event = Go;
    type Context = PickCtx;
}

/// `k` guarded candidates for `go`; the last one passes, so every send walks them all.
pub fn guards_config(k: u32) -> Config<Guards> {
    let mut b = Config::<Guards>::builder(Idle::Idle, PickCtx { pick: k - 1 });
    b.state(Idle::Idle, |mut s| {
        for i in 0..k {
            s = s.on(GoKind::Go, move |t| {
                t.guard_fn(move |g| g.context().pick == i)
            });
        }
        s
    });
    b.build()
}

#[derive(State, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PingPong {
    Ping,
    Pong,
}

#[derive(Context, Clone, Debug, PartialEq)]
pub struct NCtx {
    pub n: u32,
}

pub struct Churn;
impl Types for Churn {
    type State = PingPong;
    type Event = Go;
    type Context = NCtx;
}

/// Ping <-> pong; each state has entry and exit actions.
pub fn state_churn_config() -> Config<Churn> {
    let mut b = Config::<Churn>::builder(PingPong::Ping, NCtx { n: 0 });
    for (from, to) in [
        (PingPong::Ping, PingPong::Pong),
        (PingPong::Pong, PingPong::Ping),
    ] {
        b.state(from, |s| {
            s.entry_run(|_| bump())
                .exit_run(|_| bump())
                .on(GoKind::Go, move |t| t.target(to))
        });
    }
    b.build()
}

/// Ping <-> pong; each state boots an effect on entry and runs its cleanup on exit.
pub fn effect_churn_config() -> Config<Churn> {
    let mut b = Config::<Churn>::builder(PingPong::Ping, NCtx { n: 0 });
    for (from, to) in [
        (PingPong::Ping, PingPong::Pong),
        (PingPong::Pong, PingPong::Ping),
    ] {
        b.state(from, |s| {
            s.effect_run(|_| {
                bump();
                Some(Box::new(bump))
            })
            .on(GoKind::Go, move |t| t.target(to))
        });
    }
    b.build()
}
