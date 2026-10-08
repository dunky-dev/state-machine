import { createRoot } from 'react-dom/client'
import { App } from './app'

// No StrictMode: this is a perf demo, and StrictMode double-invokes renders in
// dev, which would double every render count and distort the timings.
createRoot(document.getElementById('root')!).render(<App />)
