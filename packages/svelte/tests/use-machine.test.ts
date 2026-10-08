// @vitest-environment jsdom
// `useMachine` behavioral contract: build once, machine lifecycle, props
// freshness, reactions, dep-tracked ComponentEffects, and the reactive api.
//
// testing-library's rerender swaps one props object, so every prop read
// shares a signal — the way props arrive through a parent's `{...spread}`.
import { fireEvent, render } from '@testing-library/svelte'
import { flushSync } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import { act as write, createStore } from '@dunky.dev/state-machine'
import type { ComponentEffect } from '@dunky.dev/svelte-state-machine'
import { makeBox } from './fixtures/box.svelte'
import SliceParent from './fixtures/slice-parent.svelte'
import UseMachine from './fixtures/use-machine.svelte'
import {
  connectToggle,
  createToggleConfig,
  type ToggleApi,
  type ToggleMachine,
  type ToggleProps,
  type ToggleView,
} from './fixtures/toggle'

type Effect = ComponentEffect<ToggleMachine, ToggleProps>

function mount(props: Record<string, unknown> = {}) {
  let view: ToggleView | undefined
  const result = render(UseMachine, { ...props, expose: (v: ToggleView) => (view = v) })
  return { ...result, view: view! }
}

// A connect that also reports a deep reactive prop, read where connect runs.
const connectWithBox: typeof connectToggle = Object.assign(
  (snapshot: Parameters<typeof connectToggle>[0]) => ({
    ...connectToggle(snapshot),
    label: String((snapshot.props as { box?: { n: number } }).box?.n),
  }),
  { reactions: connectToggle.reactions },
)

// The entry action sets what this connect relies on: open => draft is a string.
type Draft = { draft: string | null }
const createDraftConfig = (() => ({
  initial: 'closed',
  context: { count: 0, draft: null },
  states: {
    closed: { on: { toggle: { target: 'open' } } },
    open: { entry: write(() => ({ draft: 'ready' })) },
  },
})) as unknown as typeof createToggleConfig
const connectDraft: typeof connectToggle = Object.assign(
  (snapshot: Parameters<typeof connectToggle>[0]) => ({
    ...connectToggle(snapshot),
    label: snapshot.state === 'open' ? (snapshot.context as unknown as Draft).draft!.trim() : '-',
  }),
  { reactions: connectToggle.reactions },
)

describe('useMachine — lifecycle', () => {
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
      expose: (view: ToggleView) => {
        view.machine.onStart(() => order.push(`start:${mounted()}`))
        view.machine.onStop(() => order.push('stop'))
      },
    })
    expect(order).toEqual(['start:mounted', 'effect:mounted'])
    unmount()
    expect(order).toEqual(['start:mounted', 'effect:mounted', 'stop', 'cleanup'])
  })

  // React runs a parent's unmount cleanups before descending into children.
  it('stops before child components tear down, so their cleanup sends fire no reactions', () => {
    const onOpenChange = vi.fn()
    const { unmount } = mount({ onOpenChange, childSends: { destroy: { type: 'toggle' } } })
    unmount()
    expect(onOpenChange).not.toHaveBeenCalled()
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
    const { view, getByTestId } = mount({ childSends: { mount: { type: 'toggle' } } })
    expect(view.api.open).toBe(true)
    expect(getByTestId('toggle').textContent).toBe('- open 1')
  })

  it('runs connect() once the transition settles, never mid-transition', () => {
    const { view } = mount({ createConfig: createDraftConfig, connect: connectDraft })
    expect(() => view.machine.send({ type: 'toggle' })).not.toThrow()
    expect(view.api.label).toBe('ready')
  })

  // A callback or selector runs inside the notification, after setState but
  // before the entry action: it gets the last settled api, and a selector
  // settles once the send is done.
  it('serves reads from inside a send the last settled api, never a half-applied one', () => {
    const seen: (string | undefined)[] = []
    const { view, getByTestId } = mount({
      createConfig: createDraftConfig,
      connect: connectDraft,
      selectLabel: true,
      onOpenChange: () => seen.push(view.api.label),
    })
    expect(() => view.machine.send({ type: 'toggle' })).not.toThrow()
    expect(seen).toEqual(['-'])
    flushSync()
    expect(getByTestId('selected').textContent).toBe('ready')
  })
})

// Core notifies synchronously, so whatever wakes on a notification would
// otherwise run in the tracking scope of the effect that caused it.
describe('useMachine — notifications from inside an effect', () => {
  it("never lends a machine listener's reads to the effect that sent", () => {
    const box = makeBox()
    const inEffect = vi.fn((view: ToggleView) => view.machine.send({ type: 'toggle' }))
    render(UseMachine, {
      inEffect,
      expose: (view: ToggleView) => view.machine.subscribe(() => void box.n),
    })
    box.n = 5 // read by the listener, never by the effect
    flushSync()
    expect(inEffect).toHaveBeenCalledOnce()
  })

  it("never lends a reaction callback's reads or writes to the effect that sent", () => {
    const log = makeBox()
    const onOpenChange = vi.fn(() => log.n++) // reads and writes state, like a counter
    const { view } = mount({
      onOpenChange,
      inEffect: (v: ToggleView) => v.machine.send({ type: 'toggle' }),
    })
    flushSync()
    expect(onOpenChange).toHaveBeenCalledOnce() // no self-invalidating loop
    expect(view.api.open).toBe(true)
  })

  // Not every notification is a send through `view.machine`: a core effect can
  // set context from an external store, and an action sends with the
  // machine's own `send`.
  it("never lends a reaction callback's reads to an effect that changed the machine another way", () => {
    const box = makeBox()
    const external = createStore({ n: 0 })
    const createConfig = (() => ({
      initial: 'closed',
      context: { count: 0 },
      states: {
        closed: {
          effects: [
            ({ setContext }: { setContext: (patch: { count: number }) => void }) =>
              external.subscribe(({ n }) => setContext({ count: n })),
          ],
          on: { toggle: { target: 'open' } },
        },
        open: { on: { toggle: { target: 'closed' } } },
      },
      watch: {
        count: [({ send }: { send: (e: { type: 'toggle' }) => void }) => send({ type: 'toggle' })],
      },
    })) as unknown as typeof createToggleConfig
    const onCount = vi.fn(() => box.n)
    const connect: typeof connectToggle = Object.assign(
      (s: Parameters<typeof connectToggle>[0]) => connectToggle(s),
      {
        reactions: [
          ...(connectToggle.reactions ?? []),
          [(m: ToggleMachine) => m.context.count, () => onCount()],
        ] as typeof connectToggle.reactions,
      },
    )
    const onOpenChange = vi.fn(() => box.n)
    const inEffect = vi.fn(() => external.set({ n: 1 }))
    const { view } = mount({ createConfig, connect, onOpenChange, inEffect })
    expect([onCount, onOpenChange].map(fn => fn.mock.calls.length)).toEqual([1, 1])
    box.n = 5 // read by both callbacks, never by the effect
    flushSync()
    expect(inEffect).toHaveBeenCalledOnce()
    expect(view.api.open).toBe(true)
  })
})

// A send settles before anything learns it happened: reads inside it see the
// last settled api, and whatever they computed is refreshed once it ends.
describe('useMachine — reads during a send', () => {
  it('refreshes a slice re-read mid-send once the send settles', () => {
    let view: ToggleView | undefined
    const { getByTestId } = render(SliceParent, { expose: (v: ToggleView) => (view = v) })
    view!.machine.send({ type: 'toggle' }) // the leaf's notification re-reads the slice
    flushSync()
    expect(getByTestId('parent').textContent).toBe('true')
    expect(getByTestId('leaf').textContent).toBe('open:1')
  })

  it('shows a send the snapshot the previous send in the same tick settled to', () => {
    const seen: { open: boolean; count: number }[] = []
    const { view } = mount({
      onOpenChange: () => seen.push({ open: view.api.open, count: view.api.count }),
    })
    view.machine.send({ type: 'toggle' }) // → open, count 1
    view.machine.send({ type: 'toggle' }) // → closed, read while in flight
    expect(seen).toEqual([
      { open: false, count: 0 },
      { open: true, count: 1 },
    ])
  })

  it('lets the api catch up after a send that throws', () => {
    const createConfig = (() => ({
      initial: 'closed',
      context: { count: 0 },
      states: {
        closed: {
          on: {
            toggle: {
              target: 'open',
              actions: [
                write(($: { context: { count: number } }) => ({ count: $.context.count + 1 })),
                () => {
                  throw new Error('boom')
                },
              ],
            },
          },
        },
        open: {},
      },
    })) as unknown as typeof createToggleConfig
    const { view, getByTestId } = mount({ createConfig })
    expect(() => view.machine.send({ type: 'toggle' })).toThrow('boom')
    flushSync()
    expect(getByTestId('toggle').textContent).toBe('- closed 1') // the count it did write
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

  // setProps compares shallowly on every target; the docs say to pass a new reference.
  it('sees props by reference: a replaced value reaches the api, an in-place mutation does not', async () => {
    const box = makeBox()
    const { view, rerender } = mount({ connect: connectWithBox, box })
    box.n = 1
    flushSync()
    expect(view.api.label).toBe('0')
    await rerender({ box: { n: 2 } })
    expect(view.api.label).toBe('2')
  })

  it('value-dedups: a re-render with equal props does not churn the snapshot', async () => {
    const { view, rerender } = mount({ label: 'x' })
    const before = view.api
    await rerender({ label: 'x' }) // fresh props object, equal values
    expect(view.api).toBe(before)
  })
})

describe('useMachine — component effects', () => {
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

  it('compares deps like React (Object.is): NaN stays equal, -0 differs from 0', async () => {
    const fn = vi.fn()
    const { rerender } = mount({ delay: NaN, effects: [[fn, ['delay']]] })
    await rerender({ label: 'b' }) // an unrelated change re-reads the NaN dep
    expect(fn).toHaveBeenCalledTimes(1)
    await rerender({ delay: 0 })
    await rerender({ delay: -0 })
    expect(fn).toHaveBeenCalledTimes(3)
  })

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
