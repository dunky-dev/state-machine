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
  effectScope,
  h,
  KeepAlive,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  Suspense,
  type PropType,
  watchEffect,
} from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act as write, type Connect, type TransitionConfig } from '@dunky.dev/state-machine'
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

describe('useMachine — snapshot timing', () => {
  it('reads the snapshot once a transition completes, never in the middle of one', async () => {
    type EditState = 'idle' | 'editing'
    type EditEvent = { type: 'edit' }
    // The draft exists only once `editing`'s entry action has run — after the state
    // change has already notified.
    const config: TransitionConfig<EditState, { draft?: string }, EditEvent> = {
      initial: 'idle',
      context: {},
      states: {
        idle: { on: { edit: { target: 'editing' } } },
        editing: { entry: [write(() => ({ draft: 'hi' }))] },
      },
    }
    const connectDraft: Connect<EditState, { draft?: string }, EditEvent, object, number> = ({
      state,
      context,
    }) => (state === 'editing' ? context.draft!.length : -1)
    let send!: (event: EditEvent) => void
    const Comp = defineComponent({
      setup() {
        const { api, machine } = useMachine(() => config, connectDraft, [], {})
        send = machine.send
        return () => h('div', String(api.value))
      },
    })
    const wrapper = mount(Comp)
    expect(() => send({ type: 'edit' })).not.toThrow()
    await nextTick()
    expect(wrapper.text()).toBe('2')
  })
})

describe('useMachine — build once', () => {
  it('builds the machine ONCE: state survives prop changes (no rebuild)', async () => {
    const { sink, Comp } = harness()
    const wrapper = mount(Comp, { props: { label: 'a' } })
    sink.api!.toggle() // → open, count 1
    await nextTick()

    await wrapper.setProps({ label: 'b' }) // a prop change must NOT rebuild/reset state
    expect(sink.api).toMatchObject({ open: true, count: 1 })
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

describe('useMachine — sends from tracked code', () => {
  it('runs no prop callback under the tracking of the effect that sent', async () => {
    const unrelated = ref(0)
    const go = ref(false)
    const onOpenChange = vi.fn(() => void unrelated.value) // a callback reading reactive state
    const { sink, Comp } = harness()
    mount(Comp, { props: { onOpenChange } })
    const scope = effectScope()
    scope.run(() => watchEffect(() => void (go.value && sink.machine!.send({ type: 'toggle' }))))
    go.value = true
    await nextTick()
    unrelated.value++ // must not re-run the watchEffect, which would toggle again
    await nextTick()
    expect(onOpenChange.mock.calls).toEqual([[true]])
    expect(sink.api!.open).toBe(true)
    scope.stop()
  })

  it('leaves nothing behind in the effect scope a send runs inside', () => {
    const { sink, Comp } = harness()
    mount(Comp, { props: { onOpenChange: () => {} } })
    // Vue 3.4/3.5 keep a scope's effects in an array; 3.6 links them, and has no such field.
    const scope = effectScope()
    const held = () => (scope as unknown as { effects?: unknown[] }).effects?.length ?? 0
    scope.run(() => {
      for (let i = 0; i < 10; i++) sink.machine!.send({ type: 'toggle' }) // ten reactions
    })
    expect(held()).toBe(0)
    scope.stop()
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

  it('lets a machine kept past unmount restart without calling the component back', () => {
    const onOpenChange = vi.fn()
    const { sink, Comp } = harness()
    mount(Comp, { props: { onOpenChange } }).unmount()
    sink.machine!.start()
    sink.machine!.send({ type: 'toggle' })
    expect(onOpenChange).not.toHaveBeenCalled()
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

  it("hands each run a snapshot of its props, so a cleanup undoes that run's setup", async () => {
    const registered = new Set<string | undefined>()
    const effects: Effect[] = [
      [
        (_machine, props) => {
          registered.add(props.label)
          return () => registered.delete(props.label)
        },
        ['label'],
      ],
    ]
    const { Comp } = harness(effects)
    const wrapper = mount(Comp, { props: { label: 'a' } })
    await wrapper.setProps({ label: 'b' })
    expect([...registered]).toEqual(['b'])
  })

  it('sets an effect up again even when its previous cleanup throws', async () => {
    const log: string[] = []
    const effects: Effect[] = [
      [
        () => {
          log.push('effect')
          return () => {
            throw new Error('cleanup failed')
          }
        },
        ['label'],
      ],
    ]
    const { Comp } = harness(effects, log)
    const errorHandler = vi.fn()
    const wrapper = mount(Comp, { props: { label: 'a' }, global: { config: { errorHandler } } })
    await wrapper.setProps({ label: 'b' })
    expect(errorHandler).toHaveBeenCalledOnce()
    expect(log).toEqual(['start', 'effect', 'effect'])
  })

  it('reports both a throwing cleanup and the setup that then throws', async () => {
    const effects: Effect[] = [
      [
        (_machine, props) => {
          if (props.label === 'b') throw new Error('setup failed')
          return () => {
            throw new Error('cleanup failed')
          }
        },
        ['label'],
      ],
    ]
    const { Comp } = harness(effects)
    const errorHandler = vi.fn()
    const wrapper = mount(Comp, { props: { label: 'a' }, global: { config: { errorHandler } } })
    await wrapper.setProps({ label: 'b' })
    const reported = errorHandler.mock.calls.map(([error]) =>
      error instanceof AggregateError ? error.errors.map(e => e.message) : [error.message],
    )
    expect(reported).toEqual([['cleanup failed', 'setup failed']])
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

  it('reports a throwing effect and still runs and cleans up the others', () => {
    const log: string[] = []
    const throwing: Effect = [
      () => {
        throw new Error('effect failed')
      },
      [],
    ]
    const { Comp } = harness([loggingEffect(log), throwing, loggingEffect(log)], log)
    // A plain app: test-utils rethrows mount errors even past the app's errorHandler.
    const app = createApp(Comp)
    app.config.errorHandler = vi.fn()
    app.mount(document.createElement('div'))
    app.unmount()
    expect(app.config.errorHandler).toHaveBeenCalledOnce()
    expect(log).toEqual(['start', 'effect', 'effect', 'stop', 'cleanup', 'cleanup'])
  })

  it("cleans up once the component's DOM is gone, as React's passive effects do", () => {
    let root: Element | null = null
    let attachedAtCleanup: boolean | undefined
    const effects: Effect[] = [
      [
        () => {
          root = document.getElementById('toggle-root')
          return () => void (attachedAtCleanup = root?.parentNode != null)
        },
        [],
      ],
    ]
    const { Comp } = harness(effects)
    mount(Comp, { attachTo: document.body }).unmount()
    expect(root).not.toBeNull()
    expect(attachedAtCleanup).toBe(false)
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

describe('useMachine — compound teardown', () => {
  it("stops before its parts unmount, so a part's teardown send fires no reactions", () => {
    const onOpenChange = vi.fn()
    const Part = defineComponent({
      props: { machine: { type: Object as PropType<ToggleMachine>, required: true } },
      setup(props) {
        onUnmounted(() => props.machine.send({ type: 'toggle' })) // e.g. a part unregistering
        return () => null
      },
    })
    const Root = defineComponent({
      setup() {
        const props: ToggleProps = { onOpenChange }
        const { machine } = useMachine(createToggleConfig, connectToggle, [], props)
        return () => h(Part, { machine })
      },
    })
    mount(Root).unmount()
    expect(onOpenChange).not.toHaveBeenCalled()
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

describe('useMachine — mounting into a deactivated <KeepAlive> view', () => {
  it('holds still until the view activates, then starts', async () => {
    const log: string[] = []
    const { Comp } = harness([loggingEffect(log)], log)
    const shown = ref(true)
    const loaded = ref(false)
    const Page = defineComponent({ render: () => (loaded.value ? h(Comp) : null) })
    mount(
      defineComponent({ render: () => h(KeepAlive, null, () => (shown.value ? h(Page) : null)) }),
    )
    shown.value = false
    await nextTick()
    loaded.value = true // mounts Comp into the cached, deactivated view
    await nextTick()
    expect(log).toEqual([])

    shown.value = true
    await nextTick()
    expect(log).toEqual(['start', 'effect'])
  })
})

describe('useMachine — an async component inside a <KeepAlive> view', () => {
  it('starts an async component once it has mounted, not when it first activates', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {}) // Vue's "experimental" notice
    const log: string[] = []
    const effects: Effect[] = [
      [() => void log.push(`effect(mounted=${!!document.getElementById('async-root')})`), []],
    ]
    const Async = defineComponent({
      async setup() {
        const props: ToggleProps = {}
        const { machine } = useMachine(createToggleConfig, connectToggle, effects, props)
        machine.onStart(() => log.push('start'))
        await Promise.resolve()
        return () => h('div', { id: 'async-root' })
      },
    })
    // The cached view's activation reaches its descendants before an async one has mounted.
    const Page = defineComponent({ render: () => h(Suspense, null, () => h(Async)) })
    mount(defineComponent({ render: () => h(KeepAlive, null, () => h(Page)) }), {
      attachTo: document.body,
    })
    await flushPromises()
    expect(log).toEqual(['start', 'effect(mounted=true)'])
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
