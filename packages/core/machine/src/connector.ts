/**
 * Generic helper for writing a component's connect() function.
 *
 * A connect function turns the machine's current snapshot (state, context,
 * props, send) into a *view-facing* API the render layer consumes. Two
 * things make a connect function:
 *
 *   1. Inputs the machine already produces — state, context, props, send.
 *      These travel together on every tick and have nothing to do with the
 *      specific component.
 *   2. Inputs the view alone knows about — e.g. the items array a
 *      dropdown is about to render. Component-specific; opaque to core.
 *
 * `connector` lets each component declare only (2) plus its API body, and
 * gets the boilerplate of (1) for free.
 *
 *   // In the component:
 *   export const connect = connector<MyState, MyContext, MyProps, MyApi>()(
 *     ({ state, context, props, send }, items: MyItem[] = []): MyApi => {
 *       return { ... };
 *     },
 *   );
 *
 *   // In the generated api.ts:
 *   connect({ state, context, props, send })(items);
 */

import type { EventObject } from "./types";

export type Send = (event: EventObject) => void;

export interface MachineSnapshot<TState, TContext, TProps> {
  state: TState;
  context: TContext;
  props: TProps;
  send: Send;
}

/**
 * Curried connect: outer call carries the machine snapshot; inner call
 * accepts component-specific extras. Components type the extras tuple
 * (often empty, or a single `items` arg) at the call site of `connector`.
 */
export interface Connect<TState, TContext, TProps, TApi, TExtras extends unknown[]> {
  (snapshot: MachineSnapshot<TState, TContext, TProps>): (
    ...extras: TExtras
  ) => TApi;
}

/**
 * Build a component's connect function. Returns a function with two calls
 * so callers can write `connect(snapshot)(extras)` at the use site.
 */
export function connector<TState, TContext, TProps, TApi>() {
  return <TExtras extends unknown[]>(
    build: (
      snapshot: MachineSnapshot<TState, TContext, TProps>,
      ...extras: TExtras
    ) => TApi,
  ): Connect<TState, TContext, TProps, TApi, TExtras> => {
    return (snapshot) =>
      (...extras: TExtras) =>
        build(snapshot, ...extras);
  };
}
