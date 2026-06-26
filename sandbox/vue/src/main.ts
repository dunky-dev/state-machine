import { createApp } from 'vue'
import App from './App.vue'

const root = document.getElementById('app')
if (!root) throw new Error('missing #app')

createApp(App).mount(root)
