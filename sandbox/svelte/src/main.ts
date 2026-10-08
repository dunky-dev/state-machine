import { mount } from 'svelte'
import App from './app.svelte'

// The stylesheet every web sandbox shares.
import '../../shared/src/styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

mount(App, { target: root })
