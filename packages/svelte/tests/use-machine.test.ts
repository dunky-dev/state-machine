import { describe, expect, it } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import { tick } from 'svelte'
import ToggleHarness from './fixtures/toggle-harness.svelte'

type Sink = {
  api?: import('./fixtures/toggle').ToggleApi
  renders: number
  effectRuns: number
  effectCleanups: number
}

const newSink = (): Sink => ({ renders: 0, effectRuns: 0, effectCleanups: 0 })

describe('useMachine', () => {
  it('exposes the connect() api and drives the markup', async () => {
    const sink = newSink()
    const { getByTestId } = render(ToggleHarness, { props: { label: 'a', sink } })
    await tick()

    const btn = getByTestId('toggle')
    expect(btn.textContent).toContain('a')
    expect(btn.textContent).toContain('closed')
    expect(sink.api?.open).toBe(false)
  })

  it('builds the machine ONCE: state survives prop changes', async () => {
    const sink = newSink()
    const { getByTestId, rerender } = render(ToggleHarness, { props: { label: 'a', sink } })
    await tick()

    await fireEvent.click(getByTestId('toggle')) // → open, count 1
    await tick()
    expect(sink.api?.open).toBe(true)
    expect(sink.api?.count).toBe(1)

    // A prop change must NOT rebuild the machine — state + count persist, and the
    // fresh label flows through setProps.
    await rerender({ label: 'b', sink })
    await tick()
    expect(sink.api?.open).toBe(true)
    expect(sink.api?.count).toBe(1)
    expect(sink.api?.label).toBe('b')
  })

  it('produces one new snapshot per real machine change', async () => {
    const sink = newSink()
    const { getByTestId } = render(ToggleHarness, { props: { label: 'a', sink } })
    await tick()
    const baseline = sink.renders
    const firstApi = sink.api

    // Each toggle is a real state change → exactly one new snapshot (the
    // connector memoizes, so the identity changes only on a real change).
    await fireEvent.click(getByTestId('toggle'))
    await tick()
    expect(sink.renders).toBe(baseline + 1)
    expect(sink.api).not.toBe(firstApi)
  })

  it('runs a component effect on mount and cleans it up on unmount', async () => {
    const sink = newSink()
    const { unmount } = render(ToggleHarness, {
      props: { label: 'a', sink, trackLabelEffect: true },
    })
    await tick()
    expect(sink.effectRuns).toBe(1)
    expect(sink.effectCleanups).toBe(0)

    unmount()
    await tick()
    expect(sink.effectCleanups).toBe(1)
  })

  it('does not re-run a prop-scoped effect on an unrelated machine change', async () => {
    const sink = newSink()
    const { getByTestId } = render(ToggleHarness, {
      props: { label: 'a', sink, trackLabelEffect: true },
    })
    await tick()
    expect(sink.effectRuns).toBe(1)

    // Toggling changes machine state, NOT the `label` prop the effect tracks —
    // so the effect stays put. This is the precise-dependency guarantee: the
    // effect reads only its named props, so runes wake it only for those.
    await fireEvent.click(getByTestId('toggle'))
    await tick()
    expect(sink.effectRuns).toBe(1)
  })

  it('re-runs an effect when its named prop dep changes (cleaning up first)', async () => {
    const sink = newSink()
    const { rerender } = render(ToggleHarness, {
      props: { label: 'a', sink, trackLabelEffect: true },
    })
    await tick()
    expect(sink.effectRuns).toBe(1)

    // dep changed → re-run, and the prior setup is torn down first.
    await rerender({ label: 'b', sink, trackLabelEffect: true })
    await tick()
    expect(sink.effectRuns).toBe(2)
    expect(sink.effectCleanups).toBe(1)
  })
})
