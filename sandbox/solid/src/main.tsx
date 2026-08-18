import { render } from '@solidjs/web'
import { App } from './app'

// The stylesheet both web sandboxes share.
import '../../shared/styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

render(() => <App />, root)
