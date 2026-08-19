import { createApp } from 'vue'
import App from './app.vue'

const root = document.getElementById('app')
if (!root) throw new Error('missing #app')

createApp(App).mount(root)
