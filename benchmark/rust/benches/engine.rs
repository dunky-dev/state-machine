//! The Rust engine's benchmark: the TS suite's engine scenarios, run natively.
//!
//!   cargo bench -p dunky-benchmark
//!
//! Each row is the twin of a row in `benchmark/ts`, so the two READMEs compare the same
//! work. ops/sec is the median of 5 samples of ~100 ms, after a 100 ms warmup.

use std::alloc::{GlobalAlloc, Layout, System};
use std::hint::black_box;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use dunky_benchmark::*;
use dunky_core::Machine;

/// Counts live heap bytes, for the memory rows.
struct Counting;

static LIVE: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        LIVE.fetch_add(layout.size(), Ordering::Relaxed);
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
const BATCH: u64 = 1_000;

fn ops_per_sec(mut op: impl FnMut()) -> f64 {
    let warm = Instant::now();
    while warm.elapsed() < SAMPLE {
        for _ in 0..BATCH {
            op();
        }
    }
    let mut samples = Vec::with_capacity(SAMPLES);
    for _ in 0..SAMPLES {
        let start = Instant::now();
        let mut n = 0u64;
        while start.elapsed() < SAMPLE {
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

fn row(name: &str, op: impl FnMut()) {
    let ops = ops_per_sec(op);
    println!("| {name:<46} | {:>10} | {:>8.1} |", human(ops), 1e9 / ops);
}

fn main() {
    println!("Rust engine benchmark (dunky-core, native, release build)");

    section("Throughput and fan-out");
    let cell = cell_config();
    let m = observed_cell(&cell);
    row("one event (observed field)", || m.send(CellEvent::Hit));
    for n in [1_000, 5_000] {
        let cells: Vec<_> = (0..n).map(|_| observed_cell(&cell)).collect();
        let mut i = 0;
        row(&format!("unobserved write, {n} cells"), || {
            cells[i % n].send(CellEvent::Miss);
            i += 1;
        });
    }
    let wide = Machine::new(&wide_config());
    wide.start();
    for k in 0..64 {
        let sel = wide.select(move |v| wide_field(v.context(), k));
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
