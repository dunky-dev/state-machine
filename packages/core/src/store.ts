import { makeBroadcast } from './broadcast'
import { shouldPatch } from './patch'

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
  const broadcast = makeBroadcast()
  const base: Store<T> = {
    get: () => state,
    set(action) {
      const patch = typeof action === 'function' ? action(state) : action
      if (!shouldPatch(state, patch)) return
      // Fresh identity on purpose — get() serves as a useSyncExternalStore
      // snapshot, so the identity change IS the re-render signal.
      state = { ...state, ...patch }
      broadcast.notify()
    },
    subscribe(listener) {
      return broadcast.add(() => listener(state))
    },
  }
  return { ...base, ...build(base) }
}
