import type { Connect, Connector, Machine } from './types'

/**
 * Wrap a machine + its pure connect() into a live, memoized snapshot.
 * The snapshot recomputes lazily on any machine change or props change.
 * The connector is PASSIVE — the bridge owns lifecycle.
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

  const listeners = new Set<() => void>()
  const wake = () => {
    dirty = true
    for (const l of [...listeners]) l()
  }
  const offWake = service.subscribe(wake)

  // Wire reactions on start(), tear them down on stop() — so a restart (e.g. StrictMode
  // mount→unmount→mount) cleanly re-establishes them.
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
