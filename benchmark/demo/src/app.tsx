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
const TEST_DURATION_MS = 30_000 // fixed-length "30s test" run

const ENGINE_IDS: PanelId[] = ['Dunky', 'xstate', 'zag'] // raw doesn't count

type Stat = {
  backlog: number
  appliedPerSec: number
  // queued amount captured the moment this panel first overflowed (null = keeping up)
  overflowedAt: number | null
}
const blankStat = (): Stat => ({ backlog: 0, appliedPerSec: 0, overflowedAt: null })
const zeroStats = (): Record<PanelId, Stat> => ({
  raw: blankStat(),
  Dunky: blankStat(),
  xstate: blankStat(),
  zag: blankStat(),
})

export function App() {
  const [side, setSide] = React.useState(DEFAULT_SIDE)
  const [running, setRunning] = React.useState(false)
  const [fps, setFps] = React.useState(0)
  const [rate, setRate] = React.useState(0)
  const [stats, setStats] = React.useState<Record<PanelId, Stat>>(zeroStats)
  // 0..1 remaining-time fraction during a 30s test (null = not a timed run)
  const [remaining, setRemaining] = React.useState<number | null>(null)

  const size = side * side
  const feed = React.useMemo(() => createFeed(size), [size])

  const handles = React.useRef<Record<PanelId, PanelHandle | null>>({
    raw: null,
    Dunky: null,
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
    setRemaining(null)
    setStats(zeroStats())
    // drop each panel's queue/applied state so the next run starts clean
    for (const id of Object.keys(handles.current) as PanelId[]) handles.current[id]?.clear()
  }

  function start(timed = false) {
    if (runningRef.current) {
      reset() // Stop = reset the whole interface to idle
      return
    }
    reset() // clean slate before a fresh run
    runningRef.current = true
    setRunning(true)
    if (timed) setRemaining(1)
    let curRate = RAMP_START
    setRate(curRate)
    const startedAt = performance.now()
    let lastRamp = startedAt
    let lastSample = startedAt
    let lastPaint = startedAt
    let frames = 0
    const applied: Record<PanelId, number> = { raw: 0, Dunky: 0, xstate: 0, zag: 0 }
    // queued captured at first overflow, per panel (persists across samples)
    const overflowedAt: Record<PanelId, number | null> = {
      raw: null,
      Dunky: null,
      xstate: null,
      zag: null,
    }
    const ids = Object.keys(handles.current) as PanelId[]

    const frame = async (now: number) => {
      if (!runningRef.current) return
      frames++

      if (timed) {
        const elapsed = now - startedAt
        setRemaining(Math.max(0, 1 - elapsed / TEST_DURATION_MS))
        if (elapsed >= TEST_DURATION_MS) {
          runningRef.current = false
          cancelAnimationFrame(loop.current)
          setRunning(false)
          setRemaining(0)
          return
        }
      }

      // Keep ramping the load only while at least one engine is still keeping up.
      // Once the last one falls behind we hold the rate steady — a timed run then
      // coasts at that frozen rate for the rest of the 30s.
      const allBehind = ENGINE_IDS.every(id => overflowedAt[id] !== null)
      if (!allBehind && now - lastRamp >= RAMP_EVERY_MS) {
        curRate += RAMP_STEP
        lastRamp = now
        setRate(curRate)
      }

      const batch = feed.pull(curRate)
      for (const id of ids) handles.current[id]?.enqueue(batch)
      // Drain each panel under its OWN 2ms wall-clock budget. Awaited (not fired
      // in parallel) so an async engine's flush resolves before we read its result
      // — each panel still captures its own t0, so the per-panel budget is intact;
      // they just don't overlap (same total drain time as the old synchronous loop,
      // ~panels × budget). A sync engine's drain resolves without yielding.
      for (const id of ids) {
        const r = await handles.current[id]?.drain(DRAIN_BUDGET_MS)
        if (r) applied[id] += r.applied
      }
      // Stop may have been pressed during an await — bail before scheduling more.
      if (!runningRef.current) return

      // Real wall-clock time AFTER the drains (await advanced it past the frame's
      // `now` timestamp). Paint/sample/ramp bookkeeping uses this so the windows
      // reflect actual elapsed time, including each engine's real drain cost.
      const t = performance.now()

      if (t - lastPaint >= PAINT_EVERY_MS) {
        for (const id of ids) handles.current[id]?.paint()
        lastPaint = t
      }

      if (t - lastSample >= 250) {
        const secs = (t - lastSample) / 1000
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
        lastSample = t

        // auto-stop the instant the LAST engine falls behind — freeze everything
        // immediately so the "fell behind by N" flags reflect the moment of
        // divergence and don't keep growing. A timed run ignores this and keeps
        // going for the full duration.
        if (!timed && ENGINE_IDS.every(id => overflowedAt[id] !== null)) {
          runningRef.current = false
          cancelAnimationFrame(loop.current)
          setRunning(false)
          return
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
      {/* shrinking top bar — full width at the start of a 30s test, drains to 0 */}
      {remaining !== null && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            background: '#161b22',
            zIndex: 10,
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${remaining * 100}%`,
              background: '#d29922',
              // no transition — driven each frame, so it tracks real elapsed time
            }}
          />
        </div>
      )}

      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 20 }}>Dunky — engine throughput, live</h1>
        <p style={{ margin: 0, opacity: 0.6, fontSize: 13, maxWidth: 920 }}>
          Every cell is a real state machine doing engine work per update — a guarded transition
          that feeds a computed. One change stream feeds all four; each gets an equal{' '}
          <b>{DRAIN_BUDGET_MS}ms/frame</b> to apply its queue, and the load ramps until they
          diverge. The grid is a throttled canvas heatmap (paint kept off the hot path), so what
          you're watching is <b>engine cost</b>. <b>Start</b> runs until all three engines fall
          behind, then stops; <b>30s test</b> runs the full half-minute regardless. Idle until you
          start.
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
          onClick={() => start(false)}
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
          🏁 {running ? 'Stop' : 'Start'}
        </button>

        <button
          onClick={() => start(true)}
          disabled={running}
          style={{
            padding: '8px 18px',
            fontSize: 14,
            fontWeight: 600,
            cursor: running ? 'default' : 'pointer',
            borderRadius: 6,
            border: 'none',
            background: '#1f6feb',
            color: 'white',
            opacity: running ? 0.4 : 1,
          }}
        >
          ⏱️ 30s test
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
        latches a red <b>fell behind by N</b> flag (the backlog it had stacked up). Watch the panels
        diverge as the load ramps. <b>Vanilla</b> is the control (no engine); the comparison that
        matters is Dunky vs XState vs Zag.
      </p>

      {/* auto-fit + minmax so the four panels wrap to fewer columns as the
          viewport narrows (4 → 2 → 1) instead of overflowing past the edge on
          phones/tablets. Pure CSS grid — no media query needed. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 12,
        }}
      >
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
