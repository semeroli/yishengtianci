<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Api } from '../../api.js'
import { confirmDelete, toast } from '../../stores/ui.js'
import AdminPagination from '../../components/admin/AdminPagination.vue'
import AdminStatusTag from '../../components/admin/AdminStatusTag.vue'
import AdminEmpty from '../../components/admin/AdminEmpty.vue'
import AdminSkeleton from '../../components/admin/AdminSkeleton.vue'

/**
 * 评论管理
 * ─────────────────────────────────────────────────────────────
 * 四态筛选 + 批量操作 + 内联展开回复框。
 * 回复直接以「管理员」身份插一条已通过的评论挂在原评论下，
 * 前台会跟着显示，不需要再走一次审核。
 */

const emit = defineEmits(['refresh-counts'])

const FILTERS = [
  { key: 'all', label: '全部', count: 'all' },
  { key: 'pending', label: '待审核', count: 'pending' },
  { key: 'approved', label: '已通过', count: 'approved' },
  { key: 'spam', label: '垃圾', count: 'spam' }
]

const loading = ref(true)
const list = ref([])
const counts = ref({ all: 0, pending: 0, approved: 0, spam: 0 })
const total = ref(0)
const pages = ref(1)
const status = ref('all')
const q = ref('')
const page = ref(1)
const pageSize = ref(20)
const selected = ref([])
const busy = ref(false)
const replyOpen = ref(0)
const replyText = ref('')
const replyBox = ref(null)

const allChecked = computed(() => list.value.length > 0 && selected.value.length === list.value.length)
const indeterminate = computed(() => selected.value.length > 0 && selected.value.length < list.value.length)

async function load() {
  loading.value = true
  try {
    const params = { status: status.value, page: page.value, pageSize: pageSize.value }
    if (q.value.trim()) params.q = q.value.trim()
    const { data } = await Api.adminComments(params)
    list.value = data.list || []
    counts.value = data.counts || counts.value
    total.value = data.total || 0
    pages.value = data.pages || 1
    selected.value = []
  } catch (e) {
    toast('加载失败：' + (e?.message || ''), 'error', 0, { label: '重试', run: load })
  } finally {
    loading.value = false
  }
}

function setStatus(k) {
  status.value = k
  page.value = 1
  replyOpen.value = 0
  load()
}

function search() {
  page.value = 1
  load()
}

/** 回复框用函数 ref：v-for 里的字符串 ref 会被收集成数组，取不到单个元素 */
function setReplyEl(el) {
  replyBox.value = el
}

watch(page, load)

function toggleAll(e) {
  selected.value = e.target.checked ? list.value.map((c) => c.id) : []
}
function toggleOne(id) {
  selected.value = selected.value.includes(id) ? selected.value.filter((x) => x !== id) : [...selected.value, id]
}

async function one(c, action) {
  try {
    await Api.adminCommentAction(c.id, action)
    toast(
      { approve: '已通过 ✓', spam: '已标为垃圾', pending: '已标记待处理' }[action] || '已处理',
      'success'
    )
    emit('refresh-counts')
    load()
  } catch (e) {
    toast('操作失败：' + (e?.message || ''), 'error')
  }
}

async function removeOne(c) {
  const ok = await confirmDelete(`这条评论（及其下所有回复）`)
  if (!ok) return
  try {
    await Api.adminDeleteComment(c.id)
    toast('评论已删除', 'success')
    emit('refresh-counts')
    load()
  } catch (e) {
    toast('删除失败：' + (e?.message || ''), 'error')
  }
}

async function batch(action) {
  if (!selected.value.length || busy.value) return
  if (action === 'delete') {
    const ok = await confirmDelete(`选中的 ${selected.value.length} 条评论（及其回复）`)
    if (!ok) return
  }
  busy.value = true
  try {
    await Api.adminBatchComments(selected.value, action)
    toast(
      action === 'delete' ? `已删除 ${selected.value.length} 条评论` : `已处理 ${selected.value.length} 条评论 ✓`,
      'success'
    )
    emit('refresh-counts')
    await load()
  } catch (e) {
    toast('批量操作失败：' + (e?.message || ''), 'error')
  } finally {
    busy.value = false
  }
}

function openReply(c) {
  replyOpen.value = replyOpen.value === c.id ? 0 : c.id
  replyText.value = ''
  if (replyOpen.value) nextTick(() => replyBox.value?.focus())
}

async function sendReply(c) {
  const text = replyText.value.trim()
  if (!text) return
  try {
    await Api.adminReplyComment(c.id, text)
    toast('回复已发出 ✓', 'success')
    replyOpen.value = 0
    replyText.value = ''
    load()
  } catch (e) {
    toast('回复失败：' + (e?.message || ''), 'error')
  }
}

function fmt(s) {
  return String(s || '').slice(0, 16)
}

onMounted(load)
</script>

<template>
  <div>
    <div class="adm-page-head">
      <h1>评论管理</h1>
      <span class="desc">共 {{ counts.all }} 条 · 待审 {{ counts.pending }} 条</span>
      <span class="sp"></span>
      <button class="btn sm" type="button" :disabled="loading" @click="load">↻ 刷新</button>
    </div>

    <div class="adm-card">
      <!-- 四态筛选 -->
      <div class="adm-toolbar">
        <div class="filters">
          <button
            v-for="f in FILTERS"
            :key="f.key"
            type="button"
            class="fbtn"
            :class="{ on: status === f.key }"
            @click="setStatus(f.key)"
          >
            {{ f.label }}
            <span class="n" :class="{ hot: f.key === 'pending' && counts.pending > 0 }">{{ counts[f.count] || 0 }}</span>
          </button>
        </div>
        <span class="sp"></span>
        <label class="adm-search" style="min-width: 180px">
          <span class="ic">🔍</span>
          <input v-model="q" type="search" placeholder="搜索评论内容 / 评论者" @keydown.enter="search" />
        </label>
        <button class="btn sm" type="button" @click="search">搜索</button>
      </div>

      <div v-if="selected.length" class="adm-bulk">
        <span>已选 <span class="cnt">{{ selected.length }}</span> 条</span>
        <button class="btn sm" type="button" :disabled="busy" @click="batch('approve')">批量通过</button>
        <button class="btn sm" type="button" :disabled="busy" @click="batch('spam')">批量标垃圾</button>
        <button class="btn sm" type="button" :disabled="busy" @click="batch('delete')">批量删除</button>
        <span class="sp"></span>
        <button class="adm-act" type="button" @click="selected = []">取消选择</button>
      </div>

      <AdminSkeleton v-if="loading" :rows="6" />

      <AdminEmpty
        v-else-if="!list.length"
        :line="status === 'pending' ? '没有待审评论，清净' : status === 'spam' ? '垃圾箱是空的' : '还没有评论'"
        sub="读者留言后会出现在这里"
      />

      <div v-else class="adm-table-wrap">
        <table class="adm-table">
          <thead>
            <tr>
              <th class="col-check">
                <input type="checkbox" :checked="allChecked" :indeterminate.prop="indeterminate" aria-label="全选" @change="toggleAll" />
              </th>
              <th>评论者</th>
              <th>内容</th>
              <th>所属文章</th>
              <th>时间</th>
              <th>状态</th>
              <th class="col-act">操作</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="c in list" :key="c.id">
              <tr :class="{ sel: selected.includes(c.id) }">
                <td class="col-check" data-label="">
                  <input type="checkbox" :checked="selected.includes(c.id)" :aria-label="'选择评论'" @change="toggleOne(c.id)" />
                </td>
                <td data-label="评论者">
                  <div>{{ c.author_name || '匿名' }}</div>
                  <div class="t-sub">{{ c.parent_id ? '（回复）' : '' }}{{ c.author_email || '' }}</div>
                </td>
                <td data-label="内容">
                  <div class="cc">{{ c.content }}</div>
                </td>
                <td data-label="文章">
                  <RouterLink class="adm-act" :to="`/admin/posts/edit/${c.post_id}`">
                    {{ c.post_title || '（文章已删除）' }}
                  </RouterLink>
                </td>
                <td data-label="时间" class="num">{{ fmt(c.created_at) }}</td>
                <td data-label="状态">
                  <AdminStatusTag :status="c.is_spam ? 'spam' : c.is_approved ? 'approved' : 'pending'" />
                </td>
                <td class="col-act">
                  <button v-if="!c.is_approved || c.is_spam" class="adm-act" type="button" title="通过审核" @click="one(c, 'approve')">✅ 通过</button>
                  <button v-if="!c.is_spam" class="adm-act" type="button" title="标为垃圾" @click="one(c, 'spam')">❌ 标垃圾</button>
                  <button v-if="c.is_spam" class="adm-act" type="button" title="标记待处理" @click="one(c, 'pending')">🚩 待处理</button>
                  <button class="adm-act" type="button" title="回复" @click="openReply(c)">💬 回复</button>
                  <button class="adm-act danger" type="button" @click="removeOne(c)">删除</button>
                </td>
              </tr>
              <!-- 内联回复框 -->
              <tr v-if="replyOpen === c.id" :key="'r' + c.id" class="reply-row">
                <td colspan="7">
                  <div class="reply-box">
                    <div class="quote">
                      回复 <b>{{ c.author_name }}</b>：{{ c.content.slice(0, 80) }}{{ c.content.length > 80 ? '…' : '' }}
                    </div>
                    <textarea
                      :ref="setReplyEl"
                      v-model="replyText"
                      class="textarea"
                      rows="3"
                      placeholder="以「管理员」身份回复，发出后前台立即可见"
                      @keydown.ctrl.enter="sendReply(c)"
                      @keydown.meta.enter="sendReply(c)"
                    ></textarea>
                    <div class="row" style="justify-content: flex-end; gap: 8px">
                      <button class="btn sm" type="button" @click="replyOpen = 0">取消</button>
                      <button class="btn primary sm" type="button" :disabled="!replyText.trim()" @click="sendReply(c)">
                        发送回复
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <AdminPagination v-model:page="page" :pages="pages" :total="total" :page-size="pageSize" unit="条" />
    </div>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
}
.fbtn {
  border: 1px solid var(--a-line);
  background: var(--a-card);
  color: var(--a-text-2);
  font-family: var(--a-font);
  font-size: 0.84rem;
  padding: 5px 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 120ms;
}
.fbtn:first-child {
  border-radius: var(--a-radius) 0 0 var(--a-radius);
}
.fbtn:last-child {
  border-radius: 0 var(--a-radius) var(--a-radius) 0;
}
.fbtn:not(:first-child) {
  margin-left: -1px;
}
.fbtn:hover {
  color: var(--a-text);
  background: var(--a-card-2);
}
.fbtn.on {
  background: var(--a-text);
  border-color: var(--a-text);
  color: var(--a-card);
  z-index: 1;
}
.fbtn .n {
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}
.fbtn .n.hot {
  color: var(--a-danger);
  font-weight: 600;
  opacity: 1;
}
.fbtn.on .n.hot {
  color: #ffd9d9;
}
.cc {
  max-width: 34vw;
  line-height: 1.75;
  color: var(--a-text-2);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
.reply-row td {
  background: var(--a-card-2);
  padding: 0 !important;
}
.reply-box {
  padding: 14px 16px;
}
.quote {
  font-size: 0.82rem;
  color: var(--a-text-3);
  border-left: 2px solid var(--a-line);
  padding-left: 10px;
  margin-bottom: 10px;
  line-height: 1.7;
}
.quote b {
  color: var(--a-text-2);
}
.reply-box .row {
  margin-top: 8px;
}
@media (max-width: 768px) {
  .cc {
    max-width: none;
  }
}
</style>
