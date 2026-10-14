<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Api } from '../../api.js'
import { confirmDelete, toast } from '../../stores/ui.js'
import AdminPagination from '../../components/admin/AdminPagination.vue'
import AdminStatusTag from '../../components/admin/AdminStatusTag.vue'
import AdminEmpty from '../../components/admin/AdminEmpty.vue'
import AdminSkeleton from '../../components/admin/AdminSkeleton.vue'
import AdminModal from '../../components/admin/AdminModal.vue'

/**
 * 文章管理
 * ─────────────────────────────────────────────────────────────
 * 工具栏 + 表格 + 批量操作栏 + 分页；窄屏自动变卡片列表（CSS 负责）。
 * 筛选条件全部落在 URL query 上 —— 这样「草稿箱」只是
 * /admin/posts?status=draft，刷新/分享链接都不会丢状态。
 */

const route = useRoute()
const router = useRouter()
const emit = defineEmits(['refresh-counts'])

const loading = ref(true)
const list = ref([])
const total = ref(0)
const pages = ref(1)
const counts = ref({ all: 0, published: 0, draft: 0 })
const categories = ref([])
const selected = ref([])
const busy = ref(false)

const q = ref('')
const status = ref(route.query.status || 'all')
const category = ref(route.query.category || 'all')
const sort = ref(route.query.sort || 'updated')
const page = ref(Number(route.query.page) || 1)
const pageSize = ref(20)
const view = ref('table')

const catModal = ref({ open: false, value: '' })

const allChecked = computed(() => list.value.length > 0 && selected.value.length === list.value.length)
const indeterminate = computed(() => selected.value.length > 0 && selected.value.length < list.value.length)

const statusLabel = computed(() =>
  ({ all: '全部状态', published: '已发布', draft: '草稿', draftbox: '草稿箱' }[status.value] || '全部状态')
)

function rowsParams() {
  const p = { page: page.value, pageSize: pageSize.value, sort: sort.value }
  if (q.value.trim()) p.q = q.value.trim()
  if (status.value && status.value !== 'all') p.status = status.value === 'draftbox' ? 'draft' : status.value
  if (category.value && category.value !== 'all') p.category = category.value
  return p
}

async function load() {
  loading.value = true
  try {
    const { data } = await Api.adminPosts(rowsParams())
    list.value = data.list || []
    total.value = data.total || 0
    pages.value = data.pages || 1
    counts.value = data.counts || counts.value
    selected.value = []
  } catch (e) {
    toast('加载失败：' + (e?.message || ''), 'error', 0, { label: '重试', run: load })
  } finally {
    loading.value = false
  }
}

async function loadCategories() {
  try {
    const { data } = await Api.adminCategories()
    categories.value = data.list || []
  } catch {}
}

// 筛选一变就回到第一页，并把条件同步进地址栏
function applyFilters() {
  page.value = 1
  syncUrl()
  load()
}

function syncUrl() {
  const query = {}
  if (status.value !== 'all') query.status = status.value
  if (category.value !== 'all') query.category = category.value
  if (sort.value !== 'updated') query.sort = sort.value
  if (q.value.trim()) query.q = q.value.trim()
  if (page.value > 1) query.page = String(page.value)
  router.replace({ path: '/admin/posts', query })
}

watch(page, () => {
  syncUrl()
  load()
})

// 从侧栏点「草稿箱 / 全部文章」时，把 query 同步回本地状态
watch(
  () => route.query.status,
  (v) => {
    const next = v || 'all'
    if (next !== status.value) {
      status.value = next
      page.value = 1
      load()
    }
  }
)

function toggleAll(e) {
  selected.value = e.target.checked ? list.value.map((p) => p.id) : []
}
function toggleOne(id) {
  selected.value = selected.value.includes(id) ? selected.value.filter((x) => x !== id) : [...selected.value, id]
}

async function batch(action, extra) {
  if (!selected.value.length || busy.value) return
  if (action === 'delete') {
    const ok = await confirmDelete(`选中的 ${selected.value.length} 篇文章（及其评论、收藏记录）`)
    if (!ok) return
  }
  busy.value = true
  try {
    const { data } = await Api.adminBatchPosts(selected.value, action, extra)
    toast(`已处理 ${data.affected ?? selected.value.length} 篇文章`, 'success')
    emit('refresh-counts')
    await load()
  } catch (e) {
    toast('操作失败：' + (e?.message || ''), 'error')
  } finally {
    busy.value = false
  }
}

async function removeOne(p) {
  const ok = await confirmDelete(`文章《${p.title}》`)
  if (!ok) return
  try {
    await Api.adminDeletePost(p.id)
    toast('文章已删除', 'success')
    emit('refresh-counts')
    load()
  } catch (e) {
    toast('删除失败：' + (e?.message || ''), 'error')
  }
}

async function quickToggle(p) {
  const next = p.status === 'published' ? 'draft' : 'published'
  try {
    await Api.adminUpdatePost(p.id, { status: next })
    toast(next === 'published' ? '已发布 ✓' : '已转为草稿', 'success')
    emit('refresh-counts')
    load()
  } catch (e) {
    toast('操作失败：' + (e?.message || ''), 'error')
  }
}

function openCatModal() {
  if (!selected.value.length) return
  catModal.value = { open: true, value: categories.value[0]?.name || '' }
}

async function confirmCat() {
  if (!catModal.value.value) return
  catModal.value.open = false
  await batch('category', { category: catModal.value.value })
}

function fmtDate(s) {
  return String(s || '').slice(0, 16)
}

onMounted(() => {
  loadCategories()
  load()
})
</script>

<template>
  <div>
    <div class="adm-page-head">
      <h1>文章管理</h1>
      <span class="desc">{{ statusLabel }} · 共 {{ total }} 篇</span>
      <span class="sp"></span>
      <RouterLink class="btn primary sm" to="/admin/posts/new">＋ 新建文章</RouterLink>
    </div>

    <div class="adm-card">
      <!-- 工具栏 -->
      <div class="adm-toolbar">
        <label class="adm-search" style="min-width: 190px">
          <span class="ic">🔍</span>
          <input v-model="q" type="search" placeholder="搜索标题 / 别名 / 摘要" @keydown.enter="applyFilters" />
        </label>
        <select v-model="category" class="adm-select-mini" @change="applyFilters">
          <option value="all">全部分类</option>
          <option v-for="c in categories" :key="c.id" :value="c.name">{{ c.name }}（{{ c.post_count }}）</option>
        </select>
        <select v-model="status" class="adm-select-mini" @change="applyFilters">
          <option value="all">全部状态（{{ counts.all }}）</option>
          <option value="published">已发布（{{ counts.published }}）</option>
          <option value="draft">草稿箱（{{ counts.draft }}）</option>
        </select>
        <select v-model="sort" class="adm-select-mini" @change="applyFilters">
          <option value="updated">按更新时间</option>
          <option value="created">按创建时间</option>
          <option value="views">按阅读量</option>
          <option value="title">按标题</option>
        </select>
        <button class="btn sm" type="button" @click="applyFilters">筛选</button>
        <span class="sp"></span>
        <div class="adm-seg">
          <button type="button" :class="{ on: view === 'table' }" title="表格视图" @click="view = 'table'">☰</button>
          <button type="button" :class="{ on: view === 'card' }" title="卡片视图" @click="view = 'card'">▦</button>
        </div>
      </div>

      <!-- 批量操作栏（勾选后才出现） -->
      <div v-if="selected.length" class="adm-bulk">
        <span>已选 <span class="cnt">{{ selected.length }}</span> 篇</span>
        <button class="btn sm" type="button" :disabled="busy" @click="batch('publish')">批量发布</button>
        <button class="btn sm" type="button" :disabled="busy" @click="batch('draft')">转草稿</button>
        <button class="btn sm" type="button" :disabled="busy" @click="openCatModal">批量改分类</button>
        <button class="btn sm" type="button" :disabled="busy" @click="batch('delete')">批量删除</button>
        <span class="sp"></span>
        <button class="adm-act" type="button" @click="selected = []">取消选择</button>
      </div>

      <AdminSkeleton v-if="loading" :rows="7" />

      <AdminEmpty
        v-else-if="!list.length"
        :line="status === 'draft' ? '草稿箱是空的' : '还没有文章'"
        :sub="q ? '换个关键词试试' : '写点东西吧，第一篇最难，之后就好了'"
        action="＋ 新建文章"
        @action="$router.push('/admin/posts/new')"
      />

      <!-- 表格视图 -->
      <div v-else-if="view === 'table'" class="adm-table-wrap">
        <table class="adm-table">
          <thead>
            <tr>
              <th class="col-check">
                <input
                  type="checkbox"
                  :checked="allChecked"
                  :indeterminate.prop="indeterminate"
                  aria-label="全选"
                  @change="toggleAll"
                />
              </th>
              <th>标题</th>
              <th>分类</th>
              <th>标签</th>
              <th>状态</th>
              <th>数据</th>
              <th class="col-act">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in list" :key="p.id" :class="{ sel: selected.includes(p.id) }">
              <td class="col-check" data-label="">
                <input
                  type="checkbox"
                  :checked="selected.includes(p.id)"
                  :aria-label="`选择《${p.title}》`"
                  @change="toggleOne(p.id)"
                />
              </td>
              <td data-label="标题">
                <RouterLink class="t-title" :to="`/admin/posts/edit/${p.id}`">{{ p.title }}</RouterLink>
                <div class="t-sub">
                  /{{ p.slug }} · 更新 {{ fmtDate(p.updated_at) }}
                  <template v-if="p.status === 'published' && p.published_at"> · 发布 {{ fmtDate(p.published_at) }}</template>
                </div>
              </td>
              <td data-label="分类"><span class="adm-tag-chip">{{ p.category }}</span></td>
              <td data-label="标签">
                <span v-if="!(p.tags || []).length" class="muted tiny">—</span>
                <template v-else>
                  <span v-for="t in (p.tags || []).slice(0, 3)" :key="t" class="adm-tag-chip" style="margin-right: 4px">{{ t }}</span>
                  <span v-if="(p.tags || []).length > 3" class="tiny" style="color: var(--a-text-3)">+{{ p.tags.length - 3 }}</span>
                </template>
              </td>
              <td data-label="状态"><AdminStatusTag :status="p.status" /></td>
              <td data-label="数据" class="num">👁 {{ p.view_count }} · 💬 {{ p.share_count }} · ♡ {{ p.like_count }}</td>
              <td class="col-act">
                <RouterLink class="adm-act" :to="`/admin/posts/edit/${p.id}`">编辑</RouterLink>
                <a class="adm-act" :href="p.status === 'published' ? `/blog/${p.slug}` : undefined" target="_blank" :style="p.status !== 'published' ? 'opacity:.4;pointer-events:none' : ''">预览</a>
                <button class="adm-act" type="button" @click="quickToggle(p)">{{ p.status === 'published' ? '撤下' : '发布' }}</button>
                <button class="adm-act danger" type="button" @click="removeOne(p)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 卡片视图 -->
      <div v-else class="card-grid">
        <article v-for="p in list" :key="p.id" class="p-card" :class="{ sel: selected.includes(p.id) }">
          <label class="pick">
            <input type="checkbox" :checked="selected.includes(p.id)" @change="toggleOne(p.id)" />
          </label>
          <RouterLink class="pc-title" :to="`/admin/posts/edit/${p.id}`">{{ p.title }}</RouterLink>
          <p class="pc-prev">{{ p.excerpt || p.preview || '（暂无摘要）' }}</p>
          <div class="pc-meta">
            <AdminStatusTag :status="p.status" />
            <span class="adm-tag-chip">{{ p.category }}</span>
            <span class="sp"></span>
            <span class="tiny" style="color: var(--a-text-3)">👁 {{ p.view_count }}</span>
          </div>
          <div class="pc-act">
            <RouterLink class="adm-act" :to="`/admin/posts/edit/${p.id}`">编辑</RouterLink>
            <button class="adm-act" type="button" @click="quickToggle(p)">{{ p.status === 'published' ? '撤下' : '发布' }}</button>
            <button class="adm-act danger" type="button" @click="removeOne(p)">删除</button>
          </div>
        </article>
      </div>

      <AdminPagination v-model:page="page" :pages="pages" :total="total" :page-size="pageSize" unit="篇" />
    </div>

    <AdminModal :open="catModal.open" title="批量修改分类" @close="catModal.open = false">
      <div class="adm-field">
        <label>目标分类</label>
        <select v-model="catModal.value" class="select">
          <option v-for="c in categories" :key="c.id" :value="c.name">{{ c.name }}</option>
        </select>
      </div>
      <p class="tiny" style="color: var(--a-text-3)">
        将把选中的 {{ selected.length }} 篇文章一起改到该分类。
      </p>
      <template #foot>
        <button class="btn" type="button" @click="catModal.open = false">取消</button>
        <button class="btn primary" type="button" :disabled="!catModal.value" @click="confirmCat">确认修改</button>
      </template>
    </AdminModal>
  </div>
</template>

<style scoped>
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(268px, 1fr));
  gap: 12px;
  padding: 14px;
}
.p-card {
  border: 1px solid var(--a-line);
  border-radius: var(--a-radius);
  background: var(--a-card);
  padding: 14px 16px;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.p-card.sel {
  border-color: var(--a-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--a-primary) 18%, transparent);
}
.p-card .pick {
  position: absolute;
  top: 12px;
  right: 12px;
}
.pc-title {
  color: var(--a-text);
  text-decoration: none;
  font-weight: 500;
  font-size: 0.96rem;
  padding-right: 26px;
  line-height: 1.5;
}
.pc-title:hover {
  color: var(--a-primary);
}
.pc-prev {
  margin: 0;
  font-size: 0.82rem;
  color: var(--a-text-3);
  line-height: 1.7;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pc-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.pc-meta .sp {
  flex: 1;
}
.pc-act {
  display: flex;
  gap: 2px;
  border-top: 1px solid var(--a-line-2);
  padding-top: 8px;
  margin-top: 2px;
}
</style>
