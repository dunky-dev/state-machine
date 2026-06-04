import { signal } from '@preact/signals-core'
import type { Connect, Connector, Machine } from './types'

/**
 * Wrap a machine + its pure connect() into a live snapshot. `props` is a
 * reactive input: pass the initial value, push changes via setProps().
 *
 * connect() is a pure mapping (snapshot → view-facing api). The connector is the
 * reactive plumbing that keeps that mapping live: it memoizes connect's output
 * so its identity is stable until inputs change (no useSyncExternalStore
 * infinite loop), reads machine state through live getters (no tearing), makes
 * consumer `props` a reactive input (a props change recomputes the snapshot and
 * wakes subscribers), and is PASSIVE — it forwards subscribe/select but never
 * self-subscribes; the bridge owns lifecycle.
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
  // props as a signal → a props change invalidates the memoized snapshot and
  // trips the coarse subscribe, same as a context/state change.
  const propsSig = signal(initialProps)

  // The snapshot is a memoized Selection over connect's output: its identity is
  // stable until connect's inputs (state/context/computed/props) change.
  const snap = service.select(() =>
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
        return propsSig.value
      },
      send: service.send,
    }),
  )

  // Reactions (declared state-change → prop-callback) live exactly as long as
  // the machine runs: wired on every start(), torn down on stop(). Hooking the
  // machine's own lifecycle (not the connector's construction) means a restart —
  // notably React StrictMode's mount→unmount→mount — cleanly re-establishes them
  // without the bridge threading any teardown. Symmetric with effects/watchers.
  let reactionOffs: Array<() => void> = []
  service.onStart(() => {
    reactionOffs = (connect.reactions ?? []).map(([selector, callback]) => {
      const sel = service.select(() => selector(service))
      return sel.subscribe(value => callback(value, propsSig.value))
    })
  })
  service.onStop(() => {
    for (const off of reactionOffs) off()
    reactionOffs = []
  })

  return {
    get snapshot() {
      return snap.value
    },
    // Coarse: wake whenever the snapshot recomputes — i.e. on any state /
    // context / computed / props change (connect returns a fresh object each
    // time, so the Selection's Object.is dedup never suppresses a real change).
    // The value arg is dropped; coarse listeners take none.
    subscribe(listener) {
      return snap.subscribe(() => listener())
    },
    select: service.select,
    setProps(props) {
      // Value-dedup: consumers often rebuild an equal props object every render
      // (new identity, same values). Writing the signal then would needlessly
      // recompute the snapshot and wake every subscriber. Skip when shallow-equal.
      if (shallowEqual(propsSig.peek(), props)) return
      propsSig.value = props
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
