// Public surface of the engine, re-exported from the per-concern modules.

// The single public factory + its service type.
export { machine } from './machine'
export type { Machine } from './types'

// The synthetic boot event (start()).
export { MACHINE_INIT } from './constants'

// Config: the authoring helper (infers + checks a config literal) + the types.
export { config } from './config'
export type { MachineConfig, TransitionConfig, Transition, Implementations } from './types'

// Context + state building blocks (for advanced composition / tests).
export { createContext } from './context'
export { createState } from './state'
export type { State, StateNode } from './types'

// Guards: combinators + types.
export { and, or, not } from './guards'
export type { Guard, GuardArg, GuardParams } from './types'

// Actions: oneOf + types.
export { oneOf } from './actions'
export type { Action, ActionArg, ActionParams, OneOf, OneOfBranch } from './types'

// Effects + types.
export type { Effect, EffectArg } from './types'

// Per-platform adapter seam.
export { withAdapter } from './adapter'
export type { Adapter } from './types'

// Timed transitions.
export type { Delay } from './types'

// Computed.
export type { ComputedDef, ComputedDefs } from './types'

// Subscription surface (select / Selection).
export type { Selection, Select, EqualityFn } from './types'

// Connector boundary (live snapshot) + connect typing.
export { connector } from './connector'
export type { Connect, Connector, ConnectSnapshot, Reaction } from './types'

// Composition — run several independent machines as one unit (orthogonal
// regions): bundled lifecycle + sync (cross-region rules) + combine (one
// deduped Selection across members).
export { compose } from './compose'
export type { Composition } from './compose'

// A tiny signal-backed store for cross-instance singletons (wrap in a facade).
export { createStore } from './store'
export type { Store, Listener, SetStateAction } from './store'

// Bindings vocabulary (agnostic event + attr) connect() speaks.
export type { AttrBindings, EventBindings, KeyboardPayload, PointerPayload } from './bindings'

// (Style spec lives in @render-experiment/style-engine-core; components import
// it from there. Cross-instance singletons use createStore, above.)
