/** Panel metadata, in display order. (Timing/backlog is owned by the app loop.) */

export type PanelId = 'raw' | 'chimba' | 'xstate' | 'zag'

// `raw` is the no-engine control and comes first; the three engines follow in a
// fixed sequence so the panels are always lined up the same way.
export const PANELS: { id: PanelId; label: string; blurb: string; isEngine: boolean }[] = [
  {
    id: 'raw',
    label: 'Raw JS (control)',
    blurb: 'no engine · the same guard walk + derive as plain JS',
    isEngine: false,
  },
  {
    id: 'chimba',
    label: 'Chimba UI',
    blurb: 'machine per cell · guarded transition + memoized computed',
    isEngine: true,
  },
  {
    id: 'xstate',
    label: 'XState',
    blurb: 'actor per cell · guarded transition + assign-derived field',
    isEngine: true,
  },
  {
    id: 'zag',
    label: 'Zag',
    blurb: 'VanillaMachine per cell · guarded transition + bindable cells',
    isEngine: true,
  },
]
