import { render } from '@solidjs/web'
import { App } from './app'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

render(() => <App />, root)
