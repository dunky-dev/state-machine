/**
 * Compiles a TS config for the Rust engine: the graph becomes numbers (states, event
 * types, targets), the user code becomes tables the host callbacks index into. The
 * spec shape mirrors `crates/wasm/src/runtime.rs`.
 */
import { isOneOf } from './actions'
import { isDev } from './constants'
import { JsConfig, startEngine } from './wasm'
import type {
  ActionArg,
  Actions,
  Guard,
  GuardArg,
  TransitionConfig,
  TransitionEntry,
} from './types'

// The engine is generic over user code; inside the compiler everything is erased.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Fn = (params: any) => any
type AnyConfig = TransitionConfig<any, any, any, any>
type AnyGuard = GuardArg<any, any, any>
type AnyAction = ActionArg<any, any, any>
type AnyActions = Actions<any, any, any>
type AnyEntry = TransitionEntry<string, any, any, any>
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface ActionSpec {
  id?: number
  /** A run of actions the host runs in one call: an index into `actionLists`. */
  list?: number
  oneOf?: Array<{ guard?: number; actions: ActionSpec[] }>
}
interface CandidateSpec {
  /** The host runs the transition whole when it leaves the state: an index into
   * `transitionActions`. */
  id?: number
  target?: number
  guard?: number
  actions: ActionSpec[]
}
interface EntrySpec {
  kind: number
  candidates: CandidateSpec[]
  /** The host evaluates the guards in one call: an index into `guardLists`. */
  pick?: number
}

/** A TS config compiled for the Rust engine. Cached per config object. */
export interface Compiled {
  rust: JsConfig
  initial: number
  stateNames: string[]
  kinds: Map<string, number>
  tags: Array<ReadonlySet<string>>
  /** Context key → change-mask bit. Bit 63 is shared by every key past the 63rd. */
  fieldBits: Map<string, number>
  /** Whether the engine needs to hear about context writes (watchers, computed values). */
  tracksContext: boolean
  /** Whether a context write can run code in the engine (watchers). */
  watches: boolean
  computedIndex: Map<string, number>
  computedDefs: Fn[]
  guards: Fn[]
  /** Per pick list: each candidate's guard, -1 for none. */
  guardLists: number[][]
  /** Per action list: the actions, in order. */
  actionLists: number[][]
  /** What a transition run whole needs: per transition id, its actions; per state, its
   * exit and entry actions and its effects. */
  transitionActions: ActionSpec[][]
  exitActions: ActionSpec[][]
  entryActions: ActionSpec[][]
  stateEffects: number[][]
  actions: Fn[]
  effects: Fn[]
  delays: Fn[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  guardRegistry: Record<string, Guard<any, any, any>> | undefined
}

/** The change-mask bit of `key`, assigning the next one on first sight. */
export function fieldBit(bits: Map<string, number>, key: string): number {
  let bit = bits.get(key)
  if (bit === undefined) {
    bit = Math.min(bits.size, 63)
    bits.set(key, bit)
  }
  return bit
}

// A missing named implementation fails when it runs: a throw in dev, a warning in prod.
function missing(kind: 'guard' | 'action' | 'effect' | 'delay', name: string): Fn {
  return () => {
    const msg = `[machine] no ${kind} "${name}"`
    if (isDev) throw new Error(msg)
    console.warn(msg)
    return kind === 'guard' ? false : kind === 'delay' ? 0 : undefined
  }
}

// Each distinct function gets one id in its table.
function table(list: Fn[]): (fn: Fn) => number {
  const ids = new Map<Fn, number>()
  return fn => {
    let id = ids.get(fn)
    if (id === undefined) {
      id = list.push(fn) - 1
      ids.set(fn, id)
    }
    return id
  }
}

const cache = new WeakMap<object, Compiled>()

export function compile(config: AnyConfig): Compiled {
  const cached = cache.get(config)
  if (cached) return cached
  startEngine()

  const impl = config.implementations ?? {}
  const stateNames = Object.keys(config.states)
  const stateIndex = new Map(stateNames.map((name, i) => [name, i]))
  const indexOf = (name: string): number => {
    const i = stateIndex.get(name)
    if (i === undefined) throw new Error(`[machine] no state "${name}"`)
    return i
  }
  const kinds = new Map<string, number>()
  const kindOf = (type: string): number => {
    let kind = kinds.get(type)
    if (kind === undefined) {
      kind = kinds.size
      kinds.set(type, kind)
    }
    return kind
  }

  const guards: Fn[] = []
  const actions: Fn[] = []
  const effects: Fn[] = []
  const delays: Fn[] = []
  const guardId = table(guards)
  const actionId = table(actions)
  const effectId = table(effects)
  const delayId = table(delays)

  const guardRef = (g: AnyGuard): number =>
    guardId(typeof g === 'function' ? g : (impl.guards?.[g] ?? missing('guard', g)))
  const actionRef = (a: AnyAction): ActionSpec =>
    isOneOf(a)
      ? {
          oneOf: a.branches.map(b => ({
            guard: b.guard === undefined ? undefined : guardRef(b.guard),
            actions: actionList(b.actions),
          })),
        }
      : { id: actionId(typeof a === 'function' ? a : (impl.actions?.[a] ?? missing('action', a))) }
  // One host call per run of plain actions, instead of one per action.
  const guardLists: number[][] = []
  const actionLists: number[][] = []
  const actionList = (list: AnyActions | undefined): ActionSpec[] => {
    if (list === undefined) return []
    const specs: ActionSpec[] = []
    let run: number[] = []
    const flush = () => {
      if (run.length === 1) specs.push({ id: run[0] })
      else if (run.length > 1) specs.push({ list: actionLists.push(run) - 1 })
      run = []
    }
    for (const a of Array.isArray(list) ? list : [list]) {
      const spec = actionRef(a)
      if (spec.id === undefined) {
        flush()
        specs.push(spec)
      } else run.push(spec.id)
    }
    flush()
    return specs
  }
  // One host call per guard walk, when two or more candidates have a guard.
  // A leaving transition runs whole in one host call when nothing JS runs can read the
  // engine's state mid-transition (no computed values) and the target has no named delay.
  const runsWhole = Object.keys(config.computed ?? {}).length === 0
  const namedDelay = stateNames.map(name =>
    Object.keys(config.states[name]!.after ?? {}).some(key => Number.isNaN(Number(key))),
  )
  const transitionActions: ActionSpec[][] = []
  const entrySpec = (entry: AnyEntry): { candidates: CandidateSpec[]; pick?: number } => {
    const candidates: CandidateSpec[] = (Array.isArray(entry) ? entry : [entry]).map(el => {
      if (typeof el === 'function') return { actions: actionList(el) }
      const target = el.target === undefined ? undefined : indexOf(el.target)
      const actions = actionList(el.actions)
      const whole = runsWhole && target !== undefined && !namedDelay[target]
      return {
        id: whole ? transitionActions.push(actions) - 1 : undefined,
        target,
        guard: el.guard === undefined ? undefined : guardRef(el.guard),
        actions,
      }
    })
    const guarded = candidates.filter(c => c.guard !== undefined).length
    if (guarded < 2) return { candidates }
    return { candidates, pick: guardLists.push(candidates.map(c => c.guard ?? -1)) - 1 }
  }
  const onTable = (on: object | undefined): EntrySpec[] =>
    Object.entries((on ?? {}) as Record<string, AnyEntry>)
      .filter(([, entry]) => entry !== undefined)
      .map(([type, entry]) => ({ kind: kindOf(type), ...entrySpec(entry) }))

  const states = stateNames.map(name => {
    const node = config.states[name]!
    return {
      on: onTable(node.on),
      entry: actionList(node.entry),
      exit: actionList(node.exit),
      effects: (node.effects ?? []).map(e =>
        effectId(typeof e === 'function' ? e : (impl.effects?.[e] ?? missing('effect', e))),
      ),
      after: Object.entries((node.after ?? {}) as Record<string, AnyEntry>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => {
          const ms = Number(key)
          const delay = Number.isNaN(ms)
            ? { id: delayId(impl.delays?.[key] ?? missing('delay', key)) }
            : { ms }
          return { delay, ...entrySpec(entry) }
        }),
    }
  })

  const fieldBits = new Map<string, number>()
  for (const key of Object.keys(config.context)) fieldBit(fieldBits, key)
  const computedNames = Object.keys(config.computed ?? {})
  const computedIndex = new Map(computedNames.map((name, i) => [name, i]))
  // Watch keys are probed on computed first (fixed at build), then on context fields,
  // which may appear later.
  const watch = Object.entries((config.watch ?? {}) as Record<string, AnyActions>)
    .filter(([, list]) => list !== undefined)
    .map(([key, list]) => {
      const computed = computedIndex.get(key)
      return computed === undefined
        ? { field: fieldBit(fieldBits, key), actions: actionList(list) }
        : { computed, actions: actionList(list) }
    })

  const spec = {
    initial: indexOf(config.initial),
    kinds: 0,
    states,
    onAny: onTable(config.on),
    computed: computedNames.length,
    watch,
  }
  spec.kinds = kinds.size

  const compiled: Compiled = {
    rust: new JsConfig(spec),
    initial: spec.initial,
    stateNames,
    kinds,
    tags: stateNames.map(name => new Set(config.states[name]!.tags ?? [])),
    fieldBits,
    tracksContext: watch.length > 0 || computedNames.length > 0,
    watches: watch.length > 0,
    computedIndex,
    computedDefs: computedNames.map(name => (config.computed as Record<string, Fn>)[name]!),
    guards,
    guardLists,
    actionLists,
    transitionActions,
    exitActions: states.map(state => state.exit),
    entryActions: states.map(state => state.entry),
    stateEffects: states.map(state => state.effects),
    actions,
    effects,
    delays,
    guardRegistry: impl.guards,
  }
  cache.set(config, compiled)
  return compiled
}
