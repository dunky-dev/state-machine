/**
 * Context — the machine's reactive data, held as a PLAIN object.
 *
 * Reads are plain property access (`context.field`). Writes go through one entry
 * point, `setContext({ field })`, which shallow-equal-dedups (a no-op write is
 * skipped) and, on a real change, calls `notify()` so observers (`subscribe` /
 * `select`) re-evaluate.
 *
 * Copy-on-write: the backing object starts as the SHARED config reference and is
 * copied on the first write, so an idle/never-written machine costs zero
 * per-field bytes beyond a shared pointer (flat memory in field count); the
 * original object is never mutated.
 *
 * The returned `context` is a STABLE wrapper whose per-field getters read the
 * current backing object — so `const { context } = createContext(...)` stays
 * valid across writes (destructuring snapshots the wrapper, not a value). The
 * assembled machine doesn't use this wrapper; it reads its own `this.ctx`
 * directly. This helper is for advanced composition / tests.
 */
export function createContext<Context extends object>(
  initial: Context,
  notify: () => void = () => {},
): {
  context: Context
  setContext: (patch: Partial<Context>) => void
} {
  let backing = initial
  let owns = false

  const setContext = (patch: Partial<Context>) => {
    let changed = false
    for (const key in patch) {
      if (!Object.is(backing[key as keyof Context], patch[key as keyof Context])) {
        changed = true
        break
      }
    }
    if (!changed) return
    if (!owns) {
      backing = { ...backing }
      owns = true
    }
    Object.assign(backing, patch)
    notify()
  }

  // Stable wrapper: one getter per key, reading the (possibly copied) backing
  // object. Destructure-safe — the wrapper identity never changes.
  //
  // NOTE: this per-field getter is ~heavier than plain property access. It only
  // exists for the standalone helper (advanced composition / tests); the machine
  // does NOT use it — it reads `this.ctx` (a plain object) directly, so the engine
  // keeps flat, getter-free context on the hot path. Don't reach for
  // `createContext` in hot code; use the machine's context.
  const context = {} as Context
  for (const key in initial) {
    Object.defineProperty(context, key, {
      get: () => backing[key as keyof Context],
      enumerable: true,
    })
  }

  return { context, setContext }
}
