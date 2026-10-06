// @vitest-environment jsdom
// An effect error no errorHandler catches. Its own file: once an error escapes a flush, Vue's
// post-flush queue stays stuck for the rest of the module graph, which would break any test
// that ran after it.
import { createApp, defineComponent } from 'vue'
import { expect, it, vi } from 'vitest'
import { type ComponentEffect, useMachine } from '@dunky.dev/vue-state-machine'
import {
  connectToggle,
  createToggleConfig,
  type ToggleMachine,
  type ToggleProps,
} from './fixtures/toggle'

it('starts every effect before Vue rethrows the failure', () => {
  const started: string[] = []
  const effects: ComponentEffect<ToggleMachine, ToggleProps>[] = [
    [
      () => {
        throw new Error('effect failed')
      },
      [],
    ],
    [() => void started.push('next'), []],
  ]
  const Comp = defineComponent({
    setup() {
      const props: ToggleProps = {}
      useMachine(createToggleConfig, connectToggle, effects, props)
      return () => null
    },
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {}) // Vue's "unhandled error" notice
  expect(() => createApp(Comp).mount(document.createElement('div'))).toThrow('effect failed')
  expect(started).toEqual(['next'])
})
