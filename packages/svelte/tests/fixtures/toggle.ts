import { act, type Connect, type TransitionConfig } from '@dunky.dev/state-machine'

/**
 * A tiny toggle machine used by the useMachine tests — the Svelte counterpart of
 * the fixture the React bridge tests use. `open` flips state and counts toggles;
 * `label` is a pass-through prop that proves prop changes flow through `setProps`
 * (and don't rebuild the machine).
 */

export type ToggleState = 'closed' | 'open'
export type ToggleContext = { count: number }
export type ToggleEvent = { type: 'toggle' }
export type ToggleProps = { label?: string }
export type ToggleApi = {
  open: boolean
  count: number
  label: string | undefined
  toggle: () => void
}

export const createToggleConfig = (): TransitionConfig<
  ToggleState,
  ToggleContext,
  ToggleEvent
> => ({
  initial: 'closed',
  context: { count: 0 },
  states: {
    // The count write goes through `act` (setContext) so subscribers wake.
    closed: {
      on: { toggle: { target: 'open', actions: act($ => ({ count: $.context.count + 1 })) } },
    },
    open: {
      on: { toggle: { target: 'closed', actions: act($ => ({ count: $.context.count + 1 })) } },
    },
  },
})

export const connectToggle: Connect<
  ToggleState,
  ToggleContext,
  ToggleEvent,
  ToggleProps,
  ToggleApi
> = ({ state, context, props, send }) => ({
  open: state === 'open',
  count: context.count,
  label: props.label,
  toggle: () => send({ type: 'toggle' }),
})
