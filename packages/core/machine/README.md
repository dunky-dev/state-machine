# `@render-experiment/machine-core`

A tiny, **renderer-agnostic state-machine engine** for building UI component
logic once and running it anywhere. It owns _behavior_ — states, transitions,
side-effects, derived state — and knows nothing about the render environment.

It's pure JavaScript: it runs in any JS runtime (browser, Node, the React
Native JS thread), but not in native platform code (e.g. Swift/Kotlin).

```ts
import { machine, act } from '@render-experiment/machine-core'

const toggle = machine({
  initial: 'inactive',
  context: { count: 0 },
  states: {
    inactive: {
      on: {
        flip: { target: 'active', actions: act($ => ({ count: $.context.count + 1 })) },
      },
    },
    active: {
      on: { flip: { target: 'inactive' } },
    },
  },
})

toggle.start()
toggle.send({ type: 'flip' })
toggle.state // 'active'
toggle.context.count // 1
```

That machine is the whole behavior. To render it, a target adds two thin steps —
and **the machine itself never changes**:

1. **`connect()`** turns machine state into _logical_ bindings — `onPress`, `role`,
   `describedBy`.
2. **`normalize`** translates those to real props per platform — `onClick` +
   `aria-*` on web, `Pressable` props on React Native.

## The trade-off

This is a focused engine, not a do-everything statechart. It leaves out, on
purpose:

- **Nested / parallel / hierarchical states** — flat states + composition instead.
- **Serializable-snapshot features** — time-travel, persistence, a visual inspector.
- **Spawned child machines / actors.**

**Need those? Reach for XState.** Driving many lightweight UI machines you never
serialize? You're not paying for capabilities you don't use. The full
side-by-side — what's shared, what differs, and the measured numbers — is below.

## How it compares

Anyone who has reached for [XState](https://stately.ai/docs) or
[Zag](https://zagjs.com/) will feel at home — same statechart vocabulary
(`states`, `transitions`, `guards`, `actions`, `effects`), same headless
philosophy. Those libraries are excellent; this one exists for two things they
aren't built around: **no environment assumption** (Zag is framework-agnostic but
presumes a DOM) and **performance under heavy fan-out**.

**Shared baseline:**

| Capability                     | Zag        | XState            | machine-core  |
| ------------------------------ | ---------- | ----------------- | ------------- |
| States / transitions / guards  | ✅         | ✅                | ✅            |
| Guard combinators (and/or/not) | ✅         | ✅                | ✅            |
| `entry` / `exit`               | ✅         | ✅                | ✅            |
| Conditional actions            | `choose`   | `choose`          | `oneOf`       |
| Effects with cleanup           | `effects`¹ | invoked callbacks | `effects`     |
| Computed / derived             | ✅         | ✅                | ✅            |
| Timed transitions (`after`)    | ✅         | ✅                | ✅            |
| Watch (react to a data change) | `watch`    | via `always`      | `watch`       |
| Per-platform late binding      | ✅         | via `.provide()`  | `withAdapter` |

- **¹ `effects`** is the same idea in Zag and here, but Zag's effects receive a `scope` (a DOM)
  and reach for it; ours receive no environment.

**The differences:** The single
cause underneath all of them is **how each engine holds a machine's data**.
This lib keeps context as **one plain object, mutated in place (copy-on-write)** +
a tiny notifier — no per-field reactive cell (Zag), no immutable snapshot per event (XState).

| What's different                | Zag                          | XState                       | machine-core                          |
| ------------------------------- | ---------------------------- | ---------------------------- | ------------------------------------- |
| State selection                 | ❌ host framework does it    | ⚠️ `actor.select` (coarse)   | 🟢 `select` (fine-grained)            |
| Runs with no host framework     | ❌ needs a framework         | ⚠️ statechart yes            | 🟢 yes                                |
| Flat-ish state memory           | ❌ a reactive cell per field | 🟢 plain snapshot            | 🟢 plain context (copy-on-write)      |
| Data model                      | reactive cell per field      | immutable snapshot per event | one plain object, mutated in place    |
| Serializable snapshot¹          | ❌ state too scattered       | 🟢 the actor model           | ⚠️ no built-in                        |
| Nested / hierarchical states    | ❌ by design²                | ✅                           | ❌ flat                               |
| Parallel state                  | ❌ by design²                | ✅                           | ⚠️ `compose` (peers, no shared event) |
| Spawned child machines / actors | ❌ by design²                | ✅                           | ❌ by design²                         |

- **XState** allocates a serializable snapshot on every transition, and it taxes the hot
  path. machine-core drops mutates in place.
- **Zag** can run framework-free, but presumes a host DOM framework, machine-core owns
  its reactivity internally, extending the same idea onto any JS enviroment (DOM, React Native, TUI, WebGL, ...).
- **¹ Serializable snapshot** — only XState ships it (actor model). machine-core can
  add one (context is one plain object); Zag can't easily (state is scattered React
  hook cells).
- **² ❌-by-design** keep machines light-weight, avoid the heavy statechart concepts.

### Performance

Numbers below are from `pnpm benchmark` (Node 24, single clean run) — **disposable
first-look** figures, reproduce them yourself. The root
[README](../../../README.md#fast-at-scale) carries the headline summary; this
section is the per-scenario detail. Contenders are `machine-core` and
XState in the synchronous ops/sec loops (both sync statecharts, fair); Zag's
headless `send` is async (microtask-batched), so it can't share a synchronous
loop — it appears where it runs synchronously: construction, memory, and the
React render arena (mount + re-render row-count).

### Benchmark

#### Overview

|                                 | **Agnostic Render** |  XState |        Zag |
| ------------------------------- | ------------------: | ------: | ---------: |
| **Events per second**           |         **3.1 M/s** | 870 K/s |      n/a ¹ |
| **Spin up 10 000 machines**     |           **34 ms** |   52 ms |      92 ms |
| **Memory at 64 fields/machine** |          **7.8 KB** |  9.3 KB | **133 KB** |
| **Bundle** (min + gzip)         |          **2.2 KB** | 15.8 KB |   0.5 KB ² |
| **Bundle** + React adapter      |          **3.0 KB** | 18.6 KB |     3.6 KB |
| **Render 1 000 rows** (mount)   |          **5.4 ms** |  5.9 ms |     5.7 ms |
| **Re-render after a change** ³  |          **3.8 ms** |  7.0 ms |      n/a ¹ |

- ¹ Zag's `send` is async (microtask-batched), so it can't share a **synchronous** loop — neither the events/sec throughput nor the `flushSync` re-render timing. It IS measured where it runs sync: construction + memory (headless `VanillaMachine`), mount, and the re-render row-count (it wakes only 2 rows, same as the others — see the render table below).
- ² Zag's `@zag-js/core` is config-only (the machine runtime lives in the framework adapter), so its 0.5 KB engine row isn't runnable on its own — the `+ React adapter` row (`@zag-js/react`) is the fair comparison.
- ³ Each library using its idiomatic fine-grained path (Agnostic Render & Zag: per-instance machine + `React.memo`; XState: shared actor + `@xstate/react`'s `useSelector`).

#### In depth analyzis

**Throughput — events/sec (higher is better)**

| Scenario                          | machine-core | XState | core ×   |
| --------------------------------- | -----------: | -----: | -------- |
| Single machine, one event         |       3.12 M | 0.87 M | **3.6×** |
| Fine-grain (unobserved) 1 of 5000 |       1.20 M | 0.45 M | **2.7×** |

Per-event cost is ~3.6× XState's, and changing a field nobody observes is ~2.7×
(core's value-dedup suppresses the listener; XState fires its subscriber and
diffs in it).

**Fan-out — one machine, N observers, change one field (higher is better)**

This is the honest scaling test: a single machine with N selections, bump one
field. Core's `select` is a coarse bus — every selection re-evaluates on each
notify and value-compares — so the re-eval pass is **O(N), not O(changed)**; only
the React re-render is O(changed). XState's headless `actor.subscribe` is O(N)
too, with a heavier per-notify constant.

| Observers (N) | machine-core | XState | core ×   |
| ------------- | -----------: | -----: | -------- |
| 100           |        315 K |  256 K | **1.2×** |
| 1 000         |        9.9 K | 10.8 K | 0.9× ¹   |
| 5 000         |        6.3 K | 0.74 K | **8.5×** |

Both engines degrade with N — this is **not** flat O(changed) at the engine
level. What core buys is a far smaller constant: at 5 000 observers it's **8.5×**
XState. (At 1 000 they're within noise of each other.)

- **¹** At N=1 000 XState edges ahead by ~9%; the gap only opens up decisively at
  larger N. Reported as-is rather than cherry-picked.

**Construction — µs / machine, and memory — KB / machine (5 000 live; lower is better)**

Construction is synchronous for all three, so Zag's headless `VanillaMachine` is a
fair contender here (and for memory):

| Metric                        | machine-core | XState |     Zag |
| ----------------------------- | -----------: | -----: | ------: |
| Construct (µs/machine, ×10 K) |     **3.39** |   5.16 |    9.18 |
| Memory, 2-field context       |     **4.81** |   6.26 |    8.78 |
| Memory, 64-field context      |     **7.84** |   9.28 | **133** |

2 → 64 fields adds only ~3 KB/machine for core: context is one plain object, so
memory grows with the data you store, not with a per-field cell. It's **not**
perfectly flat — it grows linearly, just slowly. **Zag is the contrast that makes
the point**: its context is one reactive cell per field, so 64 fields balloon to
~133 KB/machine (~17× core) — the per-field-cell cost this model avoids.

**Memory after a write (copy-on-write fired).** The numbers above are idle
machines, which for core share the config's context object (copy-on-write hasn't
triggered). Sending one event to each — the realistic churny-app case — makes
each core machine own its context copy. The footprint barely moves, and the
contrast with XState sharpens:

| Metric (64 fields, 5 000 machines) | machine-core | XState |    Zag |
| ---------------------------------- | -----------: | -----: | -----: |
| Idle (never written)               |     **7.84** |   9.28 |    133 |
| Written (1 event each, COW fired)  |     **5.84** |  12.42 |    136 |

Core stays flat (the idle/written wobble is within GC noise); **XState's snapshot
model doubles** (6.4 → 12.4 KB) once `assign` allocates a per-machine context.

**React rendering — list of 1 000 rows, 50 highlight moves.** Each library in its
idiomatic fine-grained path (lower is better):

| Metric                | machine-core | XState |          Zag |
| --------------------- | -----------: | -----: | -----------: |
| Rows woken / move     |        **2** |      2 |            2 |
| Mount (ms) ³          |      **5.4** |    5.9 |          5.7 |
| Re-render wall (ms) ¹ |      **3.8** |    7.0 | n/a (async)² |

All three properly-set-up engines wake only the **2** rows that changed. The
difference is per-render _cost_ — where core and XState are directly comparable
(both flush synchronously); Zag's async send can't be timed under the same
`flushSync` loop, but its **row-count is identical** (2), which is the metric
that matters for "does it stay surgical at scale."

- ¹ 50 highlight moves, median of 5.
- ² Zag's `send` is microtask-batched, so a
  synchronous `flushSync` re-render loop can't time it fairly (it balloons under
  forced sync flushes) — only the row-count is reported for Zag.
- ³ Mount (ms) is **not** apples-to-apples: each library mounts its idiomatic
  per-row primitive (core/XState a `useSelector` subscription; Zag a full
  `useMachine` + `React.memo` wrapper). It's "cost of this library's row", not a
  shared primitive — the row-count and re-render wall are the comparable metrics.

**Engine internals (core-only, events/sec).** These have no cross-engine
counterpart (XState has no first-class lazy `computed`; the rest are engine hot
paths) — they're here to characterize the runtime's own cost, not to compare:

| Path                                          | events/sec | note                                    |
| --------------------------------------------- | ---------: | --------------------------------------- |
| `computed` — cached read (no change)          |     17.0 M | memo hit; ~11× a recompute              |
| `computed` — recompute (read field changed)   |      1.5 M | full re-run under tracking proxies      |
| `computed` — 4-deep chain (root → tip)        |      0.5 M | resolves the whole chain, glitch-free   |
| `computed` — fine-grain (unread field changed)|      2.9 M | read-key tracking → memo hit, no re-run |
| Guard fallthrough — 2 / 8 / 32 candidates     | 3.4 / 3.0 / 2.1 M | linear in candidate count        |
| State-change churn (exit + entry every event) |      2.7 M | ~13% over a context-only mutate         |
| Effect boot + cleanup every transition        |      2.7 M | `startEffects`/`stopEffects` per move   |
| Subscriber set — stable vs churning ⁴         | 2.9 M vs 2.3 M | bus-snapshot rebuild costs ~21%    |

- **⁴** "Churning" subscribes + unsubscribes around each event, so the bus
  iteration snapshot is rebuilt every notify — the mount/unmount shape of a
  virtualized list. A stable subscriber set reuses the snapshot.

**When this matters: density × frequency** — many machines reacting to a
high-frequency stream inside one frame budget. Trading terminals (thousands of
ticker rows), canvas boards (`pointermove` fanning out to selected shapes),
monitoring walls, multiplayer editors, game HUDs. Where machine work fights the
frame, ~3.6× throughput plus surgical re-renders is the difference between smooth
and dropped frames.

### The machine never sees props

A machine here is pure behavior — it has no `props` argument and no `prop()`
accessor, so the _same_ machine runs byte-for-byte identically on every target.
This is the engine's defining rule, and the one place it diverges from Zag/XState
(whose machines read props directly). The full rationale + the layered model live
in [`ARCHITECTURE.md`](../../../ARCHITECTURE.md#the-core-rule-the-machine-never-sees-props);
the engine-level summary: every job a prop does lands at the **edge**, never the
machine —

| A prop that…            | …goes here                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **configures** behavior | seeded into `context` once (and updated via `setContext`)                                                        |
| **fires a callback**    | a **reaction** on the connector (see [Reactions](#reactions--firing-prop-callbacks-without-the-machine-knowing)) |
| **is controlled** state | resolved into the initial state before `machine()` is built                                                      |

---

## API at a glance

| Export                               | What it is                                                                                                                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `machine(config)`                    | build a service (stopped); `.start()` / `.stop()` / `.send()` / `.state` / `.context` / `.computed` / `.subscribe` / `.select` / `.onStart` / `.onStop`                                                        |
| `config({ ... })`                    | author a config const with full inference + checking, no manual generics                                                                                                                                       |
| `withAdapter(config, adapter)`       | layer a platform's `actions` + `effects` over a config (other impls — `guards`, `delays` — carry through untouched)                                                                                            |
| `connector(service, connect, props)` | live, memoized, subscribable view snapshot: `.snapshot` / `.subscribe` / `.select` / `.setProps` (prop-callbacks wire automatically)                                                                           |
| `makeReaction<…>()`                  | inference helper for a connector reaction — fixes the machine generics once, infers each reaction's selector→callback `Value` (see [Reactions](#reactions--firing-prop-callbacks-without-the-machine-knowing)) |
| `compose({ a, b })`                  | run several machines as one (orthogonal regions): bundled `start`/`stop` + `.sync()` + `.combine()`                                                                                                            |
| `createStore(initial, build?)`       | a tiny reactive store (plain value + listeners) for cross-instance singleton state (outside any one machine)                                                                                                   |
| `and` / `or` / `not`                 | guard combinators                                                                                                                                                                                              |
| `act(...patches)`                    | write-sugar: a context-writing action (one or many patches, applied in order). Slots in any `actions` / `entry` / `exit` list                                                                                  |
| `oneOf(...branches)`                 | conditional action: variadic `{ guard?, actions }` branches, first passing wins (guardless = fallback)                                                                                                         |
| `MACHINE_INIT`                       | the synthetic event fired when effects/watchers boot on `start()`                                                                                                                                              |
| Types                                | `Machine`, `MachineConfig`, `TransitionConfig`, `Guard`, `Action`, `Effect`, `Delay`, `Selection`, `Connect`, `Store`, `StateNode`, `EventBindings`, `AttrBindings`, …                                         |

---

## Lifecycle

`machine(config)` returns a **service** that is _built but not running_. The
caller controls when it boots:

```ts
const m = machine(config)
m.start() // boot it (effects + watchers begin)
m.stop() // tear down (cleanups run); restartable with start()
```

The lifecycle lives on the instance so every target drives it the same way —
React calls them in `useEffect`, a test inline. The shared teardown logic is
written once. `send()` still works while stopped (transitions are pure state);
only side-effects are gated by `start`/`stop`.

**`onStart` / `onStop`** let an _outer_ layer hang start/stop-scoped work off the
machine's lifecycle without the machine knowing what it is — this is how the
connector wires its [reactions](#reactions--firing-prop-callbacks-without-the-machine-knowing)
on boot and tears them down on stop. They fire on _every_ start/stop (a machine
can restart), so listeners must be idempotent; `onStart` also runs immediately if
the machine is already running, so a late registrant never misses it. Each
returns an unregister.

```ts
const offStart = m.onStart(() => {
  /* start-scoped wiring */
})
const offStop = m.onStop(() => {
  /* teardown */
})
```

> **Tip: author configs with `config(...)`.** Writing a config as a bare object
> gives weaker type-checking than passing it through the `config()` identity
> helper, which applies the full `TransitionConfig` constraint at the definition
> site — a typo in `initial`, an invalid `target`, or a wrong param shape all
> error _there_, with no manual generics:
>
> ```ts
> import { config, machine } from '@render-experiment/machine-core'
>
> const cfg = config({ initial: 'closed', context: {}, states: { closed: {} } })
> const m = machine(cfg)
> ```

---

## Context — reactive data

`context` is the component's data. It's **read** as a plain property and
**written** through `setContext` (a single, batched entry point):

```ts
const m = machine({
  initial: 'idle',
  context: { name: 'Ada', age: 36 },
  states: {
    idle: {
      on: {
        birthday: { actions: $ => $.setContext({ age: $.context.age + 1 }) },
      },
    },
  },
})

m.context.name // 'Ada'
m.send({ type: 'birthday' })
m.context.age // 37
```

---

## States & transitions

Each state lists the events it responds to under `on`. A transition can change
state (`target`), run `actions`, or both:

```ts
const light = machine({
  initial: 'green',
  context: {},
  states: {
    green: { on: { next: { target: 'yellow' } } },
    yellow: { on: { next: { target: 'red' } } },
    red: { on: { next: { target: 'green' } } },
  },
})

light.start()
light.send({ type: 'next' }) // green → yellow
```

**Any-state events** go in the top-level `on` (a per-state `on` wins over it):

```ts
on: { reset: { target: 'a' } }, // works from ANY state
```

**Tags** group states so consumers ask about a _category_, not a name:

```ts
states: {
  closed: {},
  opening: { tags: ['visible'] },
  open: { tags: ['visible'] },
}
m.hasTag('visible') // true while in opening OR open
m.matches('open') // exact-state check
```

**Events are queued (run-to-completion).** If an action sends another event, it
waits until the current transition fully finishes — no re-entrancy surprises:

```ts
states: {
  a: { on: { go: { target: 'b', actions: [({ send }) => send({ type: 'auto' })] } } },
  b: { on: { auto: { target: 'c' } } }, // 'auto' processes AFTER the machine settles in 'b'
  c: {},
}
```

---

## Guards — gating a transition

A guard is a predicate; return `false` and the transition doesn't fire. It
receives `{ context, event, computed }`:

```ts
on: { submit: { target: 'done', guard: ({ context }) => context.allowed } }
```

**Fallthrough** — give an event an _array_ of transitions; the first whose guard
passes wins:

```ts
on: {
  tick: [
    { guard: ({ context }) => context.n >= 10, target: 'max' },
    { guard: ({ context }) => context.n > 0, target: 'some' },
    { target: 'zero' }, // no guard = fallback
  ],
}
```

**Named guards + combinators** (`and` / `or` / `not`):

```ts
import { and, not } from '@render-experiment/machine-core'

machine({
  // ...
  states: {
    idle: { on: { toggle: { target: 'busy', guard: and('isOpen', not('isLocked')) } } },
  },
  implementations: {
    guards: {
      isOpen: ({ context }) => context.open,
      isLocked: ({ context }) => context.locked,
    },
  },
})
```

---

## Actions — fire-and-forget side-effects

Actions run on a transition, in order, getting
`{ context, setContext, event, send, computed }`. Inline or named:

```ts
on: {
  save: {
    actions: [
      $ => $.setContext({ saved: true }),
      'notify', // a named action from implementations.actions
    ],
  },
}
```

**`act(...)`** is write-sugar for the most common action — setting context. It
drops the `$ => $.setContext(...)` wrapper, so the patch reads as data, and takes
one or many patches (applied in order; a later patch fn sees earlier writes):

```ts
import { act } from '@render-experiment/machine-core'

on: {
  save: {
    actions: [
      act({ saved: true }), // ≡ $ => $.setContext({ saved: true })
      'notify',
    ],
  },
  // one or many fields, static or derived:
  bump: { actions: act({ touched: true }, $ => ({ n: $.context.n + 1 })) },
}
```

`act` only WRITES — `target` / `guard` stay on the transition object. It returns
a normal action, so it slots in any `actions` / `entry` / `exit` list or a `oneOf`
branch.

**`entry` / `exit`** run when a state is entered / left — handy for behavior that
should run on _any_ way in or out, without repeating it on each transition:

```ts
states: {
  open: {
    entry: ['focusFirstItem'], // on enter
    exit: ['restoreFocus'], // on leave
    on: { close: { target: 'closed' } },
  },
  closed: {},
}
```

**`oneOf`** picks one branch of actions by guard (the action analog of
fallthrough):

`oneOf(...)` is variadic — its branches are plain `{ guard?, actions }` objects
(the same shape as a transition, minus `target`); `actions` may be a single action
or a list. A guardless branch is the fallback (put it last):

```ts
import { oneOf } from '@render-experiment/machine-core'

actions: [
  oneOf(
    { guard: 'isMobile', actions: 'lockScroll' },
    { guard: 'isDesktop', actions: 'dimBackground' },
    { actions: 'noop' }, // guardless = fallback
  ),
]
```

---

## Effects — side-effects with cleanup

An effect runs when a state is **entered** and returns an optional **cleanup**
that runs when the state is **left**. Setup and teardown share one closure — so
whatever an effect starts on enter is torn down by the exact cleanup that
captured it (something plain `entry`/`exit` can't do without manual bookkeeping):

```ts
states: {
  open: {
    // subscribe to a store while open; unsubscribe on exit. No platform, no props
    // — a pure effect, so it lives right here in the config.
    effects: [
      ({ context, send }) =>
        store.subscribe(() => {
          if (store.get().openId !== context.id) send({ type: 'close' })
        }),
    ],
    on: { close: { target: 'closed' } },
  },
  closed: {},
}
```

The initial state's effects boot on `start()`; all active cleanups run on
`stop()`. Effects can be named and resolved from `implementations.effects` (so
they're reusable / overridable — see the adapter below) or written inline.

### Where does a side-effect live? — the three homes

Not every side-effect belongs in the config. The deciding questions are **does it
touch the platform** (a DOM listener, a native API) and **does it need props**
(the machine [never sees props](#the-machine-never-sees-props)). That gives three
homes:

```
Does the effect touch the platform (DOM / native API)?
├─ No  → a plain machine effect, implemented right in the config `effects`
│        (e.g. a store subscription — same on every target)
└─ Yes → Does it need props?
         ├─ No  → a NAMED machine effect, implemented per-target via the ADAPTER
         │        (withAdapter) — the machine owns its lifecycle, the platform
         │        owns its body  (e.g. a focus-trap while `open`)
         └─ Yes → a ComponentEffect in the target's effects.ts — the VIEW owns it,
                  because the machine can't read the props it needs
                  (e.g. Escape gated by a `closeOnEscape` prop)
```

| Home                        | Owns the lifecycle | Touches platform | Reads props |
| --------------------------- | ------------------ | ---------------- | ----------- |
| config `effects: { … }`     | machine            | no               | no          |
| **adapter** (`withAdapter`) | machine            | yes              | no          |
| `ComponentEffect` (target)  | the view           | yes              | yes         |

The middle row is the adapter's whole reason to exist: an effect the **machine**
schedules (scoped to a state, started on enter / cleaned up on exit) whose **body
is platform-specific but takes no props**. A focus-trap or scroll-lock while a
dialog is `open` is the canonical case — the _machine_ decides _when_ (it's
behavior), the _target_ decides _how_ (web `focus()` vs. native
`AccessibilityInfo`).

### The adapter — naming an effect, binding it per platform

A config **names** a platform effect; each target **supplies the body** via
`withAdapter`, which merges the platform's `actions` + `effects` over the config's
`implementations` (adapter wins on a name collision):

```ts
import { withAdapter } from '@render-experiment/machine-core'

// agnostic config — names the effect, no platform code:
const config = { initial: 'open', context: {}, states: { open: { effects: ['trapFocus'] } } }

// web target supplies the real body:
const webAdapter = {
  effects: {
    trapFocus: ({ context }) => {
      const release = trapFocusDom(getContentEl(context.id)) // web focus-trap
      return release // cleanup on state exit
    },
  },
}
// a native target would name the SAME 'trapFocus' with a different body
// (AccessibilityInfo …) — the machine config never changes.

const m = machine(withAdapter(config, webAdapter))
```

Only `actions` + `effects` are the platform seam. `guards` stay config-only (pure
logic, identical everywhere) and named `delays` carry through untouched.

> **Why are the shipped components' `adapter.ts` files empty (`{}`)?** Because
> neither tooltip nor dropdown has an effect in the middle row: their one machine
> effect is a store subscription (pure → config), and their platform listener
> (Escape / Android back) is prop-gated (→ a ComponentEffect). An empty adapter
> is the correct, common state — it's a _ready seam_, filled only when a component
> has a platform effect that needs no props (a focus-trap, a scroll-lock). The
> contrast with Zag: Zag puts all platform effects in one `effects` map and reads
> the DOM through an injected `scope`; here the no-props rule splits the
> prop-dependent ones out to the view, leaving the adapter for the prop-free rest.

---

## Computed — derived data

Computeds are values _derived_ from context (or other computeds). Lazy and
memoized: a computed recalculates only when an input it actually read changes.

```ts
const m = machine({
  initial: 'idle',
  context: { items: ['a', 'b'] },
  computed: {
    count: ({ context }) => context.items.length,
    isEmpty: ({ computed }) => computed.count === 0, // derives from another computed
  },
  states: { idle: {} },
})

m.computed.count // 2
m.computed.isEmpty // false
```

Computeds are available everywhere context is — guards, actions, effects
(`{ ..., computed }`) — and on the machine itself (`m.computed.x`).

---

## `after` — timed transitions

A state can transition **automatically after a delay**. The timer is scoped to
the state: scheduled on enter, **auto-cancelled** if the state is left (or
`stop()` is called) before it fires.

```ts
const m = machine({
  initial: 'closed',
  context: { openMs: 200 },
  states: {
    closed: { on: { hover: { target: 'opening' } } },
    opening: { after: { openDelay: { target: 'open' } } }, // wait, then open
    open: { after: { 1500: { target: 'closed' } } }, // auto-dismiss after 1.5s
  },
  implementations: {
    delays: { openDelay: ({ context }) => context.openMs }, // named, dynamic delay
  },
})
```

A delay key is a **number of ms** (`1500`) or a **named delay** resolved from
`implementations.delays` (which can read `context`/`computed`, so it's dynamic).
An `after` entry is a normal transition: it can `target`, run `actions`, and use
guard fallthrough. A pure wait-then-advance state _is_ "sleep":

```ts
states: {
  flash: { after: { 300: { target: 'idle' } } }, // show for 300ms, then return
}
```

---

## `watch` — react to data changes

Where `after` reacts to _time_ and effects react to _state_, `watch` reacts to
**data**: run actions whenever a context (or computed) field changes — in any
state, for the machine's whole lifetime.

```ts
const m = machine({
  initial: 'idle',
  context: { query: '' },
  watch: {
    query: ['runSearch'], // whenever `query` changes → runSearch
  },
  states: { idle: {} },
  implementations: {
    actions: { runSearch: ({ context, send }) => send({ type: 'search', q: context.query }) },
  },
})
```

The declarative form of "subscribe to a field and run something." Watchers start
on `start()`, clean up on `stop()`, and fire only when the watched field's value
actually changes (not on setup). Use `watch` for side-effecting reactions; for a
_derived value_, reach for `computed` instead.

---

## Subscriptions — observing changes

**Coarse** `subscribe` wakes on _any_ change (what a `useSyncExternalStore`
bridge uses):

```ts
const off = m.subscribe(() => rerender()) // fires on any state/context change
off() // unsubscribe
```

It fires on any `setContext` or state change. A computed change is covered
transitively (a computed only changes when context it reads changes), so "any
change" holds in practice.

**Fine-grained** `select` narrows to a slice and fires _only when that slice's
value changes_:

```ts
// a single named field (typed + autocompleted):
m.select.context('count').subscribe(n => console.log('count is now', n))
m.select.computed('isEmpty').subscribe(empty => toggle(empty))
m.select.state().subscribe(s => console.log('state →', s))

// or a derived/composite selection via a function:
const view = m.select(() => ({ open: m.matches('open'), count: m.context.count }))
view.subscribe(render, (a, b) => a.open === b.open && a.count === b.count) // optional equality
view.value // read the current selected value directly
```

A `select` re-evaluates on any machine change but only fires its listener when the
selected value actually changes — so an observer wakes only for the slice it reads.

---

## Connector — the view boundary

A component's pure `connect(snapshot) → api` maps machine state into a
view-facing object (handlers + attributes a renderer spreads onto elements). The
`connector` keeps that mapping **live** and hands the renderer a stable,
subscribable snapshot:

```ts
import { connector } from '@render-experiment/machine-core'

const connect = ({ state, send }) => ({
  isOpen: state === 'open',
  triggerProps: { onPress: () => send({ type: 'toggle' }) },
})

const c = connector(m, connect, /* initial props */ {})

c.snapshot // memoized api; identity is stable until something changes
c.subscribe(rerender) // coarse — wake the view
c.select // forwarded fine-grained path
c.setProps(newProps) // props are a reactive input; recomputes the snapshot
```

`setProps` is **shallow-dedup'd**: passing a fresh-but-equal props object (the
common case — a host that rebuilds props every render) is a no-op, so it won't
needlessly recompute the snapshot or wake subscribers. Only a real value change
propagates.

The connector surface is exactly these four: `snapshot`, `subscribe`, `select`,
`setProps`. Prop-callbacks ([reactions](#reactions--firing-prop-callbacks-without-the-machine-knowing))
are wired **automatically** off the machine's own lifecycle — there's nothing to
activate by hand.

`c.snapshot`'s identity changes only when the machine (or props) changes — so it
drops straight into React's `useSyncExternalStore(c.subscribe, () => c.snapshot)`
without the infinite-loop / tearing pitfalls of returning a fresh object each
read.

> **Why `connect` returns abstract handlers (`onPress`) and not `onClick`:** core
> stays renderer-blind. A per-target `normalize` step translates the agnostic
> _bindings_ vocabulary (`onPress`, `role`, `describedBy`) into real props
> (`onClick`, `aria-describedby`) — so the same `connect` can target the DOM,
> React Native, or any other surface.

### Reactions — firing prop-callbacks without the machine knowing

Because [the machine never sees props](#the-machine-never-sees-props),
a callback like `onOpenChange` can't fire from inside it. A **reaction** is how
the connector bridges that gap from the _outside_: a declared
`[selector, callback]` tuple that watches a value derived from machine state
and, when it changes, calls the matching prop. (Same tuple shape as a React
`ComponentEffect` — declare each as a named const, collect them in a list.)

```ts
import { makeReaction } from '@render-experiment/machine-core'

// fix the machine generics once per component; `Value` is then inferred per reaction:
const reaction = makeReaction<TooltipState, TooltipContext, TooltipEvent, TooltipProps>()

const onOpenChange = reaction(
  m => m.matches('open') || m.matches('closing'), // selector → Value inferred as boolean
  (open, props) => props.onOpenChange?.({ open }), // callback: open is boolean, no annotation
)

connectTooltip.reactions = [onOpenChange]
```

`makeReaction(...)` is just an inference helper: it returns the same
`[selector, callback]` tuple, but recovers the selector→callback `Value` link a
bare array would lose (inline, the tuple lands in `Reaction<…, any>` and the
callback's first arg is untyped). The raw `Reaction<…>` tuple type still works if
you prefer to spell it out.

The machine just transitions `closed → open`; it has no idea `onOpenChange`
exists. The connector runs the selector (tuple position 0) as a value-deduped
`select(...)`, and when the result flips it calls the callback (position 1) with
the **current** props (so a swapped callback is always the one that fires). This
is the inversion from Zag, for example, which fires the same callback as an
`invokeOnOpen` _action inside_ the machine — here the firing is pulled out to the
edge, which is what keeps the machine pure.

`selector` is always a **function** (no state-name shorthand): it reads whatever
it needs off the machine — `m.matches('open')` for a state-based reaction, or
`m.context.highlightedValue` for a value-based one — so a single shape covers
every reaction whether it keys off state or context.

Reactions are **wired automatically** — there is no activation call. The
connector hooks the machine's own lifecycle (`onStart` / `onStop`), so reactions
come alive on `start()` and are torn down on `stop()`, exactly as long as the
machine runs. The bridge only drives the machine; reactions follow for free:

```ts
useEffect(() => {
  service.start() // reactions wire themselves here (connector's onStart hook)
  return () => service.stop() // …and tear down here (onStop)
}, [service])
```

Hooking the machine's lifecycle (not the connector's construction) means a
restart — notably React StrictMode's mount→unmount→mount — cleanly
re-establishes the reactions with no bookkeeping in the bridge.

Contrast with the **target's effects**: a reaction is for pure state→callback
(portable, declared once, runs on every target). Anything needing the platform
itself — a DOM `keydown` listener for Escape — lives in the target's effect
layer (the React bridge's `ComponentEffect`), which gates it and then `send()`s a
plain event the machine already handles.

- reaction = agnostic edge (state → callback, every target)
- target effect = platform edge (DOM/RN listeners → `send()`)

---

## Composing machines

States are flat. When a component has **two independent dimensions of state at
once** — say a popup that's open/closed _and_ a submenu that's shown/hidden —
each dimension is its own machine, and `compose` runs them as one unit
(orthogonal regions, without nested states):

```ts
import { compose } from '@render-experiment/machine-core'

const popup = machine({
  /* closed / open */
})
const submenu = machine({
  /* none / shown */
})

const combobox = compose({ popup, submenu })
combobox.start() // starts every member; .stop() stops all + disposes the helpers below

// members stay independent — drive and read each on its own:
popup.send({ type: 'focus' })
submenu.send({ type: 'open' }) // both regions active simultaneously
```

`compose` returns a `Composition` with two helpers, both auto-disposed on
`stop()`:

```ts
// sync — a cross-region rule: react when any member changes. COARSE: it wakes on
// any change to any member (the rule reads what it needs); use it for cross-region
// coordination, not as a fine-grained per-field watcher.
combobox.sync(() => {
  if (popup.matches('closed')) submenu.send({ type: 'close' })
})

// combine — one value-deduped Selection derived across members; re-evaluates on
// any member change and fires only when the combined value changes
const view = combobox.combine(() => ({ open: popup.matches('open'), sub: submenu.state }))
view.value // { open: true, sub: 'shown' }
view.subscribe(render)
```

This is the engine's answer to hierarchy/parallel statecharts: rather than
nesting states in one machine, compose independent peer machines. Each stays
individually observable (fine-grained `select` per region), and `compose` adds
only the lifecycle + coordination glue.

> **`compose` vs. true parallel states.** Members are independent peers: a
> `send` goes to one member, not broadcast across regions, and there's no shared
> event bus. Cross-region behavior is expressed explicitly via `sync`. That's the
> deliberate trade — simpler than nested/parallel statecharts, at the cost of a
> shared event model.

---

## Flat states & managing "nested" data

States here are **flat** — there's no hierarchy and no parallel regions inside a
single machine. That's a deliberate constraint, and the first reaction to it is
usually the same worry: _won't my states explode?_ Take a **combobox** (an input
with a filtered dropdown). It feels like it has many states at once: the popup is
open or closed, _and_ some item is highlighted (one of N), _and_ a value may be
selected. Treat each combination as its own state and you get the product —
`open/closed × N highlighted × selected/not` — which blows up the moment the list
grows.

It doesn't have to — because **the explosion only happens if you fold independent
things onto the single state axis.** A flat state should encode exactly **one**
axis of control flow (here: is the popup open?). Everything that would multiply
that axis is pushed sideways onto a different tool:

- a **product of data** → `computed`
- a **second lifecycle** → `compose`
- a **grouping over states** → `tags`

| You have…                                                 | Don't…                                  | Do…                                                       |
| --------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------- |
| A value derived from **data** (which item is highlighted) | make a state per item → N nodes         | keep the inputs in **`context`**, derive it in `computed` |
| A **second independent lifecycle** running at once        | multiply it into the popup states → N×M | run it as a peer with **`compose`**                       |
| A **category over many states** ("is the list showing?")  | `matches('a') \|\| matches('b') \|\| …` | tag the states, query with **`hasTag`**                   |

### A product of data → `computed`

"Which item is highlighted" isn't control flow — it's a value derived from the
query, the filtered list, and the active index. Those are `context` fields; the
highlighted item is a _derived_ value, not a state per row:

```ts
machine<
  'idle' | 'open',
  { query: string; items: Item[]; activeIndex: number },
  Event,
  {
    filtered: Item[]
    highlighted: Item | null
  }
>({
  initial: 'idle',
  context: { query: '', items: ALL_ITEMS, activeIndex: -1 },
  computed: {
    // derived, memoized — never a state per item
    filtered: $ => $.context.items.filter(i => i.label.includes($.context.query)),
    highlighted: $ => $.computed.filtered[$.context.activeIndex] ?? null,
  },
  states: {
    idle: { on: { focus: { target: 'open' } } },
    open: {
      on: {
        // a few handlers move the cursor / filter — NOT one transition per row
        type: act($ => ({ query: $.event.value, activeIndex: 0 })),
        moveDown: act($ => ({ activeIndex: $.context.activeIndex + 1 })),
        moveUp: act($ => ({ activeIndex: $.context.activeIndex - 1 })),
        close: { target: 'idle' },
      },
    },
  },
})
```

**Two state nodes, not "one per item."** `highlighted` is recomputed lazily and
only when an input it read changes — so the transitions scale with the _kinds_ of
move (type / up / down), not with the list length.

### A second lifecycle → `compose`

If a second axis is genuine control flow — e.g. an **async loader** that fetches
the options (`idle → loading → loaded → error`) running _alongside_ the open/closed
popup — don't fold it into the popup machine (that's `popupStates × loaderStates`
nodes). Make it a peer region and [`compose`](#composing-machines) the two:

```ts
const combobox = compose({ popup: popupMachine, loader: loaderMachine })
// 2 popup + 4 loader states = 6 nodes total, not 2 × 4 = 8 — additive, not multiplicative
```

### A grouping over states → `tags`

Even flat, a machine accumulates states, and the view often wants a _category_:
"is the listbox visible right now?" — which may be true across several states.
Tagging keeps that query from scaling with the state count (see
[Tags](#states--transitions)):

```ts
states: {
  idle:     {},
  open:     { tags: ['expanded'] },
  filtering:{ tags: ['expanded'] },   // still showing the list, just narrowing it
}

m.hasTag('expanded') // true in open OR filtering — one query, no OR-chain
```

The throughline: flat states stay readable because the things that would have
multiplied them live elsewhere — data in `computed`, parallel lifecycles in
`compose`, categories in `tags`.

---

## `createStore` — cross-instance singleton state

Context lives _inside_ a machine. Some state belongs _outside_ any one machine —
a singleton shared across instances, like "only one tooltip open at a time" or "a
single active menu in a menubar." `createStore` is a tiny reactive cell for
exactly that: a plain value plus a listener set.

```ts
import { createStore } from '@render-experiment/machine-core'

const store = createStore({ count: 0 })

store.get() // { count: 0 }
store.set({ count: 1 }) // shallow-merge a patch…
store.set(s => ({ count: s.count + 1 })) // …or an updater (no-op writes don't notify)
const off = store.subscribe(s => console.log(s.count)) // fires on change, not on subscribe
off()
```

Pass a second `build` argument to add named domain methods on top — no facade
boilerplate. `build` receives the base store, so the methods read/write through
it:

```ts
const tooltipStore = createStore({ openId: null as string | null }, s => ({
  setOpen: (id: string | null) => s.set({ openId: id }),
  isOpen: (id: string) => s.get().openId === id,
}))

tooltipStore.setOpen('a')
tooltipStore.isOpen('a') // true
```

The store is **not** wired into a machine's `select` automatically — reading
`store.get()` inside a `select` won't re-fire when the store changes. To make a
machine react to a shared store, bridge it explicitly: subscribe to the store and
forward the change as an event the machine already handles.

```ts
const off = tooltipStore.subscribe(s => m.send({ type: 'activeChanged', openId: s.openId }))
```

---

## Putting it together

```ts
import { config, machine, withAdapter, connector } from '@render-experiment/machine-core'

// 1. describe behavior (agnostic) — config() type-checks the literal in place
const disclosureConfig = config({
  initial: 'closed',
  context: {},
  states: {
    closed: { on: { open: { target: 'open' } } },
    open: {
      effects: ['trackEscape'],
      on: { close: { target: 'closed' } },
    },
  },
})

// 2. supply the platform
const webAdapter = {
  effects: {
    trackEscape: ({ send }) => {
      const fn = (e: KeyboardEvent) => e.key === 'Escape' && send({ type: 'close' })
      document.addEventListener('keydown', fn)
      return () => document.removeEventListener('keydown', fn)
    },
  },
}

// 3. map to a view api
const connect = ({ state, send }) => ({
  isOpen: state === 'open',
  triggerProps: { onPress: () => send({ type: 'open' }) },
})

// 4. run it
const m = machine(withAdapter(disclosureConfig, webAdapter))
m.start()
const view = connector(m, connect, {})
view.subscribe(render)
```

---

## Glossary

Every term and concept in `machine-core`, with a one-line meaning and a link to
its full section.

| Term                             | Meaning                                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Building blocks**              |                                                                                                                                                                            |
| **machine**                      | The built service from `machine(config)` — exposes `start`/`stop`/`send`/`state`/`context`/`select`. [→](#lifecycle)                                                       |
| **config**                       | The plain object describing behavior (states, context, transitions). Author it with `config()` for in-place type-checking. [→](#lifecycle)                                 |
| **state**                        | One of the flat, named situations the machine can be in (it's in exactly one at a time). [→](#states--transitions)                                                         |
| **transition**                   | An `on` entry: where an event takes the machine — optional `target`, `guard`, `actions`. [→](#states--transitions)                                                         |
| **event**                        | The `{ type, … }` object you `send()` to drive a transition. [→](#states--transitions)                                                                                     |
| **context**                      | The machine's data: one plain object, read directly (`m.context.x`), written via `setContext`. [→](#context--reactive-data)                                                |
| **setContext**                   | The single, batched entry point for writing context (shallow-equal deduped). [→](#context--reactive-data)                                                                  |
| **send**                         | Dispatch an event to the machine; events run to completion (see below). [→](#states--transitions)                                                                          |
| **Transitions & actions**        |                                                                                                                                                                            |
| **guard**                        | A predicate that gates a transition — return `false` and it doesn't fire. [→](#guards--gating-a-transition)                                                                |
| **and/or/not**                   | Guard combinators for composing named guards. [→](#guards--gating-a-transition)                                                                                            |
| **fallthrough**                  | An array of transitions for one event; the first whose guard passes wins. [→](#guards--gating-a-transition)                                                                |
| **action**                       | A fire-and-forget side-effect run on a transition, in order — gets `{context,setContext,event,send,computed}`. [→](#actions--fire-and-forget-side-effects)                 |
| **act**                          | Write-sugar returning a context-writing action — `act({ field: value })` instead of the `setContext` wrapper. [→](#actions--fire-and-forget-side-effects)                  |
| **oneOf**                        | Conditional action: variadic `{ guard?, actions }` branches, first passing wins (the action analog of fallthrough). [→](#actions--fire-and-forget-side-effects)            |
| **entry / exit**                 | Actions run when a state is entered / left (any path in or out). [→](#actions--fire-and-forget-side-effects)                                                               |
| **run-to-completion**            | Events queue: an event `send()`-ed from inside an action waits until the current transition finishes — no re-entrancy. [→](#states--transitions)                           |
| **Time, data & derivation**      |                                                                                                                                                                            |
| **after**                        | A timed transition — fire after a delay while in a state; auto-cancelled on exit. [→](#after--timed-transitions)                                                           |
| **delay**                        | An `after` key: a number of ms, or a named delay from `implementations.delays` (can read context). [→](#after--timed-transitions)                                          |
| **watch**                        | Run actions whenever a context/computed field changes — in any state, for the machine's lifetime. [→](#watch--react-to-data-changes)                                       |
| **computed**                     | A lazy, memoized value derived from context (or other computeds); recomputes only when a read input changes. [→](#computed--derived-data)                                  |
| **Effects & the platform seam**  |                                                                                                                                                                            |
| **effect**                       | A side-effect with cleanup, scoped to a state: runs on enter, its returned cleanup runs on exit. [→](#effects--side-effects-with-cleanup)                                  |
| **adapter**                      | A per-target binding that supplies the body of a named, platform-touching, prop-free effect. [→](#the-adapter--naming-an-effect-binding-it-per-platform)                   |
| **implementations**              | The named registry on a config — `guards` / `actions` / `effects` / `delays` referenced by string. [→](#guards--gating-a-transition)                                       |
| **The view boundary**            |                                                                                                                                                                            |
| **connect**                      | A pure function mapping a machine snapshot → the view-facing api (handlers + attributes). [→](#connector--the-view-boundary)                                               |
| **connector**                    | Keeps `connect` live: memoizes the snapshot, makes props a reactive input, wires reactions. [→](#connector--the-view-boundary)                                             |
| **snapshot**                     | The memoized view api the connector serves — stable identity until the machine or props change. [→](#connector--the-view-boundary)                                         |
| **setProps**                     | Push new props into the connector (a reactive input; shallow-dedup'd). [→](#connector--the-view-boundary)                                                                  |
| **reaction**                     | A `[selector, callback]` tuple that fires a prop-callback from _outside_ the machine on a value change. [→](#reactions--firing-prop-callbacks-without-the-machine-knowing) |
| **makeReaction**                 | Inference helper for a reaction tuple — recovers the selector→callback `Value` type. [→](#reactions--firing-prop-callbacks-without-the-machine-knowing)                    |
| **bindings**                     | The agnostic event/attr vocabulary `connect` speaks — `onPress`, `role`, `describedBy`. [→](#connector--the-view-boundary)                                                 |
| **normalize**                    | The per-target step translating bindings → real props (`onPress` → `onClick`; `aria-*` on web). [→](#connector--the-view-boundary)                                         |
| **Observing changes**            |                                                                                                                                                                            |
| **subscribe**                    | Coarse observation — fires on _any_ state/context change (what a `useSyncExternalStore` bridge uses). [→](#subscriptions--observing-changes)                               |
| **select**                       | Fine-grained observation — narrows to a slice, fires only when _that value_ changes. [→](#subscriptions--observing-changes)                                                |
| **selection**                    | What `select(...)` returns: a value-deduped view with `.value` + `.subscribe`. [→](#subscriptions--observing-changes)                                                      |
| **Composition & scale**          |                                                                                                                                                                            |
| **compose**                      | Run several peer machines as one unit (orthogonal regions) — the answer to "nested/parallel" without nesting. [→](#composing-machines)                                     |
| **composition**                  | What `compose(...)` returns: bundled `start`/`stop` plus `sync` + `combine`. [→](#composing-machines)                                                                      |
| **sync**                         | A coarse cross-region rule on a composition — runs when any member changes. [→](#composing-machines)                                                                       |
| **combine**                      | A value-deduped selection derived across composition members. [→](#composing-machines)                                                                                     |
| **tags**                         | Labels on states so consumers query a _category_ (`hasTag('visible')`) instead of a name. [→](#states--transitions)                                                        |
| **hasTag**                       | Check whether the current state carries a tag. [→](#states--transitions)                                                                                                   |
| **matches**                      | Exact-state check — `m.matches('open')`. [→](#states--transitions)                                                                                                         |
| **createStore**                  | A tiny reactive cell (value + listeners) for singleton state _outside_ any one machine. [→](#createstore--cross-instance-singleton-state)                                  |
| **store**                        | What `createStore(...)` returns: `get` / `set` / `subscribe` (+ optional domain methods). [→](#createstore--cross-instance-singleton-state)                                |
| **Lifecycle**                    |                                                                                                                                                                            |
| **start / stop**                 | Boot / tear down the machine — effects, watchers, and reactions begin / clean up. [→](#lifecycle)                                                                          |
| **onStart / onStop**             | Hang start/stop-scoped work off the machine's lifecycle (how the connector wires reactions). [→](#lifecycle)                                                               |
| **MACHINE_INIT**                 | The synthetic event fired when effects/watchers boot on `start()`. [→](#api-at-a-glance)                                                                                   |
| **Cross-cutting concepts**       |                                                                                                                                                                            |
| **the machine never sees props** | The defining rule: a machine is pure behavior; props live only at the edge. [→](#the-machine-never-sees-props)                                                             |
| **the edge**                     | Where props/platform meet the machine — the connector (props, reactions) + adapter (platform). [→](#the-machine-never-sees-props)                                          |
| **copy-on-write (COW)**          | The context memory model: share the config's object until the first write, then copy. [→](#how-it-compares)                                                                |
