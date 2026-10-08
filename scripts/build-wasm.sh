#!/usr/bin/env bash
# Build the wasm of the sandbox machines written in Rust (crates/sandbox -> its pkg/),
# with their TS types: what `?machine=rust` and the sandbox's Rust tests load.
# Needs: rustup target wasm32-unknown-unknown, wasm-bindgen-cli matching the crate
# version (see Cargo.toml), and optionally wasm-opt (binaryen) for the size pass.
set -euo pipefail
cd "$(dirname "$0")/.."
# The features rustc enables by default for wasm32 (Rust >= 1.82); binaryen must accept them.
WASM_OPT_FLAGS=(-Oz --strip-debug --strip-producers
  --enable-bulk-memory --enable-bulk-memory-opt --enable-nontrapping-float-to-int
  --enable-sign-ext --enable-mutable-globals --enable-reference-types --enable-multivalue)

# build <crate> <lib name> <out dir> [cargo args...]
build() {
  local crate=$1 lib=$2 out=$3
  shift 3
  cargo build -p "$crate" --target wasm32-unknown-unknown --profile wasm "$@"
  # --target web: one ES module for browsers (init) and Node/Bun/tests (initSync).
  # --weak-refs: instances are freed by a FinalizationRegistry.
  # --reference-types: JS values cross as externrefs, so passing one costs no JS call.
  wasm-bindgen --target web --weak-refs --reference-types --out-dir "$out" "target/wasm32-unknown-unknown/wasm/$lib.wasm"
  if command -v wasm-opt >/dev/null 2>&1; then
    wasm-opt "${WASM_OPT_FLAGS[@]}" "$out/${lib}_bg.wasm" -o "$out/${lib}_bg.wasm"
  else
    echo "wasm-opt not found: skipping the size pass (brew install binaryen)" >&2
  fi
  local raw gz
  raw=$(wc -c < "$out/${lib}_bg.wasm" | tr -d ' ')
  gz=$(gzip -9c "$out/${lib}_bg.wasm" | wc -c | tr -d ' ')
  echo "$crate: ${raw} B raw, ${gz} B gzip"
}

# types <crate> <.d.ts> [cargo args...] — a Rust machine's TS types come from its Rust
# types: the crate's `typescript` example prints them for each exported class, and they
# join the class wasm-bindgen declared, where fromWasm reads them.
types() {
  local crate=$1 dts=$2
  shift 2
  cargo run -q -p "$crate" --example typescript "$@" >> "$dts"
}

build dunky-sandbox dunky_sandbox crates/sandbox/pkg --features wasm
types dunky-sandbox crates/sandbox/pkg/dunky_sandbox.d.ts --features wasm
