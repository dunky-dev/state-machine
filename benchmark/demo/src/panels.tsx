/**
 * One panel = one engine instance + a <canvas> heatmap. No per-cell React: the
 * thing being compared is the ENGINE's per-update cost, so React/DOM paint is
 * kept out of the hot path entirely.
 *
 * The app drives each panel via a ref handle:
 *   - enqueue(changes)  : queue updates (cheap)
 *   - drain(budgetMs)   : apply queued updates through the engine until the time
 *                         budget is spent; returns applied + remaining. THIS is
 *                         the measured engine work.
 *   - paint()           : throttled, called ~10fps by the app — draws every cell's
 *                         current computed value to the canvas in one pass.
 */
import React from 'react'
import {
  makeDunkyEngine,
  makeXStateEngine,
  makeZagEngine,
  makeRawEngine,
  type CellEngine,
} from './engines'
import type { Feed, CellChange } from './feed'
import type { PanelId } from './metrics'

const CELL_PX = 5
const GAP = 1

const ENGINE_FACTORY: Record<PanelId, (size: number, seed: (i: number) => number) => CellEngine> = {
  raw: makeRawEngine,
  Dunky: makeDunkyEngine,
  xstate: makeXStateEngine,
  zag: makeZagEngine,
}

export interface PanelHandle {
  enqueue: (changes: CellChange[]) => void
  // Async because an async engine (Zag) must await a flush so its deferred
  // transitions actually execute before we count them. Sync engines resolve
  // without ever yielding, so they pay nothing for the async signature.
  drain: (budgetMs: number) => Promise<{ applied: number; remaining: number }>
  backlog: () => number
  paint: () => void
  /** drop the pending queue and wipe the canvas (Stop = reset) */
  clear: () => void
}

function makeQueue() {
  let q: CellChange[] = []
  return {
    push(changes: CellChange[]) {
      if (q.length < 500_000) q = q.concat(changes)
    },
    take(n: number): CellChange[] {
      return q.splice(0, n)
    },
    size: () => q.length,
    reset() {
      q = []
    },
  }
}

export const Panel = React.forwardRef<PanelHandle, { id: PanelId; side: number; feed: Feed }>(
  function Panel({ id, side, feed }, ref) {
    const size = side * side
    const canvasRef = React.useRef<HTMLCanvasElement>(null)

    const engine = React.useMemo(
      () => ENGINE_FACTORY[id](size, i => feed.valueAt(i)),
      [id, size, feed],
    )
    React.useEffect(() => () => engine.dispose(), [engine])
    const queue = React.useMemo(makeQueue, [engine])

    React.useImperativeHandle(ref, () => ({
      enqueue: c => queue.push(c),
      backlog: queue.size,
      async drain(budgetMs) {
        const t0 = performance.now()
        let applied = 0
        // Apply in chunks, re-checking the wall clock; each update is a guarded
        // transition + computed through the engine (the measured cost).
        //
        // SYNC engines (Dunky/XState/raw, `flush` absent): the work is done when
        // `update` returns, so we count the chunk immediately — identical to the
        // original synchronous loop, no yielding.
        //
        // ASYNC engines (Zag, `flush` present): `update` only SCHEDULES the
        // transition, so we await `flush()` to let the chunk's transitions
        // actually run, and only THEN count them. This measures real transition
        // work against the same wall-clock budget — not `send()` calls that merely
        // returned (which is what made the old loop count Zag's work as free).
        while (queue.size() > 0 && performance.now() - t0 < budgetMs) {
          const chunk = queue.take(512)
          for (const c of chunk) engine.update(c.index, c.value)
          if (engine.flush) await engine.flush()
          applied += chunk.length
        }
        return { applied, remaining: queue.size() }
      },
      paint() {
        const ctx = canvasRef.current?.getContext('2d')
        if (!ctx) return
        const step = CELL_PX + GAP
        for (let i = 0; i < size; i++) {
          const v = engine.paintValue(i)
          ctx.fillStyle = `hsl(${v % 360} 70% 55%)`
          const x = (i % side) * step
          const y = Math.floor(i / side) * step
          ctx.fillRect(x, y, CELL_PX, CELL_PX)
        }
      },
      clear() {
        queue.reset()
        const c = canvasRef.current
        c?.getContext('2d')?.clearRect(0, 0, c.width, c.height)
      },
    }))

    const dim = side * (CELL_PX + GAP)
    // internal resolution is fixed (crisp); CSS scales it to fit the column so
    // all four panels line up in one row regardless of grid size
    return (
      <canvas
        ref={canvasRef}
        width={dim}
        height={dim}
        style={{
          width: '100%',
          height: 'auto',
          aspectRatio: '1 / 1',
          display: 'block',
          background: '#010409',
          borderRadius: 4,
          imageRendering: 'pixelated',
        }}
      />
    )
  },
)
