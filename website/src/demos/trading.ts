import {
  machine,
  setup,
  act,
  compose,
  type Machine,
  type Composition,
} from '@chimba-ui/state-machine'

// ---------------------------------------------------------------------------
// Pair machine — types
// ---------------------------------------------------------------------------

export type PairState = 'idle' | 'buying' | 'holding' | 'selling'

export interface PairContext {
  price: number
  prevPrice: number
  history: number[]
  entryPrice: number
  pnl: number
}

export interface PairComputed {
  pnl: number
  delta: number
  isUp: boolean
}

export type PairEvent =
  | { type: 'TICK'; price: number }
  | { type: 'BUY' }
  | { type: 'SELL' }
  | { type: 'CANCEL' }
  | { type: '_FILLED' }
  | { type: '_CLOSED' }

export type PairMachine = Machine<PairState, PairContext, PairEvent, PairComputed> & {
  symbol: string
}

// ---------------------------------------------------------------------------
// Pair machine — factory
// ---------------------------------------------------------------------------

export function createPairMachine(
  symbol: string,
  initialPrice: number,
  volatility: number,
): PairMachine {
  const { createMachine } = setup<PairContext, PairEvent, PairComputed>().config({
    guards: {
      canBuy: ({ context }) => context.entryPrice === 0,
      canSell: ({ context }) => context.entryPrice > 0,
      isProfit: ({ computed }) => computed.pnl > 0,
    },
    actions: {
      recordEntry: act($ => ({ entryPrice: $.context.price })),
      updatePrice: act($ => ({
        prevPrice: $.context.price,
        price: ($.event as Extract<PairEvent, { type: 'TICK' }>).price,
        history: [
          ...$.context.history.slice(-79),
          ($.event as Extract<PairEvent, { type: 'TICK' }>).price,
        ],
      })),
    },
    effects: {
      priceTicker: ({ send }) => {
        let current = initialPrice
        const id = setInterval(() => {
          // Gaussian-approximate random walk via Box-Muller
          const u1 = Math.random()
          const u2 = Math.random()
          const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2)
          current = Math.max(current + z * volatility, 0.0001)
          send({ type: 'TICK', price: current })
        }, 350)
        return () => clearInterval(id)
      },
    },
  })

  const config = createMachine({
    initial: 'idle',
    context: {
      price: initialPrice,
      prevPrice: initialPrice,
      history: [initialPrice],
      entryPrice: 0,
      pnl: 0,
    },

    computed: {
      pnl: ({ context }) => context.price - context.entryPrice,
      delta: ({ context }) => context.price - context.prevPrice,
      isUp: ({ context }) => context.price >= context.prevPrice,
    },

    // Global TICK handler — fires in ALL states so the price always updates.
    on: {
      TICK: { actions: ['updatePrice'] },
    },

    // Update pnl whenever price changes while we have an open position.
    watch: {
      price: [
        ({ context, setContext }) => {
          if (context.entryPrice > 0) {
            setContext({ pnl: context.price - context.entryPrice })
          }
        },
      ],
    },

    states: {
      idle: {
        // Start the price ticker when we enter idle; stop it on exit.
        effects: ['priceTicker'],
        on: {
          BUY: { guard: 'canBuy', target: 'buying' },
        },
      },

      buying: {
        on: {
          CANCEL: { target: 'idle' },
        },
        // Simulate order-fill delay: after 2s transition to holding and
        // record the fill price as the entry price.
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
        // Simulate close delay: after 600 ms return to idle and clear entry.
        after: {
          600: { target: 'idle', actions: [act({ entryPrice: 0, pnl: 0 })] },
        },
      },
    },
  })

  const m = machine(config) as PairMachine
  // Attach the symbol for callers that want to display/key by it.
  ;(m as { symbol: string }).symbol = symbol
  return m
}

// ---------------------------------------------------------------------------
// Pair config for the three demo pairs
// ---------------------------------------------------------------------------

interface PairSpec {
  symbol: string
  initialPrice: number
  volatility: number
}

export const PAIRS: PairSpec[] = [
  { symbol: 'USDEUR', initialPrice: 0.9234, volatility: 0.0008 },
  { symbol: 'USDJPY', initialPrice: 157.42, volatility: 0.15 },
  { symbol: 'BTCUSD', initialPrice: 67420, volatility: 180 },
]

// ---------------------------------------------------------------------------
// Composition — three pairs grouped under one lifecycle
// ---------------------------------------------------------------------------

export type TradingDemoMembers = Record<string, PairMachine> & {
  usdeur: PairMachine
  usdjpy: PairMachine
  btcusd: PairMachine
}

export interface TradingDemo {
  /** The composed group — call group.start() / group.stop() for the demo. */
  group: Composition<TradingDemoMembers>
  /** The three pair machines in insertion order (same as `symbols`). */
  pairs: PairMachine[]
  /** The three symbol strings in the same order as `pairs`. */
  symbols: string[]
}

export function createTradingDemo(): TradingDemo {
  const usdeur = createPairMachine(PAIRS[0].symbol, PAIRS[0].initialPrice, PAIRS[0].volatility)
  const usdjpy = createPairMachine(PAIRS[1].symbol, PAIRS[1].initialPrice, PAIRS[1].volatility)
  const btcusd = createPairMachine(PAIRS[2].symbol, PAIRS[2].initialPrice, PAIRS[2].volatility)

  const group = compose<TradingDemoMembers>({ usdeur, usdjpy, btcusd })

  const pairs: PairMachine[] = [usdeur, usdjpy, btcusd]
  const symbols: string[] = PAIRS.map(p => p.symbol)

  return { group, pairs, symbols }
}
