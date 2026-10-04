// A minimal toggle component — machine config, connect, and a reaction — shared
// by the client and server suites so both render the exact same component.
import {
  act as write,
  machine,
  makeReaction,
  type Connect,
  type TransitionConfig,
} from '@dunky.dev/state-machine'

export type ToggleState = 'closed' | 'open'
export interface ToggleCtx {
  count: number
}
export type ToggleEvent = { type: 'toggle' }

export interface ToggleProps {
  label?: string
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export type ToggleApi = {
  open: boolean
  label: string | undefined
  count: number
  toggle: () => void
  trigger: Record<string, unknown>
}

export type ToggleMachine = ReturnType<typeof machine<ToggleState, ToggleCtx, ToggleEvent>>

export const createToggleConfig = (
  props: ToggleProps,
): TransitionConfig<ToggleState, ToggleCtx, ToggleEvent> => ({
  initial: props.defaultOpen ? 'open' : 'closed',
  context: { count: 0 },
  states: {
    closed: {
      on: { toggle: { target: 'open', actions: write($ => ({ count: $.context.count + 1 })) } },
    },
    open: { on: { toggle: { target: 'closed' } } },
  },
})

export const connectToggle: Connect<
  ToggleState,
  ToggleCtx,
  ToggleEvent,
  ToggleProps,
  ToggleApi
> = ({ state, context, props, send }) => ({
  open: state === 'open',
  label: props.label,
  count: context.count,
  toggle: () => send({ type: 'toggle' }),
  trigger: {
    role: 'button',
    focusable: true,
    expanded: state === 'open',
    controls: 'toggle-panel',
    describedBy: undefined,
    onPress: () => send({ type: 'toggle' }),
  },
})

const reaction = makeReaction<ToggleState, ToggleCtx, ToggleEvent, ToggleProps>()
connectToggle.reactions = [
  reaction(
    m => m.state === 'open',
    (open, props) => props.onOpenChange?.(open),
  ),
]
