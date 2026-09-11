import { makeBroadcast } from './broadcast'
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
  // Built once — the getters read live values, so every rebuild can reuse the same object.
  const connectArg = {
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
  }
  const snapshot = (): Api => {
    if (dirty) {
      cached = connect(connectArg)
      dirty = false
    }
    return cached
  }

  const broadcast = makeBroadcast()
  const wake = () => {
    dirty = true
    broadcast.notify()
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
      return broadcast.add(listener)
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
      broadcast.clear()
    },
  }
}

// Runs on every render (setProps) — two for..in passes with a key counter, no key arrays.
function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  let extraKeys = 0
  for (const k in left) {
    if (!Object.is(left[k], right[k])) return false
    extraKeys++
  }
  for (const _ in right) extraKeys--
  return extraKeys === 0
}
