#!/usr/bin/env bash
# Build the demo machines to wasm for the JS adapter, benchmark and sandboxes.
# Needs: rustup target wasm32-unknown-unknown, wasm-bindgen-cli matching the crate
# version (see Cargo.toml), and optionally wasm-opt (binaryen) for the size pass.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=packages/demo-wasm/pkg
WASM=target/wasm32-unknown-unknown/wasm/dunky_demo_wasm.wasm

cargo build -p dunky-demo-wasm --target wasm32-unknown-unknown --profile wasm
# --target web: one ES module that works in browsers (await init()) and Node (initSync).
# --weak-refs: instances are freed by a FinalizationRegistry, so JS never calls free().
wasm-bindgen --target web --weak-refs --out-dir "$OUT" "$WASM"

if command -v wasm-opt >/dev/null 2>&1; then
  # The features rustc enables by default for wasm32 (Rust >= 1.82); binaryen must accept them.
  wasm-opt -Oz --strip-debug --strip-producers \
    --enable-bulk-memory --enable-bulk-memory-opt --enable-nontrapping-float-to-int \
    --enable-sign-ext --enable-mutable-globals --enable-reference-types --enable-multivalue \
    "$OUT/dunky_demo_wasm_bg.wasm" -o "$OUT/dunky_demo_wasm_bg.wasm"
else
  echo "wasm-opt not found: skipping the size pass (brew install binaryen)" >&2
fi

raw=$(wc -c < "$OUT/dunky_demo_wasm_bg.wasm" | tr -d ' ')
gz=$(gzip -9c "$OUT/dunky_demo_wasm_bg.wasm" | wc -c | tr -d ' ')
glue=$(gzip -9c "$OUT/dunky_demo_wasm.js" | wc -c | tr -d ' ')
echo "wasm: ${raw} B raw, ${gz} B gzip · JS glue: ${glue} B gzip"
