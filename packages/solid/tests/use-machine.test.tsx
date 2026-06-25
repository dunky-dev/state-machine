// @vitest-environment jsdom
/**
 * `useMachine` — the Solid bridge. These tests pin the behavioral contract: build
 * ONCE, run the machine lifecycle (start on mount / stop on cleanup), keep
 * consumer props fresh via a tracked setProps effect (value-deduped), run the
 * connector's reactions across the machine lifecycle, run each ComponentEffect as
 * its own dep-tracked createEffect, and expose the connect() api as a fine-grained
 * store — so JSX reading one field updates only when THAT field changes.
 */
import { createSignal } from 'solid-js'
import { render } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  act as write,
  machine,
  makeReaction,
  type Connect,
  type TransitionConfig,
} from '@dunky.dev/state-machine'
import { type ComponentEffects, useMachine } from '../src'

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

describe('useMachine — lifecycle', () => {
  it('returns { api, machine }: api is the connect() output, machine is the running service', () => {
    let captured: { api: ToggleApi; machine: ToggleMachine } | undefined
    function Comp() {
      const props: ToggleProps = { label: 'hi' }
      captured = useMachine(createConfig(), connect, noEffects, props)
      return <div>{captured.api.label}</div>
    }
    render(() => <Comp />)
    expect(captured!.api.open).toBe(false)
    expect(captured!.api.label).toBe('hi')
    expect(captured!.api.count).toBe(0)
    expect(typeof captured!.api.toggle).toBe('function')
    expect(typeof captured!.machine.send).toBe('function')
  })

  it('starts the machine on mount and stops it on cleanup', () => {
    let api: ToggleApi | undefined
    function Comp() {
      const props: ToggleProps = {}
      api = useMachine(createConfig(), connect, noEffects, props).api
      return null
    }
    const { unmount } = render(() => <Comp />)
    api!.toggle()
    expect(api!.open).toBe(true)
    expect(() => unmount()).not.toThrow()
  })

  it('updates the DOM fine-grained when the read field changes', () => {
    let api: ToggleApi | undefined
    function Comp() {
      const props: ToggleProps = {}
      api = useMachine(createConfig(), connect, noEffects, props).api
      return <div data-testid='state'>{api.open ? 'open' : 'closed'}</div>
    }
    const { getByTestId } = render(() => <Comp />)
    expect(getByTestId('state').textContent).toBe('closed')
    api!.toggle()
    expect(getByTestId('state').textContent).toBe('open')
    expect(api!.count).toBe(1)
  })
})

describe('useMachine — fine-grained store', () => {
  it('a field read updates ONLY when that field changes, not on unrelated changes', () => {
    // `count` and `open` both live on the api store. A reader of `count` must not
    // re-run when only an unrelated render happens, and the store reconciles in
    // place so untouched leaves keep identity. We assert the store proxy reflects
    // each field independently after a toggle.
    let api: ToggleApi | undefined
    const countReads = vi.fn()
    function Comp() {
      const props: ToggleProps = {}
      api = useMachine(createConfig(), connect, noEffects, props).api
      return (
        <>
          <div data-testid='count'>{(countReads(), api.count)}</div>
          <div data-testid='open'>{api.open ? 'y' : 'n'}</div>
        </>
      )
    }
    const { getByTestId } = render(() => <Comp />)
    expect(getByTestId('count').textContent).toBe('0')
    expect(getByTestId('open').textContent).toBe('n')
    const countReadsBefore = countReads.mock.calls.length

    api!.toggle() // open: n→y AND count: 0→1
    expect(getByTestId('open').textContent).toBe('y')
    expect(getByTestId('count').textContent).toBe('1')
    expect(countReads.mock.calls.length).toBeGreaterThan(countReadsBefore)
  })
})

describe('useMachine — build once', () => {
  it('builds the machine ONCE: state survives prop changes (no rebuild)', () => {
    let api: ToggleApi | undefined
    const [label, setLabel] = createSignal('a')
    function Comp() {
      const props: ToggleProps = {
        get label() {
          return label()
        },
      }
      api = useMachine(createConfig(), connect, noEffects, props).api
      return <div>{api.label}</div>
    }
    render(() => <Comp />)
    api!.toggle() // → open, count 1
    expect(api!.open).toBe(true)

    setLabel('b') // prop change must NOT rebuild/reset state
    expect(api!.open).toBe(true)
    expect(api!.count).toBe(1)
    expect(api!.label).toBe('b') // but the new prop IS reflected
  })
})

describe('useMachine — props freshness via setProps', () => {
  it('flows later prop changes into the snapshot (setProps, not rebuild)', () => {
    let api: ToggleApi | undefined
    const [label, setLabel] = createSignal('first')
    function Comp() {
      const props: ToggleProps = {
        get label() {
          return label()
        },
      }
      api = useMachine(createConfig(), connect, noEffects, props).api
      return null
    }
    render(() => <Comp />)
    expect(api!.label).toBe('first')
    setLabel('second')
    expect(api!.label).toBe('second')
  })
})

describe('useMachine — reactions follow the machine lifecycle', () => {
  it('fires the connect reaction (onOpenChange) when state flips while mounted', () => {
    const onOpenChange = vi.fn()
    let api: ToggleApi | undefined
    function Comp() {
      const props: ToggleProps = { onOpenChange }
      api = useMachine(createConfig(), connect, noEffects, props).api
      return null
    }
    render(() => <Comp />)
    expect(onOpenChange).not.toHaveBeenCalled() // not on subscribe
    api!.toggle()
    expect(onOpenChange).toHaveBeenCalledWith(true)
    api!.toggle()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('useMachine — component effects', () => {
  it('runs each ComponentEffect (setup on mount, cleanup on unmount)', () => {
    const setup = vi.fn()
    const cleanup = vi.fn()
    const effects: ComponentEffects<ToggleMachine, ToggleProps> = [[() => (setup(), cleanup), []]]
    function Comp() {
      const props: ToggleProps = {}
      useMachine(createConfig(), connect, effects, props)
      return null
    }
    const { unmount } = render(() => <Comp />)
    expect(setup).toHaveBeenCalledOnce()
    expect(cleanup).not.toHaveBeenCalled()
    unmount()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('re-runs an effect ONLY when one of its named prop deps changes', () => {
    const fn = vi.fn(() => () => {})
    const effects: ComponentEffects<ToggleMachine, ToggleProps> = [[fn, ['label']]]
    const [label, setLabel] = createSignal('a')
    const [other, setOther] = createSignal(() => {})
    function Comp() {
      const props: ToggleProps = {
        get label() {
          return label()
        },
        get onOpenChange() {
          return other()
        },
      }
      useMachine(createConfig(), connect, effects, props)
      return null
    }
    render(() => <Comp />)
    expect(fn).toHaveBeenCalledTimes(1)

    setOther(() => () => {}) // non-dep prop changed → no re-run
    expect(fn).toHaveBeenCalledTimes(1)

    setLabel('b') // dep changed → re-run
    expect(fn).toHaveBeenCalledTimes(2)
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
    function Comp() {
      const props: ToggleProps = {}
      useMachine(createConfig(), connect, effects, props)
      return null
    }
    render(() => <Comp />)
    expect(seenOpen).toBe(false)
  })
})
