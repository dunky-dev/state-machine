import { batch, signal, type Signal } from '@preact/signals-core'

/**
 * Build the reactive context from a plain initial object.
 *
 * Returns:
 *   - `context`: a read view. `context.field` is a getter over the field's
 *     signal — reading it inside a tracked scope subscribes the reader to just
 *     that field.
 *   - `setContext(patch)`: the single write entry point. Batched so a
 *     multi-field patch notifies each subscriber at most once; signals' own
 *     Object.is skips no-op writes.
 *
 * The setup loop runs once per machine (never on read/write), so per-read cost
 * is a plain accessor — no Proxy.
 */
export function createContext<Context extends object>(
  initial: Context,
): {
  context: Context
  setContext: (patch: Partial<Context>) => void
} {
  const cells = {} as { [K in keyof Context]: Signal<Context[K]> }
  const context = {} as Context

  for (const key in initial) {
    const k = key as keyof Context
    const cell = signal(initial[k])
    cells[k] = cell
    Object.defineProperty(context, k, {
      get: () => cell.value,
      enumerable: true,
      configurable: false,
    })
  }

  const setContext = (patch: Partial<Context>) => {
    batch(() => {
      for (const key in patch) {
        const cell = cells[key as keyof Context]
        if (cell) cell.value = patch[key as keyof Context]!
      }
    })
  }

  return { context, setContext }
}
