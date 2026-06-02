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

import { batch, signal, type Signal } from '@preact/signals-core'

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
    StateNode & { on?: Record<string, TransitionEntry<State, Context, Event, Computed>> }
  >
  /** Any-state events. Per-state `on` takes precedence over this. */
  on?: Record<string, TransitionEntry<State, Context, Event, Computed>>
  /** Named implementations referenced by string in transitions. */
  implementations?: {
    /** Reusable named guards (4b). Referenced by name in a transition `guard`. */
    guards?: Record<string, Guard<Context, Event, Computed>>
    /** Reusable named actions (5b). Referenced by name in an `actions` list. */
    actions?: Record<string, Action<Context, Event, Computed>>
  }
}

export interface TransitionLayer<State extends string, Context, Event extends { type: string }> {
  readonly state: State
  hasTag: (tag: string) => boolean
  matches: (name: State) => boolean
  readonly context: Context
  send: (event: Event) => void
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
): TransitionLayer<State, Context, Event> {
  const st = createState<State>(config.initial, config.states)
  const { context, setContext } = createContext<Context>(config.context)

  // `computed` is wired in Round 7; until then it's an empty object so the
  // guard params shape is already final.
  const computed = {} as Computed

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
        if (changed) runExit(cur, e)
        runActions(t.actions, e)
        if (changed) {
          st.set(next)
          runEntry(next, e)
        }
      }
    } finally {
      draining = false
    }
  }

  // entry/exit action hooks — Round 5 formalizes these (named lists on the
  // state node). For now they're no-ops; transition `actions` carry behavior.
  const runEntry = (_state: State, _event: Event) => {}
  const runExit = (_state: State, _event: Event) => {}

  return {
    get state() {
      return st.state
    },
    hasTag: st.hasTag,
    matches: st.matches,
    get context() {
      return context
    },
    send,
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
