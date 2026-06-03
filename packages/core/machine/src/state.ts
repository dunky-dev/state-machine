import { signal } from '@preact/signals-core'
import type { State, StateNode } from './types'

/**
 * Flat states (one active state, a plain string). A state declares `tags` so
 * consumers can query a category rather than a name. `state` / `hasTag` /
 * `matches` are tracked signal reads — reading them inside a tracked scope
 * subscribes the reader.
 */
export function createState<T extends string>(
  initial: NoInfer<T>,
  nodes: Record<T, StateNode>,
): State<T> {
  const stateSig = signal<T>(initial)

  // Precompute each state's tag set once (lookup is per-read, must be cheap).
  const tagsOf = {} as Record<T, ReadonlySet<string>>
  for (const name in nodes) {
    tagsOf[name as T] = new Set(nodes[name as T].tags ?? [])
  }

  return {
    get state() {
      return stateSig.value
    },
    hasTag(tag: string) {
      return tagsOf[stateSig.value].has(tag)
    },
    matches(name: T) {
      return stateSig.value === name
    },
    set(next: T) {
      stateSig.value = next // Object.is dedup is built into the signal
    },
  }
}
