import type { EqualityFn, Machine, Selection } from './types'

/** Any machine, regardless of its specific generics. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMachine = Machine<any, any, any, any>

/** Several machines composed into one unit: bundled lifecycle + sync/combine. */
export interface Composition<Members extends Record<string, AnyMachine>> {
  /** The composed machines, by name — read/send to them individually. */
  readonly members: Members
  /** Start every member (in declared order). Idempotent per member. */
  start: () => void
  /** Stop every member (reverse order) and dispose all sync/combine subscriptions. */
  stop: () => void
  /**
   * Run `reaction` whenever any member changes — the place for cross-region
   * rules ("when the popup closes, close the submenu"). Coarse (wakes on any
   * member change; the reaction reads what it needs); does not fire on setup.
   * Auto-disposed on stop(); also returns a disposer to stop it earlier.
   */
  sync: (reaction: () => void) => () => void
  /**
   * Derive a value-deduped Selection across members. Re-evaluates on any member change;
   * fires only when the selected value changes.
   */
  combine: <Value>(selector: () => Value) => Selection<Value>
}

/**
 * Bundle several machines into a group with shared lifecycle + sync/combine.
 * Members stay independent — read and `send` to each via `group.members.x`.
 */
export function compose<Members extends Record<string, AnyMachine>>(
  members: Members,
): Composition<Members> {
  const list = Object.values(members)
  const disposers: Array<() => void> = []

  return {
    members,
    start() {
      for (const m of list) m.start()
    },
    stop() {
      for (const dispose of disposers) dispose()
      disposers.length = 0
      for (let i = list.length - 1; i >= 0; i--) list[i]!.stop()
    },
    sync(reaction) {
      const offs = list.map(m => m.subscribe(reaction))
      const dispose = () => {
        for (const off of offs) off()
      }
      disposers.push(dispose)
      return dispose
    },
    combine<Value>(selector: () => Value): Selection<Value> {
      return {
        get value() {
          return selector()
        },
        subscribe(listener: (value: Value) => void, equals: EqualityFn<Value> = Object.is) {
          let prev = selector()
          const onChange = () => {
            const next = selector()
            if (equals(prev, next)) return
            prev = next
            listener(next)
          }
          const offs = list.map(m => m.subscribe(onChange))
          const dispose = () => {
            for (const off of offs) off()
          }
          disposers.push(dispose)
          return dispose
        },
      }
    },
  }
}
