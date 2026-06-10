// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

/** Per-state node. `tags` groups states so consumers query a tag, not names. */
export interface StateNode {
  tags?: string[]
}

export interface State<T extends string> {
  /** The current state. */
  readonly state: T
  /** Is the current state tagged `tag`? */
  hasTag: (tag: string) => boolean
  /** Is the current state exactly `name`? (sugar for state === name) */
  matches: (name: T) => boolean
  /**
   * Move to a new state. Internal to the engine: the transition layer calls
   * this; the assembled machine does not expose it (consumers move state via
   * `send`).
   */
  set: (next: T) => void
}

// -----------------------------------------------------------------------------
// Guards
// -----------------------------------------------------------------------------

/** Everything a guard can read. */
export interface GuardParams<Context extends object, Event, Computed = Record<string, never>> {
  context: Context
  event: Event
  computed: Computed
  /**
   * Resolve another guard — a registered name or an inline fn — against these
   * same params. The channel the combinators use, so `and('a', not(b))`
   * resolves names through the runtime's single guard registry.
   */
  guard: (g: GuardArg<Context, Event, Computed>) => boolean
}

// -----------------------------------------------------------------------------
// Registered-name slots
// -----------------------------------------------------------------------------
//
// A config references named impls by string: `guard: 'isOpen'`, `entry: ['log']`,
// `effects: ['track']`, `after: { openDelay: … }`. By default each name slot is
// `AnyString` (any name compiles; a typo is caught at runtime). When a config is
// authored through `setup({...}).createMachine(...)`, the builder threads the
// registry's keys into these params so a name is checked + autocompleted against
// what's actually registered — a typo becomes a compile error.

/**
 * The loose default for every registered-name slot. `string & {}` — NOT bare
 * `string` — so that when a real name union is supplied (`'isOpen' | 'isLocked'`)
 * and the slot reads `fn | Names`, the literals stay autocompletable instead of
 * being swallowed by a plain `string` in the union. With no names supplied it
 * still accepts any string (back-compat).
 */
export type AnyString = string & {}

/** An inline guard: a predicate over the params. */
export type Guard<Context extends object, Event, Computed = Record<string, never>> = (
  params: GuardParams<Context, Event, Computed>,
) => boolean

/** A guard arg in a transition: an inline predicate or a registered name
 * (resolved against implementations.guards). Missing name → throw in dev,
 * warn + false in prod. `GuardName` is the set of valid names — any string by
 * default (unchecked), the registered guard keys under `setup()`. */
export type GuardArg<
  Context extends object,
  Event,
  Computed = Record<string, never>,
  GuardName extends string = AnyString,
> = Guard<Context, Event, Computed> | GuardName

// -----------------------------------------------------------------------------
// Transitions
// -----------------------------------------------------------------------------

/** A single transition: optional target, optional guard, optional actions.
 * `Event` is the (possibly narrowed) incoming event; `Send` is the full event
 * union an action may dispatch (defaults to `Event`). */
export interface Transition<
  State extends string,
  Context extends object,
  Event,
  Computed = Record<string, never>,
  Send = Event,
  GuardName extends string = AnyString,
  ActionName extends string = AnyString,
> {
  // NoInfer: `target` is checked against the State union (defined by the states
  // keys) rather than contributing to inferring it — so a bad target errors at
  // the target and autocompletes the declared states, instead of widening State.
  target?: NoInfer<State>
  guard?: GuardArg<Context, Event, Computed, GuardName>
  /** Actions to run, in order. A single action or a list. */
  actions?: Actions<Context, Event, Computed, Send, ActionName, GuardName>
}

/**
 * A transition entry, in any of three forms:
 *   - a {@link Transition} object        — "go (+ optionally do)"
 *   - a bare {@link Action} function      — "just do this" (a guardless,
 *     targetless transition — the terse form for context-only handlers, where
 *     a `{ actions: [fn] }` wrapper with no `target` would be pure noise)
 *   - an array of either                  — fallthrough: the first element whose
 *     guard passes wins; a bare fn is guardless, so it always matches (use it
 *     last, as the fallback). Mirrors the rule for a guardless object.
 *
 * The runtime normalizes a bare fn to `{ actions: [fn] }` (see `resolve`), so
 * all three forms run through the same "first passing guard wins" loop.
 */
export type TransitionEntry<
  State extends string,
  Context extends object,
  Event,
  Computed,
  Send = Event,
  GuardName extends string = AnyString,
  ActionName extends string = AnyString,
> =
  | Transition<State, Context, Event, Computed, Send, GuardName, ActionName>
  | Action<Context, Event, Computed, Send>
  | Array<
      | Transition<State, Context, Event, Computed, Send, GuardName, ActionName>
      | Action<Context, Event, Computed, Send>
    >

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------

/**
 * Everything an action can read/use. `Event` is the (possibly narrowed)
 * incoming event the action reads; `Send` is the FULL event union you may
 * dispatch — under a per-event `on.K` entry, `event` narrows to that variant
 * while `send` still accepts any event. `Send` defaults to `Event` so a
 * direct/unnarrowed use is unchanged.
 */
export interface ActionParams<
  Context extends object,
  Event,
  Computed = Record<string, never>,
  Send = Event,
> {
  context: Context
  setContext: (patch: Partial<Context>) => void
  event: Event
  send: (event: Send) => void
  computed: Computed
}

/** An inline action: a side-effect over the params. */
export type Action<
  Context extends object,
  Event,
  Computed = Record<string, never>,
  Send = Event,
> = (params: ActionParams<Context, Event, Computed, Send>) => void

/** One branch of a oneOf: an optional guard + the actions to run if it wins
 * (a single action or a list — the runtime normalizes when it runs them). */
export interface OneOfBranch<
  Context extends object,
  Event,
  Computed = Record<string, never>,
  Send = Event,
  GuardName extends string = AnyString,
  ActionName extends string = AnyString,
> {
  guard?: GuardArg<Context, Event, Computed, GuardName>
  actions: Actions<Context, Event, Computed, Send, ActionName, GuardName>
}

/** The oneOf sentinel — the runtime detects it in an actions list and expands. */
export interface OneOf<
  Context extends object,
  Event,
  Computed = Record<string, never>,
  Send = Event,
  GuardName extends string = AnyString,
  ActionName extends string = AnyString,
> {
  readonly __oneOf: true
  readonly branches: Array<OneOfBranch<Context, Event, Computed, Send, GuardName, ActionName>>
}

/**
 * An action arg in an `actions` list: an inline action, a registered name
 * (resolved against implementations.actions), or a `oneOf(...)` conditional
 * branch. Missing name → throw in dev, warn in prod. A list runs in order.
 */
export type ActionArg<
  Context extends object,
  Event,
  Computed = Record<string, never>,
  Send = Event,
  ActionName extends string = AnyString,
  GuardName extends string = AnyString,
> =
  | Action<Context, Event, Computed, Send>
  | ActionName
  | OneOf<Context, Event, Computed, Send, GuardName, ActionName>

/** What an `actions` / `entry` / `exit` slot accepts: a single action or a list.
 * The runtime normalizes a single value to a one-element list, so `actions: act(...)`
 * and `actions: [act(...), 'log']` are both valid. */
export type Actions<
  Context extends object,
  Event,
  Computed = Record<string, never>,
  Send = Event,
  ActionName extends string = AnyString,
  GuardName extends string = AnyString,
> =
  | ActionArg<Context, Event, Computed, Send, ActionName, GuardName>
  | Array<ActionArg<Context, Event, Computed, Send, ActionName, GuardName>>

// -----------------------------------------------------------------------------
// Effects
// -----------------------------------------------------------------------------

/** An inline effect: runs on enter, optionally returns a cleanup run on exit. */
export type Effect<
  Context extends object,
  Event,
  Computed = Record<string, never>,
  Send = Event,
> = (params: ActionParams<Context, Event, Computed, Send>) => void | (() => void)

/** An effect arg: an inline effect or a registered name (resolved against
 * implementations.effects). Missing name → throw in dev, warn in prod. */
export type EffectArg<
  Context extends object,
  Event,
  Computed = Record<string, never>,
  Send = Event,
  EffectName extends string = AnyString,
> = Effect<Context, Event, Computed, Send> | EffectName

// -----------------------------------------------------------------------------
// Computed
// -----------------------------------------------------------------------------

/** A single computed definition: derives a value from context, the current
 * `state`, and other computeds. Reading `state` makes the lifecycle a tracked
 * dependency, so a transition re-evaluates the computed (same memoization as a
 * context-key read). */
export type ComputedDef<
  State extends string,
  Context,
  Computed = Record<string, never>,
  Value = unknown,
> = (params: { context: Context; state: State; computed: Computed }) => Value

/** The map of computed definitions, keyed to the Computed value shape. */
export type ComputedDefs<State extends string, Context, Computed> = {
  [K in keyof Computed]: ComputedDef<State, Context, Computed, Computed[K]>
}

// -----------------------------------------------------------------------------
// Delays
// -----------------------------------------------------------------------------

/** A named delay: resolves to a number of ms, may read context/computed so a
 * prop-driven delay is dynamic. Referenced by name in a state's `after`. */
export type Delay<Context extends object, Event, Computed = Record<string, never>> = (
  params: GuardParams<Context, Event, Computed>,
) => number

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

/** The named-implementation registries a config supplies. */
export interface Implementations<Context extends object, Event, Computed = Record<string, never>> {
  /** Reusable named guards. Referenced by name in a transition `guard`. */
  guards?: Record<string, Guard<Context, Event, Computed>>
  /** Reusable named actions. Referenced by name in an `actions` list. */
  actions?: Record<string, Action<Context, Event, Computed>>
  /** Reusable named effects, referenced by name in a state's `effects`. */
  effects?: Record<string, Effect<Context, Event, Computed>>
  /** Reusable named delays. Referenced by name as an `after` key. */
  delays?: Record<string, Delay<Context, Event, Computed>>
}

/**
 * The `on` map keyed to the event union: each key is an `Event['type']`, and
 * its entry's incoming `event` narrows to that exact variant
 * (`Extract<Event, { type: K }>`) — so an action under `on.set` reads
 * `event.value` without a manual cast, and a key that isn't a real event type
 * errors. `send` keeps the FULL `Event` union (passed as the trailing `Send`
 * arg), because an action routinely dispatches OTHER events. Partial: a state
 * handles only the events it cares about.
 */
export type EventMap<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed,
  GuardName extends string = AnyString,
  ActionName extends string = AnyString,
> = {
  [K in Event['type']]?: TransitionEntry<
    State,
    Context,
    Extract<Event, { type: K }>,
    Computed,
    Event,
    GuardName,
    ActionName
  >
}

export interface TransitionConfig<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed = Record<string, never>,
  // The registered-name unions. All default to `AnyString` (any name compiles —
  // today's behavior); `setup({...}).createMachine(...)` supplies the real
  // registry keys so a `guard`/action/effect/delay name is checked + autocompleted.
  GuardName extends string = AnyString,
  ActionName extends string = AnyString,
  EffectName extends string = AnyString,
  DelayName extends string = AnyString,
> {
  // NoInfer: `initial` is checked against the State union, which is inferred
  // solely from the `states` keys below (the single source of truth) — so a
  // mistyped initial errors and autocompletes the declared states.
  initial: NoInfer<State>
  context: Context
  states: Record<
    State,
    StateNode & {
      on?: EventMap<State, Context, Event, Computed, GuardName, ActionName>
      /** Actions run when this state is entered (after the switch). One or a list. */
      entry?: Actions<Context, Event, Computed, Event, ActionName, GuardName>
      /** Actions run when this state is exited (before the switch). One or a list. */
      exit?: Actions<Context, Event, Computed, Event, ActionName, GuardName>
      /** Effects started on enter; their cleanups run first on exit. */
      effects?: Array<EffectArg<Context, Event, Computed, Event, EffectName>>
      /** Timed transitions. Each key is a delay — a number of ms (e.g. 200) or
       * a name resolved from implementations.delays. The transition fires after
       * the delay WHILE in this state; auto-cancelled on exit. A delay may map
       * to a transition array (guard fallthrough). */
      after?: {
        [K in DelayName | `${number}`]?: TransitionEntry<
          State,
          Context,
          Event,
          Computed,
          Event,
          GuardName,
          ActionName
        >
      }
    }
  >
  /** Any-state events. Per-state `on` takes precedence over this. */
  on?: EventMap<State, Context, Event, Computed, GuardName, ActionName>
  /** Derived state. Each def becomes a lazy, memoized computed signal read via
   * the `computed` bag in guard/action/effect params (and on the machine). */
  computed?: ComputedDefs<State, Context, Computed>
  /** Data-reactions. Each key is a context (or computed) field; its actions run
   * whenever that field changes — in ANY state, while the machine runs. Started
   * on start(), cleaned up on stop(). The action's `event` is the MACHINE_INIT
   * marker (a data change isn't an event). */
  watch?: {
    [K in keyof Context | keyof Computed]?: Array<
      ActionArg<Context, Event, Computed, Event, ActionName, GuardName>
    >
  }
  /** Named implementations referenced by string in transitions. */
  implementations?: Implementations<Context, Event, Computed>
}

/**
 * Public alias for the machine config shape. Annotating a config with this
 * still requires the generics (`const c: MachineConfig<'a' | 'b', Ctx, Ev>`);
 * for type-checking + inference at the definition site with no manual generics,
 * author it with `setup().createMachine(...)` instead.
 */
export type MachineConfig<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed = Record<string, never>,
> = TransitionConfig<State, Context, Event, Computed>

// -----------------------------------------------------------------------------
// Subscription surface
// -----------------------------------------------------------------------------

/** Compare two selected values; return true if equal (no fire). */
export type EqualityFn<Value> = (a: Value, b: Value) => boolean

/** A narrowed, value-deduped view of the machine. */
export interface Selection<Value> {
  /** Current selected value, evaluated on read. */
  readonly value: Value
  /** Fire `listener(value)` only when the selected value changes (Object.is by
   * default, or `equals`). Does not fire on subscribe. Bare unsubscribe. */
  subscribe: (listener: (value: Value) => void, equals?: EqualityFn<Value>) => () => void
}

/**
 * The `select` builder: callable for the function form, with typed named-scope
 * methods. Each form returns a Selection.
 */
export interface Select<State extends string, Context, Computed> {
  /** Function form: derived/composite selection over anything. */
  <Value>(selector: () => Value): Selection<Value>
  /** A single context field, by key. Exact return type + autocomplete. */
  context: <K extends keyof Context>(key: K) => Selection<Context[K]>
  /** A single computed value, by key. */
  computed: <K extends keyof Computed>(key: K) => Selection<Computed[K]>
  /** The current state string. */
  state: () => Selection<State>
}

// -----------------------------------------------------------------------------
// Machine service
// -----------------------------------------------------------------------------

/**
 * A machine service — the live, running instance produced by `machine(config)`.
 * Built stopped; `start()` boots its effects, `stop()` runs their cleanups.
 * Reads (state/context/computed) are plain getters; transitions go through
 * `send`; observe via `subscribe` (coarse) or `select` (value-deduped).
 */
export interface Machine<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed = Record<string, never>,
> {
  readonly state: State
  hasTag: (tag: string) => boolean
  matches: (name: State) => boolean
  readonly context: Context
  /** Derived state. Reading a field is a tracked computed-signal read. */
  readonly computed: Computed
  send: (event: Event) => void
  /** Coarse subscription — listener fires on ANY subsequent change (state or
   * context). Does not fire on subscribe. Returns a bare unsubscribe. */
  subscribe: (listener: () => void) => () => void
  /** Narrow to a value-deduped Selection. Callable for the function form
   * (select(fn)); typed named scopes (select.context/.computed/.state). */
  select: Select<State, Context, Computed>
  /** Boot the machine: start the initial state's effects (and the watchers).
   * Idempotent; a re-start after stop re-boots. */
  start: () => void
  /** Run all active effect/watcher cleanups and mark stopped. Consumer
   * subscriptions (subscribe/select) are the consumer's to dispose. */
  stop: () => void
  /** Register a listener fired on every `start()` (and immediately if already
   * running). Returns an unregister. Lets an outer layer hang start-scoped work
   * off the lifecycle — e.g. the connector wiring its reactions. */
  onStart: (fn: () => void) => () => void
  /** Register a listener fired on every `stop()`. Returns an unregister.
   * The teardown counterpart to onStart. */
  onStop: (fn: () => void) => () => void
}

// -----------------------------------------------------------------------------
// Connector
// -----------------------------------------------------------------------------

/** What a component's connect() receives. Machine reads are live getters. */
export interface ConnectSnapshot<
  State extends string,
  Context extends object,
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

/**
 * A substrate-agnostic reaction: `[selector, callback]`. When the value
 * `selector` derives from the machine changes, the connector calls
 * `callback(value, props)`. This is how a component declares "machine-state
 * change → consumer callback" ONCE (e.g. `onOpenChange`), fired identically on
 * every target — the machine never reads props or fires callbacks itself.
 * (Platform-specific reactions like a DOM Escape listener stay in the
 * per-target effects.)
 *
 * Tuple shape mirrors a React `ComponentEffect` (`[fn, deps]`) so the two read
 * the same — declare each as a named const, collect them in a list.
 */
export type Reaction<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Props,
  Computed = Record<string, never>,
  Value = unknown,
> = [
  selector: (machine: Machine<State, Context, Event, Computed>) => Value,
  callback: (value: Value, props: Props) => void,
]

/**
 * A pure connect(): snapshot → view-facing api. It MAY carry a static
 * `reactions` array — declarative state-change → prop-callback bindings the
 * connector registers once (the mapping itself stays pure / side-effect free).
 */
export type Connect<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Props,
  Api,
  Computed = Record<string, never>,
> = ((snapshot: ConnectSnapshot<State, Context, Event, Props, Computed>) => Api) & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reactions?: Array<Reaction<State, Context, Event, Props, Computed, any>>
}

/** The live, subscribable connector: snapshot + subscribe + select + setProps. */
export interface Connector<
  State extends string,
  Context extends object,
  Api,
  Props,
  Computed = Record<string, never>,
> {
  /** Memoized connect() output. Stable identity until state/context/computed/
   * props change — safe as a useSyncExternalStore getSnapshot. */
  readonly snapshot: Api
  /** Coarse: wake on any change (also fires when props change). */
  subscribe: (listener: () => void) => () => void
  /** Per-field selection forwarded from the machine. */
  select: Select<State, Context, Computed>
  /** Update consumer props (a reactive input) — recomputes snapshot + wakes. */
  setProps: (props: Props) => void
  /** Detach the connector from the machine: drops its bus subscription and any
   * lifecycle hooks. Call when discarding the connector independently of the
   * machine. (When the machine is discarded too — the common case — both are
   * collected together and `destroy()` is optional.) */
  destroy: () => void
}
