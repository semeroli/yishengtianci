<script setup>
import { computed, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTheme } from '../stores/ui.js'
import { loadBranding, BRAND_DEFAULTS, hasCustomLogo, SEAL_TEXT } from '../utils/branding.js'

const route = useRoute()
const router = useRouter()
const { theme, toggle } = useTheme()

// 站名 / 顶栏图标从站点设置来。这里用 loadBranding() 而不是直接 Api.settings()，
// 是为了和 main.js 共用同一条请求（否则同一个接口每页要拉两次）。
const site = ref({ ...BRAND_DEFAULTS })
const menuOpen = ref(false)

// 后台填了自定义「站点图标」就用它；没填（或还是 1.0 的 🏮）就渲染朱砂方印，
// 和浏览器标签页的 favicon 是同一个记号。
const customLogo = computed(() => hasCustomLogo(site.value.logo))

const nav = [
  { to: '/studio', label: '填词', key: 'workbench' },
  { to: '/blog', label: '博客', key: 'blog' },
  { to: '/rhyme', label: '韵书', key: 'rhyme' },
  { to: '/favorites', label: '词笺', key: 'favorites' },
  { to: '/about', label: '关于', key: 'about' }
]

const active = computed(() => {
  const p = route.path
  // 落地页（/）不属于任何导航项，不点亮任何一个 ——
  // 否则站在首页上却高亮「填词」，会让人以为自己已经在工具页了。
  if (p === '/') return ''
  if (p.startsWith('/studio')) return 'workbench'
  if (p.startsWith('/blog')) return 'blog'
  if (p.startsWith('/rhyme')) return 'rhyme'
  if (p.startsWith('/favorites')) return 'favorites'
  if (p.startsWith('/about')) return 'about'
  return ''
})

onMounted(async () => {
  site.value = await loadBranding()
})

function go(to) {
  menuOpen.value = false
  router.push(to)
}
</script>

<template>
  <header class="hdr no-print">
    <div class="wrap hdr-inner">
      <RouterLink to="/" class="brand" @click="menuOpen = false">
        <span v-if="customLogo" class="lamp">{{ site.logo }}</span>
        <span v-else class="brand-seal" aria-hidden="true">{{ SEAL_TEXT }}</span>
        <span class="brand-text">
          <b>{{ site.site_name || '倚声 · AI填词工坊' }}</b>
          <em>依谱填词 · 以韵为骨</em>
        </span>
      </RouterLink>

      <nav class="nav" :class="{ open: menuOpen }">
        <a
          v-for="n in nav"
          :key="n.key"
          class="nav-item"
          :class="{ on: active === n.key }"
          :href="n.to"
          @click.prevent="go(n.to)"
        >
          {{ n.label }}
        </a>
      </nav>

      <div class="hdr-actions">
        <button class="icon-btn" :title="theme === 'dark' ? '点亮青灯' : '吹熄烛火'" @click="toggle">
          <span v-if="theme === 'dark'">🌙</span>
          <span v-else>☀️</span>
        </button>
        <RouterLink to="/admin" class="icon-btn admin-entry" title="后台管理">⚙</RouterLink>
        <button class="icon-btn burger" title="菜单" @click="menuOpen = !menuOpen">
          {{ menuOpen ? '✕' : '☰' }}
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.hdr {
  position: sticky;
  top: 0;
  z-index: 50;
  background: color-mix(in srgb, var(--paper) 88%, transparent);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--line);
  transition: background var(--t-theme) ease-in-out, border-color var(--t-theme) ease-in-out;
}
.hdr-inner {
  display: flex;
  align-items: center;
  gap: 18px;
  height: 66px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ink);
  flex-shrink: 0;
}
.brand:hover {
  color: var(--ink);
}
.lamp {
  font-size: 1.4rem;
  line-height: 1;
}
/* 朱砂方印「倚」—— 与 public/favicon.svg 同一枚记号，也与落地页落款一致 */
.brand-seal {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 3px;
  background: linear-gradient(135deg, #ce4a40, #9c2a25);
  color: #fdf6ec;
  font-family: var(--font-serif);
  font-size: 17px;
  font-weight: 700;
  line-height: 1;
}
.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.brand-text b {
  font-size: 1.06rem;
  letter-spacing: 0.06em;
  font-weight: 600;
}
.brand-text em {
  font-style: normal;
  font-size: 0.72rem;
  color: var(--ink-3);
  letter-spacing: 0.14em;
}
.nav {
  display: flex;
  gap: 4px;
  flex: 1;
}
.nav-item {
  position: relative;
  padding: 6px 14px;
  color: var(--ink-2);
  font-size: 0.98rem;
  letter-spacing: 0.1em;
  border-radius: var(--r);
  transition: color var(--t-fast), background var(--t-fast);
}
.nav-item:hover {
  color: var(--ink);
  background: var(--paper-3);
}
.nav-item.on {
  color: var(--ink);
  font-weight: 600;
}
.nav-item.on::after {
  content: '';
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: 0;
  height: 2px;
  background: var(--cinnabar);
  border-radius: 2px;
}
.hdr-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid transparent;
  border-radius: var(--r);
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
  font-size: 1rem;
  transition: all var(--t-fast);
}
.icon-btn:hover {
  background: var(--paper-3);
  border-color: var(--line);
  color: var(--ink);
}
.burger {
  display: none;
}
@media (max-width: 860px) {
  .nav {
    position: absolute;
    top: 66px;
    left: 0;
    right: 0;
    flex-direction: column;
    gap: 0;
    background: var(--paper-2);
    border-bottom: 1px solid var(--line);
    box-shadow: var(--shadow-2);
    max-height: 0;
    overflow: hidden;
    transition: max-height var(--t) var(--ease-ink);
  }
  .nav.open {
    max-height: 320px;
  }
  .nav-item {
    padding: 12px 20px;
    border-radius: 0;
    border-bottom: 1px solid var(--line);
  }
  .nav-item.on::after {
    left: 0;
    right: auto;
    top: 12px;
    bottom: 12px;
    width: 3px;
    height: auto;
  }
  .burger {
    display: inline-flex;
  }
  .brand-text em {
    display: none;
  }
}
</style>
