/**
 * Benchmark suite entry point — runs ALL benches in one process, one report.
 * DISPOSABLE first-look numbers.
 *
 *   pnpm benchmark
 *
 * The single command passes --expose-gc (memory needs it; harmless elsewhere).
 *
 * Each bench is also exported standalone if you want to run one in isolation:
 *   node --expose-gc --import tsx -e "import('./benchmark/tests/memory').then(m=>m.runMemory())"
 * (or import the run* fn from its file). The rendering bench bootstraps jsdom
 * itself, so it's safe to run alone too.
 *
 * Order: the four headless/pure benches first, then rendering LAST — rendering
 * imports react-dom, so we keep it after the pure measurements.
 */
import { runFanout } from './tests/fan-out'
import { runCompose } from './tests/compose'
import { runComputed } from './tests/computed'
import { runEngine } from './tests/engine'
import { runConstruct } from './tests/construct'
import { runMemory } from './tests/memory'
import { runRendering } from './tests/rendering/run'

async function main() {
  console.log('Benchmark suite (disposable). Node', process.version)
  if (!global.gc) {
    console.warn('⚠️  no --expose-gc — memory numbers will be noisy. Use `pnpm benchmark`.')
  }
  await runFanout()
  await runCompose()
  await runComputed()
  await runEngine()
  await runConstruct()
  await runMemory()
  await runRendering() // last: imports react-dom (bootstraps its own jsdom)
  console.log('\n========== DONE ==========')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
