import {
  machine,
  setup,
  act,
  compose,
  type Action,
  type Machine,
  type Composition,
} from '@chimba-ui/state-machine'

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
}

// ---------------------------------------------------------------------------
// 1) Cursor machine
// ---------------------------------------------------------------------------

export interface CursorCtx {
  /** Current rendered position (eased). */
  x: number
  y: number
  /** Animation start position. */
  x0: number
  y0: number
  /** Animation target position (% of canvas). */
  x1: number
  y1: number
  /** 0..1 progress along the current move. */
  progress: number
  /** Per-cursor speed (progress units per 16 ms tick). */
  speed: number
  /** How long to pause in idle before picking the next target (ms). */
  pauseMs: number
}

export type CursorEv =
  | { type: 'PICK_TARGET'; x: number; y: number }
  | { type: 'ARRIVED' }
  | { type: 'PAUSE_END' }

export interface CursorComputed {
  distance: number
  ex: number
  ey: number
}

export type CursorState = 'idle' | 'moving'
export type CursorMachine = Machine<CursorState, CursorCtx, CursorEv, CursorComputed>

const { createMachine: createCursorConfig } = setup<CursorCtx, CursorEv, CursorComputed>().config({
  guards: {
    hasTarget: ({ context }) => context.x1 !== context.x0 || context.y1 !== context.y0,
    arrived: ({ context }) => context.progress >= 1,
  },
  actions: {
    setTarget: (({ context, event, setContext }) => {
      if (event.type !== 'PICK_TARGET') return
      setContext({ x0: context.x, y0: context.y, x1: event.x, y1: event.y, progress: 0 })
    }) satisfies Action<CursorCtx, CursorEv, CursorComputed>,
    stepProgress: act($ => ({
      progress: Math.min(1, $.context.progress + $.context.speed),
      x: $.computed.ex,
      y: $.computed.ey,
    })),
    pickNewTarget: ({ context, setContext }) => {
      setContext({
        x0: context.x,
        y0: context.y,
        x1: 6 + Math.random() * 86,
        y1: 6 + Math.random() * 86,
        progress: 0,
      })
    },
    setPauseMs: act($ => ({
      pauseMs: 800 + ((Math.abs($.context.x * 17 + $.context.y * 31) | 0) % 2200),
    })),
  },
  delays: {
    idlePause: ({ context }) => context.pauseMs,
  },
})

export function createCursorMachine(
  id: string,
  color: string,
  name: string,
  initialX: number,
  initialY: number,
): CursorMachine {
  void id
  void color
  void name

  return machine(
    createCursorConfig({
      initial: 'idle',
      context: {
        x: initialX,
        y: initialY,
        x0: initialX,
        y0: initialY,
        x1: initialX,
        y1: initialY,
        progress: 0,
        speed: 0.025 + Math.random() * 0.025,
        pauseMs: 800 + Math.floor(Math.random() * 2200),
      },
      computed: {
        distance: ({ context }) => Math.hypot(context.x1 - context.x0, context.y1 - context.y0),
        ex: ({ context }) => context.x0 + (context.x1 - context.x0) * easeInOut(context.progress),
        ey: ({ context }) => context.y0 + (context.y1 - context.y0) * easeInOut(context.progress),
      },
      states: {
        idle: {
          // On entry: lock in a pseudo-random pause duration based on position.
          entry: ['setPauseMs'],
          after: {
            idlePause: {
              target: 'moving',
              actions: ['pickNewTarget'],
            },
          },
        },
        moving: {
          // Self-driving 16 ms loop (≈60 fps).
          // • progress >= 1 → transition to idle (arrived).
          // • otherwise     → step progress + re-enter moving to schedule the next tick.
          after: {
            16: [
              { guard: 'arrived', target: 'idle' },
              { actions: ['stepProgress'], target: 'moving' },
            ],
          },
        },
      },
    }),
  )
}

// ---------------------------------------------------------------------------
// 2) Sticky-note machine
// ---------------------------------------------------------------------------

export interface StickyCtx {
  x: number
  y: number
  dragOffsetX: number
  dragOffsetY: number
}

export type StickyEv =
  | { type: 'DRAG_START'; offsetX: number; offsetY: number }
  | { type: 'DRAG_MOVE'; clientX: number; clientY: number; canvasRect: DOMRect }
  | { type: 'DROP' }

export interface StickyComputed {
  normalizedX: number
  normalizedY: number
}

export type StickyState = 'placed' | 'dragging'
export type StickyMachine = Machine<StickyState, StickyCtx, StickyEv, StickyComputed>

const { createMachine: createStickyConfig } = setup<StickyCtx, StickyEv, StickyComputed>().config({
  actions: {
    startDrag: (({ event, setContext }) => {
      if (event.type !== 'DRAG_START') return
      setContext({ dragOffsetX: event.offsetX, dragOffsetY: event.offsetY })
    }) satisfies Action<StickyCtx, StickyEv, StickyComputed>,
    moveTo: (({ event, context, setContext }) => {
      if (event.type !== 'DRAG_MOVE') return
      setContext({
        x:
          ((event.clientX - event.canvasRect.left - context.dragOffsetX) / event.canvasRect.width) *
          100,
        y:
          ((event.clientY - event.canvasRect.top - context.dragOffsetY) / event.canvasRect.height) *
          100,
      })
    }) satisfies Action<StickyCtx, StickyEv, StickyComputed>,
  },
})

export function createStickyMachine(id: string, initialX: number, initialY: number): StickyMachine {
  void id

  return machine(
    createStickyConfig({
      initial: 'placed',
      context: {
        x: initialX,
        y: initialY,
        dragOffsetX: 0,
        dragOffsetY: 0,
      },
      computed: {
        normalizedX: ({ context }) => Math.max(0, Math.min(85, context.x)),
        normalizedY: ({ context }) => Math.max(0, Math.min(80, context.y)),
      },
      states: {
        placed: {
          on: {
            DRAG_START: {
              target: 'dragging',
              actions: ['startDrag'],
            },
          },
        },
        dragging: {
          on: {
            DRAG_MOVE: {
              actions: ['moveTo'],
            },
            DROP: {
              target: 'placed',
            },
          },
        },
      },
    }),
  )
}

// ---------------------------------------------------------------------------
// 3) Whiteboard demo — compose all 10 cursors + 2 stickies
// ---------------------------------------------------------------------------

export const CURSOR_COLORS = [
  '#ff5d52',
  '#ffe66d',
  '#a2e57b',
  '#62b3ff',
  '#c8a9f0',
  '#ff9f7e',
  '#4dd9c0',
  '#f472b6',
  '#94a3b8',
  '#fb923c',
]

export const CURSOR_NAMES = [
  'alice',
  'bob',
  'carol',
  'dave',
  'eve',
  'frank',
  'grace',
  'hiro',
  'ines',
  'jan',
]

type CursorKey = 'c0' | 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'c7' | 'c8' | 'c9'
type StickyKey = 's0' | 's1'
type WhiteboardMembers = Record<CursorKey, CursorMachine> & Record<StickyKey, StickyMachine>

export interface WhiteboardDemo {
  group: Composition<WhiteboardMembers>
  cursors: CursorMachine[]
  stickies: StickyMachine[]
}

export function createWhiteboardDemo(): WhiteboardDemo {
  const cursors: CursorMachine[] = CURSOR_NAMES.map((name, i) =>
    createCursorMachine(`cursor-${i}`, CURSOR_COLORS[i]!, name, 10 + i * 8, 10 + (i % 3) * 30),
  )

  const stickies: StickyMachine[] = [
    createStickyMachine('sticky-0', 20, 25),
    createStickyMachine('sticky-1', 60, 55),
  ]

  const [c0, c1, c2, c3, c4, c5, c6, c7, c8, c9] = cursors as [
    CursorMachine,
    CursorMachine,
    CursorMachine,
    CursorMachine,
    CursorMachine,
    CursorMachine,
    CursorMachine,
    CursorMachine,
    CursorMachine,
    CursorMachine,
  ]

  const [s0, s1] = stickies as [StickyMachine, StickyMachine]

  const group = compose<WhiteboardMembers>({
    c0,
    c1,
    c2,
    c3,
    c4,
    c5,
    c6,
    c7,
    c8,
    c9,
    s0,
    s1,
  })

  return { group, cursors, stickies }
}
