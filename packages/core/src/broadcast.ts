/** Payload-less one-to-all notify: add listeners, wake them all, drop them all. */
export interface Broadcast {
  add: (listener: () => void) => () => void
  notify: () => void
  clear: () => void
}

/**
 * Steady-state notifies allocate nothing: iteration runs over a cached snapshot,
 * re-derived only when membership changes. Mid-pass (un)subscribes still take
 * effect within the pass — a dirty flag flips iteration to membership-checked
 * mode, and since a nested notify() clears that flag, a swapped snapshot
 * (rebuilds always allocate anew) counts as mid-pass churn too.
 */
export function makeBroadcast(): Broadcast {
  const listeners = new Set<() => void>()
  let snapshot: Array<() => void> = []
  let dirty = false
  return {
    add(listener) {
      listeners.add(listener)
      dirty = true
      return () => {
        listeners.delete(listener)
        dirty = true
      }
    },
    notify() {
      if (dirty) {
        snapshot = [...listeners]
        dirty = false
      }
      const snap = snapshot
      for (const l of snap) {
        if ((!dirty && snap === snapshot) || listeners.has(l)) l()
      }
    },
    clear() {
      listeners.clear()
      dirty = true
    },
  }
}
