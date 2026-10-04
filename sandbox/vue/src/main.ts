import { createApp } from 'vue'
import App from './app.vue'

// The stylesheet the web sandboxes share.
import '../../shared/src/styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createApp(App).mount(root)
