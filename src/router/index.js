import { createRouter, createWebHistory } from 'vue-router'
import { getToken } from '../api.js'
import { useSession } from '../stores/session.js'

const routes = [
  // ⚠️ 「/」从 2026-01 起是**落地页（官网首页）**，不再是填词工具本身。
  //    工具挪到了 /studio。改这条时注意：站内所有「去填词」的入口都要指向 /studio，
  //    只有品牌 logo、登录页「回到前台」这类「回首页」的语义才继续用 /。
  {
    path: '/',
    name: 'home',
    component: () => import('../views/LandingView.vue'),
    // title 留空 ⇒ afterEach 里 document.title 走默认的「倚声 · AI填词工坊」；
    // 落地页 onMounted 里会再调 setSeo() 补 description / og / JSON-LD，两者不冲突。
    meta: { title: '' }
  },
  {
    path: '/studio',
    name: 'workbench',
    component: () => import('../views/WorkbenchView.vue'),
    meta: { title: '填词工作台' }
  },
  {
    path: '/blog',
    name: 'blog',
    component: () => import('../views/BlogListView.vue'),
    meta: { title: '填词博客' }
  },
  {
    path: '/blog/:slug',
    name: 'post',
    component: () => import('../views/BlogPostView.vue'),
    meta: { title: '文章' }
  },
  {
    path: '/rhyme',
    name: 'rhyme',
    component: () => import('../views/RhymeView.vue'),
    meta: { title: '韵书速查' }
  },
  {
    path: '/favorites',
    name: 'favorites',
    component: () => import('../views/FavoritesView.vue'),
    meta: { title: '我的词笺' }
  },
  {
    path: '/about',
    name: 'about',
    component: () => import('../views/AboutView.vue'),
    meta: { title: '关于' }
  },
  {
    path: '/admin/login',
    name: 'admin-login',
    component: () => import('../views/admin/LoginView.vue'),
    meta: { title: '管理员登录', bare: true }
  },
  {
    path: '/admin',
    component: () => import('../views/admin/AdminLayout.vue'),
    meta: { admin: true },
    children: [
      { path: '', redirect: '/admin/dashboard' },
      { path: 'dashboard', name: 'admin-dashboard', component: () => import('../views/admin/DashboardView.vue'), meta: { title: '数据看板' } },
      { path: 'posts', name: 'admin-posts', component: () => import('../views/admin/PostsView.vue'), meta: { title: '文章管理' } },
      // ⚠️ 「新建」和「编辑」刻意共用同一条路由记录（用 id = 'new' 表示新建）：
      //    自动保存把 new 换成真实 id 时，同记录内的参数变化**不会重建组件**，
      //    否则编辑器会被卸载重挂，正文、光标、未保存状态全丢。
      { path: 'posts/edit/:id', name: 'admin-post-edit', component: () => import('../views/admin/PostEditView.vue'), meta: { title: '文章编辑器' } },
      { path: 'posts/new', redirect: '/admin/posts/edit/new' },
      { path: 'posts/:id/edit', redirect: (to) => `/admin/posts/edit/${to.params.id}` },
      { path: 'comments', name: 'admin-comments', component: () => import('../views/admin/CommentsView.vue'), meta: { title: '评论管理' } },
      { path: 'categories', name: 'admin-categories', component: () => import('../views/admin/CategoriesView.vue'), meta: { title: '分类标签' } },
      { path: 'media', name: 'admin-media', component: () => import('../views/admin/MediaView.vue'), meta: { title: '媒体库' } },
      { path: 'settings', name: 'admin-settings', component: () => import('../views/admin/SettingsView.vue'), meta: { title: '设置' } }
    ]
  },
  { path: '/:pathMatch(.*)*', name: 'notfound', component: () => import('../views/NotFoundView.vue'), meta: { title: '未找到' } }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, saved) {
    if (saved) return saved
    if (to.hash) return { el: to.hash, behavior: 'smooth' }
    return { top: 0 }
  }
})

router.beforeEach(async (to) => {
  // ⚠️ 必须先放行登录页，**不能**只写 to.path.startsWith('/admin')：
  //    /admin/login 自己也以 /admin 开头，未登录时会被守卫重定向到它自己
  //    （/admin/login → /admin/login?redirect=/admin/login → …），
  //    结果是无限重定向、页面永久卡死、未登录时**根本打不开登录页**。
  if (to.name === 'admin-login') return true
  if (!to.path.startsWith('/admin')) return true

  if (!getToken()) {
    return { name: 'admin-login', query: { redirect: to.fullPath } }
  }
  const { verify } = useSession()
  const good = await verify()
  if (!good) return { name: 'admin-login', query: { redirect: to.fullPath } }
  return true
})

router.afterEach((to) => {
  const t = to.meta?.title
  document.title = t ? `${t} · 倚声` : '倚声 · AI填词工坊'
})

export default router
