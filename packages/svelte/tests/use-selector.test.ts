// @vitest-environment jsdom
// `useSelector` contract: a value-deduped `current` (Object.is by default,
// custom isEqual for objects) that follows the machine and the props its
// selector closes over, subscribed for the reader's lifetime.
import { render } from '@testing-library/svelte'
import { flushSync } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UseSelector from './fixtures/use-selector.svelte'
import { makeCounters, type CountersMachine } from './fixtures/counters'

// Sends outside an event handler; flush so the reader's effects have run.
const send = (m: CountersMachine, type: 'incA' | 'incB' | 'noop') => {
  m.send({ type })
  flushSync()
}

afterEach(() => vi.clearAllMocks())

describe('useSelector', () => {
  it('reflects the selected value, updating when the machine changes it', () => {
    const m = makeCounters()
    const { getByTestId } = render(UseSelector, {
      machine: m,
      pick: (m: CountersMachine) => m.context.a,
    })
    expect(getByTestId('value').textContent).toBe('0')
    send(m, 'incA')
    expect(getByTestId('value').textContent).toBe('1')
  })

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
      isEqual: (x: { a: number }, y: { a: number }) => x.a === y.a,
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
