import type { ComputedDefs } from './types'

/**
 * Live accessors into the host machine. Computed defs read the CURRENT context /
 * computed bag / state through these — never a snapshot. Supplied once at
 * install.
 */
export interface ComputedHost<State extends string, Context, Computed> {
  /** The live context object (re-read every access). */
  context: () => Context
  /** The live computed bag (so a computed can depend on another computed). */
  computed: () => Computed
  /** The live state value (reading it makes the lifecycle a tracked dependency). */
  state: () => State
}

/**
 * Install the computed bag onto `target` with read-key tracking: each def records
 * exactly which context keys and which other computeds it read (via a tracking
 * proxy on first/every recompute), and only recomputes when one of THOSE inputs
 * changed — not on any context write. This keeps signal-level laziness (an
 * expensive computed in a churny machine doesn't recompute when an unrelated
 * field moves) without per-field reactive cells. Chains resolve transitively and
 * glitch-free: a dep on another computed is checked by reading that computed
 * (which lazily recomputes itself first if stale).
 *
 * Defined as a property installer (rather than returning a new object) so the
 * machine can hand in the SAME object it exposes as `this.computed` — the
 * `host.computed()` accessor and the installed getters then reference one bag,
 * which is what makes computed→computed chains resolve in place.
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
    // recorded deps from the last run: context keys + computed keys read,
    // plus whether the def read `state` (the lifecycle is also a dependency)
    let ctxDeps: string[] = []
    let computedDeps: string[] = []
    let ctxSnapshot: Record<string, unknown> = {}
    let computedSnapshot: Record<string, unknown> = {}
    let readState = false
    let stateSnapshot: State | undefined

    // The two tracking proxies are built ONCE per computed (not per recompute).
    // Their targets read the host's context / computed LIVE through the trap.
    // Each `get` records the key into the CURRENT read-set, which the recompute
    // swaps in before calling `def`.
    let ctxRead: Set<string> | null = null
    let computedRead: Set<string> | null = null
    // set true during a recompute so reading `params.state` records the
    // dependency; nulled outside so a stale-check read never records.
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
      // if the def read `state`, the lifecycle is a dependency too
      if (readState && stateSnapshot !== host.state()) return true
      for (const dk of ctxDeps) {
        if (!Object.is(ctxSnapshot[dk], (host.context() as Record<string, unknown>)[dk]))
          return true
      }
      // reading a computed dep below resolves ITS staleness first, so a
      // transitive change surfaces as a value difference here
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
        // swap in fresh read-sets, recompute under the (reused) proxies
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
            // a getter: reading `state` records it as a dependency (during
            // tracking) so a later transition invalidates this computed
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
