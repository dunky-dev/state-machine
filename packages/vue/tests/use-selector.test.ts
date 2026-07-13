// @vitest-environment jsdom
/**
 * `useSelector` — fine-grained leaf subscription. These tests pin the README
 * contract: the selector reads the machine directly, the returned ref updates
 * ONLY when the selected value changes (value-deduped, `Object.is` by default,
 * custom `isEqual` for object selections), the component re-renders only when its
 * ref changes, and a change to one leaf's slice wakes only that leaf (the
 * O(readers) property).
 */
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act as write, machine, type TransitionConfig } from '@dunky.dev/state-machine'
import { useSelector } from '@dunky.dev/state-machine-vue'

type S = 'idle'
interface Ctx {
  a: number
  b: number
}
type Ev = { type: 'incA' } | { type: 'incB' } | { type: 'noop' }

const config: TransitionConfig<S, Ctx, Ev> = {
  initial: 'idle',
  context: { a: 0, b: 0 },
  states: {
    idle: {
      on: {
        // context writes go through setContext (via `act`) so the bus notifies —
        // a raw in-place `context.a++` mutates the value but never wakes subscribers.
        incA: write($ => ({ a: $.context.a + 1 })),
        incB: write($ => ({ b: $.context.b + 1 })),
        noop: () => {},
      },
    },
  },
}

function makeMachine() {
  const m = machine(config)
  m.start()
  return m
}

afterEach(() => vi.clearAllMocks())

describe('useSelector — value-deduped updates', () => {
  it('reads the machine directly and reflects the selected value', async () => {
    const m = makeMachine()
    let seen: number | undefined
    const Comp = defineComponent({
      setup() {
        const a = useSelector(m, () => m.context.a)
        return () => {
          seen = a.value
          return null
        }
      },
    })
    mount(Comp)
    expect(seen).toBe(0)
    m.send({ type: 'incA' })
    await nextTick()
    expect(seen).toBe(1)
  })

  it('re-renders ONLY when the selected slice changes (not on every machine change)', async () => {
    const m = makeMachine()
    const renders = vi.fn()
    const Comp = defineComponent({
      setup() {
        const a = useSelector(m, () => m.context.a)
        return () => {
          renders()
          return h('span', a.value)
        }
      },
    })
    mount(Comp)
    expect(renders).toHaveBeenCalledTimes(1)

    m.send({ type: 'incB' }) // selects `a`, `b` changed → no re-render
    await nextTick()
    expect(renders).toHaveBeenCalledTimes(1)

    m.send({ type: 'noop' }) // nothing changed → no re-render
    await nextTick()
    expect(renders).toHaveBeenCalledTimes(1)

    m.send({ type: 'incA' }) // `a` changed → re-render
    await nextTick()
    expect(renders).toHaveBeenCalledTimes(2)
  })

  it('defaults to Object.is equality (a re-derived equal value does not re-render)', async () => {
    const m = makeMachine()
    const renders = vi.fn()
    const Comp = defineComponent({
      setup() {
        const gt0 = useSelector(m, () => m.context.a > 0) // boolean: flips only at 0→1
        return () => {
          renders()
          return h('span', String(gt0.value))
        }
      },
    })
    mount(Comp)
    expect(renders).toHaveBeenCalledTimes(1)
    m.send({ type: 'incA' }) // false → true (re-render)
    await nextTick()
    expect(renders).toHaveBeenCalledTimes(2)
    m.send({ type: 'incA' }) // true → true (no re-render)
    await nextTick()
    expect(renders).toHaveBeenCalledTimes(2)
  })
})

describe('useSelector — custom isEqual for object selections', () => {
  it('uses the provided isEqual to dedup an object selection', async () => {
    const m = makeMachine()
    const renders = vi.fn()
    const Comp = defineComponent({
      setup() {
        const sel = useSelector(
          m,
          () => ({ a: m.context.a }),
          (x, y) => x.a === y.a,
        )
        return () => {
          renders()
          return h('span', String(sel.value.a))
        }
      },
    })
    mount(Comp)
    expect(renders).toHaveBeenCalledTimes(1)

    m.send({ type: 'incB' }) // selected {a} unchanged → no re-render
    await nextTick()
    expect(renders).toHaveBeenCalledTimes(1)

    m.send({ type: 'incA' }) // {a} changed → re-render
    await nextTick()
    expect(renders).toHaveBeenCalledTimes(2)
  })
})

describe('useSelector — fresh selector closure', () => {
  it('evaluates the selector against current machine state on each change', async () => {
    const m = makeMachine()
    let seen: boolean | undefined
    const target = 1
    const Comp = defineComponent({
      setup() {
        const hit = useSelector(m, () => m.context.a === target)
        return () => {
          seen = hit.value
          return null
        }
      },
    })
    mount(Comp)
    expect(seen).toBe(false) // a=0 === 1 is false

    m.send({ type: 'incA' }) // a → 1; compares to target 1
    await nextTick()
    expect(seen).toBe(true)
  })
})

describe('useSelector — O(readers): a slice change wakes only its reader', () => {
  it('re-renders only the leaf whose selected slice changed', async () => {
    const m = makeMachine()
    const aRenders = vi.fn()
    const bRenders = vi.fn()
    const LeafA = defineComponent({
      setup() {
        const a = useSelector(m, () => m.context.a)
        return () => {
          aRenders()
          return h('span', a.value)
        }
      },
    })
    const LeafB = defineComponent({
      setup() {
        const b = useSelector(m, () => m.context.b)
        return () => {
          bRenders()
          return h('span', b.value)
        }
      },
    })
    const Parent = defineComponent({
      setup() {
        return () => h('div', [h(LeafA), h(LeafB)])
      },
    })
    mount(Parent)
    expect(aRenders).toHaveBeenCalledTimes(1)
    expect(bRenders).toHaveBeenCalledTimes(1)

    m.send({ type: 'incA' }) // only LeafA's slice changed
    await nextTick()
    expect(aRenders).toHaveBeenCalledTimes(2)
    expect(bRenders).toHaveBeenCalledTimes(1)

    m.send({ type: 'incB' }) // only LeafB's slice changed
    await nextTick()
    expect(aRenders).toHaveBeenCalledTimes(2)
    expect(bRenders).toHaveBeenCalledTimes(2)
  })
})
