// @vitest-environment jsdom
// `useSelector` — fine-grained leaf subscription: the ref updates only when the
// selected value changes, hands the value back untouched, and disposes with its
// effect scope (a component's, or a bare effectScope()).
import { defineComponent, effectScope, h, nextTick, ref, shallowRef, type PropType } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  act as write,
  machine,
  type EqualityFn,
  type TransitionConfig,
} from '@dunky.dev/state-machine'
import { useSelector } from '@dunky.dev/vue-state-machine'

type S = 'idle'
interface Ctx {
  a: number
  b: number
  item: { id: string }
}
type Ev = { type: 'incA' } | { type: 'incB' }

const config: TransitionConfig<S, Ctx, Ev> = {
  initial: 'idle',
  context: { a: 0, b: 0, item: { id: 'x' } },
  states: {
    idle: {
      on: {
        // context writes go through setContext (via `act`) so the bus notifies —
        // a raw in-place `context.a++` mutates the value but never wakes subscribers.
        incA: write($ => ({ a: $.context.a + 1 })),
        incB: write($ => ({ b: $.context.b + 1 })),
      },
    },
  },
}

type TestMachine = ReturnType<typeof machine<S, Ctx, Ev>>

function makeMachine(): TestMachine {
  const m = machine(config)
  m.start()
  return m
}

// A leaf component rendering one selection; `renders` logs each rendered value.
function defineLeaf<T>(m: TestMachine, selector: () => T, isEqual?: EqualityFn<T>) {
  const renders = vi.fn<(value: T) => void>()
  const Leaf = defineComponent({
    setup() {
      const selected = useSelector(m, selector, isEqual)
      return () => {
        renders(selected.value)
        return h('span', String(selected.value))
      }
    },
  })
  return { Leaf, renders }
}

afterEach(() => vi.clearAllMocks())

describe('useSelector — value-deduped updates', () => {
  it('O(readers): a slice change re-renders only the leaf that selected it', async () => {
    const m = makeMachine()
    const a = defineLeaf(m, () => m.context.a)
    const b = defineLeaf(m, () => m.context.b)
    mount(defineComponent({ render: () => h('div', [h(a.Leaf), h(b.Leaf)]) }))

    m.send({ type: 'incA' })
    await nextTick()
    m.send({ type: 'incB' })
    await nextTick()
    expect(a.renders.mock.calls).toEqual([[0], [1]])
    expect(b.renders.mock.calls).toEqual([[0], [1]])
  })

  it('defaults to Object.is equality (a re-derived equal value does not re-render)', async () => {
    const m = makeMachine()
    const { Leaf, renders } = defineLeaf(m, () => m.context.a > 0)
    mount(Leaf)
    m.send({ type: 'incA' }) // false → true
    await nextTick()
    m.send({ type: 'incA' }) // true → true
    await nextTick()
    expect(renders.mock.calls).toEqual([[false], [true]])
  })

  it('uses the provided isEqual to dedup an object selection', async () => {
    const m = makeMachine()
    const { Leaf, renders } = defineLeaf(
      m,
      () => ({ a: m.context.a }),
      (x, y) => x.a === y.a,
    )
    mount(Leaf)
    m.send({ type: 'incB' }) // a fresh but equal {a} → no re-render
    await nextTick()
    m.send({ type: 'incA' })
    await nextTick()
    expect(renders.mock.calls).toEqual([[{ a: 0 }], [{ a: 1 }]])
  })
})

describe('useSelector — reactive inputs', () => {
  it('re-selects when a reactive value it reads changes while the machine does not', async () => {
    const m = makeMachine()
    const target = ref(0)
    const { Leaf, renders } = defineLeaf(m, () => m.context.a === target.value)
    mount(Leaf)
    target.value = 1 // the machine is untouched: 0 === 1
    await nextTick()
    m.send({ type: 'incA' }) // and back through the machine: 1 === 1
    await nextTick()
    expect(renders.mock.calls).toEqual([[true], [false], [true]])
  })

  it('tracks a reactive read the selector skipped on an earlier run', async () => {
    const m = makeMachine()
    const target = ref(1)
    // `a > 0 &&` short-circuits while a is 0, so the first run never reads `target`.
    const { Leaf, renders } = defineLeaf(m, () => m.context.a > 0 && m.context.a === target.value)
    mount(Leaf)
    m.send({ type: 'incA' }) // a machine-triggered run now reads `target`
    await nextTick()
    target.value = 2
    await nextTick()
    expect(renders.mock.calls).toEqual([[false], [true], [false]])
  })

  it('follows a machine swapped through a ref', async () => {
    const [first, second] = [makeMachine(), makeMachine()]
    const current = shallowRef(first)
    const selector = vi.fn(() => current.value.context.a)
    const scope = effectScope()
    const a = scope.run(() => useSelector(current, selector))!
    current.value = second
    await nextTick()

    expect(a.value).toBe(0)
    const evaluations = selector.mock.calls.length
    first.send({ type: 'incA' }) // the old machine no longer marks the selection stale
    void a.value
    expect(selector.mock.calls.length).toBe(evaluations)
    second.send({ type: 'incA' })
    expect(a.value).toBe(1)
    scope.stop()
  })

  it('reads props only after Vue has patched them all', async () => {
    const m = makeMachine()
    const Leaf = defineComponent({
      props: {
        items: { type: Array as PropType<string[]>, required: true },
        index: { type: Number, required: true },
      },
      setup(props) {
        const label = useSelector(m, () => props.items[props.index]!.toUpperCase())
        return () => h('span', label.value)
      },
    })
    const items = ref(['a', 'b', 'c'])
    const index = ref(2)
    const errorHandler = vi.fn()
    const wrapper = mount(
      defineComponent({ render: () => h(Leaf, { items: items.value, index: index.value }) }),
      { global: { config: { errorHandler } } },
    )
    items.value = ['x'] // alone, index 2 is out of range...
    index.value = 0 // ...but both land in the same patch
    await nextTick()
    expect(errorHandler).not.toHaveBeenCalled()
    expect(wrapper.text()).toBe('X')
  })

  it('rethrows a selector failure where it is read, then recovers on the next change', () => {
    const m = makeMachine()
    const broken = ref(false)
    const scope = effectScope()
    const a = scope.run(() =>
      useSelector(m, () => {
        if (broken.value) throw new Error('selector failed')
        return m.context.a
      }),
    )!
    expect(a.value).toBe(0)
    broken.value = true
    expect(() => a.value).toThrow('selector failed')
    broken.value = false
    m.send({ type: 'incA' })
    expect(a.value).toBe(1)
    scope.stop()
  })
})

describe('useSelector — the returned ref', () => {
  it('hands the selected value back as-is (no proxy), behind a readonly ref', () => {
    const m = makeMachine()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scope = effectScope()
    const item = scope.run(() => useSelector(m, () => m.context.item))!
    expect(item.value).toBe(m.context.item)

    ;(item as { value: unknown }).value = null
    expect(item.value).toBe(m.context.item)
    expect(warn).toHaveBeenCalled() // Vue's readonly-write warning
    scope.stop()
  })

  it('disposes with its effect scope: a stopped scope stops following the machine', () => {
    const m = makeMachine()
    const selector = vi.fn(() => m.context.a)
    const scope = effectScope()
    const a = scope.run(() => useSelector(m, selector))!
    m.send({ type: 'incA' })
    expect(a.value).toBe(1)

    scope.stop()
    const evaluations = selector.mock.calls.length
    m.send({ type: 'incA' })
    void a.value // a live subscription would have marked the selection stale
    expect(selector.mock.calls.length).toBe(evaluations)
  })
})
