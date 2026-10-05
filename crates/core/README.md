# dunky-core

The Rust port of [`@dunky.dev/state-machine`](../../packages/core). Same engine, same
behavior contract — [`packages/core/SPEC.md`](../../packages/core/SPEC.md) is the spec for
both; the Rust tests in `tests/` are ported from `packages/core/tests`.

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

## Where it differs from the TS engine

- **Typed.** States, events and context are Rust types. `#[derive(Event)]` generates the
  `<Name>Kind` enum that transitions are keyed by; `#[derive(Context)]` generates the
  `<Name>Patch` builder (`Ctx::patch().field(value)`), one `Field` const per field, and a
  tracked reader so computed values record what they read.
- **Sans-IO timers.** The core owns no clock. `after` emits `Command::StartTimer` /
  `Command::CancelTimer` (`Machine::take_commands`); the host runs them and calls
  `Machine::fire_timer(id)`. Tests use `testing::Clock`.
- **Change mask.** `Machine::take_changes` reports which fields (and whether the state)
  changed, so a binding mirrors only those into another runtime.
- **Borrow discipline.** Actions, guards, effects, delays and computed definitions get
  params, not the machine handle. Observers (subscriptions, selections, lifecycle
  listeners, effect cleanups) run with no borrow held and may read, send or patch.
- **Equality** is `PartialEq` per field (TS: `Object.is`).
- **A missing named implementation** panics in debug builds and warns + no-ops in release
  builds (TS: throws in dev, warns in prod).

## Bindings

- [`dunky-wasm`](../wasm): `export_machine!` turns a machine type into a JS class for
  [`@dunky.dev/state-machine-wasm`](../../packages/wasm).
- `crates/uniffi` (React Native through JSI) — see its README.
