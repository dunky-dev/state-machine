import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { toMachine } from '@dunky.dev/state-machine'
import { commandPaletteMachineConfig, DEMO_COMMANDS } from '@sandbox/cmdk-core'
import { type MachineHost, PaletteMachine } from '@sandbox/uniffi'

// The uniffi spike: what one event costs in Hermes on each path, side by side.
//
// - TS: the TS engine, a subscriber reading the changed field.
// - Rust pull: `sendKind` returns a change mask; JS reads the field named in it.
// - Rust push: the machine calls `host.notify(state, lo, hi)` per change, as the
//   wasm binding does; JS reads the field inside the notify.
//
// Each run is a fresh machine, open with results, timed with `performance.now()`.
// The medians of three runs are shown; the raw JSON goes to the Metro log as
// `[rust-bench]`.

const EVENTS = 50_000
const RUNS = 3

// Kind indices (`metaJson().events`) and field indices (`metaJson().fields`).
const OPEN = 0
const QUERY_SET = 2
const EXECUTE = 5
const QUERY = 1
const LAST_EXECUTED = 3
// The pull mask: field `i` is bit `2 + i` (`dunky_state_machine::protocol`).
const FIELD_SHIFT = 2

interface Result {
  label: string
  nsPerEvent: number
}

const COMMANDS_JSON = JSON.stringify(DEMO_COMMANDS)

function openRustPalette(): PaletteMachine {
  const m = new PaletteMachine(COMMANDS_JSON)
  m.start()
  m.sendKind(OPEN)
  return m
}

function openTsPalette() {
  const m = toMachine(commandPaletteMachineConfig({ commands: DEMO_COMMANDS }))
  m.start()
  m.send({ type: 'open' })
  return m
}

/** Time `events` events: `setup()` builds the machine, `each(i)` sends one. */
function measure(label: string, setup: () => (i: number) => void): Result {
  const samples: number[] = []
  for (let run = 0; run < RUNS; run++) {
    const each = setup()
    for (let i = 0; i < EVENTS / 10; i++) each(i) // warm up
    const start = performance.now()
    for (let i = 0; i < EVENTS; i++) each(i)
    samples.push(((performance.now() - start) * 1e6) / EVENTS)
  }
  samples.sort((a, b) => a - b)
  return { label, nsPerEvent: samples[RUNS >> 1]! }
}

/** A host that reads the named field inside each notify. */
function readingHost(m: PaletteMachine, field: number, sink: { reads: number }): MachineHost {
  const bit = 1 << field
  return {
    notify: (_state, lo) => {
      if (lo & bit) {
        JSON.parse(m.fieldJson(field))
        sink.reads++
      }
    },
    startTimer: () => {},
    cancelTimer: () => {},
  }
}

function runAll(): Result[] {
  const sink = { reads: 0 }
  const results: Result[] = []

  // One payload-less event that changes one field: `execute` stamps `lastExecuted`.
  results.push(
    measure('TS · execute', () => {
      const m = openTsPalette()
      m.subscribe(() => {
        if (m.context.lastExecuted) sink.reads++
      })
      return () => m.send({ type: 'execute' })
    }),
    measure('Rust pull · execute', () => {
      const m = openRustPalette()
      const bit = 1 << (FIELD_SHIFT + LAST_EXECUTED)
      return () => {
        const mask = m.sendKind(EXECUTE)
        if (mask & bit) {
          JSON.parse(m.fieldJson(LAST_EXECUTED))
          sink.reads++
        }
      }
    }),
    measure('Rust push · execute', () => {
      const m = openRustPalette()
      m.attach(readingHost(m, LAST_EXECUTED, sink))
      return () => m.send(EXECUTE)
    }),
  )

  // One event with a payload that changes one field: `query.set` toggling the query.
  const queries = ['{"query":"g"}', '{"query":""}']
  results.push(
    measure('TS · query.set', () => {
      const m = openTsPalette()
      m.subscribe(() => {
        if (m.context.query.length >= 0) sink.reads++
      })
      return i => m.send({ type: 'query.set', query: i & 1 ? 'g' : '' })
    }),
    measure('Rust pull · query.set', () => {
      const m = openRustPalette()
      const bit = 1 << (FIELD_SHIFT + QUERY)
      return i => {
        const mask = m.sendPayloadJson(QUERY_SET, queries[i & 1]!)
        if (mask & bit) {
          JSON.parse(m.fieldJson(QUERY))
          sink.reads++
        }
      }
    }),
    measure('Rust push · query.set', () => {
      const m = openRustPalette()
      m.attach(readingHost(m, QUERY, sink))
      return i => m.sendJson(QUERY_SET, queries[i & 1]!)
    }),
  )

  // The floor: what a call into Rust costs with nothing to do, and what one notify
  // back costs on top of the event.
  results.push(
    measure('Rust · stateIndex() (bare call)', () => {
      const m = openRustPalette()
      return () => {
        sink.reads += m.stateIndex()
      }
    }),
    measure('Rust push · execute, notify not reading', () => {
      const m = openRustPalette()
      m.attach({
        notify: () => {
          sink.reads++
        },
        startTimer: () => {},
        cancelTimer: () => {},
      })
      return () => m.send(EXECUTE)
    }),
  )

  console.log(`[rust-bench] ${JSON.stringify({ events: EVENTS, runs: RUNS, results })}`)
  return results
}

export function RustBench() {
  const [results, setResults] = useState<Result[] | null>(null)
  const [running, setRunning] = useState(false)

  const run = () => {
    setRunning(true)
    // Let the frame paint before Hermes blocks on the loop.
    setTimeout(() => {
      setResults(runAll())
      setRunning(false)
    }, 50)
  }

  useEffect(run, [])

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Rust over uniffi, per event (ns, median of {RUNS})</Text>
      {running && <Text style={styles.row}>running {EVENTS.toLocaleString()} events…</Text>}
      {results?.map(r => (
        <View key={r.label} style={styles.line}>
          <Text style={styles.row}>{r.label}</Text>
          <Text style={styles.value}>{Math.round(r.nsPerEvent).toLocaleString()}</Text>
        </View>
      ))}
      <Pressable style={styles.button} onPress={run} disabled={running}>
        <Text style={styles.buttonText}>Run again</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    gap: 6,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f4f5f8',
  },
  heading: { fontSize: 13, fontWeight: '700', color: '#1c1e26', marginBottom: 4 },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
  row: { fontSize: 13, color: '#5b6172' },
  value: { fontSize: 13, fontVariant: ['tabular-nums'], color: '#1c1e26' },
  button: { alignSelf: 'flex-start', marginTop: 6 },
  buttonText: { fontSize: 13, fontWeight: '700', color: '#6c5ce7' },
})
