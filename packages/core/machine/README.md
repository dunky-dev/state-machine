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

The differentiator is **where the fine-grained reactivity lives**.

- **Zag** delegates it to the host framework: its `bindable` context, `computed`,
  and `watch` map `track` onto the framework's own primitive (Vue `computed`,
  Solid `createMemo`, Svelte `$derived`, React `useMemo`). Fine-grained — but
  only because a host framework is there to do the tracking.
- **XState** has deduped selection too — `actor.select(selector)` on the core
  actor, and `@xstate/store`'s `store.select(selector)`. But they're
  **manual selectors**: you name the slice, `state => state.context.x`.
  (And `@xstate/store` is a store, not the statechart.)

This engine puts the reactivity **in the machine itself, and auto-tracked**: each
context field is its own signal, and reading one inside a `computed` / `select`
subscribes to exactly that field — no host framework, no manual selector. So a
change updates **only the observers that read the changed field** (`O(changed)`,
not `O(all)`), which matters when **many independent machines run at once**.

> Each piece of context is its own **signal** (a reactive cell). When code reads
> a cell, it automatically becomes a subscriber to that one cell, nothing else.
> So when one field changes, only the readers of _that_ field re-run,
> automatically, with no manual dependency lists or selectors. The kernel is
> [`@preact/signals-core`](https://preactjs.com/guide/v10/signals/).

### How it compares

| Capability                                | Zag                            | XState                                                 | machine-core               |
| ----------------------------------------- | ------------------------------ | ------------------------------------------------------ | -------------------------- |
| States / transitions / guards             | ✅                             | ✅                                                     | ✅                         |
| Guard combinators (`and`/`or`/`not`)      | ✅                             | ✅                                                     | ✅                         |
| Conditional actions                       | ✅ `choose`                    | ✅ `choose`                                            | ✅ `oneOf`                 |
| `entry` / `exit`                          | ✅                             | ✅                                                     | ✅                         |
| Effects with cleanup                      | ✅                             | ✅ (invoked callbacks)                                 | ✅ `effects`               |
| Computed / derived                        | ✅                             | ✅                                                     | ✅                         |
| Timed transitions (`after`)               | ✅                             | ✅                                                     | ✅                         |
| Watch (react to data change)              | ✅ `watch`                     | ⚠️ via `always`                                        | ✅ `watch` (name from Zag) |
| Per-platform late binding                 | ✅                             | ⚠️ via `.provide()`                                    | ✅ via `withAdapter`       |
| **Where fine-grained reactivity lives**   | ⚠️ delegated to host framework | ⚠️ manual selectors (`actor.select` / `@xstate/store`) | ✅ intrinsic, auto-tracked |
| **Works with no host framework / no DOM** | ❌ (needs a framework + DOM)   | varies                                                 | ✅                         |
| Parallel / orthogonal regions             | ✅ (parallel states)           | ✅ (parallel states)                                   | ✅ via `compose` (peer machines) |
| Nested / hierarchical states              | ✅                             | ✅                                                     | ❌ (flat states)           |
| Spawned child machines / actors           | ❌                             | ✅ (`invoke` / `spawn`)                                | ❌                         |
| Pre-built framework bindings              | ✅ React/Vue/Solid/Svelte      | ✅ many                                                | ❌ (write per target)      |
| Pre-built components                      | ✅ ~40                         | —                                                      | ❌ (built on top)          |

The line that earns building locally isn't "they're coarse" — they're not. It's
**where the reactivity lives and how it's expressed**: Zag delegates fine-graining
to a host framework that must exist (and presumes a DOM); XState exposes deduped
selection but via **manual selectors** (and `@xstate/store` is a store, not the
statechart). Here it's **intrinsic to the machine and auto-tracked** — no host
framework, no DOM, no named slice. (Zag's `computed`/`watch`, like this engine's,
are themselves Vue/Lit-inspired — no novelty claimed there.)

---

## API at a glance

| Export                               | What it is                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `machine(config)`                    | build a service (stopped); `.start()` / `.stop()` / `.send()` / `.state` / `.context` / `.computed` / `.subscribe` / `.select`  |
| `withAdapter(config, adapter)`       | merge a platform's `actions` + `effects` into a config                                                                          |
| `connector(service, connect, props)` | live, memoized, subscribable view snapshot                                                                                      |
| `compose({ a, b })`                  | run several machines as one (orthogonal regions): bundled `start`/`stop` + `.sync()` + `.combine()`                            |
| `and` / `or` / `not`                 | guard combinators                                                                                                               |
| `oneOf([...])`                       | conditional action branch                                                                                                       |
| `MACHINE_INIT`                       | the synthetic event fired when effects/watchers boot on `start()`                                                               |
| `createContext` / `createState`      | the underlying building blocks (advanced)                                                                                       |
| Types                                | `Machine`, `TransitionConfig`, `Guard`, `Action`, `Effect`, `Delay`, `Selection`, `Connect`, `EventBindings`, `AttrBindings`, … |

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

`withAdapter` merges a platform's `actions` + `effects` over the config (guards
stay config-only — they're pure logic, the same on every platform).

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

**Fine-grained** `select` narrows to a slice and fires _only when that slice's
value changes_ — the `O(changed)` path:

```ts
// a single named field (typed + autocompleted):
m.select.context('count').subscribe(n => console.log('count is now', n))
m.select.computed('isEmpty').subscribe(empty => toggle(empty))
m.select.state().subscribe(s => console.log('state →', s))

// or a derived/composite selection via a function:
const view = m.select(() => ({ open: m.matches('open'), count: m.context.count }))
view.subscribe(render, (a, b) => a.open === b.open && a.count === b.count) // optional equality
view.value // read the current value directly (tracked, like a signal)
```

A `select` that doesn't read the changed field is never even re-run — so one
machine's change wakes only the observers of the field that moved.

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

`c.snapshot`'s identity changes only when the machine (or props) changes — so it
drops straight into React's `useSyncExternalStore(c.subscribe, () => c.snapshot)`
without the infinite-loop / tearing pitfalls of returning a fresh object each
read.

> **Why `connect` returns abstract handlers (`onPress`) and not `onClick`:** core
> stays renderer-blind. A per-target `normalize` step translates the agnostic
> _bindings_ vocabulary (`onPress`, `role`, `describedBy`) into real props
> (`onClick`, `aria-describedby`) — so the same `connect` can target the DOM,
> React Native, or any other surface.

---

## Composing machines

States are flat. When a component has **two independent dimensions of state at
once** — say a popup that's open/closed _and_ a submenu that's shown/hidden —
each dimension is its own machine, and `compose` runs them as one unit
(orthogonal regions, without nested states):

```ts
import { compose } from '@render-experiment/machine-core'

const popup = machine({ /* closed / open */ })
const submenu = machine({ /* none / shown */ })

const combobox = compose({ popup, submenu })
combobox.start() // starts every member; .stop() stops all + disposes the helpers below

// members stay independent — drive and read each on its own:
popup.send({ type: 'focus' })
submenu.send({ type: 'open' }) // both regions active simultaneously
```

`compose` returns a `Composition` with two helpers, both auto-disposed on
`stop()`:

```ts
// sync — a cross-region rule: react when any member changes
combobox.sync(() => {
  if (popup.matches('closed')) submenu.send({ type: 'close' })
})

// combine — one value-deduped Selection derived across members; reads
// auto-track, so it fires only when a read field changes (O(changed))
const view = combobox.combine(() => ({ open: popup.matches('open'), sub: submenu.state }))
view.value // { open: true, sub: 'shown' }
view.subscribe(render)
```

This is the engine's answer to hierarchy/parallel statecharts: rather than
nesting states in one machine, compose independent peer machines. Each stays
individually observable (fine-grained `select` per region), and `compose` adds
only the lifecycle + coordination glue.

---

## Putting it together

```ts
import { machine, withAdapter, connector } from '@render-experiment/machine-core'

// 1. describe behavior (agnostic)
const disclosureConfig = {
  initial: 'closed',
  context: {},
  states: {
    closed: { on: { open: { target: 'open' } } },
    open: {
      effects: ['trackEscape'],
      on: { close: { target: 'closed' } },
    },
  },
}

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
