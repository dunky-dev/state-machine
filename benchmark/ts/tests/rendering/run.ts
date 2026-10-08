/**
 * jsdom bootstrap + rendering bench. DISPOSABLE.
 *
 * jsdom MUST be set up before react-dom is imported, so `./bench` is loaded via
 * dynamic import() AFTER bootstrapJsdom() runs. Exported as `runRendering()`;
 * the suite runs it via benchmark/index.ts (`pnpm benchmark`).
 */
import { JSDOM } from 'jsdom'

function bootstrapJsdom() {
  if ('document' in globalThis) return // already set up (suite ran another DOM bench first)
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
  const g = globalThis as unknown as Record<string, unknown>
  g.window = dom.window
  g.document = dom.window.document
  g.HTMLElement = dom.window.HTMLElement
  g.Node = dom.window.Node
  // `navigator` is a read-only getter on modern Node — define it instead of assigning.
  if (!('navigator' in globalThis)) {
    Object.defineProperty(globalThis, 'navigator', {
      value: dom.window.navigator,
      configurable: true,
    })
  }
  // React 18/19 act() env flag
  g.IS_REACT_ACT_ENVIRONMENT = true
}

export async function runRendering() {
  console.log('\n========== RENDERING — first render (mount) + re-render ==========')
  bootstrapJsdom()
  const { runRenderingBench } = await import('./bench') // after jsdom is live
  await runRenderingBench(100, 50)
  await runRenderingBench(1000, 50)
}
