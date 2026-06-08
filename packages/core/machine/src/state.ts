import type { State, StateNode } from './types'

/**
 * Flat tagged states. One active state, a plain string. A state declares `tags`
 * so consumers can query a category rather than a name. `state` / `hasTag` /
 * `matches` are plain reads; `set` changes the state and, on a real change,
 * calls `notify()` so observers re-evaluate (no-op transitions don't notify).
 *
 * Tag sets are derived purely from the STATIC `nodes` map, so they're computed
 * once here per state (a Set per state). When `nodes` is reused across many
 * instances (the common case), pass a shared precomputed `tagsOf` — see
 * `tagsForNodes` — so the Sets aren't rebuilt per instance.
 */
export function createState<T extends string>(
  initial: NoInfer<T>,
  nodes: Record<T, StateNode>,
  notify: () => void = () => {},
  tagsOf: Record<T, ReadonlySet<string>> = tagsForNodes(nodes),
): State<T> {
  let current = initial
  return {
    get state() {
      return current
    },
    hasTag(tag: string) {
      return tagsOf[current].has(tag)
    },
    matches(name: T) {
      return current === name
    },
    set(next: T) {
      if (next === current) return
      current = next
      notify()
    },
  }
}

// Per-`nodes` tag-set cache: tags depend only on the static node map, so compute
// them once per map and share across every machine built from it (keeps
// per-instance memory flat as state count grows). Keyed by the nodes object.
const tagsCache = new WeakMap<object, Record<string, ReadonlySet<string>>>()
export function tagsForNodes<T extends string>(
  nodes: Record<T, StateNode>,
): Record<T, ReadonlySet<string>> {
  let tags = tagsCache.get(nodes) as Record<T, ReadonlySet<string>> | undefined
  if (!tags) {
    tags = {} as Record<T, ReadonlySet<string>>
    for (const name in nodes) tags[name as T] = new Set(nodes[name as T].tags ?? [])
    tagsCache.set(nodes, tags)
  }
  return tags
}
