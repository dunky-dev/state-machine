import { computed as preactComputed, effect as preactEffect } from '@preact/signals-core'
import type { EqualityFn, Machine, Selection } from './types'

/**
 * Composition helpers for running several independent machines as one unit —
 * the "orthogonal regions" pattern without nested states. Each machine stays a
 * plain peer (its own state, lifecycle, fine-grained `select`); `compose` adds
 * the glue:
 *
 *   const combobox = compose({ popup, submenu })
 *   combobox.start()
 *   combobox.sync(() => { if (popup.matches('closed')) submenu.send({ type: 'close' }) })
 *   const view = combobox.combine(() => ({ open: popup.matches('open'), sub: submenu.state }))
 *   combobox.stop() // stops members + disposes the sync rules and combine selections
 *
 * `sync`/`combine` register against the group, so `stop()` tears down their
 * subscriptions too — no manual disposer threading. All built on the
 * single-machine surface (start/stop/subscribe/select); the state model is
 * untouched.
 */

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
   * Derive one value-deduped Selection across the members. The selector reads
   * from any members; their reads auto-track, so it re-runs only when a read
   * field changes (O(changed), across regions). Read `.value` or
   * `.subscribe(listener, equals?)`.
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
      const sig = preactComputed(selector)
      return {
        get value() {
          return sig.value
        },
        subscribe(listener: (value: Value) => void, equals: EqualityFn<Value> = Object.is) {
          let prev: Value
          let primed = false
          const dispose = preactEffect(() => {
            const next = sig.value
            if (!primed) {
              prev = next
              primed = true
              return
            }
            if (equals(prev, next)) return
            prev = next
            listener(next)
          })
          disposers.push(dispose)
          return dispose
        },
      }
    },
  }
}
