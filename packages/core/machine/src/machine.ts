/**
 * Machine engine — rebuilt from scratch, one decision at a time.
 *
 * Reactivity kernel: @preact/signals-core (locked decision).
 *
 * ROUND 1 — Context layer (DECIDED):
 *   - Each context field is its own signal ("cell").
 *   - Reads are plain, tracked property access: `context.field`
 *     (a getter that reads the cell's signal → auto-subscribes the reader).
 *   - Writes go through one explicit, batched entry point:
 *     `setContext({ field: value })`.
 *   This mirrors Solid's store split (plain tracked reads, explicit writes)
 *   — no assignment-reactive footgun, no per-cell .get()/.set() ceremony.
 *
 * Everything below this layer (state, transitions, guards, actions, effects,
 * computed, subscription, connect) is STUBBED and will be built in later
 * rounds. The build is intentionally incomplete until then.
 */

import {
  batch,
  computed as preactComputed,
  effect as preactEffect,
  signal,
  type Signal,
} from '@preact/signals-core'

// 9a: the agnostic bindings vocabulary (event + attr) a component's connect()
// emits. Re-exported here so the rebuilt engine is one import surface; the
// target-side `normalize` translates these to real props (onPress→onClick, …).
// The vocabulary itself is reviewed in depth during the target sync (later).
export type { AttrBindings, EventBindings, KeyboardPayload, PointerPayload } from './bindings'

// -----------------------------------------------------------------------------
// Round 1: context layer
// -----------------------------------------------------------------------------

/**
 * Build the reactive context from a plain initial object.
 *
 * Returns:
 *   - `context`: a read view. `context.field` is a getter over the field's
 *     signal — reading it inside a tracked scope (effect/computed) subscribes
 *     the reader to just that field.
 *   - `setContext(patch)`: the single write entry point. Batched so a
 *     multi-field patch notifies each subscriber at most once; signals' own
 *     Object.is skips no-op writes.
 *
 * The setup loop runs once per machine (never on read/write), so per-read cost
 * is a plain accessor — no Proxy.
 */
export function createContext<Context extends object>(
  initial: Context,
): {
  context: Context
  setContext: (patch: Partial<Context>) => void
} {
  const cells = {} as { [K in keyof Context]: Signal<Context[K]> }
  const context = {} as Context

  for (const key in initial) {
    const k = key as keyof Context
    const cell = signal(initial[k])
    cells[k] = cell
    Object.defineProperty(context, k, {
      get: () => cell.value,
      enumerable: true,
      configurable: false,
    })
  }

  const setContext = (patch: Partial<Context>) => {
    batch(() => {
      for (const key in patch) {
        const cell = cells[key as keyof Context]
        if (cell) cell.value = patch[key as keyof Context]!
      }
    })
  }

  return { context, setContext }
}

// -----------------------------------------------------------------------------
// Round 2: state representation (DECIDED)
// -----------------------------------------------------------------------------
//
// Flat tagged states (the "G" decision: flat per machine, composition for
// hierarchy/parallelism later). One active state, a plain string. States
// declare `tags` co-located on the node. Read surface:
//   - `state`            tracked current state string
//   - `hasTag(tag)`      tracked — is the current state tagged `tag`?
//   - `matches(name)`    tracked — is the current state exactly `name`?
// All three are tracked signal reads (reading inside an effect/computed
// subscribes the reader), matching Round 1's context model.
//
// This layer owns ONLY representation + reads. Moving between states
// (transitions) is Round 3.

/** Per-state node. `tags` groups states so consumers query a tag, not names. */
export interface StateNode {
  tags?: string[]
}

export interface State<T extends string> {
  /** Tracked current state. */
  readonly state: T
  /** Tracked: is the current state tagged `tag`? */
  hasTag: (tag: string) => boolean
  /** Tracked: is the current state exactly `name`? (sugar for state === name) */
  matches: (name: T) => boolean
  /**
   * Move to a new state. INTERNAL to the engine: the transition layer
   * (Round 3) calls this; the assembled machine does NOT forward it to
   * consumers (who move state only via `send`). Privacy is structural — the
   * public machine simply won't expose `set` — not by naming convention.
   */
  set: (next: T) => void
}

export function createState<T extends string>(initial: T, nodes: Record<T, StateNode>): State<T> {
  const stateSig = signal<T>(initial)

  // Precompute each state's tag set once (lookup is per-read, must be cheap).
  const tagsOf = {} as Record<T, ReadonlySet<string>>
  for (const name in nodes) {
    tagsOf[name as T] = new Set(nodes[name as T].tags ?? [])
  }

  return {
    get state() {
      return stateSig.value // tracked read
    },
    hasTag(tag: string) {
      return tagsOf[stateSig.value].has(tag) // reads stateSig → tracked
    },
    matches(name: T) {
      return stateSig.value === name // reads stateSig → tracked
    },
    set(next: T) {
      stateSig.value = next // Object.is dedup is built into the signal
    },
  }
}

// -----------------------------------------------------------------------------
// Round 3: transitions (DECIDED)
// -----------------------------------------------------------------------------
//
// send(event) moves the machine. Decisions:
//   3a Events are { type, ...payload } discriminated unions.
//   3b Transitions live in each state's `on`, with an optional top-level `on`
//      for any-state events. Per-state wins over top-level.
//   3c An event maps to one transition OR an array (guard fallthrough: first
//      whose guard passes wins). Self-transitions (no `target`, or same state)
//      run actions but SKIP exit/entry (internal only).
//   3d send() is QUEUED: a send() called during a transition is enqueued and
//      processed after the current one fully completes (exit→actions→switch→
//      entry). No re-entrancy corruption; events process serially.
//
// Transition sequence on a state change:
//   exit actions (old state) → transition actions → switch state →
//   entry actions (new state).
//
// NOTE: guard + action RESOLUTION (how a name/fn becomes a result) is wired
// minimally here and formalized in Round 4 (guards) and Round 5 (actions).
// This round owns the transition mechanics + the queue, not those registries.

// -----------------------------------------------------------------------------
// Round 4a: guards — params shape + inline guards (DECIDED)
// -----------------------------------------------------------------------------
//
// A guard is a predicate gating a transition. It receives the FINAL params
// shape now — { context, event, computed } — even though `computed` is wired
// in Round 7; until then it's an empty object. Locking the shape here means no
// guard signature churns later. Named guards (4b) and combinators (4c) build
// on this same Guard type.

/** Everything a guard can read. `computed` is `{}` until Round 7 wires it. */
export interface GuardParams<Context, Event, Computed = Record<string, never>> {
  context: Context
  event: Event
  computed: Computed
  /**
   * Resolve another guard — a registered name or an inline fn — against these
   * same params (4c). The channel combinators use, so `and('a', not(b))`
   * resolves names through the runtime's single guard registry. User guards
   * may also call it to consult another guard.
   */
  guard: (g: GuardArg<Context, Event, Computed>) => boolean
}

/** An inline guard: a predicate over the params. */
export type Guard<Context, Event, Computed = Record<string, never>> = (
  params: GuardParams<Context, Event, Computed>,
) => boolean

// -----------------------------------------------------------------------------
// Round 4b: named guards (DECIDED)
// -----------------------------------------------------------------------------
//
// A transition's `guard` can be an inline function (4a) OR a NAME resolved
// against `implementations.guards`. Names enable reuse + schema exhaustiveness.
// A missing name throws in dev (catches typos immediately) and warns + treats
// as false in prod (non-crashing). Resolution is one channel so the
// combinators (4c) reuse it.

/** A guard arg in a transition: an inline predicate or a registered name. */
export type GuardArg<Context, Event, Computed = Record<string, never>> =
  | Guard<Context, Event, Computed>
  | string

const isDev = process.env.NODE_ENV !== 'production'

/**
 * The event the engine synthesizes when it starts the initial state's effects
 * at construction (6, decision A/B). Dotted so it can't collide with a domain
 * event; exported so a boot effect can branch on it: `event.type === MACHINE_INIT`.
 */
export const MACHINE_INIT = 'machine.init' as const

// -----------------------------------------------------------------------------
// Round 4c: guard combinators and / or / not (DECIDED)
// -----------------------------------------------------------------------------
//
// Compose guards without naming every combination. Args are GuardArgs — names
// OR inline fns — each resolved through `params.guard()`, the runtime's single
// registry channel. So `and('isOpen', not('isAnimating'))` works, and so does
// `and(isOpenFn, not(isAnimatingFn))`. Compose arbitrarily deep. Short-circuit.

/** AND — true iff every guard passes. Zero args → true (empty intersection). */
export function and<Context, Event, Computed = Record<string, never>>(
  ...guards: Array<GuardArg<Context, Event, Computed>>
): Guard<Context, Event, Computed> {
  return params => guards.every(g => params.guard(g))
}

/** OR — true iff any guard passes. Zero args → false (empty union). */
export function or<Context, Event, Computed = Record<string, never>>(
  ...guards: Array<GuardArg<Context, Event, Computed>>
): Guard<Context, Event, Computed> {
  return params => guards.some(g => params.guard(g))
}

/** NOT — logical negation of a single guard. */
export function not<Context, Event, Computed = Record<string, never>>(
  guard: GuardArg<Context, Event, Computed>,
): Guard<Context, Event, Computed> {
  return params => !params.guard(guard)
}

/** A single transition: optional target, optional guard, optional actions. */
export interface Transition<
  State extends string,
  Context,
  Event,
  Computed = Record<string, never>,
> {
  target?: State
  /** Inline predicate (4a) or a registered guard name (4b). */
  guard?: GuardArg<Context, Event, Computed>
  /** Actions to run: inline fns (5a) or registered names (5b), in order. */
  actions?: Array<ActionArg<Context, Event, Computed>>
}

// -----------------------------------------------------------------------------
// Round 5a: actions — params shape + inline actions (DECIDED)
// -----------------------------------------------------------------------------
//
// An action is a side-effect a transition (or entry/exit) runs: mutate
// context, fire an event, call a callback. FINAL params shape, locked now:
//   { context, setContext, event, send, computed }
// `setContext` is the one write entry point (R1); `send` is the queued
// dispatcher (R3); `computed` is `{}` until Round 7. Actions DO — they do NOT
// get `guard` (deciding is the guards' job; an action calling a guard is a
// smell). Named actions (5b), oneOf (5c), entry/exit (5d) build on this type.

/** Everything an action can read/use. `computed` is `{}` until Round 7. */
export interface ActionParams<Context, Event, Computed = Record<string, never>> {
  context: Context
  setContext: (patch: Partial<Context>) => void
  event: Event
  send: (event: Event) => void
  computed: Computed
}

/** An inline action: a side-effect over the params. */
export type Action<Context, Event, Computed = Record<string, never>> = (
  params: ActionParams<Context, Event, Computed>,
) => void

// -----------------------------------------------------------------------------
// Round 5c: oneOf — conditional action branch (DECIDED)
// -----------------------------------------------------------------------------
//
// `oneOf([...])` is the conditional-action analog of fallthrough transitions:
// the FIRST branch whose guard passes runs its action list; the rest are
// skipped (short-circuit). It lives inside an `actions` list — used where
// there's no transition array to fall through (entry/exit lists, or alongside
// unconditional actions in a transition). For choosing a whole TRANSITION,
// use the fallthrough array form (R3) instead.
//
//   actions: [
//     'alwaysRun',
//     oneOf([
//       { guard: 'isCheckbox', actions: ['toggle'] },
//       { guard: 'isRadio',    actions: ['select'] },
//       { actions: ['activate'] },   // guardless = fallback
//     ]),
//   ]

/** One branch of a oneOf: optional guard + the actions to run if it wins. */
export interface OneOfBranch<Context, Event, Computed = Record<string, never>> {
  guard?: GuardArg<Context, Event, Computed>
  actions: Array<ActionArg<Context, Event, Computed>>
}

/** The oneOf sentinel — the runtime detects it in an actions list and expands. */
export interface OneOf<Context, Event, Computed = Record<string, never>> {
  readonly __oneOf: true
  readonly branches: Array<OneOfBranch<Context, Event, Computed>>
}

/** Build a oneOf: first branch whose guard passes runs; rest skipped. */
export function oneOf<Context, Event, Computed = Record<string, never>>(
  branches: Array<OneOfBranch<Context, Event, Computed>>,
): OneOf<Context, Event, Computed> {
  return { __oneOf: true, branches }
}

/**
 * An action arg in an `actions` list: an inline action (5a), a registered
 * name (5b), or a `oneOf(...)` conditional branch (5c). Missing name → throw
 * in dev, warn in prod. A list runs in order.
 */
export type ActionArg<Context, Event, Computed = Record<string, never>> =
  | Action<Context, Event, Computed>
  | string
  | OneOf<Context, Event, Computed>

// -----------------------------------------------------------------------------
// Round 6: effects — state-scoped side-effects WITH cleanup (DECIDED, Zag model)
// -----------------------------------------------------------------------------
//
// An effect is the paired sibling of entry/exit: it runs when a state is
// entered and may RETURN a cleanup that runs when the state is exited. Setup
// and teardown share one closure (e.g. addEventListener / removeEventListener),
// which entry+exit can't do without manually stashing the reference.
//
// Sequencing bookends everything (decision A): cleanup is the FIRST thing on
// exit and start is the LAST thing on enter, so an effect's resource is alive
// for the whole time the state's actions run. Effects are the seam the adapter
// swaps per platform (withAdapter, R6+), so they're named OR inline like
// guards/actions; the adapter overrides the NAMED ones.

/** An inline effect: runs on enter, optionally returns a cleanup run on exit. */
export type Effect<Context, Event, Computed = Record<string, never>> = (
  params: ActionParams<Context, Event, Computed>,
) => void | (() => void)

/** An effect arg: an inline effect (6) or a registered name (resolved against
 * implementations.effects). Missing name → throw in dev, warn in prod. */
export type EffectArg<Context, Event, Computed = Record<string, never>> =
  | Effect<Context, Event, Computed>
  | string

// -----------------------------------------------------------------------------
// Round 7: computed — derived state (DECIDED, A/A/A)
// -----------------------------------------------------------------------------
//
// A computed is a pure derivation backed by a preact computed() signal: lazy,
// memoized, and auto-tracked — it reads context (7a) and other computeds (7b),
// and recomputes only when one of those inputs changes (O(changed), not on
// every read). The Computed type is the shape of VALUES ({ isEmpty: boolean });
// the config holds the DEFINITIONS (functions producing those values). Defs get
// the same { context } bag style as guards/actions (decision 1=A). The bag is
// the one the engine threads into guard/action/effect params (was {} until now)
// and is surfaced on the layer (7c).

/** A single computed definition: derives a value from context (7a). */
export type ComputedDef<Context, Computed = Record<string, never>, Value = unknown> = (params: {
  context: Context
  computed: Computed
}) => Value

/** The map of computed definitions, keyed to the Computed value shape. */
export type ComputedDefs<Context, Computed> = {
  [K in keyof Computed]: ComputedDef<Context, Computed, Computed[K]>
}

type TransitionEntry<State extends string, Context, Event, Computed> =
  | Transition<State, Context, Event, Computed>
  | Array<Transition<State, Context, Event, Computed>>

export interface TransitionConfig<
  State extends string,
  Context,
  Event extends { type: string },
  Computed = Record<string, never>,
> {
  initial: State
  context: Context
  states: Record<
    State,
    StateNode & {
      on?: Record<string, TransitionEntry<State, Context, Event, Computed>>
      /** 5d: actions run when this state is entered (after the switch). */
      entry?: Array<ActionArg<Context, Event, Computed>>
      /** 5d: actions run when this state is exited (before the switch). */
      exit?: Array<ActionArg<Context, Event, Computed>>
      /** 6: effects started on enter; their cleanups run first on exit. */
      effects?: Array<EffectArg<Context, Event, Computed>>
    }
  >
  /** Any-state events. Per-state `on` takes precedence over this. */
  on?: Record<string, TransitionEntry<State, Context, Event, Computed>>
  /** 7: derived state. Each def becomes a lazy, memoized computed signal read
   * via the `computed` bag in guard/action/effect params (and on the layer). */
  computed?: ComputedDefs<Context, Computed>
  /** Named implementations referenced by string in transitions. */
  implementations?: Implementations<Context, Event, Computed>
}

/** The named-implementation registries a config (and an adapter) supply. */
export interface Implementations<Context, Event, Computed = Record<string, never>> {
  /** Reusable named guards (4b). Referenced by name in a transition `guard`. */
  guards?: Record<string, Guard<Context, Event, Computed>>
  /** Reusable named actions (5b). Referenced by name in an `actions` list. */
  actions?: Record<string, Action<Context, Event, Computed>>
  /** Reusable named effects (6). The adapter (withAdapter) overrides these. */
  effects?: Record<string, Effect<Context, Event, Computed>>
}

// -----------------------------------------------------------------------------
// Round 6c: withAdapter — platform injection seam (DECIDED)
// -----------------------------------------------------------------------------
//
// A config names effects/actions ('trackOutsideClick', 'focusFirstItem') but
// the implementation is platform-specific (DOM addEventListener vs canvas
// hit-test vs TUI key handler). withAdapter merges a platform's actions +
// effects over the config's implementations (decision B: those two are the
// platform seam; guards stay config-only — pure predicates over context/event,
// identical on every platform). The agnostic config stays pure; the platform
// is applied at the edge: createMachine(withAdapter(config, domAdapter)).

/**
 * Platform implementations swapped per target. Only actions + effects — the
 * things that touch the platform. On a name collision the adapter WINS
 * (decision 3): the config's named impl is the default, the platform overrides.
 */
export type Adapter<Context, Event, Computed = Record<string, never>> = Pick<
  Implementations<Context, Event, Computed>,
  'actions' | 'effects'
>

/**
 * Merge a platform `adapter` over `config.implementations`, adapter winning on
 * name collisions. Returns a NEW config — the input stays untouched, so one
 * agnostic config can be adapted for many platforms.
 */
export function withAdapter<
  State extends string,
  Context,
  Event extends { type: string },
  Computed = Record<string, never>,
>(
  config: TransitionConfig<State, Context, Event, Computed>,
  adapter: Adapter<Context, Event, Computed>,
): TransitionConfig<State, Context, Event, Computed> {
  const base = config.implementations
  return {
    ...config,
    implementations: {
      guards: base?.guards,
      actions: { ...base?.actions, ...adapter.actions },
      effects: { ...base?.effects, ...adapter.effects },
    },
  }
}

// -----------------------------------------------------------------------------
// Round 8: subscription surface (DECIDED)
// -----------------------------------------------------------------------------
//
// Two pieces: coarse `subscribe(listener)` (8a — wake on any change) and a
// `select` builder (8b/8c) that narrows to a slice. `select(fn)` is the
// function form (derived/composite); `select.context/.computed/.state(...)`
// are typed named-scope forms (8c). All return a Selection — a wrapped preact
// computed: read `.value` (tracked, like signal.value) or `.subscribe(listener,
// equals?)` to fire only when the SELECTED value changes (value-deduped,
// Object.is default + optional equals). The selection machinery exists only
// when select() is called — unobserved machines pay nothing.

/** Compare two selected values; return true if equal (no fire). */
export type EqualityFn<Value> = (a: Value, b: Value) => boolean

/** A narrowed, value-deduped view of the machine. Wraps a preact computed. */
export interface Selection<Value> {
  /** Current value. A tracked read (like signal.value): auto-subscribes inside
   * a reactive scope, a plain read outside one. */
  readonly value: Value
  /** Fire `listener(value)` only when the selected value changes (Object.is by
   * default, or `equals`). Does not fire on subscribe. Bare unsubscribe. */
  subscribe: (listener: (value: Value) => void, equals?: EqualityFn<Value>) => () => void
}

/**
 * The `select` builder: callable for the function form (8b), with typed
 * named-scope methods (8c). Each form returns a Selection.
 */
export interface Select<State extends string, Context, Computed> {
  /** Function form: derived/composite selection over anything (8b). */
  <Value>(selector: () => Value): Selection<Value>
  /** A single context field, by key. Exact return type + autocomplete (8c). */
  context: <K extends keyof Context>(key: K) => Selection<Context[K]>
  /** A single computed value, by key (8c). */
  computed: <K extends keyof Computed>(key: K) => Selection<Computed[K]>
  /** The current state string (8c). */
  state: () => Selection<State>
}

export interface TransitionLayer<
  State extends string,
  Context,
  Event extends { type: string },
  Computed = Record<string, never>,
> {
  readonly state: State
  hasTag: (tag: string) => boolean
  matches: (name: State) => boolean
  readonly context: Context
  /** 7c: derived state. Reading a field is a tracked computed-signal read. */
  readonly computed: Computed
  send: (event: Event) => void
  /** 8a: coarse subscription — listener fires on ANY subsequent change (state
   * or context). Does not fire on subscribe. Returns a bare unsubscribe. */
  subscribe: (listener: () => void) => () => void
  /** 8b/8c: narrow to a value-deduped Selection. Callable for the function form
   * (select(fn)); typed named scopes (select.context/.computed/.state). */
  select: Select<State, Context, Computed>
}

/**
 * Round 3 building block: state + context + queued, guarded transitions.
 *
 * NOT the machine — a composable layer. `createMachine` (the single public
 * factory) is assembled from these pieces in the final round. Guards and
 * actions are inline functions for now (named registries arrive in R4/R5).
 */
export function createTransitions<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed = Record<string, never>,
>(
  config: TransitionConfig<State, Context, Event, Computed>,
): TransitionLayer<State, Context, Event, Computed> {
  const st = createState<State>(config.initial, config.states)
  const { context, setContext } = createContext<Context>(config.context)

  // 7: build the `computed` bag. Each def becomes a lazy, memoized preact
  // computed() — reading it inside an effect/computed auto-subscribes, and it
  // recomputes only when a context cell (or other computed) it read changes.
  // The bag is the SAME reference passed into every def, so a def reading
  // `computed.other` chains correctly (7b); the engine threads this bag into
  // guard/action/effect params and surfaces it on the layer (7c).
  const computed = {} as Computed
  if (config.computed) {
    for (const key in config.computed) {
      const k = key as keyof Computed
      const def = config.computed[k]
      const sig = preactComputed(() => def({ context, computed }))
      Object.defineProperty(computed, k, {
        get: () => sig.value,
        enumerable: true,
        configurable: false,
      })
    }
  }

  // 4b: resolve a guard arg (inline fn OR registered name) against params.
  // Single channel so combinators (4c) reuse it. Missing name → throw in dev,
  // warn + false in prod.
  const guardRegistry = config.implementations?.guards
  const resolveGuard = (
    guard: GuardArg<Context, Event, Computed>,
    params: GuardParams<Context, Event, Computed>,
  ): boolean => {
    if (typeof guard === 'function') return guard(params)
    const fn = guardRegistry?.[guard]
    if (!fn) {
      const msg = `[machine] no guard "${guard}"`
      if (isDev) throw new Error(msg)
      console.warn(msg)
      return false
    }
    return fn(params)
  }

  // Build the params a guard receives for this event. `guard` lets a guard
  // (or a combinator from 4c) resolve another guard against these same params.
  const guardParams = (event: Event): GuardParams<Context, Event, Computed> => {
    const params: GuardParams<Context, Event, Computed> = {
      context,
      event,
      computed,
      guard: g => resolveGuard(g, params),
    }
    return params
  }

  // 3c: resolve an entry (single or array) to the first transition whose
  // guard passes. No guard = always passes. Guards get { context, event,
  // computed, guard } (4a); a guard may be an inline fn, a name (4b), or a
  // combinator of those (4c).
  const resolve = (
    entry: TransitionEntry<State, Context, Event, Computed> | undefined,
    event: Event,
  ) => {
    if (!entry) return undefined
    const list = Array.isArray(entry) ? entry : [entry]
    const params = guardParams(event)
    return list.find(t => (t.guard ? resolveGuard(t.guard, params) : true))
  }

  // 3d: the queue. send() enqueues; the first send drains the queue, so a
  // re-entrant send (from an action) waits until the current transition ends.
  const queue: Event[] = []
  let draining = false

  // 5b/5c: resolve and run an action arg — inline fn, registered name, or a
  // oneOf(...) conditional branch. Missing name → throw in dev, warn in prod.
  const actionRegistry = config.implementations?.actions
  const isOneOf = (a: unknown): a is OneOf<Context, Event, Computed> =>
    typeof a === 'object' && a !== null && (a as { __oneOf?: boolean }).__oneOf === true
  const runAction = (action: ActionArg<Context, Event, Computed>, event: Event) => {
    // 5c: oneOf — run the first branch whose guard passes (short-circuit).
    if (isOneOf(action)) {
      const params = guardParams(event)
      const branch = action.branches.find(b => (b.guard ? resolveGuard(b.guard, params) : true))
      if (branch) runActions(branch.actions, event)
      return
    }
    const fn = typeof action === 'function' ? action : actionRegistry?.[action]
    if (!fn) {
      const msg = `[machine] no action "${action as string}"`
      if (isDev) throw new Error(msg)
      console.warn(msg)
      return
    }
    fn({ context, setContext, event, send, computed })
  }

  // A list of actions runs in order (5a/5b).
  const runActions = (
    actions: Array<ActionArg<Context, Event, Computed>> | undefined,
    event: Event,
  ) => {
    if (!actions) return
    for (const action of actions) runAction(action, event)
  }

  const send = (event: Event) => {
    queue.push(event)
    if (draining) return
    draining = true
    try {
      while (queue.length) {
        const e = queue.shift()!
        // 3b: per-state `on` first, then top-level `on`.
        const entry = config.states[st.state].on?.[e.type] ?? config.on?.[e.type]
        const t = resolve(entry, e)
        if (!t) continue
        const cur = st.state
        const next = t.target ?? cur
        const changed = next !== cur
        // 3c: internal self-transition runs actions only, skips exit/entry.
        // 6 (decision A): effect cleanups bookend the exit — they run FIRST,
        // before exit actions, so the resource is alive for the whole state.
        if (changed) {
          stopEffects(cur)
          runExit(cur, e)
        }
        runActions(t.actions, e)
        if (changed) {
          st.set(next)
          runEntry(next, e)
          // start LAST on enter — the mirror of cleanup-first on exit.
          startEffects(next, e)
        }
      }
    } finally {
      draining = false
    }
  }

  // 5d: entry/exit action lists on the state node. Sequenced by send() around
  // the switch: exit(old) → transition actions → switch → entry(new). Skipped
  // on an internal self-transition (no state change). Each list reuses
  // runActions, so names / inline / oneOf all compose.
  const runEntry = (state: State, event: Event) => runActions(config.states[state].entry, event)
  const runExit = (state: State, event: Event) => runActions(config.states[state].exit, event)

  // 6: effects. startEffects runs each effect on enter and stashes any returned
  // cleanup; stopEffects runs the stashed cleanups (in start order) on exit.
  // Resolve like actions: inline fn OR named (implementations.effects) — the
  // latter is what the adapter overrides. Missing name → throw dev / warn prod.
  const effectRegistry = config.implementations?.effects
  const activeCleanups: Array<() => void> = []
  const startEffects = (state: State, event: Event) => {
    const effects = config.states[state].effects
    if (!effects) return
    for (const effect of effects) {
      const fn = typeof effect === 'function' ? effect : effectRegistry?.[effect]
      if (!fn) {
        const msg = `[machine] no effect "${effect as string}"`
        if (isDev) throw new Error(msg)
        console.warn(msg)
        continue
      }
      const cleanup = fn({ context, setContext, event, send, computed })
      if (typeof cleanup === 'function') activeCleanups.push(cleanup)
    }
  }
  const stopEffects = (_state: State) => {
    for (const cleanup of activeCleanups) cleanup()
    activeCleanups.length = 0
  }

  // 6 (decision B): start the INITIAL state's effects at construction — unlike
  // entry (5d), which fires only on a transition IN. A resting initial state
  // (a closed dropdown still listening for its trigger) needs its listeners up
  // immediately. The synthetic boot event is MACHINE_INIT so an effect can tell
  // "started fresh" from "entered via transition". Cleanup runs on first exit.
  startEffects(config.initial, { type: MACHINE_INIT } as Event)

  // 8a: coarse subscribe — wake on ANY change. One preact effect reads the
  // state + every context cell, so any state transition or context write
  // re-runs it (computed changes are downstream of context, so we needn't read
  // computeds — and reading them here would force the lazy ones, which we avoid
  // to keep unobserved computeds free). The effect body runs once on creation
  // to register deps; `primed` skips that first run so the listener fires only
  // on SUBSEQUENT changes (decision 3=A: no fire-on-subscribe). Returns a bare
  // unsubscribe (Zag-style). Costs nothing unless called.
  const subscribe = (listener: () => void): (() => void) => {
    let primed = false
    return preactEffect(() => {
      void st.state
      for (const key in context) void context[key as keyof Context]
      if (primed) listener()
      else primed = true
    })
  }

  // 8b: build a Selection from a preact computed signal. `value` is a tracked
  // read of the signal. `subscribe` runs an effect reading the signal, compares
  // to the previous selected value (Object.is default / `equals`), and fires
  // only on a real change — skipping the priming run (no fire-on-subscribe).
  const makeSelection = <Value>(sig: { value: Value }): Selection<Value> => ({
    get value() {
      return sig.value
    },
    subscribe(listener, equals = Object.is) {
      let prev: Value
      let primed = false
      return preactEffect(() => {
        const next = sig.value // tracks exactly what the selector read
        if (!primed) {
          prev = next
          primed = true
          return
        }
        if (equals(prev, next)) return // selected value unchanged → no fire
        prev = next
        listener(next)
      })
    },
  })

  // 8b: function-form selector. Wrap in a lazy/memoized preact computed so it
  // auto-tracks exactly the cells/computeds it reads — selecting from anything.
  // 8c: attach typed named-scope sugar (context/computed/state). Each builds the
  // SAME Selection over a computed reading one named field — exact return types,
  // autocomplete, and compile-time typo safety on the key.
  const select = (<Value>(selector: () => Value): Selection<Value> =>
    makeSelection(preactComputed(selector))) as Select<State, Context, Computed>
  select.context = <K extends keyof Context>(key: K) =>
    makeSelection(preactComputed(() => context[key]))
  select.computed = <K extends keyof Computed>(key: K) =>
    makeSelection(preactComputed(() => computed[key]))
  select.state = () => makeSelection(preactComputed(() => st.state))

  return {
    get state() {
      return st.state
    },
    hasTag: st.hasTag,
    matches: st.matches,
    get context() {
      return context
    },
    // 7c: surface the computed bag (decision 3=A). Reading m.computed.x is a
    // tracked read of the underlying preact computed signal — same model as
    // context/state — so the render loop / connect can derive O(changed).
    get computed() {
      return computed
    },
    send,
    subscribe,
    select,
  }
}

// -----------------------------------------------------------------------------
// Round 9c: connector — live subscribable snapshot (DECIDED, C/A/A)
// -----------------------------------------------------------------------------
//
// connect() is a pure mapping (snapshot → view-facing api). The connector is
// the reactive plumbing that keeps that mapping live: it memoizes connect's
// output so its identity is stable until inputs change (no useSyncExternalStore
// infinite loop), reads machine state through live getters (no tearing), makes
// consumer `props` a reactive input (a props change recomputes the snapshot and
// wakes subscribers), and is PASSIVE — it forwards subscribe/select but never
// self-subscribes; the bridge owns lifecycle (decision A, matches XState/Zag).
//
//   React/Ink:  useSyncExternalStore(c.subscribe, () => c.snapshot)
//   Pixi/Lit:   c.select.context('x').subscribe(dirtyMark)   // per-field

/** What a component's connect() receives. Machine reads are live getters. */
export interface ConnectSnapshot<
  State extends string,
  Context,
  Event extends { type: string },
  Props,
  Computed = Record<string, never>,
> {
  readonly state: State
  readonly context: Context
  readonly computed: Computed
  readonly props: Props
  send: (event: Event) => void
}

/** A pure connect(): snapshot → view-facing api. */
export type Connect<
  State extends string,
  Context,
  Event extends { type: string },
  Props,
  Api,
  Computed = Record<string, never>,
> = (snapshot: ConnectSnapshot<State, Context, Event, Props, Computed>) => Api

/** The live, subscribable connector (decision C: snapshot + subscribe + select). */
export interface Connector<
  State extends string,
  Context,
  Api,
  Props,
  Computed = Record<string, never>,
> {
  /** Memoized connect() output. Stable identity until state/context/computed/
   * props change — safe as a useSyncExternalStore getSnapshot. */
  readonly snapshot: Api
  /** Coarse: wake on any change (also fires when props change). */
  subscribe: (listener: () => void) => () => void
  /** Per-field selection forwarded from the machine (for canvas/Lit bridges). */
  select: Select<State, Context, Computed>
  /** Update consumer props (a reactive input) — recomputes snapshot + wakes. */
  setProps: (props: Props) => void
}

/**
 * Wrap a machine + its pure connect() into a live snapshot. `props` is a
 * reactive input: pass the initial value, push changes via setProps().
 */
export function connector<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Props,
  Api,
  Computed = Record<string, never>,
>(
  machine: TransitionLayer<State, Context, Event, Computed>,
  connect: Connect<State, Context, Event, Props, Api, Computed>,
  initialProps: Props,
): Connector<State, Context, Api, Props, Computed> {
  // props as a signal → a props change invalidates the memoized snapshot and
  // trips the coarse subscribe, same as a context/state change.
  const propsSig = signal(initialProps)

  // The snapshot is a memoized Selection over connect's output: its identity is
  // stable until connect's inputs (state/context/computed/props) change.
  const snap = machine.select(() =>
    connect({
      get state() {
        return machine.state
      },
      get context() {
        return machine.context
      },
      get computed() {
        return machine.computed
      },
      get props() {
        return propsSig.value
      },
      send: machine.send,
    }),
  )

  return {
    get snapshot() {
      return snap.value
    },
    // Coarse: wake whenever the snapshot recomputes — i.e. on any state/
    // context/computed/props change (connect returns a fresh object each time,
    // so the Selection's Object.is dedup never suppresses a real change). The
    // value arg is dropped; coarse listeners take none.
    subscribe(listener) {
      return snap.subscribe(() => listener())
    },
    select: machine.select,
    setProps(props) {
      propsSig.value = props
    },
  }
}

// -----------------------------------------------------------------------------
// STUBS — to be designed in later rounds. Not wired, not final.
// -----------------------------------------------------------------------------
//
// Round 4: guards (and/or/not — kept concept)
// Round 5: actions (+ choose, + entry/exit lists — kept concept)
// Round 6: effects (+ adapter injection — kept concept)
// Round 7: computed (kept concept)
// Round 8: subscription surface (subscribe / subscribeSelector / select)
// Round 9: connect / connector boundary (kept concept)
//
// `createMachine` (the SINGLE public factory) is assembled from these
// composable pieces — createContext, createState, createTransitions, … — in
// the final round. None of the per-round building blocks is named `*Machine`.
