import type { ComputedDefs } from './types'

export interface ComputedHost<State extends string, Context, Computed> {
  context: () => Context
  computed: () => Computed
  state: () => State
}

/**
 * Define computed getters on `target` with read-key tracking: each def records which
 * context/computed keys it read and recomputes only when one of those inputs changed.
 * Defined onto the SAME object the machine exposes as `this.computed` so computed→computed
 * chains resolve in place.
 */
export function defineComputed<State extends string, Context extends object, Computed>(
  target: Computed,
  defs: ComputedDefs<State, Context, Computed>,
  host: ComputedHost<State, Context, Computed>,
): void {
  // Dep keys are runtime strings, so all dep reads are string-indexed — widen once here
  // instead of casting at every read site. The proxy target is inert (traps never touch it).
  const contextOf = host.context as () => Record<string, unknown>
  const computedOf = host.computed as () => Record<string, unknown>
  const proxyTarget: Record<string, unknown> = {}

  for (const key in defs) {
    const k = key as keyof Computed
    const def = defs[k]
    let computedOnce = false
    let cachedValue: Computed[keyof Computed]
    let readState = false
    let stateSnapshot: State | undefined

    // Parallel dep-key/dep-value buffers, reused across recomputes — a recompute
    // allocates nothing. Values are captured AT read time inside the tracking
    // proxies, so no post-pass re-reads (and re-validates) what was just computed.
    const ctxDeps: string[] = []
    const ctxVals: unknown[] = []
    const computedDeps: string[] = []
    const computedVals: unknown[] = []

    // True during recompute so proxy reads record deps and `params.state` records
    // a state dependency. Deps are few, so the includes() dedup beats a Set.
    let tracking = false
    const trackedCtx = new Proxy(proxyTarget, {
      get: (_t, p: string) => {
        const value = contextOf()[p]
        if (tracking && !ctxDeps.includes(p)) {
          ctxDeps.push(p)
          ctxVals.push(value)
        }
        return value
      },
    }) as Context

    const trackedComputed = new Proxy(proxyTarget, {
      get: (_t, p: string) => {
        const value = computedOf()[p]
        if (tracking && !computedDeps.includes(p)) {
          computedDeps.push(p)
          computedVals.push(value)
        }
        return value
      },
    }) as Computed

    // The def params never change shape — build them once, not per recompute.
    const params = {
      context: trackedCtx,
      computed: trackedComputed,
      get state() {
        if (tracking) readState = true
        return host.state()
      },
    }

    const stale = (): boolean => {
      if (readState && stateSnapshot !== host.state()) return true
      const ctx = contextOf()

      let i = 0
      while (i < ctxDeps.length) {
        if (!Object.is(ctxVals[i], ctx[ctxDeps[i]!])) return true
        i++
      }

      // Reading a computed dep resolves ITS staleness first — transitive changes surface here.
      const computed = computedOf()
      i = 0
      while (i < computedDeps.length) {
        if (!Object.is(computedVals[i], computed[computedDeps[i]!])) return true
        i++
      }
      return false
    }

    Object.defineProperty(target, k, {
      enumerable: true,
      get: () => {
        if (computedOnce && !stale()) return cachedValue
        ctxDeps.length = 0
        ctxVals.length = 0
        computedDeps.length = 0
        computedVals.length = 0
        readState = false
        tracking = true
        let completed = false
        try {
          cachedValue = def(params) as Computed[keyof Computed]
          completed = true
        } finally {
          tracking = false
          // A throwing def leaves the buffers half-filled — force the next read to recompute.
          computedOnce = completed
        }
        stateSnapshot = readState ? host.state() : undefined
        return cachedValue
      },
    })
  }
}
