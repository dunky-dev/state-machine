/**
 * Continuous change producer. While running, it emits one batch of cell changes
 * per `pull()` (the app calls pull() once per animation frame). It does NOT
 * apply anything or touch React — each panel keeps its own queue and drains it
 * under a time budget, so a panel whose per-update cost is higher falls behind
 * (its backlog grows) while a cheaper one keeps its queue near empty.
 *
 * `rate` (changes per pull) ramps up over time so the load eventually exceeds
 * what the slower engines can drain per frame — that's when they visibly lag.
 */

export type CellChange = { index: number; value: number }

export interface Feed {
  size: number
  /** produce the next batch of `count` changes (advances the stream) */
  pull: (count: number) => CellChange[]
  /** seed value for a cell, before any change */
  valueAt: (i: number) => number
}

export function createFeed(size: number): Feed {
  const values = new Int32Array(size)
  let cursor = 0
  let seq = 0

  return {
    size,
    pull(count) {
      const changes: CellChange[] = Array.from({ length: count })
      for (let k = 0; k < count; k++) {
        const index = cursor % size
        cursor += 1
        const value = (seq = (seq + 1) % 1_000_000)
        values[index] = value
        changes[k] = { index, value }
      }
      cursor += 7 // prime-ish stride so successive pulls cover fresh cells
      return changes
    },
    valueAt: i => values[i],
  }
}
