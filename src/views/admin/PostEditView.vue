<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { Api } from '../../api.js'
import { confirmDialog, toast } from '../../stores/ui.js'
import { renderMarkdown, plainFromMarkdown } from '../../utils/markdown.js'
import MarkdownEditor from '../../components/MarkdownEditor.vue'

/**
 * 文章编辑器（三栏：编辑 | 预览 | 设置）
 * ─────────────────────────────────────────────────────────────
 * 几个「用了才会发现需要」的细节，都实现在这里：
 *  · Slug 自动跟随标题，但**用户手改过之后就不再覆盖**（否则改完标题 slug 白改了）；
 *  · 每 30 秒自动保存草稿，标题栏显示「已自动保存 · 10:50:32」；
 *  · 有新内容没保存就离开 / 关标签页会拦一下；
 *  · 快捷键 Ctrl/Cmd+S 存草稿、Ctrl/Cmd+Enter 发布、Ctrl/Cmd+B/I 加粗斜体；
 *  · 预览滚动与编辑区同步（按比例映射，长文不会越滚越偏）。
 */

const route = useRoute()
const router = useRouter()
const emit = defineEmits(['refresh-counts'])

const isNew = computed(() => String(route.params.id || 'new') === 'new')
const postId = computed(() => (isNew.value ? null : Number(route.params.id)))

const loading = ref(true)
const saving = ref(false)
const publishing = ref(false)
const dirty = ref(false)
const savedAt = ref('')
const lastSavedSnapshot = ref('')
const categories = ref([])
const previewEl = ref(null)
const editorRef = ref(null)
const coverUploading = ref(false)
const tagInput = ref('')
const mobileTab = ref('edit')

const form = ref({
  title: '',
  slug: '',
  content_md: '',
  excerpt: '',
  cover_image: '',
  category: '填词教程',
  tags: [],
  status: 'draft',
  publishedDate: '',
  publishedTime: ''
})

const slugTouched = ref(false)
const showPreview = ref(true)

/** 与服务端一致的 slug 生成规则（保持一致才能「本地看着是什么样，存下来就是什么样」） */
function slugify(title) {
  const base = String(title || '')
    .trim()
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (base || 'post-' + Date.now().toString(36)).slice(0, 80)
}

const previewHtml = computed(() => renderMarkdown(form.value.content_md || ''))
const wordCount = computed(() => (form.value.content_md || '').replace(/\s/g, '').length)
const titleErr = computed(() => (form.value.title.trim() ? '' : '标题不能为空'))

const publishAtIso = computed(() => {
  const d = form.value.publishedDate
  if (!d) return ''
  return `${d} ${form.value.publishedTime || '00:00'}:00`
})

// 标题变了自动生成 slug（除非用户已经手动改过 slug）
watch(
  () => form.value.title,
  (t) => {
    if (!slugTouched.value) form.value.slug = slugify(t)
  }
)

watch(
  () => form.value.slug,
  (v) => {
    if (v && v !== slugify(form.value.title)) slugTouched.value = true
  }
)

// 任何字段变化都重新判定「有没有未保存的改动」。
// ⚠️ 不要简单地置 dirty = true：loadPost 里给 form 赋值也会触发这个 watch，
//    那样刚打开的文章会被当成「已改动」，30 秒后自动保存一次白跑。
//    跟「上次保存时的快照」比对才是稳的。
watch(
  () => JSON.stringify({ ...form.value, publishedAtIso: publishAtIso.value }),
  () => {
    dirty.value = snapshot() !== lastSavedSnapshot.value
  }
)

function snapshot() {
  return JSON.stringify({ ...form.value, publishedAtIso: publishAtIso.value })
}

function payload(status) {
  const body = {
    title: form.value.title.trim() || '未命名草稿',
    slug: form.value.slug || slugify(form.value.title),
    content_md: form.value.content_md,
    excerpt: form.value.excerpt,
    cover_image: form.value.cover_image,
    category: form.value.category,
    tags: form.value.tags,
    status: status || form.value.status
  }
  if (publishAtIso.value) body.published_at = publishAtIso.value
  return body
}

async function loadPost() {
  if (isNew.value) {
    const now = new Date()
    form.value.publishedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    form.value.publishedTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    lastSavedSnapshot.value = snapshot()
    dirty.value = false
    loading.value = false
    return
  }
  loading.value = true
  try {
    const { data } = await Api.adminPost(postId.value)
    form.value = {
      title: data.title || '',
      slug: data.slug || '',
      content_md: data.content_md || '',
      excerpt: data.excerpt || '',
      cover_image: data.cover_image || '',
      category: data.category || '填词教程',
      tags: Array.isArray(data.tags) ? data.tags : [],
      status: data.status || 'draft',
      publishedDate: data.published_at ? String(data.published_at).slice(0, 10) : '',
      publishedTime: data.published_at ? String(data.published_at).slice(11, 16) : ''
    }
    slugTouched.value = true // 已有文章的 slug 不要被标题覆盖
    lastSavedSnapshot.value = snapshot()
    dirty.value = false
  } catch (e) {
    toast('文章加载失败：' + (e?.message || ''), 'error')
  } finally {
    loading.value = false
  }
}

async function loadCategories() {
  try {
    const { data } = await Api.adminCategories()
    categories.value = data.list || []
    if (categories.value.length && !categories.value.some((c) => c.name === form.value.category)) {
      categories.value.push({ id: -1, name: form.value.category, post_count: 0 })
    }
  } catch {}
}

/** 自动保存：新文章会在第一次自动保存时落库成草稿，然后把地址换成真实 id */
async function autosave() {
  if (!dirty.value || saving.value) return
  if (isNew.value && !form.value.title.trim() && !form.value.content_md.trim()) return
  await doSave(form.value.status === 'published' ? 'published' : 'draft', { silent: true })
}

async function doSave(status, { silent = false } = {}) {
  if (saving.value || publishing.value) return false
  if (!form.value.title.trim() && !silent) {
    toast('请先填写标题', 'error')
    return false
  }
  if (status === 'published') publishing.value = true
  else saving.value = true
  try {
    const body = payload(status)
    if (isNew.value) {
      const { data } = await Api.adminCreatePost(body)
      form.value.status = status
      await router.replace(`/admin/posts/edit/${data.id}`)
      emitCounts()
    } else {
      await Api.adminUpdatePost(postId.value, body)
      form.value.status = status
    }
    lastSavedSnapshot.value = snapshot()
    dirty.value = false
    savedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    if (!silent) toast(status === 'published' ? '文章已发布 ✓' : '草稿已保存 ✓', 'success')
    return true
  } catch (e) {
    toast((status === 'published' ? '发布失败：' : '保存失败：') + (e?.message || ''), 'error')
    return false
  } finally {
    saving.value = false
    publishing.value = false
  }
}

function emitCounts() {
  // 让外壳的侧栏角标跟上（草稿数 / 待审数）
  emit('refresh-counts')
}

function syncPreview(ratio) {
  const el = previewEl.value
  if (!el) return
  const max = el.scrollHeight - el.clientHeight
  if (max <= 0) return
  el.scrollTop = ratio * max
}

// ── 标签 ──────────────────────────────────────────────
function addTag() {
  const t = tagInput.value.trim().replace(/[,，\s]+/g, '')
  if (!t) return
  if (form.value.tags.length >= 10) {
    toast('最多 10 个标签', 'info')
    return
  }
  if (!form.value.tags.includes(t)) form.value.tags.push(t)
  tagInput.value = ''
}
function removeTag(t) {
  form.value.tags = form.value.tags.filter((x) => x !== t)
}

// ── 封面图 ────────────────────────────────────────────
async function pickCover() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const f = input.files?.[0]
    if (!f) return
    if (f.size > 4 * 1024 * 1024) {
      toast('封面不能超过 4MB', 'error')
      return
    }
    coverUploading.value = true
    try {
      const { data } = await Api.adminMediaUpload(f, postId.value || undefined)
      form.value.cover_image = data.url
      toast('封面已上传 ✓', 'success')
    } catch (e) {
      toast('上传失败：' + (e?.message || ''), 'error')
    } finally {
      coverUploading.value = false
    }
  }
  input.click()
}

// ── 摘要 ──────────────────────────────────────────────
function fillExcerpt() {
  form.value.excerpt = plainFromMarkdown(form.value.content_md, 110)
  toast('已从正文自动生成摘要', 'info')
}

// ── 快捷键 ────────────────────────────────────────────
function onKeydown(e) {
  const mod = e.ctrlKey || e.metaKey
  if (!mod) return
  const k = e.key.toLowerCase()
  const inEditor = e.target?.tagName === 'TEXTAREA' || e.target?.tagName === 'INPUT'
  if (k === 's') {
    e.preventDefault()
    doSave('draft')
  } else if (k === 'enter') {
    e.preventDefault()
    doSave('published')
  } else if ((k === 'b' || k === 'i') && inEditor) {
    // 只有在编辑器里才拦，不然在标题框里加粗会把人搞懵
    e.preventDefault()
    editorRef.value?.applyToolByKey(k)
  }
}

// ── 离开提醒 ──────────────────────────────────────────
function beforeUnload(e) {
  if (!dirty.value) return
  e.preventDefault()
  e.returnValue = ''
}

onBeforeRouteLeave(async () => {
  if (!dirty.value) return true
  const leave = await confirmDialog({
    title: '还有改动没保存',
    message: '正文或设置有改动尚未保存。\n\n离开后这些改动会丢失，确定离开吗？',
    confirmText: '不保存，离开',
    danger: true
  })
  return !!leave
})

// ── 自动保存定时器 ────────────────────────────────────
let timer = null

onMounted(async () => {
  await Promise.all([loadPost(), loadCategories()])
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', beforeUnload)
  timer = setInterval(autosave, 30000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', beforeUnload)
})

const savedHint = computed(() => {
  if (saving.value || publishing.value) return '保存中…'
  if (dirty.value) return savedAt.value ? `有改动未保存（上次 ${savedAt.value}）` : '有改动未保存'
  if (savedAt.value) return `已自动保存 · ${savedAt.value}`
  return isNew.value ? '尚未保存' : '已是最新'
})
</script>

<template>
  <div>
    <!-- 页头：标题 + 保存状态 + 按钮 -->
    <div class="adm-page-head">
      <h1 style="font-family: var(--a-font-title)">{{ isNew ? '新建文章' : '编辑文章' }}</h1>
      <span class="adm-saved-pill" :class="{ saving: saving || publishing }">
        <span class="dot"></span>{{ savedHint }}
      </span>
      <span class="sp"></span>
      <button class="btn sm" type="button" title="Ctrl/Cmd+S" :disabled="saving || publishing" @click="doSave('draft')">
        <span v-if="saving" class="adm-inkdrop"></span>
        {{ saving ? '保存中…' : '保存草稿' }}
      </button>
      <button class="btn primary sm" type="button" title="Ctrl/Cmd+Enter" :disabled="saving || publishing" @click="doSave('published')">
        <span v-if="publishing" class="adm-inkdrop"></span>
        {{ publishing ? '发布中…' : '发布文章' }}
      </button>
    </div>

    <!-- 移动端：Tab 切换三栏 -->
    <div class="adm-tabs mobile-tabs">
      <button type="button" :class="{ on: mobileTab === 'edit' }" @click="mobileTab = 'edit'">编辑</button>
      <button type="button" :class="{ on: mobileTab === 'preview' }" @click="mobileTab = 'preview'">预览</button>
      <button type="button" :class="{ on: mobileTab === 'settings' }" @click="mobileTab = 'settings'">设置</button>
    </div>

    <div class="adm-editor" :class="{ 'preview-off': !showPreview }">
      <!-- ① 编辑区 -->
      <section class="adm-card col-edit" :class="{ 'hide-mobile': mobileTab !== 'edit' }">
        <div class="adm-card-body" style="padding-bottom: 10px">
          <input v-model="form.title" class="adm-title-input" type="text" placeholder="在此写下标题…" maxlength="120" />
          <div class="adm-slug-row mt1">
            <span>别名 /</span>
            <input v-model="form.slug" type="text" placeholder="自动生成" @input="slugTouched = true" />
            <button class="adm-act" type="button" title="按标题重新生成" @click="form.slug = slugify(form.title); slugTouched = false">
              ↻ 重置
            </button>
          </div>
          <div class="meta-row">
            <span>{{ wordCount }} 字</span>
            <span>·</span>
            <span>{{ form.tags.length }} 个标签</span>
            <span>·</span>
            <span>{{ (form.content_md.match(/!\[/g) || []).length }} 张图</span>
          </div>
        </div>
        <div style="padding: 0 16px 16px">
          <MarkdownEditor
            ref="editorRef"
            v-model="form.content_md"
            mode="edit"
            :post-id="postId"
            :rows="26"
            placeholder="在这里写正文（Markdown）。可直接拖入 / 粘贴图片自动上传。"
            @scroll="syncPreview"
          />
        </div>
      </section>

      <!-- ② 预览区 -->
      <section
        v-show="showPreview"
        class="adm-card col-preview"
        :class="{ 'hide-mobile': mobileTab !== 'preview' }"
      >
        <div class="adm-card-head">
          <h3>实时预览</h3>
          <span class="sp"></span>
          <span class="tiny" style="color: var(--a-text-3)">滚动与左侧同步</span>
        </div>
        <div ref="previewEl" class="adm-preview">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-if="form.content_md" class="prose" v-html="previewHtml"></div>
          <p v-else class="tiny" style="color: var(--a-text-3)">左侧写了什么，这里就长什么样。</p>
        </div>
      </section>

      <!-- ③ 设置区 -->
      <aside class="col-side" :class="{ 'hide-mobile': mobileTab !== 'settings' }">
        <div class="adm-card adm-editor-side">
          <div class="adm-card-head"><h3>发布设置</h3></div>
          <div class="adm-card-body">
            <div class="adm-field">
              <label id="pe-status-label">状态</label>
              <div class="adm-seg" style="width: 100%" role="group" aria-labelledby="pe-status-label">
                <button
                  type="button"
                  style="flex: 1"
                  :class="{ on: form.status === 'draft' }"
                  :aria-pressed="form.status === 'draft'"
                  @click="form.status = 'draft'"
                >
                  草稿
                </button>
                <button
                  type="button"
                  style="flex: 1"
                  :class="{ on: form.status === 'published' }"
                  :aria-pressed="form.status === 'published'"
                  @click="form.status = 'published'"
                >
                  已发布
                </button>
              </div>
            </div>

            <div class="adm-field">
              <label for="pe-category">分类</label>
              <select id="pe-category" v-model="form.category" class="select">
                <option v-for="c in categories" :key="c.id + c.name" :value="c.name">{{ c.name }}</option>
              </select>
            </div>

            <div class="adm-field">
              <label for="pe-tag-input">标签（最多 10 个）</label>
              <div class="tags">
                <span v-for="t in form.tags" :key="t" class="tag-pill">
                  {{ t }}
                  <button type="button" title="移除" @click="removeTag(t)">✕</button>
                </span>
              </div>
              <div class="tag-add">
                <input
                  id="pe-tag-input"
                  v-model="tagInput"
                  class="input"
                  type="text"
                  placeholder="输入后回车添加"
                  maxlength="20"
                  @keydown.enter.prevent="addTag"
                />
                <button class="adm-act" type="button" @click="addTag">添加</button>
              </div>
            </div>

            <div class="adm-field" role="group" aria-labelledby="pe-cover-label">
              <label id="pe-cover-label">封面图</label>
              <div v-if="form.cover_image" class="cover">
                <img :src="form.cover_image" alt="封面预览" />
                <div class="cover-act">
                  <button class="adm-act" type="button" :disabled="coverUploading" @click="pickCover">换一张</button>
                  <button class="adm-act danger" type="button" @click="form.cover_image = ''">移除</button>
                </div>
              </div>
              <button v-else class="adm-drop" type="button" style="width: 100%" :disabled="coverUploading" @click="pickCover">
                <span v-if="coverUploading" class="adm-inkdrop"></span>
                {{ coverUploading ? '上传中…' : '＋ 上传封面' }}
              </button>
            </div>

            <div class="adm-field">
              <label for="pe-excerpt">摘要 <span class="tiny" style="color: var(--a-text-3)">（列表页 / 分享卡片显示）</span></label>
              <textarea id="pe-excerpt" v-model="form.excerpt" class="textarea" rows="3" maxlength="200" placeholder="留空会从正文自动截取"></textarea>
              <div class="row between">
                <button class="adm-act" type="button" @click="fillExcerpt">从正文生成</button>
                <span class="tiny" style="color: var(--a-text-3)">{{ form.excerpt.length }} / 200</span>
              </div>
            </div>

            <div class="adm-field">
              <label id="pe-pub-label">发布时间</label>
              <div class="dt" role="group" aria-labelledby="pe-pub-label">
                <input
                  id="pe-pub-date"
                  v-model="form.publishedDate"
                  class="input"
                  type="date"
                  aria-label="发布日期"
                />
                <input
                  id="pe-pub-time"
                  v-model="form.publishedTime"
                  class="input"
                  type="time"
                  aria-label="发布时间"
                />
              </div>
              <p class="tiny" style="color: var(--a-text-3); margin: 4px 0 0">
                留空则发布时自动记为「现在」。
              </p>
            </div>

            <p v-if="titleErr" class="err-line">{{ titleErr }}</p>

            <div class="side-actions">
              <button class="btn block" type="button" :disabled="saving || publishing" @click="doSave('draft')">保存草稿</button>
              <button class="btn primary block" type="button" :disabled="saving || publishing" @click="doSave('published')">
                发布文章
              </button>
              <RouterLink class="btn ghost block" to="/admin/posts">返回列表</RouterLink>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.mobile-tabs {
  display: none;
}
.meta-row {
  display: flex;
  gap: 6px;
  align-items: center;
  color: var(--a-text-3);
  font-size: var(--fs-xs);
  margin-top: 8px;
  font-variant-numeric: tabular-nums;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.tag-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border: 1px solid var(--a-line);
  border-radius: var(--a-radius);
  background: var(--a-card-2);
  font-size: var(--fs-sm);
  color: var(--a-text-2);
}
.tag-pill button {
  border: 0;
  background: transparent;
  color: var(--a-text-3);
  cursor: pointer;
  font-size: var(--fs-xs);
  padding: 0;
  line-height: 1;
}
.tag-pill button:hover {
  color: var(--a-danger);
}
.tag-add {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cover img {
  width: 100%;
  border-radius: var(--a-radius);
  border: 1px solid var(--a-line);
  display: block;
}
.cover-act {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}
.dt {
  display: flex;
  gap: 8px;
}
.dt .input {
  flex: 1;
  min-width: 0;
}
.err-line {
  color: var(--a-danger);
  font-size: var(--fs-sm);
  margin: 0 0 12px;
}
.side-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--a-line-2);
  margin-top: 6px;
}
.col-edit,
.col-preview {
  min-width: 0;
}
@media (max-width: 1024px) {
  .mobile-tabs {
    display: flex;
  }
  .hide-mobile {
    display: none !important;
  }
}
</style>
