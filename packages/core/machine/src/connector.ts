import type { Connect, Connector, Machine } from './types'

/**
 * Wrap a machine + its pure connect() into a live snapshot. `props` is a
 * reactive input: pass the initial value, push changes via setProps().
 *
 * connect() is a pure mapping (snapshot → view-facing api). The connector keeps
 * that mapping live: it memoizes connect's output so the snapshot identity is
 * stable until an input changes (no useSyncExternalStore infinite loop), reads
 * machine state through live getters (no tearing), makes consumer `props` a
 * reactive input (a props change recomputes the snapshot and wakes subscribers),
 * and is PASSIVE — the bridge owns lifecycle.
 *
 * The snapshot recomputes on EITHER input: a machine change (via the machine's
 * coarse subscribe) or a props change (via setProps). Both bump an internal
 * revision; the memoized snapshot is rebuilt lazily on the next read.
 */
export function connector<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Props,
  Api,
  Computed = Record<string, never>,
>(
  service: Machine<State, Context, Event, Computed>,
  connect: Connect<State, Context, Event, Props, Api, Computed>,
  initialProps: Props,
): Connector<State, Context, Api, Props, Computed> {
  let props = initialProps

  // Lazily memoized snapshot. `dirty` is set on any machine change or props
  // change; the next `snapshot` read rebuilds and caches. Stable identity while
  // clean → safe as a useSyncExternalStore getSnapshot.
  let cached: Api
  let dirty = true
  const rebuild = (): Api =>
    connect({
      get state() {
        return service.state
      },
      get context() {
        return service.context
      },
      get computed() {
        return service.computed
      },
      get props() {
        return props
      },
      send: service.send,
    })
  const snapshot = (): Api => {
    if (dirty) {
      cached = rebuild()
      dirty = false
    }
    return cached
  }

  // Coarse listeners on this connector. A machine change or a props change marks
  // the snapshot dirty and wakes them. We subscribe to the machine once and fan
  // its notifications (plus props changes) out to connector subscribers.
  const listeners = new Set<() => void>()
  const wake = () => {
    dirty = true
    for (const l of [...listeners]) l()
  }
  // The machine's coarse subscribe drives snapshot invalidation. Held for the
  // connector's life and released by destroy() (passive — the bridge still owns
  // start/stop).
  const offWake = service.subscribe(wake)

  // Reactions (declared state-change → prop-callback) live exactly as long as the
  // machine runs: wired on every start(), torn down on stop(). Hooking the
  // machine's own lifecycle (not the connector's construction) means a restart —
  // notably React StrictMode's mount→unmount→mount — cleanly re-establishes them.
  let reactionOffs: Array<() => void> = []
  const offStart = service.onStart(() => {
    reactionOffs = (connect.reactions ?? []).map(([selector, callback]) => {
      const sel = service.select(() => selector(service))
      return sel.subscribe(value => callback(value, props))
    })
  })
  const offStop = service.onStop(() => {
    for (const off of reactionOffs) off()
    reactionOffs = []
  })

  return {
    get snapshot() {
      return snapshot()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    select: service.select,
    setProps(next) {
      // Value-dedup: consumers often rebuild an equal props object every render
      // (new identity, same values). Skip the wake when shallow-equal so an equal
      // re-render doesn't needlessly recompute the snapshot or wake subscribers.
      if (shallowEqual(props, next)) return
      props = next
      wake()
    },
    destroy() {
      offWake()
      offStart()
      offStop()
      for (const off of reactionOffs) off()
      reactionOffs = []
      listeners.clear()
    },
  }
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false
  const ak = Object.keys(a as object)
  const bk = Object.keys(b as object)
  if (ak.length !== bk.length) return false
  for (const k of ak) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false
    }
  }
  return true
}
