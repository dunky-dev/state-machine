import { createEffect, createStore, onCleanup, onSettled, reconcile } from 'solid-js'
import { connector, machine, type Connect, type TransitionConfig } from '@dunky.dev/state-machine'

/**
 * One substrate-specific effect: a setup/teardown function plus the prop names
 * that re-run it. The tuple shape is identical across every target, so a
 * component's effects are authored once; `deps` are prop names (typed, so
 * typos are compile errors) — the authored list is the whole re-run contract.
 */
export type ComponentEffect<Machine, Props> = [
  effect: (machine: Machine, props: Props) => (() => void) | void,
  deps: (keyof Props)[],
]

/**
 * The generic Solid bridge: builds the machine + connector once, mirrors the
 * connector's snapshot into a fine-grained store, runs the lifecycle and the
 * component's effects. Returns the connect() api (reactive store proxy) and
 * the running machine.
 */
export function useMachine<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Props extends object,
  Api extends object,
  Computed = Record<string, never>,
>(
  createConfig: (props: Props) => TransitionConfig<State, Context, Event, Computed>,
  connect: Connect<State, Context, Event, Props, Api, Computed>,
  effects: ComponentEffect<ReturnType<typeof machine<State, Context, Event, Computed>>, Props>[],
  props: Props,
): { api: Api; machine: ReturnType<typeof machine<State, Context, Event, Computed>> } {
  // Seed with a plain copy, never the live props proxy: setProps value-dedups,
  // and a held proxy would compare equal to its own fresh spread and never wake.
  const service = machine(createConfig(props))
  const connection = connector(service, connect, { ...props })

  // Workaround for a solid-js 2.0.0-rc.0 bug: reconcile corrupts a store
  // node when it replaces a function prop. We reconcile with the old
  // functions kept in place, then write the new functions in after.
  const [api, setApi] = createStore<Api>(connection.snapshot as Api extends Function ? never : Api)
  const off = connection.subscribe(() => {
    const next = connection.snapshot
    setApi(draft => {
      reconcile(stableFunctionView(next, draft) as Api)(draft)
      restoreFunctionLeaves(draft as Record<string, unknown>, next as Record<string, unknown>)
    })
  })
  onCleanup(off)

  // The compute spread reads every prop, so any consumed prop change re-runs
  // this; setProps value-dedups.
  createEffect(
    () => ({ ...props }),
    snapshot => connection.setProps(snapshot),
  )

  // No connection.destroy(): connector and machine share this component's
  // lifetime and are GC'd together; destroy() is for standalone connectors.
  onSettled(() => {
    service.start()
    return () => service.stop()
  })

  // One effect per entry: compute tracks exactly the named deps (fresh array,
  // so apply fires on every dep change); the body runs untracked in apply, so
  // a prop it merely reads never becomes a hidden dependency.
  for (const [fn, deps] of effects) {
    createEffect(
      () => deps.map(key => props[key]),
      () => fn(service, props),
    )
  }

  return { api, machine: service }
}

type AnyRecord = Record<string, unknown>

// Plain data only — the shapes reconcile recurses into; anything else is a
// leaf value to a store.
function isPlainData(value: unknown): value is AnyRecord {
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return true
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

// Copy-on-write view of `next` with each function leaf swapped for the one the
// store already holds (reconcile no-ops on it; restoreFunctionLeaves writes the
// fresh identity). Function leaves with no counterpart are dropped from the
// view. Subtrees without functions are shared, not copied.
function stableFunctionView(next: unknown, prev: unknown): unknown {
  if (!isPlainData(next)) return next
  if (Array.isArray(next)) {
    let copy: unknown[] | undefined
    for (let i = 0; i < next.length; i++) {
      const item = next[i]
      let stable = item
      if (typeof item === 'function') {
        const before = Array.isArray(prev) ? (prev as unknown[])[i] : undefined
        stable = typeof before === 'function' ? before : null
      } else if (isPlainData(item)) {
        stable = stableFunctionView(item, Array.isArray(prev) ? (prev as unknown[])[i] : undefined)
      }
      if (stable !== item) {
        if (!copy) copy = next.slice()
        copy[i] = stable
      }
    }
    return copy ?? next
  }
  const before = isPlainData(prev) && !Array.isArray(prev) ? prev : undefined
  let copy: AnyRecord | undefined
  for (const key in next) {
    const item = next[key]
    if (typeof item === 'function') {
      if (!copy) copy = { ...next }
      const held = before?.[key]
      if (typeof held === 'function') copy[key] = held
      else delete copy[key]
      continue
    }
    const stable = stableFunctionView(item, before?.[key])
    if (stable !== item) {
      if (!copy) copy = { ...next }
      copy[key] = stable
    }
  }
  return copy ?? next
}

// Assign the snapshot's function leaves into the draft — same setter as the
// reconcile, so the intermediate state is never observable.
function restoreFunctionLeaves(draft: AnyRecord, next: AnyRecord): void {
  for (const key in next) {
    const item = next[key]
    if (typeof item === 'function') {
      draft[key] = item
    } else if (isPlainData(item)) {
      const slot = draft[key]
      if (slot !== null && typeof slot === 'object') {
        restoreFunctionLeaves(slot as AnyRecord, item)
      }
    }
  }
}
