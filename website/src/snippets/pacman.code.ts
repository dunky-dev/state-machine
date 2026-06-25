// 🟡 pacman
const pacman = machine({
  initial: 'eating',
  context: { x: 1, y: 1, dir: 'right', mouth: 'open' },
  states: {
    eating: {
      on: {
        step: {
          actions: act($ => ({
            x: $.event.x,
            y: $.event.y,
          })),
        },
        die: { target: 'dead' },
      },
    },
    dead: {
      on: {
        revive: { target: 'eating' },
      },
    },
  },
})

// 👻 ghost
const ghost = machine({
  initial: 'roaming',
  context: { x: 11, y: 10, dir: 'up' },
  states: {
    roaming: {
      on: {
        tick: {
          actions: act($ => chase($.context, $.event)),
        },
        stop: { target: 'stopped' },
      },
    },
    stopped: {
      on: {
        reset: { target: 'roaming' },
      },
    },
  },
})

// 🍒 board
const board = machine({
  initial: 'playing',
  context: { dots, cherry, score: 0 },
  states: {
    playing: {
      on: {
        eat: {
          actions: act($ => scoreAt($.context, $.event)),
        },
        caught: { target: 'caught' },
      },
    },
    caught: {
      on: {
        reset: { target: 'playing' },
      },
    },
  },
})

// ⏱️ clock: self-drives via `after`, no external loop
const clock = machine({
  initial: 'running',
  states: {
    running: {
      after: {
        200: { target: 'running' },
      },
    },
  },
})

// 🎲 compose: sync() fans each clock beat to all regions in order
const game = compose({ clock, pacman, ghost, board })
game.sync(() => {
  const { x, y } = step(pacman.context)
  pacman.send({ type: 'step', x, y })
  board.send({ type: 'eat', x, y })
  ghost.send({ type: 'tick', targetX: x, targetY: y })
})

game.start()
