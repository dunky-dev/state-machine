import { useMemo, useRef, useSyncExternalStore } from 'react'
import type { EqualityFn, Machine } from '@dunky.dev/state-machine'

/**
 * Fine-grained subscription for leaf components — re-renders only when the selected VALUE changes.
 *
 *   const open = useSelector(m, () => m.matches('open'))
 *   const isHL = useSelector(m, () => m.context.highlightedValue === value)
 *
 * The selector runs in a stable Selection (so a fresh closure per render doesn't re-subscribe).
 * getSnapshot caches the last value so object selections don't cause infinite re-render loops.
 */
export function useSelector<
  State extends string,
  Context extends object,
  T,
  Event extends { type: string } = { type: string },
  Computed = Record<string, never>,
>(
  machine: Machine<State, Context, Event, Computed>,
  selector: () => T,
  isEqual?: EqualityFn<T>,
): T {
  // Refs so a fresh closure per render doesn't rebuild the Selection or re-subscribe.
  const selectorRef = useRef(selector)
  selectorRef.current = selector
  const isEqualRef = useRef(isEqual)
  isEqualRef.current = isEqual

  const selectorMemo = useMemo(() => machine.select(() => selectorRef.current()), [machine])

  // Cache the last returned value — getSnapshot must be referentially stable for equal values
  // or useSyncExternalStore re-renders on every call (breaks object selections).
  const cache = useRef<{ value: T } | null>(null)
  const getSnapshot = (): T => {
    const next = selectorRef.current()
    const eq = isEqualRef.current ?? Object.is
    if (cache.current && eq(cache.current.value, next)) return cache.current.value
    cache.current = { value: next }
    return next
  }

  return useSyncExternalStore(
    onStoreChange => selectorMemo.subscribe(() => onStoreChange(), isEqual),
    getSnapshot,
    getSnapshot,
  )
}
