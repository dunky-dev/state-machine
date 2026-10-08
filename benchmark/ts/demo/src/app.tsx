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
const TEST_DURATION_MS = 15_000 // fixed-length "15s test" run

const ENGINE_IDS: PanelId[] = ['Dunky', 'xstate', 'zag'] // raw doesn't count

// Dark theme palette. Page is a slightly lighter dark than the black boxes
// (cards / control bar are #010409) so they read as distinct surfaces.
const PAGE_BG = '#0d1117'
const FG = '#ffffff'
const BORDER = '#30363d'
const GREEN = '#3fb950'
const RED = '#f85149'

type Stat = {
  backlog: number
  appliedPerSec: number
  // total updates this panel applied over the whole run (the "N ops" readout).
  totalOps: number
  // seconds this panel survived before its backlog crossed OVERFLOW_AT (null =
  // never fell behind). Time-to-divergence is monotonic with engine speed — a
  // faster engine holds the rising load longer — so it ranks the engines the
  // same way updates/s does, unlike the backlog magnitude (which depended on the
  // ramp rate at the divergence instant and read backwards).
  fellBehindAtSec: number | null
}
const blankStat = (): Stat => ({
  backlog: 0,
  appliedPerSec: 0,
  totalOps: 0,
  fellBehindAtSec: null,
})
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
  // 0..1 progress of the current run — drives the red top bar. For a timed run
  // it's elapsed/duration; for survival it's how many engines have fallen behind.
  // null = idle (no run, bar hidden).
  const [progress, setProgress] = React.useState<number | null>(null)
  // tracks whether the active run is a timed (15s) one
  const [isTimedRun, setIsTimedRun] = React.useState(false)
  // true once a 15s test has run to completion — only THEN do we reveal the
  // "fell behind by N" flags for a timed run (they're hidden mid-run so the
  // coasting backlog doesn't read as a live verdict).
  const [timedDone, setTimedDone] = React.useState(false)

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
    setProgress(null)
    setIsTimedRun(false)
    setTimedDone(false)
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
    setIsTimedRun(timed)
    setProgress(0)
    let curRate = RAMP_START
    setRate(curRate)
    const startedAt = performance.now()
    let lastRamp = startedAt
    let lastSample = startedAt
    let lastPaint = startedAt
    let frames = 0
    // per-sample applied (resets each 250ms window) — used for fps cadence only
    const applied: Record<PanelId, number> = { raw: 0, Dunky: 0, xstate: 0, zag: 0 }
    // run-long totals — the headline updates/s is totalApplied / totalElapsed, a
    // RUNNING AVERAGE over the whole run. A last-250ms snapshot jumped around
    // (and during Start, the stop-instant snapshot caught engines mid-divergence,
    // making fast ones look tied with Vanilla); the average is stable.
    const totalApplied: Record<PanelId, number> = { raw: 0, Dunky: 0, xstate: 0, zag: 0 }
    // seconds-survived captured at first overflow, per panel (persists across samples)
    const fellBehindAtSec: Record<PanelId, number | null> = {
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
        // timed run: bar fills linearly with elapsed time over the 15s
        setProgress(Math.min(1, elapsed / TEST_DURATION_MS))
        if (elapsed >= TEST_DURATION_MS) {
          runningRef.current = false
          cancelAnimationFrame(loop.current)
          setRunning(false)
          setProgress(1)
          setTimedDone(true) // run complete → reveal the final "fell behind" flags
          return
        }
      }

      // Keep ramping the load only while at least one engine is still keeping up.
      // Once the last one falls behind we hold the rate steady — a timed run then
      // coasts at that frozen rate for the rest of the 30s.
      const allBehind = ENGINE_IDS.every(id => fellBehindAtSec[id] !== null)
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
        if (r) {
          applied[id] += r.applied
          totalApplied[id] += r.applied
        }
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
        const totalSecs = (t - startedAt) / 1000 // whole run, for the running average
        setFps(Math.round(frames / secs))
        const next = zeroStats()
        for (const id of ids) {
          const backlog = handles.current[id]?.backlog() ?? 0
          // Latch HOW LONG the panel survived — the elapsed seconds at the first
          // sample where backlog crossed the line — once, and never move it. The
          // backlog MAGNITUDE at divergence is useless here: it depends on the ramp
          // rate at the divergence instant (a fast engine diverges later, when the
          // rate is higher, so it caught a BIGGER queue) — so it read backwards vs
          // speed. Time-to-divergence is monotonic with speed: faster engines last
          // longer. (Was Math.max backlog over time, which pinned every engine to
          // the 500k queue cap during the coast.)
          if (backlog > OVERFLOW_AT && fellBehindAtSec[id] === null) {
            fellBehindAtSec[id] = (t - startedAt) / 1000
          }
          next[id] = {
            backlog,
            // running average over the whole run — stable, doesn't jump per sample
            appliedPerSec: totalSecs > 0 ? Math.round(totalApplied[id] / totalSecs) : 0,
            totalOps: totalApplied[id],
            fellBehindAtSec: fellBehindAtSec[id],
          }
          applied[id] = 0
        }
        setStats(next)
        frames = 0
        lastSample = t

        // Survival run: the bar fills as engines die — each of the three engines
        // that falls behind fills it a third, with a gentle time-based creep before
        // the first death so it isn't stuck at zero. (Timed runs fill it above.)
        if (!timed) {
          const downCount = ENGINE_IDS.filter(id => fellBehindAtSec[id] !== null).length
          const creep = Math.min(0.3, ((t - startedAt) / 1000) * 0.02) // ≤0.3 over ~15s
          setProgress(Math.max(creep, downCount / ENGINE_IDS.length))
        }

        // auto-stop the instant the LAST engine falls behind — freeze everything
        // immediately so the flags reflect the moment of divergence. A timed run
        // ignores this and keeps going for the full duration.
        if (!timed && ENGINE_IDS.every(id => fellBehindAtSec[id] !== null)) {
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

  const fpsColor = fps >= 50 ? GREEN : fps >= 30 ? '#d29922' : RED

  // light-theme aliases (the rest of the JSX reads these names)
  const fg = FG
  const borderNeutral = BORDER
  const green = GREEN
  const red = RED

  return (
    <div
      style={{
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        color: fg,
        background: PAGE_BG,
        minHeight: '100vh',
        padding: 20,
        boxSizing: 'border-box',
      }}
    >
      {/* Run progress — a thick red bar pinned to the top of the screen. Filled
          by elapsed time (15s test) or by engines-fallen-behind (survival). */}
      {progress !== null && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 6, zIndex: 10 }}>
          <div
            style={{
              height: '100%',
              width: `${progress * 100}%`,
              background: RED,
              // driven each frame, so it tracks real progress with no easing lag
            }}
          />
        </div>
      )}

      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 20 }}>Dunky — engine throughput, live</h1>
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            fontSize: 13,
            maxWidth: 920,
            lineHeight: 1.6,
          }}
        >
          <li>Every cell is a real state machine: a guarded transition feeding a computed.</li>
          <li>
            One change stream feeds all four; each gets <b>{DRAIN_BUDGET_MS}ms/frame</b> to drain
            its queue as the load ramps.
          </li>
          <li>
            Paint is a throttled canvas heatmap, off the hot path — you're seeing engine cost.
          </li>
        </ul>
      </header>

      <div
        style={{
          display: 'flex',
          gap: 24,
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '12px 16px',
          background: '#010409', // black control bar
          color: '#e6edf3',
          border: '1px solid #30363d',
          borderRadius: 10,
          marginBottom: 12,
        }}
      >
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
          ⏱️ 15s test
        </button>

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
          ☠️ {running ? 'Stop' : 'Survival test'}
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
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid #30363d',
          }}
        >
          <span style={{ fontSize: 28, fontWeight: 700, color: '#ffd666' }}>
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

      <ul
        style={{
          margin: '0 0 16px',
          paddingLeft: 18,
          fontSize: 12,
          maxWidth: 1000,
          lineHeight: 1.6,
        }}
      >
        <li>
          <b>updates/s</b> (shown as <b>% of vanilla</b>) is the headline — higher is better.
        </li>
        <li>
          <b>☠️ Survival test</b> — ramps until every engine falls behind; reports how long each
          lasted.
        </li>
        <li>
          <b>⏱️ 15s test</b> — runs the full fifteen seconds; crowns the longest survivor.
        </li>
        <li>
          <b>Vanilla</b> is the control — the real comparison is Dunky vs XState vs Zag.
        </li>
      </ul>

      {/* The 15s test's verdict, computed once the run completes: the ENGINE with
          the highest updates/s is the winner (green · "faster"); the rest are red ·
          "slower". Vanilla is the control and is excluded from the ranking — it's
          the 100% baseline every panel's % diff is measured against. */}
      {(() => {
        const timedVerdict = isTimedRun && timedDone
        const bestEngine = timedVerdict
          ? ENGINE_IDS.reduce<PanelId | null>((best, id) => {
              const ops = stats[id].appliedPerSec
              return best === null || ops > stats[best].appliedPerSec ? id : best
            }, null)
          : null
        const vanillaOps = stats.raw.appliedPerSec

        // auto-fit + minmax so the four panels wrap to fewer columns as the
        // viewport narrows (4 → 2 → 1) instead of overflowing past the edge on
        // phones/tablets. Pure CSS grid — no media query needed.
        return (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 12,
            }}
          >
            {PANELS.map(p => {
              const s = stats[p.id]
              // A timed (15s) run hides the survival flag WHILE running — the coasting
              // backlog mid-run isn't the verdict — and reveals it only once the run
              // completes. An untimed run shows it live (it auto-stops at the moment of
              // divergence, so the flag is the verdict the instant it appears).
              const showBehind = !isTimedRun || timedDone
              const behind = showBehind && s.fellBehindAtSec !== null

              // 15s verdict colouring: winner green, every other ENGINE red. Vanilla
              // (the control) and the live survival test keep the neutral treatment.
              const isWinner = timedVerdict && p.id === bestEngine
              const isLoser = timedVerdict && p.isEngine && p.id !== bestEngine
              const borderColor = isWinner
                ? '#00aa00'
                : isLoser || behind
                  ? '#ff0000'
                  : borderNeutral

              // % vs Vanilla — always relative to the control's updates/s.
              const pctVsVanilla =
                p.isEngine && vanillaOps > 0
                  ? Math.round((s.appliedPerSec / vanillaOps) * 100)
                  : null

              // badge accent for the % chip beside the name
              const badgeColor = timedVerdict ? (isWinner ? green : red) : '#79c0ff'

              return (
                <div
                  key={`${p.id}-${side}`}
                  style={{
                    border: `1px solid ${isWinner || isLoser || behind ? borderColor : '#30363d'}`,
                    borderRadius: 10,
                    padding: 12,
                    background: '#010409', // the whole card is one black box
                    color: '#e6edf3',
                    transition: 'border-color 200ms',
                  }}
                >
                  {/* name (left) + a % of vanilla badge (right) */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <strong style={{ fontSize: 14 }}>{p.label}</strong>
                    {pctVsVanilla !== null && (
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 999,
                          color: badgeColor,
                          background: `${badgeColor}22`,
                          border: `1px solid ${badgeColor}55`,
                          whiteSpace: 'nowrap',
                        }}
                        title='updates/s as a percentage of the vanilla control'
                      >
                        {pctVsVanilla}% of vanilla
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, marginTop: 6 }}>
                    <b style={{ color: '#79c0ff' }}>{s.appliedPerSec.toLocaleString()}</b>
                    <span style={{ opacity: 0.6 }}> updates/s</span>
                    {isWinner && (
                      <span style={{ color: '#3fb950', fontWeight: 700 }}> · faster</span>
                    )}
                    {isLoser && (
                      <span style={{ color: '#ff6b6b', fontWeight: 700 }}> · slower</span>
                    )}
                  </div>
                  {/* live survival test: how long it lasted + total ops applied.
                      The timed (15s) verdict is purely "who was faster", so no line. */}
                  {behind && !timedVerdict && (
                    <div style={{ fontSize: 12, color: '#ff6b6b', fontWeight: 600, marginTop: 4 }}>
                      survived {(s.fellBehindAtSec ?? 0).toFixed(1)}s ·{' '}
                      {s.totalOps.toLocaleString()} ops
                    </div>
                  )}
                  <div style={{ fontSize: 11, opacity: 0.55, margin: '8px 0 10px' }}>{p.blurb}</div>
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
        )
      })()}
    </div>
  )
}
