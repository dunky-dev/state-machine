// @vitest-environment jsdom
// `useSelector` contract: a value-deduped `current` (Object.is by default,
// custom isEqual for objects) that follows the machine and the props its
// selector closes over, subscribed for the reader's lifetime.
import { render } from '@testing-library/svelte'
import { flushSync } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import DropOnChange from './fixtures/drop-on-change.svelte'
import UseSelector from './fixtures/use-selector.svelte'
import { makeCounters, type CountersMachine } from './fixtures/counters'

// Counts the subscriptions a reader opens on the machine.
function counted(m: CountersMachine) {
  const calls = { subscribe: 0 }
  const machine = new Proxy(m, {
    get: (target, key, receiver) =>
      key === 'subscribe'
        ? (listener: () => void) => (calls.subscribe++, target.subscribe(listener))
        : Reflect.get(target, key, receiver),
  })
  return { machine, calls }
}

// Sends outside an event handler; flush so the reader's effects have run.
const send = (m: CountersMachine, type: 'incA' | 'incB' | 'noop') => {
  m.send({ type })
  flushSync()
}

describe('useSelector', () => {
  it('wakes its reader ONLY when the selected value changes (Object.is by default)', () => {
    const m = makeCounters()
    const onread = vi.fn()
    render(UseSelector, { machine: m, pick: (m: CountersMachine) => m.context.a > 0, onread })
    expect(onread).toHaveBeenCalledTimes(1)

    send(m, 'incB') // another slice changed → no wake
    send(m, 'noop') // nothing changed → no wake
    expect(onread).toHaveBeenCalledTimes(1)

    send(m, 'incA') // false → true → wake
    expect(onread).toHaveBeenLastCalledWith(true)
    send(m, 'incA') // re-derived, still true → no wake
    expect(onread).toHaveBeenCalledTimes(2)
  })

  it('dedups an object selection with isEqual, handing out the selected object itself', () => {
    const m = makeCounters()
    const selected: { a: number }[] = []
    const onread = vi.fn()
    render(UseSelector, {
      machine: m,
      pick: (m: CountersMachine) => {
        const value = { a: m.context.a }
        selected.push(value)
        return value
      },
      isEqual: (x: unknown, y: unknown) => (x as { a: number }).a === (y as { a: number }).a,
      onread,
    })

    send(m, 'incB') // a fresh but equal { a } → no wake
    expect(onread).toHaveBeenCalledTimes(1)
    send(m, 'incA') // { a } changed → wake
    expect(onread).toHaveBeenCalledTimes(2)
    // Never a reactive copy: the reader sees the objects the selector returned.
    for (const [value] of onread.mock.calls) expect(selected).toContain(value)
  })

  it('follows a prop the selector closes over, and compares later changes against it', async () => {
    const m = makeCounters()
    const { getByTestId, rerender } = render(UseSelector, {
      machine: m,
      pick: (m: CountersMachine, wanted: number) => m.context.a === wanted,
      wanted: 0,
    })
    expect(getByTestId('value').textContent).toBe('true')

    await rerender({ wanted: 1 }) // a is 0 → false, with no machine change
    expect(getByTestId('value').textContent).toBe('false')

    send(m, 'incA') // a is 1 → true against the NEW prop
    expect(getByTestId('value').textContent).toBe('true')
  })

  it('dedups a prop-driven change with isEqual too', async () => {
    const m = makeCounters()
    const onread = vi.fn()
    const { rerender } = render(UseSelector, {
      machine: m,
      pick: (m: CountersMachine, wanted: number) => ({ a: m.context.a, big: wanted > 100 }),
      isEqual: (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y),
      onread,
    })
    await rerender({ wanted: 1 }) // a fresh object, equal under isEqual → no wake
    expect(onread).toHaveBeenCalledOnce()
  })

  it('follows the machine a getter hands over, waking on it alone', async () => {
    const first = makeCounters()
    const second = makeCounters()
    const pick = (m: CountersMachine) => m.context.a
    const { getByTestId, rerender } = render(UseSelector, { machine: first, pick })
    send(second, 'incA')
    await rerender({ machine: second })
    expect(getByTestId('value').textContent).toBe('1') // reads the new machine

    send(first, 'incA') // the old machine no longer wakes the reader
    send(second, 'incA')
    expect(getByTestId('value').textContent).toBe('2')
  })

  it('keeps one subscription while the machine stays the same, whatever else changes', async () => {
    const { machine, calls } = counted(makeCounters())
    const { rerender } = render(UseSelector, { machine, pick: (m: CountersMachine) => m.context.a })
    await rerender({ wanted: 1 }) // props share one signal, as through a {...spread}
    expect(calls.subscribe).toBe(1)
  })

  // The dropped reader still hears this change's notification, before its
  // parent's re-render removes it: neither its stale selector nor its
  // isEqual may throw out of send().
  it.each([
    {
      throwing: 'selector',
      pick: (m: CountersMachine) => {
        if (m.context.a > 0) throw new Error('stale index')
        return m.context.a
      },
      isEqual: undefined,
    },
    {
      throwing: 'isEqual',
      pick: (m: CountersMachine) => (m.context.a === 0 ? { id: 'row-0' } : undefined),
      isEqual: (x: unknown, y: unknown) => (x as { id: string }).id === (y as { id: string }).id,
    },
  ])(
    'keeps a reader its parent drops on this change out of send() (throwing $throwing)',
    ({ pick, isEqual }) => {
      const m = makeCounters()
      render(DropOnChange, { machine: m, pick, isEqual })
      expect(() => m.send({ type: 'incA' })).not.toThrow()
      expect(() => flushSync()).not.toThrow()
    },
  )

  it('gives a dropped reader its last value at teardown, never a stale re-selection', () => {
    const m = makeCounters()
    const pick = (m: CountersMachine) => {
      if (m.context.a > 0) throw new Error('stale index')
      return m.context.a
    }
    const onteardown = vi.fn()
    render(DropOnChange, { machine: m, pick, onteardown })
    m.send({ type: 'incA' })
    expect(() => flushSync()).not.toThrow()
    expect(onteardown).toHaveBeenCalledWith(0)
  })

  it("surfaces a mounted reader's selector error in the next flush, not in send()", () => {
    const m = makeCounters()
    const pick = (m: CountersMachine) => {
      if (m.context.a === 1) throw new Error('bad state')
      return m.context.a
    }
    const { getByTestId } = render(UseSelector, { machine: m, pick })
    expect(() => m.send({ type: 'incA' })).not.toThrow()
    expect(() => flushSync()).toThrow('bad state')
    send(m, 'incA') // a later state the selector handles: the reader recovers
    expect(getByTestId('value').textContent).toBe('2')
  })

  it('reflects a send made before mount (a child mount effect runs first)', () => {
    const m = makeCounters()
    const { getByTestId } = render(UseSelector, {
      machine: m,
      pick: (m: CountersMachine) => m.context.a,
      sendOnMount: { type: 'incA' },
    })
    expect(getByTestId('value').textContent).toBe('1')
  })

  it('stops evaluating the selector once unmounted', () => {
    const m = makeCounters()
    const pick = vi.fn((m: CountersMachine) => m.context.a)
    const { unmount } = render(UseSelector, { machine: m, pick })
    unmount()

    const evaluations = pick.mock.calls.length
    send(m, 'incA') // unmounted reader → the machine must not re-evaluate it
    expect(pick.mock.calls.length).toBe(evaluations)
  })
})
