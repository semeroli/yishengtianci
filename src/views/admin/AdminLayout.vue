<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '../../stores/session.js'
import { confirmDialog, toast, useTheme } from '../../stores/ui.js'
import { Api } from '../../api.js'

/**
 * 后台外壳
 * ─────────────────────────────────────────────────────────────
 * 规格四种宽度各一套形态：
 *   >1024  侧栏固定 240px + 主内容区
 *   768–1024 侧栏收成抽屉，默认收起
 *   <768   侧栏变底部 TabBar（5 个图标）+ 右下角浮动新建按钮
 * 侧栏用深灰（#1E2127）而不是前台的古纸色：后台是「用」的界面，
 * 深色导航能把注意力压到右边的内容上。
 */

const route = useRoute()
const router = useRouter()
const { displayName, role, logout, verify, user } = useSession()
const { theme, toggle } = useTheme()

const drawer = ref(false)
const counts = ref({ drafts: 0, pendingComments: 0 })

const NAV = [
  { to: '/admin/dashboard', label: '数据看板', icon: '📊' },
  {
    to: '/admin/posts',
    label: '文章管理',
    icon: '📝',
    children: [
      { to: '/admin/posts', label: '全部文章' },
      { to: '/admin/posts/new', label: '新建文章' },
      { to: '/admin/posts?status=draft', label: '草稿箱', badge: 'drafts' }
    ]
  },
  { to: '/admin/comments', label: '评论管理', icon: '💬', badge: 'pendingComments' },
  { to: '/admin/categories', label: '分类标签', icon: '🏷️' },
  { to: '/admin/media', label: '媒体库', icon: '📁' },
  { to: '/admin/settings', label: '设置', icon: '⚙️' }
]

// 底部 TabBar 只放 5 个（规格：5 个图标）
const TABS = [
  { to: '/admin/dashboard', label: '看板', icon: '📊' },
  { to: '/admin/posts', label: '文章', icon: '📝', badge: 'drafts' },
  { to: '/admin/comments', label: '评论', icon: '💬', badge: 'pendingComments' },
  { to: '/admin/media', label: '媒体', icon: '📁' },
  { to: '/admin/settings', label: '设置', icon: '⚙️' }
]

const title = computed(() => route.meta?.title || '后台')
const initial = computed(() => String(displayName.value || '倚').slice(0, 1))
const roleText = computed(() => (role.value === 'admin' ? '管理员' : role.value === 'editor' ? '编辑' : role.value))
const isEditorPage = computed(() => /^\/admin\/posts\/(new|edit)/.test(route.path))

function badgeOf(n) {
  const v = n.badge ? counts.value[n.badge] || 0 : 0
  return v > 0 ? (v > 99 ? '99+' : String(v)) : ''
}

/** 文章管理这一组是否处于展开态（当前路径落在它的子项上） */
const postsGroupOpen = computed(() => route.path.startsWith('/admin/posts'))

function isActive(item) {
  if (item.children) return false
  if (item.to.includes('?')) return false
  return route.path === item.to || (item.to !== '/admin/dashboard' && route.path.startsWith(item.to + '/'))
}

function isSubActive(sub) {
  if (sub.to.includes('?status=draft')) return route.path === '/admin/posts' && route.query.status === 'draft'
  if (sub.to === '/admin/posts') return route.path === '/admin/posts' && route.query.status !== 'draft'
  return route.path === sub.to
}

async function refreshCounts() {
  try {
    const { data } = await Api.adminCounts()
    counts.value = data
  } catch {
    /* 角标拉不到就不显示，不要打扰用户 */
  }
}

async function doLogout() {
  const ok = await confirmDialog({
    title: '退出登录',
    message: '退出后需要重新输入账号密码才能进入后台，确定退出吗？',
    confirmText: '退出',
    danger: true
  })
  if (!ok) return
  try {
    await Api.adminLogout()
  } catch {}
  logout()
  toast('已退出登录', 'info')
  router.replace('/admin/login')
}

// 切路由时收起抽屉、刷新角标
watch(
  () => route.fullPath,
  () => {
    drawer.value = false
    refreshCounts()
  }
)

let timer = null
onMounted(async () => {
  await verify()
  refreshCounts()
  // 后台开着不动也要让「待审 / 草稿」角标跟上
  timer = setInterval(refreshCounts, 60000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="adm-scope">
    <!-- 顶栏 -->
    <header class="adm-top no-print">
      <button class="adm-icon-btn adm-burger" title="菜单" @click="drawer = !drawer">☰</button>
      <RouterLink class="adm-brand" to="/admin/dashboard">
        <span class="adm-seal kai">倚</span>
        <span class="bt">倚声后台</span>
      </RouterLink>
      <span class="adm-top-crumb">{{ title }}</span>
      <span class="sp"></span>
      <RouterLink class="adm-icon-btn" to="/" title="回到前台" target="_blank">↗</RouterLink>
      <button class="adm-icon-btn" :title="theme === 'dark' ? '切换到浅色' : '切换到深色'" @click="toggle">
        {{ theme === 'dark' ? '☀' : '☾' }}
      </button>
      <span class="adm-who">
        <span class="adm-avatar">{{ initial }}</span>
        <span class="nm">{{ displayName || user?.username }}</span>
        <span class="rl">{{ roleText }}</span>
      </span>
      <button class="btn ghost sm" type="button" @click="doLogout">退出</button>
    </header>

    <div class="adm-body">
      <!-- 侧栏 -->
      <aside class="adm-side no-print" :class="{ open: drawer }">
        <template v-for="n in NAV" :key="n.to">
          <RouterLink v-if="!n.children" class="adm-nav-item" :class="{ active: isActive(n) }" :to="n.to">
            <span class="ic">{{ n.icon }}</span>
            <span>{{ n.label }}</span>
            <span v-if="badgeOf(n)" class="bd">{{ badgeOf(n) }}</span>
          </RouterLink>
          <template v-else>
            <RouterLink class="adm-nav-item adm-nav-group" :class="{ active: postsGroupOpen }" :to="n.to">
              <span class="ic">{{ n.icon }}</span>
              <span>{{ n.label }}</span>
            </RouterLink>
            <RouterLink
              v-for="sub in n.children"
              :key="sub.to + (sub.label || '')"
              class="adm-nav-item adm-nav-sub"
              :class="{ active: isSubActive(sub) }"
              :to="sub.to"
            >
              <span>{{ sub.label }}</span>
              <span v-if="badgeOf(sub)" class="bd">{{ badgeOf(sub) }}</span>
            </RouterLink>
          </template>
        </template>
        <div class="adm-side-foot">
          <p class="mb0">倚声 · AI填词工坊</p>
          <p class="mb0">v1.0 · 本地格律引擎</p>
        </div>
      </aside>

      <div v-if="drawer" class="adm-mask no-print" @click="drawer = false"></div>

      <main class="adm-main">
        <RouterView v-slot="{ Component }">
          <Transition name="admView" mode="out-in">
            <component :is="Component" @refresh-counts="refreshCounts" />
          </Transition>
        </RouterView>
      </main>
    </div>

    <!-- 移动端：底部 TabBar + 浮动新建 -->
    <nav class="adm-tabbar no-print">
      <RouterLink v-for="t in TABS" :key="t.to" :to="t.to" :class="{ on: isActive(t) }">
        <span class="ic">{{ t.icon }}</span>
        <span>{{ t.label }}</span>
        <span v-if="badgeOf(t)" class="bd">{{ badgeOf(t) }}</span>
      </RouterLink>
    </nav>
    <RouterLink v-if="!isEditorPage" class="adm-fab no-print" to="/admin/posts/new" title="新建文章">
      <svg viewBox="0 0 64 64" width="26" height="26" aria-hidden="true">
        <g transform="rotate(45 32 32)" fill="currentColor">
          <rect x="29" y="4" width="6" height="30" rx="3" opacity=".8" />
          <rect x="28" y="33" width="8" height="6" rx="2" />
          <path d="M28 39h8l-4 19z" opacity=".92" />
        </g>
      </svg>
    </RouterLink>
  </div>
</template>

<style scoped>
.bt {
  font-family: var(--a-font-title);
}
.admView-enter-active {
  transition: opacity 220ms var(--ease-ink), transform 220ms var(--ease-ink);
}
.admView-leave-active {
  transition: opacity 120ms ease-in;
}
.admView-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.admView-leave-to {
  opacity: 0;
}
@media (max-width: 1024px) {
  .adm-nav-item[role='button'] {
    padding-left: 12px;
  }
}
</style>
