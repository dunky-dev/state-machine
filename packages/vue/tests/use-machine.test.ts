// @vitest-environment jsdom
/**
 * `useMachine` — the Vue bridge composable. Pins the contract the README
 * documents: build ONCE in setup, start after mount and stop before unmount,
 * keep props fresh via a shallow setProps, run the connector's reactions with
 * the latest callbacks, run each ComponentEffect post-mount as its own
 * dep-keyed effect (React's effect order), and pause everything while a
 * <KeepAlive> holds the component deactivated (React's <Activity>).
 */
import {
  createApp,
  defineComponent,
  h,
  KeepAlive,
  nextTick,
  onMounted,
  ref,
  Suspense,
  type PropType,
} from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type ComponentEffect, useMachine } from '@dunky.dev/vue-state-machine'
import {
  connectToggle,
  createToggleConfig,
  type ToggleApi,
  type ToggleMachine,
  type ToggleProps,
} from './fixtures/toggle'

type Effect = ComponentEffect<ToggleMachine, ToggleProps>

// `default: undefined`: Vue casts an absent Boolean prop to `false`, which the
// core would read as a real value.
const toggleProps = {
  label: String,
  defaultOpen: { type: Boolean, default: undefined },
  onOpenChange: Function as PropType<(open: boolean) => void>,
}

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

// `log` records the machine lifecycle next to whatever the effects record, so
// the tests can assert the relative order.
function harness(effects: Effect[] = [], log: string[] = []) {
  const sink: { api?: ToggleApi; machine?: ToggleMachine; renders: number } = { renders: 0 }
  const Comp = defineComponent({
    props: toggleProps,
    setup(props) {
      const { api, machine } = useMachine(createToggleConfig, connectToggle, effects, props)
      machine.onStart(() => log.push('start'))
      machine.onStop(() => log.push('stop'))
      sink.machine = machine
      return () => {
        sink.api = api.value
        sink.renders++
        return h('div', { id: 'toggle-root' }, api.value.label ?? '∅')
      }
    },
  })
  return { sink, Comp, log }
}

// Records the effect's runs and cleanups into the same log as the lifecycle.
const loggingEffect = (log: string[], deps: (keyof ToggleProps)[] = []): Effect => [
  () => {
    log.push('effect')
    return () => log.push('cleanup')
  },
  deps,
]

describe('useMachine — lifecycle', () => {
  it('returns { api, machine }: api is a ref of the connect() output, machine the service', () => {
    const { sink, Comp } = harness()
    mount(Comp, { props: { label: 'hi' } })
    expect(sink.api).toMatchObject({ open: false, label: 'hi', count: 0 })
    expect(typeof sink.machine!.send).toBe('function')
  })

  it('starts the machine after mount and stops it on unmount', () => {
    const { Comp, log } = harness()
    const wrapper = mount(Comp)
    expect(log).toEqual(['start'])
    wrapper.unmount()
    expect(log).toEqual(['start', 'stop'])
  })

  it('re-renders when the snapshot changes', async () => {
    const { sink, Comp } = harness()
    mount(Comp)
    const before = sink.renders
    sink.api!.toggle()
    await nextTick()
    expect(sink.renders).toBeGreaterThan(before)
    expect(sink.api).toMatchObject({ open: true, count: 1 })
  })
})

describe('useMachine — build once', () => {
  it('builds the machine ONCE: state survives prop changes (no rebuild)', async () => {
    const { sink, Comp } = harness()
    const wrapper = mount(Comp, { props: { label: 'a' } })
    sink.api!.toggle() // → open, count 1
    await nextTick()

    await wrapper.setProps({ label: 'b' }) // a prop change must NOT rebuild/reset state
    expect(sink.api).toMatchObject({ open: true, count: 1, label: 'b' })
  })
})

describe('useMachine — props freshness via setProps', () => {
  it('flows later prop changes into the snapshot', async () => {
    const { sink, Comp } = harness()
    const wrapper = mount(Comp, { props: { label: 'first' } })
    await wrapper.setProps({ label: 'second' })
    expect(sink.api!.label).toBe('second')
  })

  it('value-dedups: an equal-valued prop update keeps the snapshot identity', async () => {
    const { sink, Comp } = harness()
    const wrapper = mount(Comp, { props: { label: 'x' } })
    const before = sink.api
    await wrapper.setProps({ label: 'x' })
    expect(sink.api).toBe(before)
  })

  it('reactions call the latest prop callback', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { sink, Comp } = harness()
    const wrapper = mount(Comp, { props: { onOpenChange: first } })
    await wrapper.setProps({ onOpenChange: second })
    sink.api!.toggle()
    expect(second).toHaveBeenCalledWith(true)
    expect(first).not.toHaveBeenCalled()
  })

  it('never walks into prop values — setProps is shallow, and so is the props watch', async () => {
    const reads = vi.fn()
    const nested = {
      get deep() {
        reads()
        return 1
      },
    }
    const label = ref('a')
    const Comp = defineComponent({
      setup() {
        // A getter is a valid props source too (MaybeRefOrGetter).
        const props = () => ({ label: label.value, nested }) as ToggleProps
        const { api } = useMachine(createToggleConfig, connectToggle, [], props)
        return () => h('div', api.value.label)
      },
    })
    const wrapper = mount(Comp)
    label.value = 'b'
    await nextTick()
    expect(wrapper.text()).toBe('b')
    expect(reads).not.toHaveBeenCalled()
  })

  it('hands props over exactly as Vue resolved them — an absent Boolean arrives as false', () => {
    let seen: Record<string, unknown> | undefined
    const Comp = defineComponent({
      props: { ...toggleProps, plain: Boolean },
      setup(props) {
        const effects: Effect[] = [[(_machine, p) => void (seen = { ...p }), []]]
        useMachine(createToggleConfig, connectToggle, effects, props)
        return () => null
      },
    })
    mount(Comp)
    // `plain` shows the cast; `defaultOpen` shows the `default: undefined` fix.
    expect(seen).toMatchObject({ plain: false, defaultOpen: undefined })
  })
})

describe('useMachine — reactions follow the machine lifecycle', () => {
  it('fires the connect reaction while mounted, never after unmount', () => {
    const onOpenChange = vi.fn()
    const { sink, Comp } = harness()
    const wrapper = mount(Comp, { props: { onOpenChange } })
    expect(onOpenChange).not.toHaveBeenCalled() // not on subscribe
    sink.api!.toggle()
    expect(onOpenChange).toHaveBeenLastCalledWith(true)

    // Unmount stops the machine, which unhooks the reactions: a send may still
    // transition, but the callback must not fire.
    wrapper.unmount()
    sink.api!.toggle()
    expect(onOpenChange).toHaveBeenCalledOnce()
  })
})

describe('useMachine — component effects', () => {
  it('runs each effect after mount, once the machine has started', () => {
    const log: string[] = []
    let rendered: Element | null = null
    const effects: Effect[] = [
      [
        () => {
          rendered = document.getElementById('toggle-root')
          log.push('effect')
        },
        [],
      ],
    ]
    const { Comp } = harness(effects, log)
    mount(Comp, { attachTo: document.body })
    expect(log).toEqual(['start', 'effect'])
    expect(rendered).not.toBeNull()
  })

  it('re-runs an effect ONLY when one of its named prop deps changes', async () => {
    const fn = vi.fn()
    const { Comp } = harness([[fn, ['label']]])
    const wrapper = mount(Comp, { props: { label: 'a' } })
    expect(fn).toHaveBeenCalledOnce()

    await wrapper.setProps({ label: 'a', onOpenChange: () => {} }) // dep equal, non-dep changed
    expect(fn).toHaveBeenCalledOnce()

    await wrapper.setProps({ label: 'b' })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does NOT re-run when the effect body reads a prop outside its deps', async () => {
    // The authored deps list is the whole re-run contract, as with React's dep
    // array: a prop the body merely reads must not become a hidden dependency.
    const fn = vi.fn((_machine: ToggleMachine, props: ToggleProps) => void props.label)
    const { Comp } = harness([[fn, []]])
    const wrapper = mount(Comp, { props: { label: 'a' } })
    await wrapper.setProps({ label: 'b' })
    expect(fn).toHaveBeenCalledOnce()
  })

  it('runs the previous cleanup BEFORE re-running on a dep change', async () => {
    const log: string[] = []
    const { Comp } = harness([loggingEffect(log, ['label'])], log)
    const wrapper = mount(Comp, { props: { label: 'a' } })
    await wrapper.setProps({ label: 'b' })
    expect(log).toEqual(['start', 'effect', 'cleanup', 'effect'])
  })

  it('re-runs after the DOM reflects the dep change', async () => {
    const seen: (string | null | undefined)[] = []
    const effects: Effect[] = [
      [() => void seen.push(document.getElementById('toggle-root')?.textContent), ['label']],
    ]
    const { Comp } = harness(effects)
    const wrapper = mount(Comp, { props: { label: 'a' }, attachTo: document.body })
    await wrapper.setProps({ label: 'b' })
    expect(seen).toEqual(['a', 'b'])
  })

  it('still cleans up the effects that started before one that threw', () => {
    const log: string[] = []
    const throwing: Effect = [
      () => {
        throw new Error('effect failed')
      },
      [],
    ]
    const { Comp } = harness([loggingEffect(log), throwing], log)
    // A plain app: test-utils rethrows mount errors even past the app's errorHandler.
    const app = createApp(Comp)
    app.config.errorHandler = vi.fn()
    app.mount(document.createElement('div'))
    app.unmount()
    expect(app.config.errorHandler).toHaveBeenCalledOnce()
    expect(log).toEqual(['start', 'effect', 'stop', 'cleanup'])
  })

  it('cleans up on unmount, after the machine stops', () => {
    const log: string[] = []
    const { Comp } = harness([loggingEffect(log)], log)
    mount(Comp).unmount()
    expect(log).toEqual(['start', 'effect', 'stop', 'cleanup'])
  })
})

describe('useMachine — compound components', () => {
  it("reflects a child's send from its own onMounted, which runs before the machine starts", async () => {
    const log: string[] = []
    const Child = defineComponent({
      props: { machine: { type: Object as PropType<ToggleMachine>, required: true } },
      setup(props) {
        onMounted(() => {
          log.push('child:send')
          props.machine.send({ type: 'toggle' })
        })
        return () => null
      },
    })
    const Parent = defineComponent({
      setup() {
        const props: ToggleProps = {}
        const { api, machine } = useMachine(createToggleConfig, connectToggle, [], props)
        machine.onStart(() => log.push('start'))
        return () => h('div', [api.value.open ? 'open' : 'closed', h(Child, { machine })])
      },
    })
    const wrapper = mount(Parent)
    await nextTick()
    expect(log).toEqual(['child:send', 'start'])
    expect(wrapper.text()).toBe('open')
  })
})

describe('useMachine — <KeepAlive> pauses like React <Activity>', () => {
  it('stops the machine and its effects while deactivated, resumes them with state intact', async () => {
    const log: string[] = []
    const { sink, Comp } = harness([loggingEffect(log)], log)
    const shown = ref(true)
    const Other = defineComponent({ render: () => h('span') })
    mount(defineComponent({ render: () => h(KeepAlive, null, [shown.value ? h(Comp) : h(Other)]) }))
    expect(log).toEqual(['start', 'effect']) // onActivated also fires on first mount: no double start
    sink.api!.toggle() // → open, count 1

    shown.value = false
    await nextTick()
    expect(log).toEqual(['start', 'effect', 'stop', 'cleanup'])

    shown.value = true
    await nextTick()
    expect(log).toEqual(['start', 'effect', 'stop', 'cleanup', 'start', 'effect'])
    expect(sink.api).toMatchObject({ open: true, count: 1 })
  })
})

describe('useMachine — async setup', () => {
  it('starts under <Suspense> when called before the first await', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {}) // Vue's "experimental" notice
    const log: string[] = []
    const Async = defineComponent({
      async setup() {
        const props: ToggleProps = {}
        const { api, machine } = useMachine(
          createToggleConfig,
          connectToggle,
          [loggingEffect(log)],
          props,
        )
        machine.onStart(() => log.push('start'))
        await Promise.resolve()
        return () => h('div', String(api.value.open))
      },
    })
    const wrapper = mount(defineComponent({ render: () => h(Suspense, null, () => h(Async)) }))
    await flushPromises()
    expect(wrapper.text()).toBe('false')
    expect(log).toEqual(['start', 'effect'])
  })
})
