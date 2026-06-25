import type { ComputedDefs } from './types'

export interface ComputedHost<State extends string, Context, Computed> {
  context: () => Context
  computed: () => Computed
  state: () => State
}

/**
 * Install computed getters on `target` with read-key tracking: each def records which
 * context/computed keys it read and recomputes only when one of those inputs changed.
 * Installs onto the SAME object the machine exposes as `this.computed` so computed→computed
 * chains resolve in place.
 */
export function installComputed<State extends string, Context extends object, Computed>(
  target: Computed,
  defs: ComputedDefs<State, Context, Computed>,
  host: ComputedHost<State, Context, Computed>,
): void {
  for (const key in defs) {
    const k = key as keyof Computed
    const def = defs[k]
    let computedOnce = false
    let cachedValue: Computed[keyof Computed]
    let ctxDeps: string[] = []
    let computedDeps: string[] = []
    let ctxSnapshot: Record<string, unknown> = {}
    let computedSnapshot: Record<string, unknown> = {}
    let readState = false
    let stateSnapshot: State | undefined

    // Tracking proxies built once per computed; each get records the key into the current read-set.
    let ctxRead: Set<string> | null = null
    let computedRead: Set<string> | null = null
    // True during recompute so reading `params.state` records a state dependency.
    let tracking = false
    const trackedCtx = new Proxy({} as Record<string, unknown>, {
      get: (_t, p: string) => {
        ctxRead?.add(p)
        return (host.context() as Record<string, unknown>)[p]
      },
    }) as Context
    const trackedComputed = new Proxy({} as Record<string, unknown>, {
      get: (_t, p: string) => {
        computedRead?.add(p)
        return (host.computed() as Record<string, unknown>)[p]
      },
    }) as Computed

    const stale = (): boolean => {
      if (readState && stateSnapshot !== host.state()) return true
      for (const dk of ctxDeps) {
        if (!Object.is(ctxSnapshot[dk], (host.context() as Record<string, unknown>)[dk]))
          return true
      }
      // Reading a computed dep resolves ITS staleness first — transitive changes surface here.
      for (const dk of computedDeps) {
        if (!Object.is(computedSnapshot[dk], (host.computed() as Record<string, unknown>)[dk]))
          return true
      }
      return false
    }

    Object.defineProperty(target, k, {
      enumerable: true,
      get: () => {
        if (computedOnce && !stale()) return cachedValue
        const cr = new Set<string>()
        const compr = new Set<string>()
        ctxRead = cr
        computedRead = compr
        readState = false
        tracking = true
        try {
          cachedValue = def({
            context: trackedCtx,
            computed: trackedComputed,
            get state() {
              if (tracking) readState = true
              return host.state()
            },
          }) as Computed[keyof Computed]
        } finally {
          ctxRead = null
          computedRead = null
          tracking = false
        }
        ctxDeps = [...cr]
        computedDeps = [...compr]
        stateSnapshot = readState ? host.state() : undefined
        ctxSnapshot = {}
        for (const dk of ctxDeps) ctxSnapshot[dk] = (host.context() as Record<string, unknown>)[dk]
        computedSnapshot = {}
        for (const dk of computedDeps) {
          computedSnapshot[dk] = (host.computed() as Record<string, unknown>)[dk]
        }
        computedOnce = true
        return cachedValue
      },
    })
  }
}
