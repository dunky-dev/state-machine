import React from 'react'
import { createFeed } from './feed'
import { PANELS, type PanelId } from './metrics'
import { Panel, type PanelHandle } from './panels'

const SIZES = [16, 24, 32, 48, 64] // → 256 … 4,096 cells / panel
const DEFAULT_SIDE = 48 // 2,304
// Equal per-panel budget each frame to apply its queue. A cheaper-per-update
// engine clears MORE of its queue per budget → smaller backlog. This is what
// turns backlog into a proxy for per-update engine cost.
const DRAIN_BUDGET_MS = 2
const RAMP_START = 1000
const RAMP_STEP = 1500
const RAMP_EVERY_MS = 1200
const PAINT_EVERY_MS = 100 // throttle canvas paint to ~10fps (off the hot path)
const OVERFLOW_AT = 3000 // backlog over this = decisively "falling behind"
const STOP_GRACE_MS = 1000 // after all 3 cross, keep going briefly so the lag is visible

const ENGINE_IDS: PanelId[] = ['chimba', 'xstate', 'zag'] // raw doesn't count

type Stat = {
  backlog: number
  appliedPerSec: number
  // queued amount captured the moment this panel first overflowed (null = keeping up)
  overflowedAt: number | null
}
const blankStat = (): Stat => ({ backlog: 0, appliedPerSec: 0, overflowedAt: null })
const zeroStats = (): Record<PanelId, Stat> => ({
  raw: blankStat(),
  chimba: blankStat(),
  xstate: blankStat(),
  zag: blankStat(),
})

export function App() {
  const [side, setSide] = React.useState(DEFAULT_SIDE)
  const [running, setRunning] = React.useState(false)
  const [fps, setFps] = React.useState(0)
  const [rate, setRate] = React.useState(0)
  const [stats, setStats] = React.useState<Record<PanelId, Stat>>(zeroStats)

  const size = side * side
  const feed = React.useMemo(() => createFeed(size), [size])

  const handles = React.useRef<Record<PanelId, PanelHandle | null>>({
    raw: null,
    chimba: null,
    xstate: null,
    zag: null,
  })
  const loop = React.useRef(0)
  const runningRef = React.useRef(false)

  React.useEffect(() => () => cancelAnimationFrame(loop.current), [])

  function reset() {
    runningRef.current = false
    cancelAnimationFrame(loop.current)
    setRunning(false)
    setFps(0)
    setRate(0)
    setStats(zeroStats())
    // drop each panel's queue/applied state so the next run starts clean
    for (const id of Object.keys(handles.current) as PanelId[]) handles.current[id]?.clear()
  }

  function start() {
    if (runningRef.current) {
      reset() // Stop = reset the whole interface to idle
      return
    }
    reset() // clean slate before a fresh run
    runningRef.current = true
    setRunning(true)
    let curRate = RAMP_START
    setRate(curRate)
    let lastRamp = performance.now()
    let lastSample = performance.now()
    let lastPaint = performance.now()
    let frames = 0
    let allBehindSince = 0 // timestamp when all 3 engines first crossed
    const applied: Record<PanelId, number> = { raw: 0, chimba: 0, xstate: 0, zag: 0 }
    // queued captured at first overflow, per panel (persists across samples)
    const overflowedAt: Record<PanelId, number | null> = {
      raw: null,
      chimba: null,
      xstate: null,
      zag: null,
    }
    const ids = Object.keys(handles.current) as PanelId[]

    const frame = (now: number) => {
      if (!runningRef.current) return
      frames++

      if (now - lastRamp >= RAMP_EVERY_MS) {
        curRate += RAMP_STEP
        lastRamp = now
        setRate(curRate)
      }

      const batch = feed.pull(curRate)
      for (const id of ids) handles.current[id]?.enqueue(batch)
      for (const id of ids) {
        const r = handles.current[id]?.drain(DRAIN_BUDGET_MS)
        if (r) applied[id] += r.applied
      }

      if (now - lastPaint >= PAINT_EVERY_MS) {
        for (const id of ids) handles.current[id]?.paint()
        lastPaint = now
      }

      if (now - lastSample >= 250) {
        const secs = (now - lastSample) / 1000
        setFps(Math.round(frames / secs))
        const next = zeroStats()
        for (const id of ids) {
          const backlog = handles.current[id]?.backlog() ?? 0
          // once a panel crosses the line it's "behind"; track the WORST backlog
          // it reaches (how many updates it ultimately couldn't keep up with)
          if (backlog > OVERFLOW_AT) {
            overflowedAt[id] = Math.max(overflowedAt[id] ?? 0, backlog)
          }
          next[id] = {
            backlog,
            appliedPerSec: Math.round(applied[id] / secs),
            overflowedAt: overflowedAt[id],
          }
          applied[id] = 0
        }
        setStats(next)
        frames = 0
        lastSample = now

        // auto-stop once ALL THREE engines have fallen behind — but give a short
        // grace so their backlogs grow to a representative size before freezing
        if (ENGINE_IDS.every(id => overflowedAt[id] !== null)) {
          if (allBehindSince === 0) allBehindSince = now
          else if (now - allBehindSince >= STOP_GRACE_MS) {
            runningRef.current = false
            cancelAnimationFrame(loop.current)
            setRunning(false)
            return
          }
        }
      }

      loop.current = requestAnimationFrame(frame)
    }
    loop.current = requestAnimationFrame(frame)
  }

  const fpsColor = fps >= 50 ? '#3fb950' : fps >= 30 ? '#d29922' : '#f85149'

  return (
    <div
      style={{
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        color: '#e6edf3',
        background: '#010409',
        minHeight: '100vh',
        padding: 20,
        boxSizing: 'border-box',
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 20 }}>Chimba UI — engine throughput, live</h1>
        <p style={{ margin: 0, opacity: 0.6, fontSize: 13, maxWidth: 920 }}>
          Every cell is a real state machine doing engine work per update — a guarded transition
          that feeds a computed. One change stream feeds all four; each gets an equal{' '}
          <b>{DRAIN_BUDGET_MS}ms/frame</b> to apply its queue, and the load ramps until they
          diverge. The grid is a throttled canvas heatmap (paint kept off the hot path), so what
          you're watching is <b>engine cost</b>. It runs until all three engines fall behind, then
          stops. Idle until you start.
        </p>
      </header>

      <div
        style={{
          display: 'flex',
          gap: 24,
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '12px 16px',
          border: '1px solid #30363d',
          borderRadius: 8,
          marginBottom: 12,
        }}
      >
        <button
          onClick={start}
          style={{
            padding: '8px 18px',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            borderRadius: 6,
            border: 'none',
            background: running ? '#da3633' : '#238636',
            color: 'white',
            minWidth: 90,
          }}
        >
          {running ? 'Stop' : 'Start'}
        </button>

        <label style={{ fontSize: 13 }}>
          cells / panel: <b>{size.toLocaleString()}</b>
          <br />
          <input
            type='range'
            min={0}
            max={SIZES.length - 1}
            value={SIZES.indexOf(side)}
            disabled={running}
            onChange={e => setSide(SIZES[Number(e.target.value)])}
          />
        </label>

        {/* load — the prominent "how hard we're pushing" readout */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            padding: '4px 14px',
            borderRadius: 6,
            background: '#161b22',
            border: '1px solid #30363d',
          }}
        >
          <span style={{ fontSize: 28, fontWeight: 700, color: '#d29922' }}>
            {rate.toLocaleString()}
          </span>
          <span style={{ fontSize: 13, opacity: 0.7 }}>updates/frame {running && '↑'}</span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: fpsColor }}>
            {running ? fps : '—'}
          </span>
          <span style={{ opacity: 0.6, fontSize: 13 }}>fps</span>
        </div>
      </div>

      <p style={{ margin: '0 0 16px', fontSize: 12, opacity: 0.55, maxWidth: 1000 }}>
        <b>updates/s</b> is the headline — how much engine work each clears under the same{' '}
        {DRAIN_BUDGET_MS}ms/frame budget (higher is better). The moment a panel can't keep up it
        latches a red <b>fell behind by N</b> flag (the backlog it had stacked up). They tip over
        one by one. <b>Vanilla</b> is the control (no engine), so it leads; the comparison that
        matters is Chimba vs XState vs Zag.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {PANELS.map(p => {
          const s = stats[p.id]
          const behind = s.overflowedAt !== null
          return (
            <div
              key={`${p.id}-${side}`}
              style={{
                border: `1px solid ${behind ? '#f85149' : '#30363d'}`,
                borderRadius: 8,
                padding: 12,
                background: '#0d1117',
                transition: 'border-color 200ms',
              }}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}
              >
                <strong style={{ fontSize: 14 }}>{p.label}</strong>
                <span style={{ fontSize: 12 }}>
                  <b style={{ color: '#58a6ff' }}>{s.appliedPerSec.toLocaleString()}</b>
                  <span style={{ opacity: 0.6 }}> updates/s</span>
                  {behind && (
                    <span style={{ color: '#f85149', fontWeight: 600 }}>
                      {' '}
                      · fell behind by {(s.overflowedAt ?? 0).toLocaleString()}
                    </span>
                  )}
                </span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.55, margin: '2px 0 10px', height: 16 }}>
                {p.blurb}
              </div>
              <Panel
                ref={el => {
                  handles.current[p.id] = el
                }}
                id={p.id}
                side={side}
                feed={feed}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
