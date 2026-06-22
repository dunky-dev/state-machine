const { createMachine } = setup.as<PairContext, PairEvent, PairComputed>().config({
  guards: {
    canBuy: $ => $.context.entryPrice === 0,
    canSell: $ => $.context.entryPrice > 0,
  },
  actions: {
    recordEntry: act($ => ({ entryPrice: $.context.price })),
    updatePrice: act($ => ({
      prevPrice: $.context.price,
      price: $.event.price,
      history: [...$.context.history.slice(-79), $.event.price],
    })),
  },
  effects: {
    priceTicker: ({ send }) => {
      const id = setInterval(
        () =>
          send({
            type: 'TICK',
            price: randomWalk(),
          }),
        350,
      )
      return () => clearInterval(id) // ← cleanup on state exit
    },
  },
})

const pair = createMachine({
  initial: 'idle',
  context: {
    price,
    prevPrice: price,
    history: [price],
    entryPrice: 0,
    pnl: 0,
  },
  computed: {
    pnl: $ => $.context.price - $.context.entryPrice,
    delta: $ => $.context.price - $.context.prevPrice,
    isUp: $ => $.context.price >= $.context.prevPrice,
  },
  on: {
    TICK: {
      actions: ['updatePrice'],
    },
  }, // ← fires in all states
  watch: {
    price: [
      $ => {
        if ($.context.entryPrice > 0) {
          $.setContext({ pnl: $.context.price - $.context.entryPrice })
        }
      },
    ],
  },
  states: {
    idle: {
      effects: ['priceTicker'],
      on: {
        BUY: { guard: 'canBuy', target: 'buying' },
      },
    },
    buying: {
      on: {
        CANCEL: { target: 'idle' },
      },
      after: {
        2000: { target: 'holding', actions: ['recordEntry'] },
      },
    },
    holding: {
      on: {
        SELL: { guard: 'canSell', target: 'selling' },
      },
    },
    selling: {
      after: {
        600: {
          target: 'idle',
          actions: [act({ entryPrice: 0, pnl: 0 })],
        },
      },
    },
  },
})
