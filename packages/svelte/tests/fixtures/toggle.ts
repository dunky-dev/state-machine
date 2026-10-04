import {
  act as write,
  makeReaction,
  type Connect,
  type machine,
  type TransitionConfig,
} from '@dunky.dev/state-machine'

// The toggle the useMachine suites (DOM and server) drive: `toggle` flips the
// state and counts opens; `label` passes through to prove props reach connect.
type ToggleState = 'closed' | 'open'
type ToggleEvent = { type: 'toggle' }
interface ToggleContext {
  count: number
}

export interface ToggleProps {
  label?: string
  onOpenChange?: (open: boolean) => void
}

export interface ToggleApi {
  open: boolean
  label: string | undefined
  count: number
  toggle: () => void
}

export type ToggleMachine = ReturnType<typeof machine<ToggleState, ToggleContext, ToggleEvent>>

export const createToggleConfig = (): TransitionConfig<
  ToggleState,
  ToggleContext,
  ToggleEvent
> => ({
  initial: 'closed',
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
  ToggleContext,
  ToggleEvent,
  ToggleProps,
  ToggleApi
> = ({ state, context, props, send }) => ({
  open: state === 'open',
  label: props.label,
  count: context.count,
  toggle: () => send({ type: 'toggle' }),
})

const reaction = makeReaction<ToggleState, ToggleContext, ToggleEvent, ToggleProps>()
connectToggle.reactions = [
  reaction(
    m => m.state === 'open',
    (open, props) => props.onOpenChange?.(open),
  ),
]
