// Public surface of the engine, re-exported from the per-concern modules.

// The single public factory + its service type.
export { machine } from './machine'
export type { Machine } from './types'

// The synthetic boot event (start()).
export { MACHINE_INIT } from './constants'

// Config types (annotate a config literal when needed; for authoring, use setup()).
export type { MachineConfig, TransitionConfig, Transition, Implementations } from './types'

// The authoring entry point. `setup().createMachine(literal)` for a quick config
// (types inferred, names loose); `setup<Ctx,Ev>().config(registries).createMachine(...)`
// to check every guard/action/effect/delay name (a typo becomes a compile error).
export { setup } from './setup'

// Per-state node shape (used when annotating a config's `states`).
export type { StateNode } from './types'
// NOTE: state and context have no standalone modules — they're plain fields on
// the machine instance (getter-free reads, inline-deduped in-place writes); see
// machine.ts. What IS factored into its own module is the logic with real
// complexity: computed tracking (./computed) and transition selection
// (./transitions).

// Guards: combinators + types.
export { and, or, not } from './guards'
export type { Guard, GuardArg, GuardParams } from './types'

// Action helpers, used inside an `actions` / `entry` / `exit` list: `act` (terse
// context-write sugar) + `oneOf` (variadic conditional — first passing branch
// wins). Structure (`target` / `guard`) stays on the plain transition object.
export { act, oneOf } from './actions'
export type { Action, ActionArg, ActionParams, OneOf } from './types'

// Effects + types.
export type { Effect, EffectArg } from './types'

// Timed transitions.
export type { Delay } from './types'

// Computed.
export type { ComputedDef, ComputedDefs } from './types'

// Subscription surface (select / Selection).
export type { Selection, Select, EqualityFn } from './types'

// Connector boundary (live snapshot) + connect typing.
export { connector } from './connector'
export type { Connect, Connector, ConnectSnapshot, Reaction } from './types'

// Reaction authoring helper: infers the selector→callback value link.
export { makeReaction } from './reaction'

// Composition — run several independent machines as one unit (orthogonal
// regions): bundled lifecycle + sync (cross-region rules) + combine (one
// deduped Selection across members).
export { compose } from './compose'
export type { Composition } from './compose'

// A tiny store (plain value + listeners) for cross-instance singletons (wrap in a facade).
export { createStore } from './store'
export type { Store, Listener, SetStateAction } from './store'

// Bindings vocabulary (agnostic event + attr) connect() speaks.
export type {
  AttrBindings,
  ChangePayload,
  EventBindings,
  KeyboardPayload,
  PointerPayload,
  ScrollPayload,
  WheelPayload,
} from './bindings'
