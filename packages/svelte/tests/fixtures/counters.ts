import { act as write, machine, type TransitionConfig } from '@dunky.dev/state-machine'

// Two independent counters, so a selection over `a` can be shown to ignore `b`.
type CountersEvent = { type: 'incA' } | { type: 'incB' } | { type: 'noop' }
interface CountersContext {
  a: number
  b: number
}

const config: TransitionConfig<'idle', CountersContext, CountersEvent> = {
  initial: 'idle',
  context: { a: 0, b: 0 },
  states: {
    idle: {
      on: {
        // Writes go through `act` (setContext) so the bus notifies — a raw
        // in-place `context.a++` mutates the value but never wakes subscribers.
        incA: write($ => ({ a: $.context.a + 1 })),
        incB: write($ => ({ b: $.context.b + 1 })),
        noop: () => {},
      },
    },
  },
}

export type CountersMachine = ReturnType<typeof machine<'idle', CountersContext, CountersEvent>>

export const makeCounters = (): CountersMachine => {
  const m = machine(config)
  m.start()
  return m
}
