/**
 * A tiny store — for cross-instance singleton state (e.g. "only one tooltip open
 * at a time") that lives outside any single machine.
 *
 * Plain value + a listener Set. `get()` reads it; `set()` shallow-merges a patch
 * (or an updater) and notifies on a real change; `subscribe(fn)` fires on every
 * subsequent change (not on subscribe). Bare unsubscribe.
 *
 * The base always carries `get` / `set` / `subscribe`. Pass a second `build`
 * arg to add named domain methods on top — no facade boilerplate:
 *
 *   const tooltipStore = createStore(
 *     { openId: null as string | null },
 *     (s) => ({
 *       setOpen: (id: string | null) => s.set({ openId: id }),
 *       isOpen: (id: string) => s.get().openId === id,
 *     }),
 *   )
 *   tooltipStore.get() / .subscribe(fn) / .setOpen('a') / .isOpen('a')
 *
 * To react to a store from inside a machine, subscribe and forward to the
 * machine explicitly: `store.subscribe((s) => m.send({ type: '...', ...s }))`.
 */
export type Listener<T> = (state: T) => void
export type SetStateAction<T> = Partial<T> | ((state: T) => Partial<T>)

export interface Store<T extends object> {
  /** Current value. */
  get: () => T
  /** Shallow-merge a patch (or an updater) over the current value. */
  set: (action: SetStateAction<T>) => void
  /** Fire on every subsequent change (not on subscribe). Bare unsubscribe. */
  subscribe: (listener: Listener<T>) => () => void
}

export function createStore<T extends object, Methods extends object = object>(
  initial: T,
  build: (store: Store<T>) => Methods = () => ({}) as Methods,
): Store<T> & Methods {
  let state = initial
  const listeners = new Set<Listener<T>>()
  const base: Store<T> = {
    get: () => state,
    set(action) {
      const patch = typeof action === 'function' ? action(state) : action
      // shallow-equal dedup: a no-op write doesn't notify
      let changed = false
      for (const k in patch) {
        if (!Object.is(state[k as keyof T], patch[k as keyof T])) {
          changed = true
          break
        }
      }
      if (!changed) return
      state = { ...state, ...patch }
      for (const listener of [...listeners]) listener(state)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return { ...base, ...build(base) }
}
