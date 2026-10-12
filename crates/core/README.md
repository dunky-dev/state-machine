# dunky-state-machine

Dunky's state machines in Rust: the twin of the TypeScript engine,
[`@dunky.dev/state-machine`](../../packages/core). Both follow one behavior contract,
[`packages/core/SPEC.md`](../../packages/core/SPEC.md); the Rust tests in `tests/` are
ported from `packages/core/tests`. Use it in Rust programs and native bindings.

```rust
use dunky_state_machine::{Config, Context, Event, Machine, State, Types};

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
  commands, change reporting, and how it stays in sync with the TS engine. The behavior
  contract both engines follow is [`packages/core/SPEC.md`](../../packages/core/SPEC.md).
