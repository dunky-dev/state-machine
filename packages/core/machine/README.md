# `@render-experiment/machine-core`

A tiny, **renderer-agnostic state-machine engine** for building UI component
logic once and running it anywhere. It owns _behavior_ — states, transitions,
side-effects, derived state — and knows nothing about the render environment.

It's pure JavaScript: it runs in any JS runtime (browser, Node, the React
Native JS thread), but not in native platform code (e.g. Swift/Kotlin).

```ts
import { machine } from '@render-experiment/machine-core'

const counter = machine({
  initial: 'active',
  context: { count: 0 },
  computed: {
    isMax: ({ context }) => context.count >= 3, // derived state
  },
  states: {
    active: {
      on: {
        // guard gates the transition; action updates context
        inc: {
          guard: ({ computed }) => !computed.isMax,
          actions: [({ context, setContext }) => setContext({ count: context.count + 1 })],
        },
        reset: { target: 'active', actions: [({ setContext }) => setContext({ count: 0 })] },
      },
    },
  },
})

counter.start()
counter.send({ type: 'inc' })
counter.context.count // 1
counter.computed.isMax // false
counter.subscribe(() => render()) // wake on any change
```

---

## Yet another state-machine

Anyone who has reached for [XState](https://stately.ai/docs) or
[Zag](https://zagjs.com/) will feel at home — the same state-chart vocabulary
(`states`, `transitions`, `guards`, `actions`, `effects`), the same headless
philosophy.

Those libraries are excellent. This one exists for two reasons they
aren't built around:

1. **No environment assumption.** Zag is framework-agnostic, but it presumes a
   **DOM** — its machines query DOM nodes, and attach DOM listeners. That's "agnostic about which framework renders the DOM", not "agnostic about whether a DOM exists". This engine assumes _nothing_ about the environment: it's a plain behavioral kernel with no node
   lookups. Every environment touchpoint is pushed to an adapter, so the same
   machine plugs into any render environment.
2. **Performance under heavy fan-out** (below).

### 🏎️ Performance

State is mutated **in place** and changes propagate through a tiny notifier — so a
transition is essentially a function call and a property write. There's no
immutable-snapshot allocation per event, and a machine carries only its own data.
That makes the engine cheap on the two axes that matter at scale: **memory per
machine** (flat, regardless of how many context fields or states it has) and
**event throughput**.

| Metric (single clean run, shared config) | machine-core | XState   | Zag      |
| ---------------------------------------- | ------------ | -------- | -------- |
| Memory / machine (4 fields)              | **~2.8 KB**  | 3.6 KB   | ~13 KB   |
| Memory / machine (64 fields)             | **~2.8 KB**  | 3.6 KB   | ~136 KB³ |
| Construct + start, 5 000 machines        | **~13 ms**   | ~19 ms   | ~81 ms   |
| Apply 200 000 events to completion¹      | **~53 ms**   | ~199 ms  | ~204 ms  |
| Bundle (min + gzip)                      | **~2.7 KB**  | ~14.5 KB | ~2.2 KB² |

<sub>¹ Wall-clock to drain N events — comparable across synchronous (machine-core,
XState) and microtask-batched (Zag) engines. ² Zag's `@zag-js/core`; a real Zag
component also pulls `@zag-js/dom-query` + the component machine. ³ machine-core
and XState hold context as one plain object → memory is flat in field count; Zag's
`bindable` context allocates a reactive cell per field per instance, so its
per-machine memory grows with the field count (~13 → ~36 → ~136 KB at 4 / 16 / 64
fields). Measured via `@zag-js/vanilla`.</sub>

**When throughput actually matters.** It starts to matter in one shape: **many
machines reacting to a high-frequency event stream inside one frame/latency budget.**

Some real cases:

- **Trading / market-data terminals** — 2 000 ticker rows, each a machine, driven
  by a price firehose at sub-frame latency.
- **Canvas boards** — drag-select 3 000 shapes; `pointermove`
  fans out to every selected element's machine, ~270 k transitions/sec inside 16 ms.
- **Live monitoring walls** — 1 000+ hosts, each a timed
  machine (healthy → degraded → alerting) fed by a metrics stream.
- **Multiplayer editors** — every remote user's cursor/selection/edit replayed into
  local entity-machines; active collaborators multiply the stream.
- **Game HUDs** — hundreds of agents, an FSM per entity, ticked every frame.

The pattern is **density × frequency**. Where machine work fights the frame budget,
~3–4× throughput is the difference between smooth and dropped frames; pair it with
the surgical re-renders below (one field changes → only its observers wake) and you're
fast on both the state and the render side.

### How it compares

**Shared baseline — all three have these.** The everyday statechart toolkit is
the same across all three; the spelling differs, the capability doesn't:

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

**Where they differ — the rows that actually decide it.** Read top-down: the
first three are this engine's reasons to exist; the rest are what it trades away
for them.

| What's different                         | Zag                        | XState                                  | machine-core                          |
| ---------------------------------------- | -------------------------- | --------------------------------------- | ------------------------------------- |
| **Fine-grained selection in the engine** | ❌ host framework does it  | ⚠️ via `actor.select` (coarse under)    | 🟢 **`select` (value-deduped)**       |
| **Runs with no host framework / no DOM** | ❌ needs a framework + DOM | ⚠️ statechart yes, fine-graining varies | 🟢 **yes**                            |
| **Flat memory in field/state count**     | ❌ per-field reactive cell | 🟢 plain snapshot                       | 🟢 **plain context, copy-on-write**   |
| Nested / hierarchical states             | ❌ by design               | ✅                                      | ❌ by design (flat)                   |
| Parallel / orthogonal regions            | ❌ by design               | ✅ (true parallel states)               | ⚠️ `compose` (peers, no shared event) |
| Spawned child machines / actors          | ❌ by design               | ✅ (`invoke` / `spawn`)                 | ❌ by design                          |

A few cells deserve their footnote so the table survives scrutiny:

- **¹ `effects` is the same idea in Zag and here** (run on enter, return a cleanup
  run on exit — we took the name from Zag). The difference: Zag's effects receive a
  `scope` (a DOM) and reach for it directly; ours receive no environment — the
  platform is injected via `withAdapter`, so the effect runs even where no DOM exists.
- **❌-by-design** is the philosophy of keeping machines _"light-weight, simple… avoiding
  complex machine concepts like spawn, nested states, etc."_;
- **Fine-grained selection** here is built into the engine: `select(fn)` re-evaluates
  on any change and fires its listener only when the selected value changes — so an
  observer wakes only for the slice it reads, with no host framework or DOM required.
  Zag delegates this to the host framework (which must exist); XState's `actor.select`
  narrows over a coarse snapshot, and its ergonomic fine-graining (`useSelector`) is
  framework-bound. The trade vs. signals: it's not auto-dependency-tracked — a change
  re-runs every live selector + compares (cheap, bounded per machine), rather than
  waking only the selectors that read the changed field.

### Why it's faster

**XState** is built around the **actor model**: a machine's state is a single
immutable _snapshot_ you can serialize, persist, replay, and inspect in Stately's
visual tools. Every transition allocates a fresh snapshot and pushes it through an
observable to all subscribers. Those are real, valuable features — time-travel,
server rehydration, a visualizer — but each one taxes the hot path with an
allocation and a coarse fan-out per event. This engine makes the opposite bet: it
**doesn't** treat state as a serializable snapshot, so it mutates context in place
and notifies through a small notifier. The speed and the flat memory come from a
**narrower contract**, not from better engineering.

That's why it isn't a gap in XState. Dropping the snapshot model would mean
dropping serialization, if you need to persist a machine, rewind it, or watch it
in a debugger, XState is the right tool and worth every byte. If you're driving
thousands of lightweight UI machines you never serialize, you're paying for capabilities
you don't use.

**Zag** sits on a different axis: it's lean too, but it delegates reactivity to the
host framework (React/Vue/...) and presumes a DOM. This engine owns its
reactivity internally, so the _same_ machine runs byte-for-byte identically on the
DOM, React Native, or a bare canvas with no framework underneath.

`machine-core` gives up persistence/visualization (XState) and framework-delegated
rendering (Zag) to be the small, fast engine for **one behavior that runs unchanged on every render target.**

### Data strategy — mutation vs immutability

The single decision underneath the perf numbers is **how each engine holds and
updates a machine's data**. It's the axis the whole "why it's faster" argument
turns on, so it's worth stating plainly:

| Engine           | Data model                                             | Cost per update                                | Buys you                          |
| ---------------- | ------------------------------------------------------ | ---------------------------------------------- | --------------------------------- |
| **machine-core** | **one plain object, mutated in place (copy-on-write)** | a property write + a notifier call             | flat memory, high throughput      |
| XState           | immutable snapshot                                     | allocate a fresh snapshot, fan out to all subs | serialize / persist / time-travel |
| Zag              | a reactive cell per context field                      | a per-field reactive set                       | framework-delegated fine-graining |

**Mutate in place** means `setContext` writes new values onto the machine's own
context object and rings a small notifier — no fresh snapshot per event. So a
transition is essentially _a function call and a property write_, and per-machine
memory is **flat in field and state count**: that's both wins in the table. It's
copy-on-write, not blind mutation — writes go through one batched entry point, so
they're atomic to subscribers and a no-op write doesn't notify.

The trade is **no serializable snapshot** — nothing to persist, rewind, or hand a
visual debugger. machine-core picks the mutable, snapshot-free model on purpose,
paying in capabilities rather than in speed; `select` (value-deduped slices) and
`computed` (memoized derivations) still give precise change observation without
ever materializing whole-state snapshots.

### The machine never sees props

This is the single most important thing to understand about `machine-core`, and
the one place it deliberately diverges from Zag and XState.

In the other libs the machine reads your component's props directly: `prop("open")`
appear _inside_ the machine, on transitions and in actions. **Here the machine
never sees props — ever.** It has no `props` argument, no `prop()` accessor. It
is pure behavior. Nothing else.

Props are the edge where the environment leaks in — a DOM event handed to
`onOpenChange`, a host-specific timer, a controlled value owned by React state.
The moment a machine reads a prop, it is coupled to the shape _one_ environment
happens to hand it, and it can no longer run unchanged anywhere else. So props
are kept entirely **at the edge** (the connector + adapter), never crossing into
the machine. The payoff: **one machine's behavior is byte-for-byte identical on
all enviroments**.

#### So where _do_ props go?

Every job a prop does lands at the edge, never in the machine:

| A prop that…            | …goes here                      |
| ----------------------- | ------------------------------- |
| **configures** behavior | seeded into `context` once      |
| **fires a callback**    | a **reaction** on the connector |
| **is controlled** state | resolved into the initial state |

So `onOpenChange` fires like this: the machine just transitions `closed → open`
and has no idea the callback exists; the **connector** notices `open` flipped and
calls `props.onOpenChange` from the outside (see
[Reactions](#reactions--firing-prop-callbacks-without-the-machine-knowing)).
Platform-specific bits (a DOM `keydown` for Escape) live in the **target's
effects** — e.g. the React bridge's `ComponentEffect` (see the React bindings) —
which listens, applies any prop-gated veto, then sends the machine a plain event.
The core stays pure throughout.

---

## API at a glance

| Export                               | What it is                                                                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `machine(config)`                    | build a service (stopped); `.start()` / `.stop()` / `.send()` / `.state` / `.context` / `.computed` / `.subscribe` / `.select` / `.onStart` / `.onStop`                |
| `config({ ... })`                    | author a config const with full inference + checking, no manual generics                                                                                               |
| `withAdapter(config, adapter)`       | layer a platform's `actions` + `effects` over a config (other impls — `guards`, `delays` — carry through untouched)                                                    |
| `connector(service, connect, props)` | live, memoized, subscribable view snapshot: `.snapshot` / `.subscribe` / `.select` / `.setProps` (prop-callbacks wire automatically)                                   |
| `compose({ a, b })`                  | run several machines as one (orthogonal regions): bundled `start`/`stop` + `.sync()` + `.combine()`                                                                    |
| `createStore(initial, build?)`       | a tiny reactive store (plain value + listeners) for cross-instance singleton state (outside any one machine)                                                           |
| `and` / `or` / `not`                 | guard combinators                                                                                                                                                      |
| `oneOf([...])`                       | conditional action branch                                                                                                                                              |
| `MACHINE_INIT`                       | the synthetic event fired when effects/watchers boot on `start()`                                                                                                      |
| Types                                | `Machine`, `MachineConfig`, `TransitionConfig`, `Guard`, `Action`, `Effect`, `Delay`, `Selection`, `Connect`, `Store`, `StateNode`, `EventBindings`, `AttrBindings`, … |

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
        birthday: { actions: [({ context, setContext }) => setContext({ age: context.age + 1 })] },
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
      ({ context, setContext }) => setContext({ saved: true }),
      'notify', // a named action from implementations.actions
    ],
  },
}
```

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

```ts
import { oneOf } from '@render-experiment/machine-core'

actions: [
  oneOf([
    { guard: 'isMobile', actions: ['lockScroll'] },
    { guard: 'isDesktop', actions: ['dimBackground'] },
    { actions: ['noop'] }, // guardless = fallback
  ]),
]
```

---

## Effects — side-effects _with cleanup_

An effect runs when a state is **entered** and returns an optional **cleanup**
that runs when the state is **left**. Setup and teardown share one closure — so a
listener added on enter is removed by the exact cleanup that captured it
(something plain `entry`/`exit` can't do without manual bookkeeping):

```ts
states: {
  open: {
    effects: [
      ({ send }) => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') send({ type: 'close' }) }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey) // cleanup on exit
      },
    ],
    on: { close: { target: 'closed' } },
  },
  closed: {},
}
```

The initial state's effects boot on `start()`; all active cleanups run on
`stop()`.

### Effects are the per-platform seam (`withAdapter`)

The same effect can mean different things per target. So a config names effects,
and a platform supplies the implementation via `withAdapter`:

```ts
import { withAdapter } from '@render-experiment/machine-core'

// agnostic config — names effects, no platform code:
const config = {
  initial: 'open',
  context: {},
  states: { open: { effects: ['trackEscape'] } },
}

// a platform supplies the real implementation:
const webAdapter = {
  effects: {
    trackEscape: ({ send }) => {
      const fn = (e: KeyboardEvent) => e.key === 'Escape' && send({ type: 'close' })
      document.addEventListener('keydown', fn)
      return () => document.removeEventListener('keydown', fn)
    },
  },
}

const m = machine(withAdapter(config, webAdapter)) // adapter wins on name collision
```

`withAdapter` layers a platform's `actions` + `effects` over the config — those
two are the only platform seam. Everything else in `implementations` carries
through untouched: `guards` stay config-only (pure logic, the same on every
platform), and named `delays` are preserved as-is, so a config with both a named
delay and an adapter keeps its delay intact.

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
// declared on connect (agnostic — no DOM, no framework):
type TooltipReaction<V> = Reaction<
  TooltipState,
  TooltipContext,
  TooltipEvent,
  TooltipProps,
  never,
  V
>

const onOpenChange: TooltipReaction<boolean> = [
  m => m.matches('open') || m.matches('closing'), // selector: a fact about state
  (open, props) => props.onOpenChange?.({ open }), // callback: → the consumer's callback
]

connectTooltip.reactions = [onOpenChange]
```

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
