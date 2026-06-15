// @vitest-environment jsdom
/**
 * `useMachine` — the React bridge hook. These tests pin the behavioral contract
 * the README documents: build ONCE, run the machine lifecycle (start on mount /
 * stop on unmount), keep consumer props fresh via setProps (value-deduped, never
 * during render), run the connector's reactions across the machine lifecycle,
 * run each ComponentEffect as its own dep-keyed useEffect, and drive React off
 * the connector's stable snapshot — returning `{ api, machine }`.
 */
import { StrictMode } from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  act as write,
  machine,
  makeReaction,
  type Connect,
  type TransitionConfig,
} from '@chimba-ui/state-machine'
import { type ComponentEffects, useMachine } from '@chimba-ui/react-state-machine'

type ToggleState = 'closed' | 'open'
interface ToggleCtx {
  count: number
}
type ToggleEvent = { type: 'toggle' }

interface ToggleProps {
  label?: string
  onOpenChange?: (open: boolean) => void
}

const createConfig =
  (): ((props: ToggleProps) => TransitionConfig<ToggleState, ToggleCtx, ToggleEvent>) => () => ({
    initial: 'closed',
    context: { count: 0 },
    states: {
      closed: {
        on: { toggle: { target: 'open', actions: write($ => ({ count: $.context.count + 1 })) } },
      },
      open: { on: { toggle: { target: 'closed' } } },
    },
  })

type ToggleApi = {
  open: boolean
  label: string | undefined
  count: number
  toggle: () => void
}

const connect: Connect<ToggleState, ToggleCtx, ToggleEvent, ToggleProps, ToggleApi> = ({
  state,
  context,
  props,
  send,
}) => ({
  open: state === 'open',
  label: props.label,
  count: context.count,
  toggle: () => send({ type: 'toggle' }),
})

const reaction = makeReaction<ToggleState, ToggleCtx, ToggleEvent, ToggleProps>()
connect.reactions = [
  reaction(
    m => m.state === 'open',
    (open, props) => props.onOpenChange?.(open),
  ),
]

type ToggleMachine = ReturnType<typeof machine<ToggleState, ToggleCtx, ToggleEvent>>
const noEffects: ComponentEffects<ToggleMachine, ToggleProps> = []

afterEach(() => vi.clearAllMocks())

function harness(
  props: ToggleProps,
  effects: ComponentEffects<ToggleMachine, ToggleProps> = noEffects,
) {
  const sink: { api?: ToggleApi; machine?: ToggleMachine; renders: number } = { renders: 0 }
  function Comp(p: ToggleProps) {
    const { api, machine: m } = useMachine(createConfig(), connect, effects, p)
    sink.api = api
    sink.machine = m
    sink.renders++
    return <div data-testid='label'>{api.label ?? '∅'}</div>
  }
  return { sink, Comp, props }
}

describe('useMachine — lifecycle', () => {
  it('returns { api, machine }: api is the connect() output, machine is the running service', () => {
    const { sink, Comp, props } = harness({ label: 'hi' })
    render(<Comp {...props} />)
    expect(sink.api).toMatchObject({ open: false, label: 'hi', count: 0 })
    expect(typeof sink.api!.toggle).toBe('function')
    expect(typeof sink.machine!.send).toBe('function')
  })

  it('starts the machine on mount and stops it on unmount', () => {
    const { sink, Comp, props } = harness({})
    const { unmount } = render(<Comp {...props} />)
    act(() => sink.api!.toggle())
    expect(sink.api!.open).toBe(true)
    expect(() => unmount()).not.toThrow()
  })

  it('re-renders the component when the snapshot changes (useSyncExternalStore)', () => {
    const { sink, Comp, props } = harness({})
    render(<Comp {...props} />)
    const before = sink.renders
    act(() => sink.api!.toggle())
    expect(sink.renders).toBeGreaterThan(before)
    expect(sink.api!.open).toBe(true)
    expect(sink.api!.count).toBe(1)
  })
})

describe('useMachine — build once', () => {
  it('builds the machine ONCE: state survives prop changes (no rebuild)', () => {
    const { sink, Comp } = harness({ label: 'a' })
    const { rerender } = render(<Comp label='a' />)
    act(() => sink.api!.toggle()) // → open, count 1
    expect(sink.api!.open).toBe(true)

    rerender(<Comp label='b' />) // prop change must NOT rebuild/reset state
    expect(sink.api!.open).toBe(true)
    expect(sink.api!.count).toBe(1)
    expect(sink.api!.label).toBe('b') // but the new prop IS reflected
  })
})

describe('useMachine — props freshness via setProps', () => {
  it('flows later prop changes into the snapshot (setProps, not rebuild)', () => {
    const { sink, Comp } = harness({ label: 'first' })
    const { rerender } = render(<Comp label='first' />)
    expect(sink.api!.label).toBe('first')
    rerender(<Comp label='second' />)
    expect(sink.api!.label).toBe('second')
  })

  it('value-dedups: an equal props object re-render does not churn the snapshot', () => {
    const { sink, Comp } = harness({ label: 'x' })
    const { rerender } = render(<Comp label='x' />)
    const snap1 = sink.api
    rerender(<Comp label='x' />) // fresh props object, equal values
    expect(sink.api).toBe(snap1) // stable identity → no recompute
  })
})

describe('useMachine — reactions follow the machine lifecycle', () => {
  it('fires the connect reaction (onOpenChange) when state flips while mounted', () => {
    const onOpenChange = vi.fn()
    const { sink, Comp } = harness({ onOpenChange })
    render(<Comp onOpenChange={onOpenChange} />)
    expect(onOpenChange).not.toHaveBeenCalled() // not on subscribe
    act(() => sink.api!.toggle())
    expect(onOpenChange).toHaveBeenCalledWith(true)
    act(() => sink.api!.toggle())
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('useMachine — component effects', () => {
  it('runs each ComponentEffect as its own effect (setup on mount, cleanup on unmount)', () => {
    const setup = vi.fn()
    const cleanup = vi.fn()
    const effects: ComponentEffects<ToggleMachine, ToggleProps> = [[() => (setup(), cleanup), []]]
    const { Comp } = harness({}, effects)
    const { unmount } = render(<Comp />)
    expect(setup).toHaveBeenCalledOnce()
    expect(cleanup).not.toHaveBeenCalled()
    unmount()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('re-runs an effect ONLY when one of its named prop deps changes', () => {
    const fn = vi.fn(() => () => {})
    const effects: ComponentEffects<ToggleMachine, ToggleProps> = [[fn, ['label']]]
    const { Comp } = harness({ label: 'a' }, effects)
    const { rerender } = render(<Comp label='a' />)
    expect(fn).toHaveBeenCalledTimes(1)

    rerender(<Comp label='a' />) // dep unchanged → no re-run
    expect(fn).toHaveBeenCalledTimes(1)

    rerender(<Comp label='b' />) // dep changed → re-run
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does NOT re-run an effect when a NON-dep prop changes', () => {
    const fn = vi.fn(() => () => {})
    const effects: ComponentEffects<ToggleMachine, ToggleProps> = [[fn, ['label']]]
    const { Comp } = harness({ label: 'a' }, effects)
    const { rerender } = render(<Comp label='a' onOpenChange={() => {}} />)
    expect(fn).toHaveBeenCalledTimes(1)
    rerender(<Comp label='a' onOpenChange={() => {}} />) // new fn identity, label same
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('receives (machine, props) and can read live machine state', () => {
    let seenOpen: boolean | undefined
    const effects: ComponentEffects<ToggleMachine, ToggleProps> = [
      [
        m => {
          seenOpen = m.matches('open')
        },
        [],
      ],
    ]
    const { Comp } = harness({}, effects)
    render(<Comp />)
    expect(seenOpen).toBe(false)
  })
})

describe('useMachine — StrictMode (mount → unmount → mount)', () => {
  it('survives the StrictMode double-mount without throwing and stays functional', () => {
    const onOpenChange = vi.fn()
    const { sink, Comp } = harness({ onOpenChange })
    expect(() =>
      render(
        <StrictMode>
          <Comp onOpenChange={onOpenChange} />
        </StrictMode>,
      ),
    ).not.toThrow()
    act(() => sink.api!.toggle())
    expect(sink.api!.open).toBe(true)
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
  })
})
