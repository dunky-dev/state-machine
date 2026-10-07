# dunky-core

The engine of [`@dunky.dev/state-machine`](../../packages/core), and the crate to write
machines in Rust. [`packages/core/SPEC.md`](../../packages/core/SPEC.md) is its behavior
contract; the Rust tests in `tests/` are ported from `packages/core/tests`. Machines
written in TypeScript run on it too (through `dunky-wasm`'s runtime).

```rust
use dunky_core::{Config, Context, Event, Machine, State, Types};

#[derive(State, Clone, Copy, PartialEq, Eq, Debug)]
enum DialogState { Closed, Open }

#[derive(Event, Clone, Debug)]
enum DialogEvent { Open, Close }

#[derive(Context, Clone, Debug, PartialEq)]
struct DialogCtx { open_count: u32 }

struct Dialog;
impl Types for Dialog {
    type State = DialogState;
    type Event = DialogEvent;
    type Context = DialogCtx;
}

let mut b = Config::<Dialog>::builder(DialogState::Closed, DialogCtx { open_count: 0 });
b.action("count", |p| {
    let n = p.context().open_count + 1;
    p.set_context(DialogCtx::patch().open_count(n));
});
b.state(DialogState::Closed, |s| s.on(DialogEventKind::Open, |t| t.target(DialogState::Open).action("count")));
b.state(DialogState::Open, |s| s.on(DialogEventKind::Close, |t| t.target(DialogState::Closed)));
let config = b.build();

let dialog = Machine::new(&config);
dialog.start();
dialog.send(DialogEvent::Open);
assert_eq!(dialog.state(), DialogState::Open);
```

## Learn more

- [`SPEC.md`](./SPEC.md) — what the crate guarantees: authoring in Rust, timers as
  commands, change reporting, and the binding API (cargo feature `host`). The behavior
  contract every machine follows is [`packages/core/SPEC.md`](../../packages/core/SPEC.md).
- [`dunky-wasm`](../wasm) — export a machine to JavaScript; wrap it with `fromWasm` from
  `@dunky.dev/state-machine`.
