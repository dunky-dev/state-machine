// Public surface of the rebuilt engine. Everything lives in ./machine now
// (the single module assembled across R1–R9 + A1); the old per-concern modules
// (adapter/connector/guards/setup/types) are retired.

// The single public factory + its service type.
export { machine, MACHINE_INIT } from './machine'
export type { Machine } from './machine'

// Config + the layer building blocks (exported for advanced composition/tests).
export { createContext, createState } from './machine'
export type { State, StateNode, TransitionConfig, Transition, Implementations } from './machine'

// Guards: combinators + types.
export { and, or, not } from './machine'
export type { Guard, GuardArg, GuardParams } from './machine'

// Actions: oneOf + types.
export { oneOf } from './machine'
export type { Action, ActionArg, ActionParams, OneOf, OneOfBranch } from './machine'

// Effects + the per-target adapter seam.
export { withAdapter } from './machine'
export type { Effect, EffectArg, Adapter } from './machine'

// Computed.
export type { ComputedDef, ComputedDefs } from './machine'

// Subscription surface (select/Selection).
export type { Selection, Select, EqualityFn } from './machine'

// Connector boundary (live snapshot) + connect typing.
export { connector } from './machine'
export type { Connect, Connector, ConnectSnapshot } from './machine'

// Bindings vocabulary (agnostic event + attr) connect() speaks.
export type { AttrBindings, EventBindings, KeyboardPayload, PointerPayload } from './machine'

// Style spec (unchanged).
export type { Style, StyleSpec, StyleValue } from './style-spec'

// Re-export the standalone store package for backwards-compat consumers who
// imported these from machine-core. New code should import directly from
// @render-experiment/store.
export { createStore, shallowEqual } from '@render-experiment/store'
export type { Listener, SetStateAction, Store } from '@render-experiment/store'
