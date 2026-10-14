<script setup>
import { computed, onMounted, ref } from 'vue'
import { Api } from '../../api.js'
import { confirmDelete, toast } from '../../stores/ui.js'
import AdminEmpty from '../../components/admin/AdminEmpty.vue'
import AdminSkeleton from '../../components/admin/AdminSkeleton.vue'

/**
 * 媒体库
 * ─────────────────────────────────────────────────────────────
 * 网格 + 详情抽屉。图片现在同时有「R2 里的对象」和「media_files 里的索引」，
 * 详情里显示的尺寸是上传时从文件头解析出来的（后端 imageSize），
 * 不是靠浏览器加载后量的 —— 所以列表页不用把每张图都下下来。
 */

const loading = ref(true)
const uploading = ref(false)
const progress = ref(0)
const dragOn = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(24)
const pages = ref(1)
const q = ref('')
const current = ref(null)
const absUrl = ref('')

const hasMore = computed(() => page.value < pages.value)

async function load(append = false) {
  loading.value = true
  try {
    const params = { page: page.value, pageSize: pageSize.value }
    if (q.value.trim()) params.q = q.value.trim()
    const { data } = await Api.adminMedia(params)
    list.value = append ? [...list.value, ...(data.list || [])] : data.list || []
    total.value = data.total || 0
    pages.value = data.pages || 1
  } catch (e) {
    toast('加载失败：' + (e?.message || ''), 'error', 0, { label: '重试', run: () => load(false) })
  } finally {
    loading.value = false
  }
}

function search() {
  page.value = 1
  load(false)
}

function loadMore() {
  if (!hasMore.value) return
  page.value += 1
  load(true)
}

async function upload(files) {
  const imgs = [...files].filter((f) => /^image\//.test(f.type))
  if (!imgs.length) {
    toast('只支持图片文件', 'info')
    return
  }
  uploading.value = true
  progress.value = 0
  let done = 0
  let failed = 0
  for (const f of imgs) {
    if (f.size > 4 * 1024 * 1024) {
      toast(`${f.name} 超过 4MB，已跳过`, 'error')
      failed++
      continue
    }
    try {
      await Api.adminMediaUpload(f)
      done++
    } catch (e) {
      failed++
      toast(`${f.name} 上传失败：${e?.message || ''}`, 'error')
    }
    progress.value = Math.round(((done + failed) / imgs.length) * 100)
  }
  uploading.value = false
  progress.value = 0
  if (done) toast(`已上传 ${done} 张图片 ✓`, 'success')
  page.value = 1
  await load(false)
}

function pickFiles() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = true
  input.onchange = () => upload(input.files)
  input.click()
}

function onDrop(e) {
  dragOn.value = false
  if (e.dataTransfer?.files?.length) upload(e.dataTransfer.files)
}

function openDetail(m) {
  current.value = m
  absUrl.value = m.url.startsWith('http') ? m.url : location.origin + m.url
}

function closeDetail() {
  current.value = null
}

async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text)
    toast(`${what}已复制 ✓`, 'success')
  } catch {
    // 非 https / 无权限时的兜底
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
      toast(`${what}已复制 ✓`, 'success')
    } catch {
      toast('复制失败，请手动选中复制', 'error')
    }
    document.body.removeChild(ta)
  }
}

function copyMarkdown(m) {
  const alt = (m.original_name || '图片').replace(/\.[^.]+$/, '')
  copy(`![${alt}](${m.url})`, 'Markdown')
}

async function replaceFile() {
  if (!current.value) return
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const f = input.files?.[0]
    if (!f) return
    uploading.value = true
    try {
      await Api.adminMediaReplace(current.value.id, f)
      toast('图片已替换 ✓', 'success')
      closeDetail()
      page.value = 1
      await load(false)
    } catch (e) {
      toast('替换失败：' + (e?.message || ''), 'error')
    } finally {
      uploading.value = false
    }
  }
  input.click()
}

async function removeFile() {
  if (!current.value) return
  const ok = await confirmDelete(`图片「${current.value.original_name || current.value.filename}」`)
  if (!ok) return
  try {
    await Api.adminMediaDelete(current.value.id)
    toast('图片已删除', 'success')
    closeDetail()
    page.value = 1
    await load(false)
  } catch (e) {
    toast('删除失败：' + (e?.message || ''), 'error')
  }
}

function fmtSize(n) {
  const b = Number(n) || 0
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  return (b / 1024 / 1024).toFixed(2) + ' MB'
}

function fmtTime(s) {
  return String(s || '').slice(0, 16)
}

onMounted(() => load(false))
</script>

<template>
  <div>
    <div class="adm-page-head">
      <h1>媒体库</h1>
      <span class="desc">共 {{ total }} 张图片 · 单张不超过 4MB</span>
      <span class="sp"></span>
      <button class="btn primary sm" type="button" :disabled="uploading" @click="pickFiles">
        <span v-if="uploading" class="adm-inkdrop"></span>
        {{ uploading ? '上传中…' : '＋ 上传图片' }}
      </button>
    </div>

    <div class="adm-card">
      <div class="adm-toolbar">
        <label class="adm-search" style="min-width: 200px">
          <span class="ic">🔍</span>
          <input v-model="q" type="search" placeholder="搜索文件名" @keydown.enter="search" />
        </label>
        <button class="btn sm" type="button" @click="search">搜索</button>
        <span class="sp"></span>
        <span class="tiny" style="color: var(--a-text-3)">点图片看详情 · 也可直接拖文件到这里</span>
      </div>

      <div class="adm-card-body">
        <div
          class="adm-drop"
          :class="{ on: dragOn }"
          style="position: relative"
          @click="pickFiles"
          @dragover.prevent="dragOn = true"
          @dragleave="dragOn = false"
          @drop.prevent="onDrop"
        >
          <span v-if="uploading" class="adm-ink-veil"></span>
          点此选择图片，或把文件拖到这里上传
          <div v-if="uploading" class="adm-progress"><i :style="{ width: progress + '%' }"></i></div>
        </div>

        <AdminSkeleton v-if="loading && !list.length" :rows="4" />

        <AdminEmpty
          v-else-if="!list.length"
          line="媒体库还是空的"
          :sub="q ? '换个文件名试试' : '文章里插图会自动进这里，也可以手动上传'"
          action="＋ 上传第一张"
          @action="pickFiles"
        />

        <template v-else>
          <div class="adm-media-grid mt2">
            <figure
              v-for="m in list"
              :key="m.id"
              class="adm-media-cell"
              :class="{ on: current?.id === m.id }"
              @click="openDetail(m)"
            >
              <div class="thumb"><img :src="m.url" :alt="m.original_name || m.filename" loading="lazy" /></div>
              <figcaption class="meta">
                <div class="fn" :title="m.original_name || m.filename">{{ m.original_name || m.filename }}</div>
                <div class="sz">
                  {{ m.width && m.height ? `${m.width}×${m.height}` : '尺寸未知' }} · {{ fmtSize(m.size_bytes) }}
                </div>
              </figcaption>
            </figure>
          </div>

          <div v-if="hasMore" class="more">
            <button class="btn sm" type="button" :disabled="loading" @click="loadMore">
              {{ loading ? '加载中…' : `加载更多（还有 ${total - list.length} 张）` }}
            </button>
          </div>
          <p v-else class="end tiny">— 已经到底了 —</p>
        </template>
      </div>
    </div>

    <!-- 详情侧边栏 -->
    <Transition name="slide">
      <div v-if="current" class="detail-mask" @click.self="closeDetail">
        <aside class="detail">
          <header class="d-head">
            <h3>图片详情</h3>
            <span class="sp"></span>
            <button class="adm-icon-btn" type="button" title="关闭（Esc）" @click="closeDetail">✕</button>
          </header>

          <div class="d-preview">
            <img :src="current.url" :alt="current.original_name || current.filename" />
          </div>

          <dl class="d-list">
            <div><dt>文件名</dt><dd class="mono">{{ current.original_name || '—' }}</dd></div>
            <div><dt>存储名</dt><dd class="mono ell">{{ current.filename }}</dd></div>
            <div><dt>大小</dt><dd>{{ fmtSize(current.size_bytes) }}</dd></div>
            <div>
              <dt>尺寸</dt>
              <dd>{{ current.width && current.height ? `${current.width} × ${current.height} px` : '未知（非 PNG/GIF/JPEG/WebP）' }}</dd>
            </div>
            <div><dt>类型</dt><dd class="mono">{{ current.mime_type }}</dd></div>
            <div><dt>上传时间</dt><dd>{{ fmtTime(current.uploaded_at) }}</dd></div>
            <div><dt>所属文章</dt><dd>{{ current.post_title || '未关联' }}</dd></div>
            <div><dt>存储位置</dt><dd>{{ current.storage === 'r2' ? 'R2 对象存储' : '数据库（本地模式）' }}</dd></div>
          </dl>

          <div class="d-actions">
            <button class="btn sm" type="button" @click="copy(absUrl, '图片链接')">复制链接</button>
            <button class="btn sm" type="button" @click="copyMarkdown(current)">复制 Markdown</button>
            <a class="btn sm" :href="current.url" :download="current.original_name || current.filename">下载</a>
            <button class="btn sm" type="button" :disabled="uploading" @click="replaceFile">替换图片</button>
            <button class="btn sm" type="button" style="color: var(--a-danger)" @click="removeFile">删除</button>
          </div>

          <p class="d-tip tiny">
            复制到的链接是相对地址（<span class="mono">{{ current.url }}</span>），
            站内引用最稳；要发给别处再用「复制链接」里的完整地址。
          </p>
        </aside>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.more {
  text-align: center;
  padding: 18px 0 4px;
}
.end {
  text-align: center;
  color: var(--a-text-3);
  padding: 16px 0 4px;
  margin: 0;
}
.slide-enter-active,
.slide-leave-active {
  transition: opacity 200ms;
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
}
.detail-mask {
  position: fixed;
  inset: 0;
  z-index: 400;
  background: rgba(24, 26, 32, 0.42);
  backdrop-filter: blur(4px);
  display: flex;
  justify-content: flex-end;
}
/* 大屏是右侧抽屉，窄屏变成整屏弹层 */
.detail {
  width: min(420px, 100%);
  height: 100%;
  background: var(--a-card);
  border-left: 1px solid var(--a-line);
  box-shadow: var(--a-shadow-3);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  animation: detailIn 240ms var(--ease-ink) both;
}
@keyframes detailIn {
  from {
    transform: translateX(24px);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
.d-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--a-line-2);
  position: sticky;
  top: 0;
  background: var(--a-card);
  z-index: 1;
}
.d-head h3 {
  margin: 0;
  font-size: 1rem;
}
.d-head .sp {
  flex: 1;
}
.d-head .adm-icon-btn {
  border-color: var(--a-line);
  color: var(--a-text-3);
  width: 26px;
  height: 26px;
}
.d-preview {
  padding: 16px;
  background: var(--a-card-2);
  border-bottom: 1px solid var(--a-line-2);
  display: flex;
  justify-content: center;
}
.d-preview img {
  max-width: 100%;
  max-height: 260px;
  border-radius: var(--a-radius);
  border: 1px solid var(--a-line);
  background: repeating-conic-gradient(#0000 0% 25%, rgba(0, 0, 0, 0.04) 0% 50%) 50% / 16px 16px;
}
.d-list {
  margin: 0;
  padding: 6px 16px 0;
  flex: 1;
}
.d-list > div {
  display: flex;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px dashed var(--a-line-2);
  font-size: 0.84rem;
}
.d-list dt {
  color: var(--a-text-3);
  width: 74px;
  flex-shrink: 0;
}
.d-list dd {
  margin: 0;
  color: var(--a-text);
  word-break: break-all;
}
.ell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.d-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 16px;
}
.d-actions .btn {
  text-decoration: none;
}
.d-tip {
  color: var(--a-text-3);
  padding: 0 16px 20px;
  margin: 0;
  line-height: 1.8;
}
@media (max-width: 768px) {
  .detail {
    width: 100%;
  }
}
</style>
