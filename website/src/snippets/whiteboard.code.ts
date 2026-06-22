const { createMachine } = setup.as<CursorCtx, CursorEv, CursorComputed>().config({
  guards: { arrived: $ => $.context.progress >= 1 },
  actions: {
    stepProgress: act($ => ({
      progress: Math.min(1, $.context.progress + $.context.speed),
      x: $.computed.ex,
      y: $.computed.ey,
    })),
    pickNewTarget: ({ context, setContext }) =>
      setContext({
        x0: context.x,
        y0: context.y,
        x1: 6 + Math.random() * 86,
        y1: 6 + Math.random() * 86,
        progress: 0,
      }),
  },
  delays: { idlePause: $ => $.context.pauseMs },
})

const cursor = createMachine({
  computed: {
    // eased position: rendered directly by subscribers
    ex: $ => $.context.x0 + ($.context.x1 - $.context.x0) * easeInOut($.context.progress),
    ey: $ => $.context.y0 + ($.context.y1 - $.context.y0) * easeInOut($.context.progress),
  },
  states: {
    idle: {
      entry: ['setPauseMs'],
      after: {
        idlePause: {
          target: 'moving',
          actions: ['pickNewTarget'],
        },
      },
    },
    moving: {
      after: {
        16: [
          // ≈60fps self-driving loop via after timer
          {
            guard: 'arrived',
            target: 'idle',
          },
          {
            actions: ['stepProgress'],
            target: 'moving',
          },
        ],
      },
    },
  },
})

const sticky = createMachine({
  computed: {
    normalizedX: $ => Math.min(85, $.context.x),
    normalizedY: $ => Math.min(80, $.context.y),
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
        DRAG_MOVE: { actions: ['moveTo'] },
        DROP: { target: 'placed' },
      },
    },
  },
})

compose({ ...cursors, ...stickies }).start()
