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
  set: (next: T) => void
}

/** Everything a guard can read. */
export interface GuardParams<Context extends object, Event, Computed = Record<string, never>> {
  context: Context
  event: Event
  computed: Computed
  /** Resolve another guard against these same params — the channel combinators (`and`/`or`/`not`) use. */
  guard: (g: GuardArg<Context, Event, Computed>) => boolean
}

/**
 * Default for every registered-name slot. `string & {}` rather than `string` so
 * real name literals stay autocompletable when a union is supplied — bare `string`
 * swallows them.
 */
export type AnyString = string & {}

/** An inline guard: a predicate over the params. */
export type Guard<Context extends object, Event, Computed = Record<string, never>> = (
  params: GuardParams<Context, Event, Computed>,
) => boolean

/** An inline guard or a registered name. `GuardName` is `AnyString` by default; narrowed under `setup.as()`. */
export type GuardArg<
  Context extends object,
  Event,
  Computed = Record<string, never>,
  GuardName extends string = AnyString,
> = Guard<Context, Event, Computed> | GuardName

/** A single transition. `Event` is the (possibly narrowed) incoming event; `Send` defaults to `Event`. */
export interface Transition<
  State extends string,
  Context extends object,
  Event,
  Computed = Record<string, never>,
  Send = Event,
  GuardName extends string = AnyString,
  ActionName extends string = AnyString,
> {
  // NoInfer: checked against State rather than contributing to inferring it.
  target?: NoInfer<State>
  guard?: GuardArg<Context, Event, Computed, GuardName>
  /** Actions to run, in order. A single action or a list. */
  actions?: Actions<Context, Event, Computed, Send, ActionName, GuardName>
}

/**
 * A transition entry: an object, a bare action fn (shorthand for `{ actions: [fn] }`),
 * or an array of either (fallthrough: first passing guard wins).
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

/** Everything an action can read/use. `Send` is the full event union (defaults to `Event`). */
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

/** One branch of a `oneOf`: optional guard + actions to run if it wins. */
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

/** An action arg: inline fn, registered name, or `oneOf(...)` conditional. */
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

/** A single action arg or a list. The runtime normalizes single values to a one-element list. */
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

/** An inline effect: runs on enter, optionally returns a cleanup run on exit. */
export type Effect<
  Context extends object,
  Event,
  Computed = Record<string, never>,
  Send = Event,
> = (params: ActionParams<Context, Event, Computed, Send>) => void | (() => void)

/** An inline effect or a registered name. */
export type EffectArg<
  Context extends object,
  Event,
  Computed = Record<string, never>,
  Send = Event,
  EffectName extends string = AnyString,
> = Effect<Context, Event, Computed, Send> | EffectName

/** A single computed definition. Reading `state` makes the lifecycle a tracked dependency. */
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

/** A named delay: resolves to ms. May read context/computed for dynamic delays. */
export type Delay<Context extends object, Event, Computed = Record<string, never>> = (
  params: GuardParams<Context, Event, Computed>,
) => number

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
 * The `on` map: each key is an `Event['type']`; its entry's `event` narrows to that variant.
 * `send` keeps the full `Event` union so actions can dispatch any event.
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
  // Name unions default to `AnyString`; `setup.as().config(...)` supplies the real keys.
  GuardName extends string = AnyString,
  ActionName extends string = AnyString,
  EffectName extends string = AnyString,
  DelayName extends string = AnyString,
> {
  // NoInfer: checked against State (inferred from `states` keys), not contributing to it.
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
 * author it with `setup.infer().createMachine(...)` instead.
 */
export type MachineConfig<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed = Record<string, never>,
> = TransitionConfig<State, Context, Event, Computed>

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

/** The `select` builder: callable for the function form, with typed named-scope methods. */
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

/** A live machine service. Built stopped; `start()` boots effects, `stop()` runs cleanups. */
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
  /** Start effects + watchers. Idempotent; re-start re-boots from whatever state the machine is in. */
  start: () => void
  /** Stop all active effects + watchers. Consumer subscriptions are the consumer's to dispose. */
  stop: () => void
  /** Register a listener fired on every `start()` (immediately if already running). */
  onStart: (fn: () => void) => () => void
  /** Register a listener fired on every `stop()`. */
  onStop: (fn: () => void) => () => void
}

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
 * A substrate-agnostic reaction: `[selector, callback]`. When the selected value changes,
 * the connector calls `callback(value, props)` — the way a component declares "machine-state
 * change → consumer callback" once, fired identically on every target.
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

/** A pure connect(): snapshot → view-facing api. May carry a static `reactions` array. */
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
  /** Memoized connect() output. Stable identity while inputs are unchanged — safe as useSyncExternalStore getSnapshot. */
  readonly snapshot: Api
  subscribe: (listener: () => void) => () => void
  select: Select<State, Context, Computed>
  /** Update consumer props — recomputes snapshot + wakes subscribers. */
  setProps: (props: Props) => void
  /** Detach from the machine. Only needed when discarding the connector independently of the machine. */
  destroy: () => void
}
