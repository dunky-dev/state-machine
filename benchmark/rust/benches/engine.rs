//! The Rust engine's benchmark: the TS suite's engine scenarios, run natively.
//!
//!   cargo bench -p dunky-benchmark
//!   DUNKY_BENCH=guard cargo bench -p dunky-benchmark   # only the rows that match
//!
//! Each row is the twin of a row in `benchmark/ts`, so the two READMEs compare the same
//! work. ops/sec is the median of 5 samples of ~100 ms, after a 100 ms warmup.

use std::alloc::{GlobalAlloc, Layout, System};
use std::hint::black_box;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use dunky_benchmark::*;
use dunky_core::Machine;

/// Counts live heap bytes (the memory rows) and allocations (the frame rows).
struct Counting;

static LIVE: AtomicUsize = AtomicUsize::new(0);
static ALLOCS: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        LIVE.fetch_add(layout.size(), Ordering::Relaxed);
        ALLOCS.fetch_add(1, Ordering::Relaxed);
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
        unsafe { System.dealloc(ptr, layout) }
    }
}

#[global_allocator]
static ALLOC: Counting = Counting;

const SAMPLES: usize = 5;
const SAMPLE: Duration = Duration::from_millis(100);

/// `DUNKY_BENCH_LONG=1` samples for 2 s each: long enough to attach a profiler.
fn sample_time() -> Duration {
    if std::env::var_os("DUNKY_BENCH_LONG").is_some() {
        Duration::from_secs(2)
    } else {
        SAMPLE
    }
}
const BATCH: u64 = 1_000;

fn ops_per_sec(mut op: impl FnMut()) -> f64 {
    let sample = sample_time();
    let warm = Instant::now();
    while warm.elapsed() < sample {
        for _ in 0..BATCH {
            op();
        }
    }
    let mut samples = Vec::with_capacity(SAMPLES);
    for _ in 0..SAMPLES {
        let start = Instant::now();
        let mut n = 0u64;
        while start.elapsed() < sample {
            for _ in 0..BATCH {
                op();
            }
            n += BATCH;
        }
        samples.push(n as f64 / start.elapsed().as_secs_f64());
    }
    samples.sort_by(f64::total_cmp);
    samples[SAMPLES / 2]
}

fn human(ops: f64) -> String {
    if ops >= 1e6 {
        format!("{:.1} M", ops / 1e6)
    } else if ops >= 1e3 {
        format!("{:.1} K", ops / 1e3)
    } else {
        format!("{ops:.0}")
    }
}

fn section(title: &str) {
    println!("\n### {title}");
    println!(
        "| {:<46} | {:>10} | {:>8} |",
        "scenario", "ops/sec", "ns/op"
    );
    println!("| {:-<46} | {:->10} | {:->8} |", "", "", "");
}

/// The `DUNKY_BENCH` filter: run only the rows whose name contains it.
fn selected(name: &str) -> bool {
    std::env::var("DUNKY_BENCH").map_or(true, |filter| name.contains(&filter))
}

fn row(name: &str, op: impl FnMut()) {
    if !selected(name) {
        return;
    }
    let ops = ops_per_sec(op);
    println!("| {name:<46} | {:>10} | {:>8.1} |", human(ops), 1e9 / ops);
}

/// One frame at 60 fps.
const FRAME_MS: f64 = 1000.0 / 60.0;
/// Frames timed per workload (10 s of 60 fps), after a warmup of 60.
const FRAMES: usize = 600;

/// Time `work` (one frame's worth of machine work) frame by frame: the median, p99 and
/// worst frame, as a share of the 16.67 ms budget, and the allocations per frame.
fn frame(name: &str, mut work: impl FnMut()) {
    if !selected(name) {
        return;
    }
    for _ in 0..60 {
        work();
    }
    let mut times = Vec::with_capacity(FRAMES);
    let allocs_before = ALLOCS.load(Ordering::Relaxed);
    for _ in 0..FRAMES {
        let start = Instant::now();
        work();
        times.push(start.elapsed().as_secs_f64() * 1e3);
    }
    let allocs = (ALLOCS.load(Ordering::Relaxed) - allocs_before) as f64 / FRAMES as f64;
    times.sort_by(f64::total_cmp);
    let median = times[FRAMES / 2];
    let p99 = times[FRAMES * 99 / 100];
    let worst = times[FRAMES - 1];
    let pct = |ms: f64| ms / FRAME_MS * 100.0;
    println!(
        "| {name:<40} | {median:>6.3} ms ({:>4.1}%) | {p99:>6.3} ms ({:>4.1}%) | {worst:>6.3} ms ({:>4.1}%) | {allocs:>6.1} |",
        pct(median),
        pct(p99),
        pct(worst),
    );
}

fn frame_budget() {
    println!("\n### Frame budget at 60 fps (one frame = {FRAME_MS:.2} ms, {FRAMES} frames each)");
    println!(
        "| {:<40} | {:>17} | {:>17} | {:>17} | {:>6} |",
        "workload per frame", "median", "p99", "worst", "allocs"
    );
    println!(
        "| {:-<40} | {:->17} | {:->17} | {:->17} | {:->6} |",
        "", "", "", "", ""
    );

    let cell = cell_config();
    for n in [1_000, 10_000] {
        let cells: Vec<_> = (0..n).map(|_| observed_cell(&cell)).collect();
        let label = if n == 1_000 { "1,000" } else { "10,000" };
        frame(&format!("{label} machines, 1 event each"), || {
            for c in &cells {
                c.send(CellEvent::Hit);
            }
        });
    }
    let one = observed_cell(&cell);
    frame("1 machine, 10,000 events", || {
        for _ in 0..10_000 {
            one.send(CellEvent::Hit);
        }
    });
    let churn = effect_churn_config();
    let machines: Vec<_> = (0..1_000)
        .map(|_| {
            let m = Machine::new(&churn);
            m.start();
            m
        })
        .collect();
    frame("1,000 transitions (exit, entry, effects)", || {
        for m in &machines {
            m.send(Go::Go);
        }
    });
    let (config, keys) = computed_config();
    let calc = Machine::new(&config);
    calc.start();
    frame("1,000 computed recomputes", || {
        for _ in 0..1_000 {
            calc.send(ComputedEvent::BumpA);
            black_box(calc.computed(keys.sum));
        }
    });
    let wide = Machine::new(&wide_config());
    wide.start();
    for k in 0..64 {
        std::mem::forget(wide_select(&wide, k).subscribe(|_| bump()));
    }
    let mut i = 0;
    frame("64 observers, 1,000 field changes", || {
        for _ in 0..1_000 {
            wide.send(WideEvent::Set { key: i % 64 });
            i += 1;
        }
    });
}

fn main() {
    println!("Rust engine benchmark (dunky-core, native, release build)");

    frame_budget();

    section("Throughput and fan-out");
    let cell = cell_config();
    let m = observed_cell(&cell);
    row("one event (observed field)", || m.send(CellEvent::Hit));
    for n in [1_000, 5_000] {
        let cells: Vec<_> = (0..n).map(|_| observed_cell(&cell)).collect();
        let mut i = 0;
        let label = if n == 1_000 { "1,000" } else { "5,000" };
        row(&format!("unobserved write, {label} cells"), || {
            cells[i % n].send(CellEvent::Miss);
            i += 1;
        });
    }
    let wide = Machine::new(&wide_config());
    wide.start();
    for k in 0..64 {
        let sel = wide_select(&wide, k);
        std::mem::forget(sel.subscribe(|_| bump()));
    }
    let mut i = 0;
    row("1 change, 64 observers", || {
        wide.send(WideEvent::Set { key: i % 64 });
        i += 1;
    });

    section("Computed");
    let (config, keys) = computed_config();
    let m = Machine::new(&config);
    m.start();
    m.send(ComputedEvent::BumpA);
    black_box(m.computed(keys.sum));
    row("cached read (no change)", || {
        black_box(m.computed(keys.sum));
    });
    row("fine-grain (change unread, re-read)", || {
        m.send(ComputedEvent::BumpUnrelated);
        black_box(m.computed(keys.sum));
    });
    row("recompute (change read field)", || {
        m.send(ComputedEvent::BumpA);
        black_box(m.computed(keys.sum));
    });
    row("4-deep chain (change root, read tip)", || {
        m.send(ComputedEvent::BumpA);
        black_box(m.computed(keys.c4));
    });

    section("Engine paths");
    for k in [2, 8, 32] {
        let m = Machine::new(&guards_config(k));
        m.start();
        row(&format!("guard fallthrough, {k} candidates"), || {
            m.send(Go::Go)
        });
    }
    let m = Machine::new(&state_churn_config());
    m.start();
    row("state churn (exit + entry every event)", || m.send(Go::Go));
    let m = Machine::new(&effect_churn_config());
    m.start();
    row("effect churn (boot + cleanup each transition)", || {
        m.send(Go::Go)
    });

    println!("\n### Construction and memory");
    println!("| {:<46} | {:>10} |", "scenario", "value");
    println!("| {:-<46} | {:->10} |", "", "");
    let mut passes: Vec<f64> = (0..5)
        .map(|_| {
            let start = Instant::now();
            let machines: Vec<_> = (0..10_000)
                .map(|_| {
                    let m = Machine::new(&cell);
                    m.start();
                    m
                })
                .collect();
            let ns = start.elapsed().as_secs_f64() * 1e9 / 10_000.0;
            black_box(machines);
            ns
        })
        .collect();
    passes.sort_by(f64::total_cmp);
    println!(
        "| {:<46} | {:>7.0} ns |",
        "build + start, per machine (10,000)", passes[2]
    );

    let n = 5_000;
    let before = LIVE.load(Ordering::Relaxed);
    let thin: Vec<_> = (0..n)
        .map(|_| {
            let m = Machine::new(&cell);
            m.start();
            m.send(CellEvent::Hit);
            m
        })
        .collect();
    let per = (LIVE.load(Ordering::Relaxed) - before) as f64 / n as f64 / 1024.0;
    println!(
        "| {:<46} | {:>7.2} KB |",
        "memory, 2-field context, written (5,000)", per
    );
    drop(thin);
    let wide = wide_config();
    let before = LIVE.load(Ordering::Relaxed);
    let fat: Vec<_> = (0..n)
        .map(|_| {
            let m = Machine::new(&wide);
            m.start();
            m.send(WideEvent::Set { key: 0 });
            m
        })
        .collect();
    let per = (LIVE.load(Ordering::Relaxed) - before) as f64 / n as f64 / 1024.0;
    println!(
        "| {:<46} | {:>7.2} KB |",
        "memory, 64-field context, written (5,000)", per
    );
    drop(fat);

    println!("\n(sink: {})", sink());
}
