import type { Selection } from './types'

/**
 * The one home for value-deduped selection semantics: seed prev at subscribe,
 * re-select on every wake, notify only when the value changed (Object.is or a
 * supplied equality). `attach` supplies the wake source — the machine broadcast, a
 * composition's members — and returns the detach.
 */
export function makeSelection<Value>(
  selector: () => Value,
  attach: (onWake: () => void) => () => void,
): Selection<Value> {
  return {
    get value() {
      return selector()
    },
    subscribe(listener, equals = Object.is) {
      let prev = selector()
      return attach(() => {
        const next = selector()
        if (equals(prev, next)) return
        prev = next
        listener(next)
      })
    },
  }
}
