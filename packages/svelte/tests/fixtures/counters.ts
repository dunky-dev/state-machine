import { act, machine, type TransitionConfig } from '@dunky.dev/state-machine'

/** Two independent counters, so a selector over `a` can be shown to ignore `b`. */
export type CountersContext = { a: number; b: number }
export type CountersEvent = { type: 'incA' } | { type: 'incB' }

const config: TransitionConfig<'idle', CountersContext, CountersEvent> = {
  initial: 'idle',
  context: { a: 0, b: 0 },
  states: {
    idle: {
      on: {
        // Writes go through `act` (setContext) so the bus notifies — a raw
        // in-place `context.a++` mutates the value but never wakes subscribers.
        incA: act($ => ({ a: $.context.a + 1 })),
        incB: act($ => ({ b: $.context.b + 1 })),
      },
    },
  },
}

export const makeCounters = () => {
  const m = machine(config)
  m.start()
  return m
}
