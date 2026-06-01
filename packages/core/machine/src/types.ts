/**
 * Machine DSL — a Zag-shaped library with NO substrate assumptions.
 *
 * A machine config is data: states, events, transitions, named guards/actions/effects.
 * The `connect` output is LOGICAL: no `onClick`, no `aria-*`, no `style`, no `data-*`.
 * Target adapters translate that logical surface to a specific renderer.
 */

import type { AttrBindings, EventBindings } from './bindings'

/**
 * Base event shape. Components declare their own discriminated-union
 * `TEvent` extending this — `{ type: 'item.click'; value: string; ... }`
 * etc — and pass it as the third generic to `MachineConfig` / `Machine`.
 *
 * Action / guard bodies then get a fully-typed `event` parameter, and
 * `send()` call sites are type-checked. The default keeps non-opted-in
 * callers working with a payload-free event.
 */
export type EventObject = { type: string }

export interface Params<TContext, TProps, TEvent extends EventObject = EventObject> {
  context: TContext
  setContext: (patch: Partial<TContext>) => void
  props: TProps
  event: TEvent
  send: (event: TEvent) => void
}

export type Action<TContext, TProps, TEvent extends EventObject = EventObject> = (
  params: Params<TContext, TProps, TEvent>,
) => void

export type Guard<TContext, TProps, TEvent extends EventObject = EventObject> = (
  params: Omit<Params<TContext, TProps, TEvent>, 'send' | 'setContext'>,
) => boolean

/**
 * What a transition's `guard` field accepts: a name (resolved against
 * `implementations.guards`), an inline function, or a combinator (and / or /
 * not) — itself just a Guard function. Same shape composes arbitrarily.
 */
export type GuardArg<
  TContext = unknown,
  TProps = unknown,
  TEvent extends EventObject = EventObject,
> = string | Guard<TContext, TProps, TEvent>

export type Effect<TContext, TProps, TEvent extends EventObject = EventObject> = (
  params: Omit<Params<TContext, TProps, TEvent>, 'event'>,
) => VoidFunction | void

export interface Transition {
  target?: string
  /**
   * Either a name (resolved against `implementations.guards`) or an
   * inline function. Compose with `and / or / not`.
   */
  guard?: GuardArg
  actions?: string[]
}

export interface StateNode {
  entry?: string[]
  exit?: string[]
  effects?: string[]
  on?: Record<string, Transition | Transition[]>
}

export interface MachineConfig<
  TContext,
  TProps = Record<string, unknown>,
  TEvent extends EventObject = EventObject,
> {
  initial: string | ((props: TProps) => string)
  context: TContext | ((props: TProps) => TContext)
  states: Record<string, StateNode>
  on?: Record<string, Transition | Transition[]>
  implementations?: {
    actions?: Record<string, Action<TContext, TProps, TEvent>>
    guards?: Record<string, Guard<TContext, TProps, TEvent>>
    effects?: Record<string, Effect<TContext, TProps, TEvent>>
  }
}

/**
 * Part — the shape of a single named slice on a connect() API.
 *
 * Every component's connect output groups its rendered surfaces under
 * `api.parts`. Each part has, at minimum, a `handlers` bag (events the
 * adapter wires up) and an `attrs` bag (attributes the adapter applies).
 *
 * Most parts also expose:
 *   - `variants`: the cross-substrate styling variant prop set, computed
 *     in the connect from state + props so adapters don't re-derive.
 *   - extras: positioning, rendered flag, anything component-specific.
 *
 * The two generics are independent on purpose:
 *
 *   Part                       — handlers + attrs only
 *   Part<MyVariants>           — adds typed variants
 *   Part<MyVariants, MyExtras> — adds typed extras (e.g., positioning)
 *
 * Authors who don't need variants still benefit from the typing: a
 * Separator's part is just `Part` (no variants, no extras).
 */
export type Part<TVariants extends object = never, TExtras extends object = never> = {
  handlers: EventBindings
  attrs: AttrBindings
} & ([TVariants] extends [never] ? unknown : { variants: TVariants }) &
  ([TExtras] extends [never] ? unknown : TExtras)

export interface Machine<
  TContext,
  TProps = Record<string, unknown>,
  TEvent extends EventObject = EventObject,
> {
  getState: () => string
  getContext: () => TContext
  getProps: () => TProps
  /**
   * Monotonic counter that bumps on every state transition or context
   * change. Designed as a cheap "did anything change?" snapshot for
   * subscribers like React's useSyncExternalStore.
   */
  getVersion: () => number
  setProps: (next: TProps) => void
  send: (event: TEvent) => void
  subscribe: (listener: () => void) => () => void
  start: () => void
  stop: () => void
}
