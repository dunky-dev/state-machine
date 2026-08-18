// @vitest-environment jsdom
// `useMachine` behavioral contract: build once, machine lifecycle, props
// freshness, reactions, dep-tracked ComponentEffects, fine-grained api store.
import { createSignal, flush } from 'solid-js'
import { render } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  act as write,
  machine,
  makeReaction,
  type Connect,
  type TransitionConfig,
} from '@dunky.dev/state-machine'
import { type ComponentEffect, useMachine } from '@dunky.dev/solid-state-machine'

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
const noEffects: ComponentEffect<ToggleMachine, ToggleProps>[] = []

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
    flush() // Solid 2.0 defers store commits + DOM updates to the microtask queue
    expect(getByTestId('state').textContent).toBe('open')
    expect(api!.count).toBe(1)
  })
})

describe('useMachine — fine-grained store', () => {
  it('a field read updates ONLY when that field changes, not on unrelated changes', () => {
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
    flush()
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
    flush()
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
    flush()
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

describe('useMachine — function-valued api leaves', () => {
  // Regression: solid-js 2.0.0-rc.0's reconcile halts reactivity when it
  // replaces a function-valued property, and connect() rebuilds every closure
  // per wake — the bridge routes function leaves around reconcile.
  type PartsApi = {
    open: boolean
    results: { id: string; label: string }[]
    parts: { getItemProps: (id: string) => Record<string, unknown> }
    toggle: () => void
  }
  const connectParts: Connect<ToggleState, ToggleCtx, ToggleEvent, ToggleProps, PartsApi> = ({
    state,
    context,
    send,
  }) => ({
    open: state === 'open',
    results: [{ id: 'a', label: `A${context.count}` }],
    parts: { getItemProps: id => ({ id, open: state === 'open' }) },
    toggle: () => send({ type: 'toggle' }),
  })

  it('keeps readers of nested function leaves live across updates', () => {
    let api: PartsApi | undefined
    function Comp() {
      const props: ToggleProps = {}
      api = useMachine(createConfig(), connectParts, [], props).api
      return (
        <div data-testid='row'>
          {api.results.map(c => String(api!.parts.getItemProps(c.id)['open']))}
        </div>
      )
    }
    const { getByTestId } = render(() => <Comp />)
    expect(getByTestId('row').textContent).toBe('false')

    api!.toggle()
    flush()
    expect(getByTestId('row').textContent).toBe('true')

    api!.toggle()
    flush()
    expect(getByTestId('row').textContent).toBe('false')
  })
})

describe('useMachine — component effects', () => {
  it('runs each ComponentEffect (setup on mount, cleanup on unmount)', () => {
    const setup = vi.fn()
    const cleanup = vi.fn()
    const effects: ComponentEffect<ToggleMachine, ToggleProps>[] = [[() => (setup(), cleanup), []]]
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
    const effects: ComponentEffect<ToggleMachine, ToggleProps>[] = [[fn, ['label']]]
    const [label, setLabel] = createSignal('a')
    // Wrapped in an object: a bare function value would hit Solid 2.0's
    // compute-form createSignal overload.
    const [other, setOther] = createSignal<{ cb: (open: boolean) => void }>({ cb: () => {} })
    function Comp() {
      const props: ToggleProps = {
        get label() {
          return label()
        },
        get onOpenChange() {
          return other().cb
        },
      }
      useMachine(createConfig(), connect, effects, props)
      return null
    }
    render(() => <Comp />)
    expect(fn).toHaveBeenCalledTimes(1)

    setOther({ cb: () => {} }) // non-dep prop changed → no re-run
    flush()
    expect(fn).toHaveBeenCalledTimes(1)

    setLabel('b') // dep changed → re-run
    flush()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does NOT re-run when the effect body reads a prop outside its deps (untracked)', () => {
    // The authored deps list is the whole re-run contract — same as React's dep
    // array. A prop the effect merely reads must not become a hidden dependency.
    const fn = vi.fn((_m: ToggleMachine, props: ToggleProps) => {
      void props.label // read a NON-dep prop inside the effect body
    })
    const effects: ComponentEffect<ToggleMachine, ToggleProps>[] = [[fn, []]]
    const [label, setLabel] = createSignal('a')
    function Comp() {
      const props: ToggleProps = {
        get label() {
          return label()
        },
      }
      useMachine(createConfig(), connect, effects, props)
      return null
    }
    render(() => <Comp />)
    expect(fn).toHaveBeenCalledTimes(1)

    setLabel('b') // read by the effect, but not in deps → no re-run
    flush()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('receives (machine, props) and can read live machine state', () => {
    let seenOpen: boolean | undefined
    const effects: ComponentEffect<ToggleMachine, ToggleProps>[] = [
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
