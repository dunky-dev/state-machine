//! The wasm module of `@dunky.dev/state-machine`: the runtime for TS-authored machines
//! (see `dunky_wasm::runtime`). Built by `pnpm build:wasm` into `packages/core/wasm`.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

use wasm_bindgen::prelude::*;

pub use dunky_wasm::runtime::{JsConfig, JsMachine};

// The engine's memory lives outside the JS heap, so a JS heap sample misses it. The
// allocator counts the live bytes for the benchmark's memory section.
struct Counted;

static LIVE: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counted {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let ptr = unsafe { System.alloc(layout) };
        if !ptr.is_null() {
            LIVE.fetch_add(layout.size(), Ordering::Relaxed);
        }
        ptr
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) };
        LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        let moved = unsafe { System.realloc(ptr, layout, size) };
        if !moved.is_null() {
            LIVE.fetch_add(size, Ordering::Relaxed);
            LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
        }
        moved
    }
}

#[global_allocator]
static ALLOCATOR: Counted = Counted;

/// The engine's live heap bytes.
#[wasm_bindgen(js_name = engineHeapBytes)]
pub fn engine_heap_bytes() -> f64 {
    LIVE.load(Ordering::Relaxed) as f64
}
