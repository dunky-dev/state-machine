/**
 * setup() — the name-checking authoring builder.
 *
 * Pins: setup<Ctx,Ev,Cm>().config(registries).createMachine(config) returns a
 * config that (a) merges the registries into implementations so names resolve at
 * runtime, and (b) type-checks every named guard / action / effect / after-delay
 * reference against the registry keys at the definition site. The lightweight
 * setup().createMachine(literal) path (no registries) also builds a valid config.
 * The @ts-expect-error blocks are part of the contract: each must be a COMPILE
 * error (an unused directive fails tsc), so the suite's typecheck
 * (`tsc -p tsconfig.jest.json`) is what enforces (b).
 */
import { describe, expect, it, vi } from 'vitest'
import { machine, setup } from '../src'

type Ctx = { id: string; openMs: number; open: boolean }
type Ev = { type: 'open' } | { type: 'close' } | { type: 'toggle' }

describe('setup()', () => {
  it('lightweight path: setup().createMachine(literal) builds a valid config, types inferred', () => {
    const cfg = setup().createMachine({
      initial: 'closed',
      context: { count: 0 },
      states: {
        closed: { on: { open: { target: 'open' } } },
        open: { on: { close: { target: 'closed' } } },
      },
    })
    const m = machine(cfg)
    m.start()
    expect(m.state).toBe('closed')
    // inferred narrow types compile:
    const s: 'closed' | 'open' = m.state
    const n: number = m.context.count
    expect([s, n]).toEqual(['closed', 0])
  })

  it('runs with names resolved at runtime via merged registries', () => {
    const setId = vi.fn()
    const track = vi.fn(() => () => {})

    const { createMachine } = setup<Ctx, Ev>().config({
      guards: { isOpen: ({ context }) => context.open },
      actions: { setId: ({ context }) => setId(context.id) },
      effects: { track: () => track() },
      delays: { openDelay: ({ context }) => context.openMs },
    })

    const cfg = createMachine({
      initial: 'closed',
      context: { id: 'a', openMs: 5, open: false },
      states: {
        closed: { on: { open: { target: 'open' } } },
        open: {
          entry: ['setId'], // checked action name
          effects: ['track'], // checked effect name
          after: { openDelay: { target: 'closed' }, 200: { target: 'closed' } }, // delay name + number
          on: { close: { target: 'closed', guard: 'isOpen' } }, // checked guard name
        },
      },
    })

    const m = machine(cfg)
    m.start()
    expect(m.state).toBe('closed')

    m.send({ type: 'open' })
    expect(m.state).toBe('open')
    expect(setId).toHaveBeenCalledWith('a') // entry action ran
    expect(track).toHaveBeenCalledTimes(1) // effect booted on enter
  })

  it('checks names at compile time (the @ts-expect-error blocks are the test)', () => {
    const { createMachine } = setup<Ctx, Ev>().config({
      guards: { isOpen: ({ context }) => context.open },
      actions: { setId: () => {} },
      effects: { track: () => () => {} },
      delays: { openDelay: ({ context }) => context.openMs },
    })

    createMachine({
      initial: 'open',
      context: { id: 'a', openMs: 1, open: true },
      states: {
        // @ts-expect-error 'setd' is not a registered action name
        open: { entry: ['setd'] },
      },
    })
    createMachine({
      initial: 'open',
      context: { id: 'a', openMs: 1, open: true },
      states: {
        // @ts-expect-error 'trakc' is not a registered effect name
        open: { effects: ['trakc'] },
      },
    })
    createMachine({
      initial: 'open',
      context: { id: 'a', openMs: 1, open: true },
      states: {
        open: {
          // @ts-expect-error 'isOpn' is not a registered guard name
          on: { close: { target: 'open', guard: 'isOpn' } },
        },
      },
    })
    createMachine({
      initial: 'open',
      context: { id: 'a', openMs: 1, open: true },
      states: {
        // @ts-expect-error 'opnDelay' is not a registered delay name
        open: { after: { opnDelay: { target: 'open' } } },
      },
    })

    expect(true).toBe(true) // the assertion is the compile, above
  })

  it('valid names + numeric delays coexist, and inline fns still work', () => {
    const { createMachine } = setup<Ctx, Ev>().config({
      guards: { isOpen: ({ context }) => context.open },
    })

    const cfg = createMachine({
      initial: 'open',
      context: { id: 'a', openMs: 1, open: true },
      states: {
        open: {
          // inline action fn alongside the checked-name world
          entry: [({ context }) => void context.id],
          on: {
            // guard name (checked) OR inline guard — both allowed
            close: [
              { target: 'open', guard: 'isOpen' },
              { target: 'open', guard: ({ context }) => context.openMs > 0 },
            ],
          },
        },
      },
    })

    const m = machine(cfg)
    m.start()
    expect(m.state).toBe('open')
  })
})
