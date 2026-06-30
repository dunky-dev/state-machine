import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/svelte'
import { tick } from 'svelte'
import SelectorHarness from './fixtures/selector-harness.svelte'
import { makeCounters } from './fixtures/counters'

describe('useSelector', () => {
  it('reads the current selected value on mount', async () => {
    const m = makeCounters()
    const sink = { value: undefined as unknown, updates: 0 }
    const { getByTestId } = render(SelectorHarness, {
      props: { machine: m, selector: () => m.context.a, sink },
    })
    await tick()
    expect(getByTestId('value').textContent).toBe('0')
    expect(sink.value).toBe(0)
  })

  it('updates ONLY when the selected slice changes', async () => {
    const m = makeCounters()
    const sink = { value: undefined as unknown, updates: 0 }
    render(SelectorHarness, { props: { machine: m, selector: () => m.context.a, sink } })
    await tick()
    const baseline = sink.updates

    // selects `a`; bumping `b` must NOT update this selection.
    m.send({ type: 'incB' })
    await tick()
    expect(sink.updates).toBe(baseline)
    expect(sink.value).toBe(0)

    // bumping `a` updates it.
    m.send({ type: 'incA' })
    await tick()
    expect(sink.updates).toBe(baseline + 1)
    expect(sink.value).toBe(1)
  })

  it('uses the provided isEqual to dedup an object selection', async () => {
    const m = makeCounters()
    const sink = { value: undefined as unknown, updates: 0 }
    render(SelectorHarness, {
      props: {
        machine: m,
        selector: () => ({ a: m.context.a }),
        isEqual: (x: unknown, y: unknown) => (x as { a: number }).a === (y as { a: number }).a,
        sink,
      },
    })
    await tick()
    const baseline = sink.updates

    // `b` changes, the selected `{ a }` is equal under isEqual → no update,
    // despite the selector returning a fresh object each evaluation.
    m.send({ type: 'incB' })
    await tick()
    expect(sink.updates).toBe(baseline)

    // `a` changes → the object differs under isEqual → one update.
    m.send({ type: 'incA' })
    await tick()
    expect(sink.updates).toBe(baseline + 1)
    expect((sink.value as { a: number }).a).toBe(1)
  })
})
