import { createApp } from 'vue'
import App from './App.vue'
import router from './router/index.js'
import { loadBranding } from './utils/branding.js'
import './styles/tokens.css'
import './styles/main.css'
import './styles/admin.css'

// 站点设置（站名 / 顶栏图标 / favicon）在挂载的同时拉一次。
// 全站只发这一条请求：AppHeader 等组件也走 loadBranding()，共用同一个 Promise。
loadBranding()

createApp(App).use(router).mount('#app')
