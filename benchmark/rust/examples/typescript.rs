//! Prints the TS types of the exported classes; `pnpm build:wasm` appends them to the
//! module's `.d.ts`, where `fromWasm` reads them.

fn main() {
    print!("{}", dunky_benchmark::typescript());
}
