/**
 * Schema-aware machine builder.
 *
 * Authoring a machine without `setup<>()` works fine — names in `entry`,
 * `actions`, `effects`, `guard`, and transition `target` are plain strings
 * the runtime resolves via `implementations.*` and a `console.warn` if
 * missing.
 *
 * `setup<MySchema>().createMachine({ ... })` opts into compile-time checks:
 *
 *   - Every name in `entry / exit / actions / effects` must be in the
 *     Schema's union for that category.
 *   - Every transition `target` must be a declared `state`.
 *   - Every `guard` must be in `Schema['guards']` (or an inline function).
 *   - `implementations.actions / guards / effects` must contain a key for
 *     EVERY name in the Schema — missing entries fail, extra entries fail.
 *
 * Authors declare the Schema once at the top of `types.ts`:
 *
 *   export type FooSchema = {
 *     context: FooContext
 *     props:   FooMachineProps
 *     event:   FooEvent
 *     state:   FooState
 *     actions: FooActions
 *     guards:  FooGuards
 *     effects: FooEffects
 *   }
 *
 * Runtime is unchanged — `setup<S>().createMachine` is a thin typed wrapper
 * that forwards to `createMachine` after the compiler has had its say.
 */

import { createMachine } from './machine'
import type { Action, Effect, EventObject, Guard, Machine, MachineConfig } from './types'

/**
 * The shape a component supplies to `setup<...>()`. Each category is a
 * string-literal union of the names the machine uses; `context`, `props`,
 * `event`, and `state` carry the data types.
 */
export interface MachineSchema {
  context: object
  props: object
  event: EventObject
  state: string
  actions?: string
  guards?: string
  effects?: string
}

// Pick a category's union or `never` when undeclared (no names of that
// category exist for this machine). `never[]` is fine — arrays of `never`
// can only be empty, which matches "no names allowed".
type Names<
  S extends MachineSchema,
  K extends 'actions' | 'guards' | 'effects',
> = S[K] extends string ? S[K] : never

/**
 * Schema-narrowed transition: target ⊆ S['state']; actions ⊆ S['actions'];
 * guard ⊆ S['guards'] or a raw Guard function (so combinators still work).
 */
interface TypedTransition<S extends MachineSchema> {
  target?: S['state']
  guard?: Names<S, 'guards'> | Guard<S['context'], S['props'], S['event']>
  actions?: Array<Names<S, 'actions'>>
}

/** Same shape as a top-level state node, but with every name field narrowed. */
interface TypedStateNode<S extends MachineSchema> {
  entry?: Array<Names<S, 'actions'>>
  exit?: Array<Names<S, 'actions'>>
  effects?: Array<Names<S, 'effects'>>
  on?: {
    // Each event type can declare a single transition or a list (guard fallthrough).
    [K in S['event']['type']]?: TypedTransition<S> | Array<TypedTransition<S>>
  }
}

/**
 * The full config shape `setup<S>().createMachine` accepts. Mirrors
 * `MachineConfig` but with every string-keyed name narrowed to the Schema
 * and every implementation map forced to be exhaustive over its category.
 */
export interface TypedMachineConfig<S extends MachineSchema> {
  initial: S['state'] | ((props: S['props']) => S['state'])
  context: S['context'] | ((props: S['props']) => S['context'])
  states: { [K in S['state']]: TypedStateNode<S> }
  on?: {
    [K in S['event']['type']]?: TypedTransition<S> | Array<TypedTransition<S>>
  }
  implementations?: {
    // `Record<never, T>` is `{}` — when the schema omits a category, the
    // map disappears from the type entirely. When the schema declares it,
    // every name is required (no missing, no extra).
    actions?: Record<Names<S, 'actions'>, Action<S['context'], S['props'], S['event']>>
    guards?: Record<Names<S, 'guards'>, Guard<S['context'], S['props'], S['event']>>
    effects?: Record<Names<S, 'effects'>, Effect<S['context'], S['props'], S['event']>>
  }
}

/**
 * Schema-aware createMachine. Returns a curried builder so consumers write
 * `setup<MySchema>().createMachine({ ... })`, matching Zag's surface.
 */
export function setup<S extends MachineSchema>(): {
  createMachine: (
    config: TypedMachineConfig<S>,
  ) => MachineConfig<S['context'], S['props'], S['event']>
} {
  return {
    // Runtime is unchanged — we just hand the config back. The runtime's
    // `createMachine(config, initialProps)` already accepts the broader
    // MachineConfig shape; the type-narrowing happens here.
    createMachine: config => config as MachineConfig<S['context'], S['props'], S['event']>,
  }
}

// Re-export createMachine so `setup` + the runtime live behind one import path.
export { createMachine }
export type { Machine }
