import type { EventObject, MachineConfig, Machine, Transition } from './types'

export function createMachine<
  TContext extends object,
  TProps extends object,
  TEvent extends EventObject = EventObject,
>(
  config: MachineConfig<TContext, TProps, TEvent>,
  initialProps: TProps,
): Machine<TContext, TProps, TEvent> {
  let props = initialProps

  const initial =
    typeof config.initial === 'function'
      ? (config.initial as (p: TProps) => string)(props)
      : config.initial

  const initialContext =
    typeof config.context === 'function'
      ? (config.context as (p: TProps) => TContext)(props)
      : { ...config.context }

  let state = initial
  let context = initialContext
  let version = 0
  const listeners = new Set<() => void>()
  const effectCleanups = new Map<string, VoidFunction[]>()
  let started = false

  const notify = () => {
    version++
    listeners.forEach(l => l())
  }

  const setContext = (patch: Partial<TContext>) => {
    let changed = false
    for (const key in patch) {
      if (!Object.is(context[key], patch[key])) {
        changed = true
        break
      }
    }
    if (!changed) return
    context = { ...context, ...patch }
    notify()
  }

  const baseParams = (event: TEvent) => ({
    context,
    setContext,
    props,
    event,
    send,
  })

  const runActions = (names: string[] | undefined, event: TEvent) => {
    if (!names) return
    for (const name of names) {
      const fn = config.implementations?.actions?.[name]
      if (!fn) {
        console.warn(`[machine] no action "${name}"`)
        continue
      }
      fn(baseParams(event))
    }
  }

  const checkGuard = (guard: Transition['guard'], event: TEvent): boolean => {
    if (!guard) return true
    const params = { context, props, event }
    if (typeof guard === 'function') return guard(params)
    const fn = config.implementations?.guards?.[guard]
    if (!fn) {
      console.warn(`[machine] no guard "${guard}"`)
      return false
    }
    return fn(params)
  }

  const runEffects = (stateName: string) => {
    const effectNames = config.states[stateName]?.effects
    if (!effectNames) return
    const cleanups: VoidFunction[] = []
    for (const name of effectNames) {
      const fn = config.implementations?.effects?.[name]
      if (!fn) {
        console.warn(`[machine] no effect "${name}"`)
        continue
      }
      const cleanup = fn({ context, setContext, props, send })
      if (cleanup) cleanups.push(cleanup)
    }
    if (cleanups.length) effectCleanups.set(stateName, cleanups)
  }

  const cleanupEffects = (stateName: string) => {
    const cleanups = effectCleanups.get(stateName)
    cleanups?.forEach(fn => fn())
    effectCleanups.delete(stateName)
  }

  const resolveTransition = (
    transitions: Transition | Transition[] | undefined,
    event: TEvent,
  ): Transition | undefined => {
    if (!transitions) return undefined
    const list = Array.isArray(transitions) ? transitions : [transitions]
    return list.find(t => checkGuard(t.guard, event))
  }

  const send = (event: TEvent) => {
    if (!started) return
    const node = config.states[state]
    const transitions = node?.on?.[event.type] ?? config.on?.[event.type]
    const transition = resolveTransition(transitions, event)
    if (!transition) return

    const next = transition.target ?? state
    const changed = next !== state

    if (changed) {
      cleanupEffects(state)
      runActions(node?.exit, event)
    }
    runActions(transition.actions, event)
    if (changed) {
      state = next
      runActions(config.states[next]?.entry, event)
      runEffects(next)
    }
    notify()
  }

  return {
    getState: () => state,
    getContext: () => context,
    getProps: () => props,
    getVersion: () => version,
    setProps(next) {
      props = next
    },
    send,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start() {
      if (started) return
      started = true
      // Synthetic boot event for entry actions. Cast because the user's
      // TEvent union doesn't include it — it's machine-internal.
      runActions(config.states[state]?.entry, { type: '@@start' } as TEvent)
      runEffects(state)
    },
    stop() {
      if (!started) return
      started = false
      effectCleanups.forEach(cleanups => cleanups.forEach(fn => fn()))
      effectCleanups.clear()
    },
  }
}
