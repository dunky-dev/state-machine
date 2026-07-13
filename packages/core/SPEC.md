# SPEC - `@dunky.dev/state-machine`

## Overview

A **state machine** models behavior as a small, explicit graph: at any
moment the system is in exactly one of a finite set of **states**; an
**event** may trigger a **transition** to another state, optionally gated
by a **guard** and running **actions** or **effects** along the way.
Behavior becomes a function of _(current state, event)_ instead of a
tangle of boolean flags — every reachable state is named, and every change
is a deliberate transition.

Dunky's engine takes that model and makes it substrate-agnostic: one
machine describes the behavior once; a thin per-target bridge renders it
anywhere. The map below is the whole engine — every feature and how they
connect.

```
   config  -  the whole behavior, declared once
   |
   |   initial state + seed context
   |   states, each with:  on, entry, exit, effects, after, tags
   |   any-state handlers: on
   |   derived data:       computed
   |   data-reactions:     watch
   |   reusable + named:   guards, actions, effects, delays
   |   guards compose (and / or / not); actions set context or run one-of
   |
   |  build
   v
   machine  -  a live service (current state, context, computed)
   |
   |   lifecycle:  [ stopped ]  --start-->  [ running ]  --stop-->
   |
   |  an event is dispatched
   v
   [ run-to-completion queue ]  -  one event at a time
   |
   v
   find a handler ....... this state's, else any-state's
   pick a transition .... first candidate whose guard passes
   |
   +--> exit actions          (only when leaving the state)
   +--> transition actions
   +--> switch state  -------------------------------> notify observers
   +--> entry actions
   +--> start / stop effects, (re)schedule `after` timers
   |
   +--> watch: a field changed --> run its actions (deferred)
   |
   v
   observers
   |   coarse subscription  -  fires on any change
   |   finegrain selection  -  fires only when a chosen value changes
   |
   v
   connector  -  the view boundary
   |   a memoized surface the view renders (handlers + attrs)
   |   reactions:  machine change --> consumer callback
   |   props in, callbacks out;  the machine never sees props
   v
   view


   around a machine
   |
   +-- compose  ......  run several machines as one unit
   |                    (shared start / stop, cross-member sync + combine)
   |
   +-- createStore  ..  state shared between machine instances
```

## Intent

Author a state **once**, as a plain state
machine, and run it identically on any substrate — a web renderer, a
native one, a terminal canvas, or a bare test. Core is the agnostic half:
states, transitions, context, guards, actions, effects, derived data, and
the observation surface a per-target bridge plugs into.

Core is a **plain-mutation kernel**: context is a single object mutated in
place rather than rebuilt on every change; there are no signals and no
immutable snapshots. Performance is a constraint of the spec, not an
afterthought (see [Performance guarantees](#performance-guarantees)).

## Scope & boundaries

**In scope.** The state graph and its runtime; context and derived
(computed) data; guards, actions, effects, timed (`after`) transitions,
and data-reactions (`watch`); the observation surface; the view boundary
(the connector and its reactions); multi-machine composition; and a
cross-instance reactive cell.

**Out of scope — invariants, not preferences.**

- **No substrate.** Core is pure TypeScript. No web, native, or terminal
  API; no DOM, `window`, `document`, or platform globals. Reaching for one
  means the code belongs in a target, not here.
- **The machine never sees props.** A machine is pure behavior. It does
  not read the consumer's props; props enter only at the edge (context
  seeding, the connector, or initial-state computation). This is the one
  rule that guarantees identical behavior across substrates — see
  [The machine never sees props](#the-machine-never-sees-props).
- **Flat states only.** A single machine has a flat set of states — no
  nested or parallel states inside one config. Orthogonality is expressed
  by running several machines together (see
  [Composition](#composition)); "nested" data is modeled with derived
  data, composition, or tags.

## The authoring model

A behavior is described as a **config**, built into a live **service**,
and bridged to a view by a **connector**.

- A **config** declares the whole behavior: a starting state and a seed
  for context; a set of **states**, each of which may handle events, run
  actions when entered or left, run effects while active, and schedule
  timed transitions; any-state event handlers; **derived data** computed
  from context and state; **data-reactions** that run when a field
  changes; and reusable **named** guards, actions, effects, and delays
  that transitions reference by name.
- Building a config yields a **service** that is live but stopped.
- A **connector** turns the service's current state into the surface a
  view renders and fires the consumer's callbacks — without the machine
  ever knowing those callbacks exist.

Types are either inferred from the config literal or pinned explicitly;
pinning makes the named-reference registry compile-checked.

## How it works — the shape of a machine

```
  config  (static description of the behavior)
  +-----------------------------------------------------------------+
  |  initial state + seed context                                   |
  |                                                                 |
  |  states: {                                                      |
  |    <name>: {                                                    |
  |       on       - handle events while in this state              |
  |       entry    - run actions when entered                       |
  |       exit     - run actions when left                          |
  |       effects  - run while in this state, clean up on leave     |
  |       after    - timed transition while in this state           |
  |       tags     - group states                                   |
  |    }, ...                                                       |
  |  }                                                              |
  |                                                                 |
  |  on        - handle events in any state                         |
  |  computed  - data derived from context and state                |
  |  watch     - run actions when a context/computed field changes  |
  |  named guards / actions / effects / delays                      |
  +-----------------------------------------------------------------+
        |
        |  build
        v
  a live but STOPPED service
        |
        |  start
        v
  RUNNING: effects and watchers live, timers scheduled
```

The config is static description; building it yields a live but **stopped**
service; starting it boots the running behavior. Nothing renders — a
target bridge observes the service and translates.

## The behavior contract

These are the guarantees the engine must uphold. Each is testable; each is
what a consumer relies on. They describe _what_ the engine does, not the
method names it exposes.

### Lifecycle

- A freshly built service is **live but stopped**: it sits in its initial
  state with a fresh copy of the seed context, and no effects, timers, or
  watchers are running.
- **Starting** boots the watchers and the effects of the **current**
  state (not necessarily the initial one — a restarted machine may be in
  any state). Starting an already-running service is a no-op.
- **Stopping** runs every active effect's cleanup and disposes the
  watchers. It does **not** reset the current state or context. Stopping
  an already-stopped service is a no-op.
- A stop followed by a start cleanly re-boots from wherever the machine
  currently is (this is what makes remount cycles safe).
- Dispatching events and updating context work while stopped — state and
  context still change and actions still run — but effects and timed
  transitions exist only while running.
- Lifecycle transitions are observable, so a bridge can wire and tear down
  external subscriptions in step with start and stop.

### Run-to-completion

- Dispatching an event **enqueues** it; the queue is drained one item at a
  time. An event dispatched from inside an action, effect, or watcher is
  appended and processed after the current item finishes — never
  interleaved. The state graph is never observed mid-transition.
- Deferred work (a watcher's actions) shares the same queue and ordering.
- A runaway feedback loop — e.g. a watcher that writes the field it
  watches, or actions that dispatch in a cycle — is detected and aborted
  during development with a diagnostic, rather than hanging.

### Transition resolution

```
  event dispatched
     |
     v
  find a handler for this event type
     |   this state's handlers first, else any-state handlers
     v
  choose a transition
     |   unguarded ............ taken as-is
     |   guarded .............. taken iff the guard passes
     |   list of candidates ... first whose guard passes wins
     |                          (an unguarded candidate always matches)
     v
  none match --> event ignored (no-op)
  match ------> apply the transition
```

- A state's own handlers take precedence over any-state handlers for the
  same event type.
- A handler may be a full transition, a bare action (shorthand for an
  action-only, targetless transition), or a list of candidates evaluated
  in order — the first whose guard passes wins, so an unguarded candidate
  belongs last.
- Guards are **pure predicates** over the current context, the event, and
  derived data. They compose: _all-of_ (vacuously true with no operands),
  _any-of_ (vacuously false with no operands), and negation. Guards may be
  inline or referenced by name.

### Applying a transition

The order of operations on a matched transition is fixed and observable:

```
  apply(transition):
     target  = the transition's target, or the current state if none
     leaving = target is a different state
     |
     +-- if leaving AND running: stop the current state's effects
     |                           (run cleanups, cancel its timers)
     +-- if leaving: run the current state's exit actions
     |
     +-- run the transition's own actions            (always)
     |
     +-- if leaving:
           switch to the target state  -->  notify observers
           run the target state's entry actions
           if running: start the target's effects + schedule its timers
```

- A **targetless** transition (a self-transition) runs only its own
  actions — no exit, no entry, no effect restart. This is how context is
  updated in place without leaving the state.
- Exit actions run **before** the state switches; entry actions run
  **after**. The transition's own actions run **between** exit and the
  switch.
- Observers are notified exactly once per state change, and once per
  context update that actually changes a value.

### Context

- Context is **one object, mutated in place**; its identity is stable for
  the machine's lifetime, so references captured in effects and actions
  always see live values.
- Updating context is a **shallow merge** that notifies observers **only
  if** at least one field actually changed; a no-op update is silent.
- The common case — setting context — has a write-sugar that composes
  several patches in order, each an object or a function of the current
  params, with later function-patches seeing earlier writes.

### Derived data

- Each piece of derived data is a **lazy, memoized** value computed from
  context, the current state, and other derived data. It recomputes only
  when one of the inputs it actually read has changed (dependencies are
  tracked per field).
- Reading the current state inside a derivation makes the state lifecycle
  one of its tracked inputs; reading another derived value chains
  transitively.

### Actions

- Actions are fire-and-forget side-effects with access to context, the
  event, derived data, a way to update context, and a way to dispatch
  further events (subject to run-to-completion).
- A **conditional action** runs the first of several branches whose guard
  passes; the rest are skipped. A guardless branch always matches — it is
  the fallback, and belongs last.
- Actions may be inline or referenced by name.

### Effects — side-effects with cleanup

- An effect runs when its state is **entered** and its cleanup runs when
  that state is **left** (or the machine stops). Effects exist only while
  the machine is running.
- Core owns only the effects that are **props-free and platform-free**
  (e.g. subscribing to a shared store). An effect that needs props or a
  platform API is a target-side concern, not core's — the agnostic
  _decision_ still lives here; only the platform listener lives in the
  target.

### Timed transitions

- A state may schedule a transition to fire after a **delay** while it
  remains active. The delay is a fixed duration or a named delay that may
  read context and derived data to produce a dynamic value.
- A pending timer is **cancelled** when the state is left, and is
  **ignored** if the machine has since stopped, moved elsewhere, or exited
  and re-entered the same state — a stale timer never applies its
  transition.
- A timer that comes due while a transition is in flight defers so it
  never interleaves with that transition.

### Data-reactions

- A data-reaction watches a context or derived field and runs its actions
  whenever that field's value changes, in **any** state, while the machine
  runs. It is established on start and disposed on stop.
- Because a reaction observes a change as it happens, its actions are
  **deferred** onto the queue rather than run re-entrantly; a run still
  pending when the machine stops is dropped.
- A data change is not a domain event, so a reaction's actions see a
  synthetic boot marker in place of an event.

### Observation

- A **coarse** subscription fires on any subsequent change — state or
  context.
- A **value-deduped selection** narrows to a chosen value and fires only
  when that value changes (by identity, or a supplied equality). It may
  select a single field, the current state, or a composite over anything.
- Neither form fires on subscribe; both hand back a way to detach.

### Development vs. production

- Referencing a name (guard, action, effect, or delay) with no matching
  implementation is a **hard error during development** (loud, fail-fast)
  and a **degraded no-op with a warning in production**. The rule is
  shared by everything that resolves a name.

## The machine never sees props

Props are where the environment leaks in — a platform event handed to a
callback, a host timer, a runtime-specific shape. If the machine read them
it would couple to one runtime. So props enter only at the edge:

- **config the transitions need** (delays, flags like `disabled`) → seeded
  into context and refreshed as props change;
- **callbacks and controlled state** (`onOpenChange`, a controlled
  `open`) → handled by the connector, which observes the machine and calls
  back;
- **initial state derived from props** → computed before the machine is
  built.

**Controlled state is initial-only.** A controlled value resolves into the
_initial_ state once; the connector reports every intent to the consumer,
who re-renders with the new value. The engine does not live-reconcile a
controlled value after mount — it reports the intent and the consumer
decides.

## The view boundary — the connector

```
  machine (state + context + derived)            consumer props
        |                                              |
        |  observe (coarse)                            |  props update
        v                                              v
  +--------------------------------------------------------------+
  |  connector                                                   |
  |    - a memoized view surface, rebuilt lazily on any machine  |
  |      change or props change (stable while inputs are         |
  |      unchanged, so a bridge can treat it as a snapshot)      |
  |    - wakes its observers on a machine change or props update |
  |    - reactions: established on start, torn down on stop      |
  +--------------------------------------------------------------+
        |
        v
  the view spreads the surface onto elements (handlers + attrs)
```

- The connector is **passive**: the target bridge owns the lifecycle; the
  connector only observes.
- Its view surface is **memoized** and rebuilt lazily; its identity is
  stable while inputs are unchanged, so a bridge can use it directly as a
  render snapshot.
- A props update that is **shallow-equal** to the current props changes
  nothing.
- A connector may carry **reactions** — declared pairs of "a selected
  machine value" and "a consumer callback". When the value changes, the
  callback fires with the value and current props. Reactions are
  established on start and torn down on stop, so a restart cleanly
  re-establishes them. This is how a state declares "machine change →
  consumer callback" once, fired identically on every target, without the
  machine knowing the callback exists.

## Composition

- Several machines can be bundled into one unit with a shared lifecycle.
  Members stay independent — each is read and dispatched to on its own.
- Starting the unit starts every member in declared order; stopping it
  disposes the unit's coordination subscriptions, then stops members in
  reverse order.
- The unit offers two coordination primitives: a **cross-member reaction**
  that runs whenever any member changes (the place for rules like "when
  the popup closes, close the submenu"), and a **value-deduped derivation
  across members**. Both are coarse, do not fire on setup, and are
  auto-disposed on stop.

## Cross-instance state

- A tiny reactive cell holds state that lives **outside** any one machine
  — for cross-instance singletons ("only one tooltip open at a time").
  Per-machine state stays in the machine's context; this is the escape
  hatch for state shared _between_ machines.
- Updating it shallow-merges and notifies **only** on an actual change;
  its subscription fires on every subsequent change, never on subscribe.

## Performance guarantees

Performance is part of the contract. The engine must not regress these:

- **Notifying observers in the steady state allocates nothing.**
- **Context updates mutate in place** — no per-change object allocation.
- **Derived data is lazy and memoized** — a value is recomputed only when
  a tracked input changed.

Prefer mutation over allocation on hot paths; avoid spreading objects,
chaining array methods, or allocating closures inside loops.

## Edge cases that carry design meaning

- A targetless (self-)transition never runs exit, entry, or effects — only
  its own actions. Context-only updates rely on this.
- Dispatching events and updating context work while stopped; effects and
  timers do not.
- A restart boots the **current** state's effects, not the initial
  state's — a restarted machine may be in any state.
- Neither a coarse subscription nor a selection fires on subscribe.
- A no-op context or cell update is silent.
- A data-reaction run still pending at stop is dropped; a reaction's
  actions see a synthetic boot marker, not a domain event.
- A stale timed transition (wrong generation, wrong state, or stopped) is
  ignored, never applied.
- Referencing a missing named implementation is a hard error in
  development and a degraded no-op in production.
