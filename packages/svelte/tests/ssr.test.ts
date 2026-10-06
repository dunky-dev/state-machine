/**
 * Server rendering (`svelte/server`): `$effect`s never run there, so a
 * component renders its initial snapshot without starting the machine or
 * running its effects, and spread bindings serialize as the client writes them.
 */
import { render } from 'svelte/server'
import { describe, expect, it, vi } from 'vitest'
import { mergeProps, normalize } from '@dunky.dev/svelte-state-machine'
import Spread from './fixtures/spread.svelte'
import UseMachine from './fixtures/use-machine.svelte'
import UseSelector from './fixtures/use-selector.svelte'
import { makeCounters, type CountersMachine } from './fixtures/counters'
import type { ToggleMachine } from './fixtures/toggle'

describe('svelte — server rendering', () => {
  it('renders the initial snapshot without starting the machine or running effects', () => {
    const effect = vi.fn()
    let machine: ToggleMachine | undefined
    const { body } = render(UseMachine, {
      props: {
        label: 'ssr',
        effects: [[effect, []]],
        expose: (view: { machine: ToggleMachine }) => (machine = view.machine),
      },
    })

    const started = vi.fn()
    machine!.onStart(started) // fires immediately on a running machine
    expect(started).not.toHaveBeenCalled()
    expect(effect).not.toHaveBeenCalled()
    expect(body).toContain('ssr closed 0')
  })

  it('renders the snapshot a send during script init produced', () => {
    const { body } = render(UseMachine, { props: { label: 'ssr', sendAtInit: { type: 'toggle' } } })
    expect(body).toContain('ssr open 1')
  })

  it('renders the selection a send during script init produced', () => {
    const { body } = render(UseSelector, {
      props: {
        machine: makeCounters(),
        pick: (m: CountersMachine) => m.context.a,
        sendAtInit: { type: 'incA' },
      },
    })
    expect(body).toContain('>1</span>')
  })

  it('serializes spread bindings like the client: ARIA tokens, tabindex, merged class, no handlers', () => {
    const attrs = mergeProps(
      { class: ['a', { b: true }] },
      normalize({ expanded: false, hidden: true, focusable: false, onPress: () => {}, class: 'c' }),
    )
    const { body } = render(Spread, { props: { attrs } })
    for (const attr of [
      'aria-expanded="false"',
      'aria-hidden="true"',
      'tabindex="-1"',
      'class="a b c"',
    ]) {
      expect(body).toContain(attr)
    }
    expect(body).not.toContain('onclick')
  })
})
