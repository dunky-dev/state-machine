---
'@dunky.dev/state-machine': minor
---

Export `makeBroadcast` (with its `Broadcast` type) and `makeSelection` — the
notify and select primitives the engine's own `subscribe` and `select` are
built on — for code that implements the `Machine` interface on another
engine. `@dunky.dev/state-machine-wasm` uses them for its Rust-backed
machines, so every implementation shares one set of semantics instead of
re-deriving them: a broadcast that allocates nothing on steady-state notifies
and honors (un)subscribes made mid-notify, and selections that fire only when
the selected value changes (`Object.is`, or the `equals` you pass to
`subscribe`).

```ts
import { makeBroadcast, makeSelection } from '@dunky.dev/state-machine'

const broadcast = makeBroadcast()
const count = makeSelection(
  () => store.count,
  onWake => broadcast.add(onWake),
)
count.subscribe(value => render(value)) // fires only when `count` changed
broadcast.notify() // after every change
```

No behavior change for existing consumers.
