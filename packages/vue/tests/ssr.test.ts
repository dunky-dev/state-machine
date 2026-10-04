/**
 * Server rendering, in plain Node (no DOM). `renderToString` runs only setup
 * and render: the machine must never start, no ComponentEffect may run (a DOM
 * listener would crash here), and the markup carries the current snapshot
 * with its ARIA values serialized.
 */
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it, vi } from 'vitest'
import {
  type ComponentEffect,
  normalize,
  useMachine,
  useSelector,
} from '@dunky.dev/vue-state-machine'
import {
  connectToggle,
  createToggleConfig,
  type ToggleMachine,
  type ToggleProps,
} from './fixtures/toggle'

describe('server rendering', () => {
  it('renders the current snapshot without starting the machine or running effects', async () => {
    const onStart = vi.fn()
    const escapeListener: ComponentEffect<ToggleMachine, ToggleProps> = [
      vi.fn(() => {
        const onKeyDown = () => {}
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }),
      [],
    ]
    const Toggle = defineComponent({
      setup() {
        const props: ToggleProps = { label: 'Menu' }
        const { api, machine } = useMachine(
          createToggleConfig,
          connectToggle,
          [escapeListener],
          props,
        )
        machine.onStart(onStart)
        const open = useSelector(machine, () => machine.matches('open'))
        return () => h('button', normalize(api.value.trigger), `${api.value.label}: ${open.value}`)
      },
    })

    const html = await renderToString(createSSRApp(Toggle))
    expect(html).toBe(
      '<button role="button" tabindex="0" aria-expanded="false" aria-controls="toggle-panel">Menu: false</button>',
    )
    expect(escapeListener[0]).not.toHaveBeenCalled()
    expect(onStart).not.toHaveBeenCalled()
  })
})
