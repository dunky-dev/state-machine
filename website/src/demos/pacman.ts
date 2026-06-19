import {
  act,
  compose,
  machine,
  type Action,
  type Composition,
  type Machine,
} from '@dunky.dev/state-machine'

// 1 = wall, 0 = path. A small, symmetric maze that reads as "Pac-Man".
// prettier-ignore
export const MAZE: number[][] = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,1,0,0,0,0,0,1],
  [1,0,1,1,0,0,0,0,0,1,1,0,1],
  [1,0,1,0,0,1,1,1,0,0,1,0,1],
  [1,0,0,0,1,0,0,0,1,0,0,0,1],
  [1,1,0,1,1,0,1,0,1,1,0,1,1],
  [1,0,0,0,0,0,1,0,0,0,0,0,1],
  [1,0,1,1,0,1,1,1,0,1,1,0,1],
  [1,0,0,1,0,0,0,0,0,1,0,0,1],
  [1,0,1,0,0,1,1,1,0,0,1,0,1],
  [1,0,0,0,0,0,1,0,0,0,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1],
]

export const ROWS = MAZE.length
export const COLS = MAZE[0].length

export type Dir = 'right' | 'left' | 'up' | 'down'
export type Mouth = 'open' | 'closed'
export interface Pt {
  x: number
  y: number
}

export const DELTA: Record<Dir, Pt> = {
  right: { x: 1, y: 0 },
  left: { x: -1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
}
// clockwise order, used to scan "starting from the right of current travel"
const CW: Dir[] = ['right', 'down', 'left', 'up']
const cwRightOf = (dir: Dir): Dir => CW[(CW.indexOf(dir) + 1) % 4]
const OPPOSITE: Record<Dir, Dir> = { right: 'left', left: 'right', up: 'down', down: 'up' }

export const key = (x: number, y: number) => `${x},${y}`
export const isWall = (x: number, y: number) =>
  y < 0 || y >= ROWS || x < 0 || x >= COLS || MAZE[y][x] === 1

// One shortest-path step from (sx,sy) toward (tx,ty), via BFS over open cells.
// Returns the next cell + the direction taken, or null if unreachable/already there.
function bfsStep(sx: number, sy: number, tx: number, ty: number): (Pt & { dir: Dir }) | null {
  if (sx === tx && sy === ty) return null
  const prev = new Map<string, { px: number; py: number; dir: Dir }>()
  const queue: Pt[] = [{ x: sx, y: sy }]
  const seen = new Set([key(sx, sy)])
  while (queue.length) {
    const cur = queue.shift()!
    for (const dir of ['right', 'left', 'up', 'down'] as Dir[]) {
      const nx = cur.x + DELTA[dir].x
      const ny = cur.y + DELTA[dir].y
      const k = key(nx, ny)
      if (isWall(nx, ny) || seen.has(k)) continue
      seen.add(k)
      prev.set(k, { px: cur.x, py: cur.y, dir })
      if (nx === tx && ny === ty) {
        // walk back from the target to the cell whose predecessor is the start;
        // that cell IS the first step, and its `dir` is the move to make.
        let node = prev.get(k)!
        let cellX = nx
        let cellY = ny
        let dirTaken = dir
        while (!(node.px === sx && node.py === sy)) {
          cellX = node.px
          cellY = node.py
          dirTaken = node.dir
          node = prev.get(key(cellX, cellY))!
        }
        return { x: cellX, y: cellY, dir: dirTaken }
      }
      queue.push({ x: nx, y: ny })
    }
  }
  return null
}

const PAC_START: Pt = { x: 1, y: 1 }
const GHOST_START: Pt = { x: 11, y: 10 }
// must be an OPEN path cell (row 6 index 5 = 0), not a wall block
const CHERRY_START: Pt = { x: 5, y: 6 }

function initialDots(skip: Pt[]): Set<string> {
  const dots = new Set<string>()
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!isWall(x, y)) dots.add(key(x, y))
    }
  }
  for (const p of skip) dots.delete(key(p.x, p.y))
  return dots
}

// ----------------------------------------------------------------------------
// 1) PAC-MAN — direction is the state; context is only his own data
// ----------------------------------------------------------------------------
export type PacState = 'eating' | 'dead'
export interface PacCtx {
  x: number
  y: number
  dir: Dir
  mouth: Mouth
}
// `step` moves; `face` aims; `die`/`revive` flip the state
export type PacEv =
  | { type: 'step'; x: number; y: number }
  | { type: 'face'; dir: Dir }
  | { type: 'die' }
  | { type: 'revive' }

export interface PacComputed {
  mouthOpen: boolean
  isDead: boolean
}

export type PacMachine = Machine<PacState, PacCtx, PacEv, PacComputed>

export function createPacmanMachine(): PacMachine {
  return machine<PacState, PacCtx, PacEv, PacComputed>({
    initial: 'eating',
    context: { x: PAC_START.x, y: PAC_START.y, dir: 'right', mouth: 'open' },
    computed: {
      mouthOpen: ({ context }) => context.mouth === 'open',
      isDead: ({ state }) => state === 'dead',
    },
    // On every x-position change, toggle the mouth declaratively — replaces the
    // inline mouth flip that used to live inside the `step` action.
    watch: {
      x: [act(({ context }) => ({ mouth: context.mouth === 'open' ? 'closed' : 'open' }))],
    },
    states: {
      eating: {
        on: {
          face: { actions: [act(({ event }) => ({ dir: event.dir }))] },
          step: {
            guard: ({ computed }) => !computed.isDead,
            actions: [act(({ event }) => ({ x: event.x, y: event.y }))],
          },
          die: { target: 'dead' },
        },
      },
      dead: {
        // Auto-revive after 1.2s — makes the dead state observable (a beat of
        // feedback) before the next round starts. Cancelled immediately if the
        // manual `revive` event arrives first.
        after: {
          1200: {
            target: 'eating',
            actions: [act({ ...PAC_START, dir: 'right' as Dir, mouth: 'open' as Mouth })],
          },
        },
        on: {
          // Manual override — allows forcing an early revive without waiting for
          // the 1.2s timer (e.g. an instant-reset triggered from the board).
          revive: {
            target: 'eating',
            actions: [act({ ...PAC_START, dir: 'right' as Dir, mouth: 'open' as Mouth })],
          },
        },
      },
    },
  })
}

// ----------------------------------------------------------------------------
// 2) GHOST — holds its own info; a tick chases Pac-Man
// ----------------------------------------------------------------------------
export type GhostState = 'roaming' | 'stopped'
export interface GhostCtx {
  x: number
  y: number
  dir: Dir
  /** Tick parity — the ghost skips every other tick to keep a step behind Pac. */
  phase: number
}
export type GhostEv =
  | { type: 'tick'; targetX: number; targetY: number }
  | { type: 'stop' }
  | { type: 'reset' }

export interface GhostComputed {
  isChasing: boolean
}

export type GhostMachine = Machine<GhostState, GhostCtx, GhostEv, GhostComputed>

export function createGhostMachine(): GhostMachine {
  // The ghost is a touch slower than Pac-Man: it BFS-chases the shortest path,
  // but skips every other tick so Pac keeps a lead and catches are occasional
  // (a real chase) rather than instant. `phase` lives in context so it's part of
  // the machine's observable state — no hidden closure counter.
  const chase: Action<GhostCtx, GhostEv, GhostComputed> = ({ event, context, setContext }) => {
    if (event.type !== 'tick') return
    const nextPhase = (context.phase + 1) % 2
    setContext({ phase: nextPhase })
    if (nextPhase === 0) return
    const step = bfsStep(context.x, context.y, event.targetX, event.targetY)
    if (step) setContext({ x: step.x, y: step.y, dir: step.dir })
  }

  return machine<GhostState, GhostCtx, GhostEv, GhostComputed>({
    initial: 'roaming',
    context: { x: GHOST_START.x, y: GHOST_START.y, dir: 'up', phase: 0 },
    computed: {
      isChasing: ({ state }) => state === 'roaming',
    },
    states: {
      roaming: {
        effects: [() => () => {}],
        on: {
          tick: { actions: [chase] },
          stop: { target: 'stopped' },
        },
      },
      stopped: {
        on: {
          reset: {
            target: 'roaming',
            actions: [act({ ...GHOST_START, dir: 'up' as Dir, phase: 0 })],
          },
        },
      },
    },
  })
}

// ----------------------------------------------------------------------------
// 3) BOARD — the shared/general info (dots, cherry, score, status)
// ----------------------------------------------------------------------------
export type BoardState = 'playing' | 'caught'
export interface BoardCtx {
  dots: Set<string>
  cherry: Pt | null
  score: number
  status: 'playing' | 'caught'
}
export type BoardEv = { type: 'eat'; x: number; y: number } | { type: 'caught' } | { type: 'reset' }

export interface BoardComputed {
  dotCount: number
  hasCherry: boolean
  isPerfect: boolean
}

export type BoardMachine = Machine<BoardState, BoardCtx, BoardEv, BoardComputed>

export function createBoardMachine(): BoardMachine {
  const eat: Action<BoardCtx, BoardEv, BoardComputed> = ({ event, context, setContext }) => {
    if (event.type !== 'eat') return
    const dots = context.dots
    let score = context.score
    let cherry = context.cherry
    if (dots.has(key(event.x, event.y))) {
      dots.delete(key(event.x, event.y))
      score += 10
    }
    if (cherry && cherry.x === event.x && cherry.y === event.y) {
      cherry = null
      score += 100
    }
    // refill so the board never empties
    const refilled = dots.size === 0 ? initialDots([{ x: event.x, y: event.y }]) : dots
    setContext({ dots: refilled, cherry, score })
  }

  return machine<BoardState, BoardCtx, BoardEv, BoardComputed>({
    initial: 'playing',
    context: {
      dots: initialDots([PAC_START, GHOST_START]),
      cherry: { ...CHERRY_START },
      score: 0,
      status: 'playing',
    },
    computed: {
      dotCount: ({ context }) => context.dots.size,
      hasCherry: ({ context }) => context.cherry !== null,
      isPerfect: ({ context }) => context.score > 0 && context.dots.size === 0,
    },
    // Fire whenever score crosses a 100-point milestone.
    watch: {
      score: [
        ({ context }) => {
          if (context.score > 0 && context.score % 100 === 0) {
            // score milestone reached — hook point for celebratory effects
          }
        },
      ],
    },
    states: {
      playing: {
        on: {
          eat: { actions: [eat] },
          caught: {
            target: 'caught',
            actions: [act({ status: 'caught' as BoardCtx['status'] })],
          },
        },
      },
      caught: {
        on: {
          reset: {
            target: 'playing',
            actions: [
              act({
                dots: initialDots([PAC_START, GHOST_START]),
                cherry: { ...CHERRY_START } as Pt | null,
                score: 0,
                status: 'playing' as BoardCtx['status'],
              }),
            ],
          },
        },
      },
    },
  })
}

// ----------------------------------------------------------------------------
// The autopilot brain — decides Pac-Man's next direction each cell.
//   • scan all 4 dirs; keep the OPEN ones that have a score point;
//   • if any score: when the current dir scores, 70% keep straight and 30% split
//     among the other scoring dirs; if current doesn't score, split among them;
//   • if none score: keep straight if open, else first clockwise-available dir
//     (scanning clockwise starting from the right of current travel).
// ----------------------------------------------------------------------------
function scores(board: BoardCtx, x: number, y: number): boolean {
  return (
    board.dots.has(key(x, y)) || !!(board.cherry && board.cherry.x === x && board.cherry.y === y)
  )
}
const open = (x: number, y: number, dir: Dir) => !isWall(x + DELTA[dir].x, y + DELTA[dir].y)

export function nextDir(pac: PacCtx, board: BoardCtx): Dir {
  const { x, y, dir } = pac
  // clockwise scan order starting from the dir to the right of current travel
  const start = cwRightOf(dir)
  const cwFrom = CW.slice(CW.indexOf(start)).concat(CW.slice(0, CW.indexOf(start)))

  const scoring = (['right', 'left', 'up', 'down'] as Dir[]).filter(
    d => open(x, y, d) && scores(board, x + DELTA[d].x, y + DELTA[d].y),
  )

  if (scoring.length) {
    const currentScores = scoring.includes(dir)
    const others = scoring.filter(d => d !== dir)
    if (currentScores) {
      // 70% keep straight; 30% split among other scoring dirs
      if (!others.length || Math.random() < 0.7) return dir
      return others[(Math.random() * others.length) | 0]
    }
    // current doesn't score → pick among scoring dirs, clockwise-first order
    for (const d of cwFrom) if (scoring.includes(d)) return d
    return scoring[0]
  }

  // No score point adjacent → head toward the NEAREST one (BFS), so Pac never
  // loops in an eaten-clean region. This is the fix for "keeps in a loop".
  const targets: Pt[] = []
  for (const d of board.dots) {
    const [dx, dy] = d.split(',').map(Number)
    targets.push({ x: dx, y: dy })
  }
  if (board.cherry) targets.push(board.cherry)
  const toward = bfsToward(x, y, targets)
  if (toward) return toward

  // nothing reachable (shouldn't happen) → keep straight if open, else turn
  if (open(x, y, dir)) return dir
  const back = OPPOSITE[dir]
  for (const d of cwFrom) if (d !== back && open(x, y, d)) return d
  return open(x, y, back) ? back : dir
}

// BFS from (sx,sy) to the nearest of `targets`; returns the first step's dir.
function bfsToward(sx: number, sy: number, targets: Pt[]): Dir | null {
  if (!targets.length) return null
  const goal = new Set(targets.map(t => key(t.x, t.y)))
  const prev = new Map<string, { px: number; py: number; dir: Dir }>()
  const queue: Pt[] = [{ x: sx, y: sy }]
  const seen = new Set([key(sx, sy)])
  while (queue.length) {
    const cur = queue.shift()!
    for (const dir of ['right', 'left', 'up', 'down'] as Dir[]) {
      const nx = cur.x + DELTA[dir].x
      const ny = cur.y + DELTA[dir].y
      const k = key(nx, ny)
      if (isWall(nx, ny) || seen.has(k)) continue
      seen.add(k)
      prev.set(k, { px: cur.x, py: cur.y, dir })
      if (goal.has(k)) {
        // Walk predecessors back to the START; the record whose predecessor IS
        // the start carries the FIRST step's direction (the one to return).
        let rec = prev.get(k)!
        while (!(rec.px === sx && rec.py === sy)) {
          rec = prev.get(key(rec.px, rec.py))!
        }
        return rec.dir
      }
      queue.push({ x: nx, y: ny })
    }
  }
  return null
}

// ----------------------------------------------------------------------------
// GAME — compose the three + orchestrate the shared tick in order.
// ----------------------------------------------------------------------------
export interface Game {
  group: Composition<{ pacman: PacMachine; ghost: GhostMachine; board: BoardMachine }>
  pacman: PacMachine
  ghost: GhostMachine
  board: BoardMachine
  /** Steer Pac-Man immediately (re-aims his direction). */
  face: (dir: Dir) => void
  /**
   * One shared game step, fanned to all three machines in dependency order.
   * Pass `forced` to steer this step (player input); otherwise the autopilot
   * brain (nextDir) decides.
   */
  tick: (forced?: Dir) => void
}

export function createGame(): Game {
  const pacman = createPacmanMachine()
  const ghost = createGhostMachine()
  const board = createBoardMachine()
  const group = compose({ pacman, ghost, board })

  const face = (dir: Dir) => pacman.send({ type: 'face', dir })

  const caught = (px: number, py: number, gx: number, gy: number) => px === gx && py === gy

  // Did we already reset the ghost/board for the current death? Prevents the
  // per-tick reset that flips the ghost back to `roaming` (re-showing it) while
  // pacman is still dead — that's what put the skull AND the ghost on the board
  // together. We hold everything frozen during `dead`, then reset ONCE the tick
  // pacman has revived, so the whole board comes back in sync.
  let resetPending = false

  const tick = (forced?: Dir) => {
    // While dead, freeze: pacman shows the skull, the ghost stays `stopped`
    // (hidden). The `after` timer on the dead state auto-revives pacman; we just
    // mark that a ghost/board reset is owed for when it comes back.
    if (pacman.state === 'dead') {
      resetPending = true
      return
    }

    // First tick after revival: bring the ghost and board back together, in sync
    // with the freshly-revived pacman.
    if (resetPending) {
      resetPending = false
      ghost.send({ type: 'reset' })
      board.send({ type: 'reset' })
    }

    // SNAPSHOT old positions: ctx is a live reference (the engine mutates it in
    // place), so capture the values now — after `step`, pac.x/y would read NEW.
    const pac = pacman.context
    const px0 = pac.x
    const py0 = pac.y
    const gx0 = ghost.context.x
    const gy0 = ghost.context.y

    // 1) decide + face, then step Pac-Man. A forced dir (player input) wins, but
    //    only if open — else autopilot. Guard: if the chosen direction is blocked,
    //    fall back to ANY open direction so Pac can never freeze facing a wall.
    let want =
      forced && !isWall(px0 + DELTA[forced].x, py0 + DELTA[forced].y)
        ? forced
        : nextDir(pac, board.context)
    if (isWall(px0 + DELTA[want].x, py0 + DELTA[want].y)) {
      const escape = (['right', 'down', 'left', 'up'] as Dir[]).find(
        d => !isWall(px0 + DELTA[d].x, py0 + DELTA[d].y),
      )
      if (escape) want = escape
    }
    if (want !== pac.dir) pacman.send({ type: 'face', dir: want })
    const nd = pacman.context.dir // re-read: face updated context.dir
    let nx = px0 + DELTA[nd].x
    let ny = py0 + DELTA[nd].y
    if (isWall(nx, ny)) {
      nx = px0
      ny = py0
    }
    pacman.send({ type: 'step', x: nx, y: ny })

    // 2) board eats at Pac-Man's new cell
    board.send({ type: 'eat', x: nx, y: ny })

    // 3) ghost chases toward Pac-Man's new cell
    ghost.send({ type: 'tick', targetX: nx, targetY: ny })
    const g = ghost.context

    // 4) catch detection over the WHOLE tick, not just final cells. Pac and the
    //    ghost each move one step; they collide if their paths touch at any point:
    //      • they end on the same cell;
    //      • they swap cells (cross through each other);
    //      • the ghost ends where Pac started (it caught up to him);
    //      • Pac ends where the ghost started (he walked into it).
    //    The earlier "touching but no kill" bug came from only checking same-cell.
    const sameCell = caught(nx, ny, g.x, g.y)
    const swapped = g.x === px0 && g.y === py0 && nx === gx0 && ny === gy0
    const ghostOntoPac = g.x === px0 && g.y === py0
    const pacOntoGhost = nx === gx0 && ny === gy0
    if (sameCell || swapped || ghostOntoPac || pacOntoGhost) {
      pacman.send({ type: 'die' }) // pacman → dead (after 1.2s timer will revive)
      ghost.send({ type: 'stop' }) // ghost → stopped
      board.send({ type: 'caught' }) // board → caught
    }
  }

  return { group, pacman, ghost, board, face, tick }
}
