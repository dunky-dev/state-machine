// @vitest-environment jsdom
/**
 * `useMachine` — the Vue bridge composable. These tests pin the behavioral
 * contract the README documents: build ONCE, run the machine lifecycle (start on
 * mount / stop on unmount), keep consumer props fresh via setProps (value-deduped),
 * run the connector's reactions across the machine lifecycle, run each
 * ComponentEffect as its own dep-keyed watch, and expose the connector's stable
 * snapshot as a reactive api — returning `{ api, machine }`.
 */
import { defineComponent, h, nextTick, type PropType } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  act as write,
  machine,
  makeReaction,
  type Connect,
  type TransitionConfig,
} from '@dunky.dev/state-machine'
import { type ComponentEffects, useMachine } from '@dunky.dev/state-machine-vue'

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
  const sink: { api?: ToggleApi; machine?: ToggleMachine } = {}
  const Comp = defineComponent({
    props: {
      label: { type: String, required: false },
      onOpenChange: { type: Function as PropType<(open: boolean) => void>, required: false },
    },
    setup(p) {
      const { api, machine: m } = useMachine(createConfig(), connect, effects, p as ToggleProps)
      sink.machine = m
      return () => {
        sink.api = api.value
        return h('div', { 'data-testid': 'label' }, api.value.label ?? '∅')
      }
    },
  })
  return { sink, Comp, props }
}

describe('useMachine — lifecycle', () => {
  it('returns { api, machine }: api is the connect() output, machine is the running service', () => {
    const { sink, Comp, props } = harness({ label: 'hi' })
    mount(Comp, { props })
    expect(sink.api).toMatchObject({ open: false, label: 'hi', count: 0 })
    expect(typeof sink.api!.toggle).toBe('function')
    expect(typeof sink.machine!.send).toBe('function')
  })

  it('starts the machine on mount and stops it on unmount', async () => {
    const { sink, Comp, props } = harness({})
    const wrapper = mount(Comp, { props })
    sink.api!.toggle()
    await nextTick()
    expect(sink.api!.open).toBe(true)
    expect(() => wrapper.unmount()).not.toThrow()
  })

  it('reflects snapshot changes in the reactive api', async () => {
    const { sink, Comp, props } = harness({})
    mount(Comp, { props })
    sink.api!.toggle()
    await nextTick()
    expect(sink.api!.open).toBe(true)
    expect(sink.api!.count).toBe(1)
  })
})

describe('useMachine — build once', () => {
  it('builds the machine ONCE: state survives prop changes (no rebuild)', async () => {
    const { sink, Comp } = harness({ label: 'a' })
    const wrapper = mount(Comp, { props: { label: 'a' } })
    sink.api!.toggle() // → open, count 1
    await nextTick()
    expect(sink.api!.open).toBe(true)

    await wrapper.setProps({ label: 'b' }) // prop change must NOT rebuild/reset state
    expect(sink.api!.open).toBe(true)
    expect(sink.api!.count).toBe(1)
    expect(sink.api!.label).toBe('b') // but the new prop IS reflected
  })
})

describe('useMachine — props freshness via setProps', () => {
  it('flows later prop changes into the snapshot (setProps, not rebuild)', async () => {
    const { sink, Comp } = harness({ label: 'first' })
    const wrapper = mount(Comp, { props: { label: 'first' } })
    expect(sink.api!.label).toBe('first')
    await wrapper.setProps({ label: 'second' })
    expect(sink.api!.label).toBe('second')
  })

  it('value-dedups: an equal-valued prop update does not churn the snapshot', async () => {
    const { sink, Comp } = harness({ label: 'x' })
    const wrapper = mount(Comp, { props: { label: 'x' } })
    const snap1 = sink.api
    await wrapper.setProps({ label: 'x' }) // same value
    expect(sink.api).toBe(snap1) // stable identity → no recompute
  })
})

describe('useMachine — reactions follow the machine lifecycle', () => {
  it('fires the connect reaction (onOpenChange) when state flips while mounted', async () => {
    const onOpenChange = vi.fn()
    const { sink, Comp } = harness({ onOpenChange })
    mount(Comp, { props: { onOpenChange } })
    expect(onOpenChange).not.toHaveBeenCalled() // not on subscribe
    sink.api!.toggle()
    await nextTick()
    expect(onOpenChange).toHaveBeenCalledWith(true)
    sink.api!.toggle()
    await nextTick()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('useMachine — component effects', () => {
  it('runs each ComponentEffect as its own effect (setup on mount, cleanup on unmount)', () => {
    const setup = vi.fn()
    const cleanup = vi.fn()
    const effects: ComponentEffects<ToggleMachine, ToggleProps> = [[() => (setup(), cleanup), []]]
    const { Comp } = harness({}, effects)
    const wrapper = mount(Comp, { props: {} })
    expect(setup).toHaveBeenCalledOnce()
    expect(cleanup).not.toHaveBeenCalled()
    wrapper.unmount()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('re-runs an effect ONLY when one of its named prop deps changes', async () => {
    const fn = vi.fn(() => () => {})
    const effects: ComponentEffects<ToggleMachine, ToggleProps> = [[fn, ['label']]]
    const { Comp } = harness({ label: 'a' }, effects)
    const wrapper = mount(Comp, { props: { label: 'a' } })
    expect(fn).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ label: 'a' }) // dep unchanged → no re-run
    expect(fn).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ label: 'b' }) // dep changed → re-run
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does NOT re-run an effect when a NON-dep prop changes', async () => {
    const fn = vi.fn(() => () => {})
    const effects: ComponentEffects<ToggleMachine, ToggleProps> = [[fn, ['label']]]
    const { Comp } = harness({ label: 'a' }, effects)
    const wrapper = mount(Comp, { props: { label: 'a', onOpenChange: () => {} } })
    expect(fn).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ label: 'a', onOpenChange: () => {} }) // new fn identity, label same
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
    mount(Comp, { props: {} })
    expect(seenOpen).toBe(false)
  })
})
