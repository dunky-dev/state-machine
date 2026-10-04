// @vitest-environment jsdom
// `useMachine` behavioral contract: build once, machine lifecycle, props
// freshness, reactions, dep-tracked ComponentEffects, and the reactive api.
//
// testing-library's rerender swaps one props object, so every prop read
// shares a signal — the way props arrive through a parent's `{...spread}`.
import { fireEvent, render } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentEffect } from '@dunky.dev/svelte-state-machine'
import UseMachine from './fixtures/use-machine.svelte'
import {
  connectToggle,
  type ToggleApi,
  type ToggleMachine,
  type ToggleProps,
} from './fixtures/toggle'

type View = { readonly api: ToggleApi; readonly machine: ToggleMachine }
type Effect = ComponentEffect<ToggleMachine, ToggleProps>

// Mounts the harness and hands back the live view alongside the render result.
function mount(props: Record<string, unknown> = {}) {
  let view: View | undefined
  const result = render(UseMachine, { ...props, expose: (v: View) => (view = v) })
  return { ...result, view: view! }
}

afterEach(() => vi.clearAllMocks())

describe('useMachine — lifecycle', () => {
  it('returns { api, machine }: api is the connect() output, machine is the running service', () => {
    const { view } = mount({ label: 'hi' })
    expect(view.api).toMatchObject({ open: false, label: 'hi', count: 0 })
    expect(typeof view.api.toggle).toBe('function')
    expect(typeof view.machine.send).toBe('function')
  })

  it('renders from the snapshot and updates the DOM on a machine change', async () => {
    const { getByTestId } = mount({ label: 'a' })
    expect(getByTestId('toggle').textContent).toBe('a closed 0')
    await fireEvent.click(getByTestId('toggle'))
    expect(getByTestId('toggle').textContent).toBe('a open 1')
  })

  it('fires the connect reaction (onOpenChange) while mounted, and not after unmount', () => {
    const onOpenChange = vi.fn()
    const { view, unmount } = mount({ onOpenChange })
    expect(onOpenChange).not.toHaveBeenCalled() // not on subscribe
    view.api.toggle()
    expect(onOpenChange).toHaveBeenCalledWith(true)

    // Unmount stops the machine, which unhooks the connector's reactions — a
    // send may still transition, but the callback must not fire.
    unmount()
    view.machine.send({ type: 'toggle' })
    expect(onOpenChange).toHaveBeenCalledTimes(1)
  })

  it("starts after mount, before the component effects; stops before their cleanups (React's order)", () => {
    const order: string[] = []
    const mounted = () =>
      document.querySelector('[data-testid="toggle"]') ? 'mounted' : 'unmounted'
    const effect: Effect = [
      () => {
        order.push(`effect:${mounted()}`)
        return () => order.push('cleanup')
      },
      [],
    ]
    const { unmount } = render(UseMachine, {
      effects: [effect],
      expose: (view: View) => {
        view.machine.onStart(() => order.push(`start:${mounted()}`))
        view.machine.onStop(() => order.push('stop'))
      },
    })
    expect(order).toEqual(['start:mounted', 'effect:mounted'])
    unmount()
    expect(order).toEqual(['start:mounted', 'effect:mounted', 'stop', 'cleanup'])
  })
})

describe('useMachine — the api snapshot', () => {
  it("is connect()'s own output, not a reactive copy", () => {
    const outputs: ToggleApi[] = []
    const connect: typeof connectToggle = Object.assign(
      (snapshot: Parameters<typeof connectToggle>[0]) => {
        const api = connectToggle(snapshot)
        outputs.push(api)
        return api
      },
      { reactions: connectToggle.reactions },
    )
    const { view } = mount({ connect })
    view.api.toggle()
    expect(view.api).toBe(outputs.at(-1))
  })

  it('reflects a send made before mount (a child mount effect runs first)', () => {
    const { view, getByTestId } = mount({ sendOnMount: { type: 'toggle' } })
    expect(view.api.open).toBe(true)
    expect(getByTestId('toggle').textContent).toBe('- open 1')
  })
})

describe('useMachine — props', () => {
  it('builds the machine ONCE: state survives prop changes, which reach the snapshot', async () => {
    const { view, rerender, getByTestId } = mount({ label: 'a' })
    view.api.toggle() // → open, count 1
    await rerender({ label: 'b' }) // must NOT rebuild/reset state
    expect(view.api).toMatchObject({ open: true, count: 1, label: 'b' })
    expect(getByTestId('toggle').textContent).toBe('b open 1')
  })

  it('value-dedups: a re-render with equal props does not churn the snapshot', async () => {
    const { view, rerender } = mount({ label: 'x' })
    const before = view.api
    await rerender({ label: 'x' }) // fresh props object, equal values
    expect(view.api).toBe(before)
  })
})

describe('useMachine — component effects', () => {
  it('runs each ComponentEffect: setup on mount, cleanup on unmount', () => {
    const setup = vi.fn()
    const cleanup = vi.fn()
    const { unmount } = mount({ effects: [[() => (setup(), cleanup), []]] })
    expect(setup).toHaveBeenCalledOnce()
    expect(cleanup).not.toHaveBeenCalled()
    unmount()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  // `copy`: the getter builds its own object (destructured defaults), so the
  // deps must be tracked by value, not by which props the getter reads.
  it.each([false, true])(
    're-runs an effect ONLY when one of its named prop deps changes (copied props: %s)',
    async copy => {
      const fn = vi.fn(() => () => {})
      const { rerender } = mount({ copy, label: 'a', effects: [[fn, ['label']]] })
      expect(fn).toHaveBeenCalledTimes(1)

      await rerender({ onOpenChange: () => {} }) // non-dep prop changed → no re-run
      expect(fn).toHaveBeenCalledTimes(1)

      await rerender({ label: 'b' }) // dep changed → re-run
      expect(fn).toHaveBeenCalledTimes(2)
    },
  )

  it('runs the previous cleanup BEFORE re-running on a dep change', async () => {
    // A listener-registering effect must tear down before it sets up again,
    // or every dep change stacks a listener.
    const cleanup = vi.fn()
    const fn = vi.fn(() => cleanup)
    const { rerender } = mount({ label: 'a', effects: [[fn, ['label']]] })
    await rerender({ label: 'b' })
    expect(cleanup).toHaveBeenCalledOnce()
    expect(cleanup.mock.invocationCallOrder[0]!).toBeLessThan(fn.mock.invocationCallOrder[1]!)
  })

  it('does NOT re-run when the effect body reads a prop outside its deps (untracked)', async () => {
    // The authored deps list is the whole re-run contract — same as React's
    // dep array. A prop the effect merely reads must not become a dependency.
    const fn = vi.fn((_machine: ToggleMachine, props: ToggleProps) => void props.label)
    const { rerender } = mount({ label: 'a', effects: [[fn, []]] })
    await rerender({ label: 'b' })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('receives (machine, props) and can read live machine state', () => {
    let seen: { open: boolean; label: string | undefined } | undefined
    const effect: Effect = [
      (machine, props) => {
        seen = { open: machine.matches('open'), label: props.label }
      },
      [],
    ]
    mount({ label: 'hi', effects: [effect] })
    expect(seen).toEqual({ open: false, label: 'hi' })
  })
})
