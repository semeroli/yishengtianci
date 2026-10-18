<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { Api } from '../api.js'
import { toast } from '../stores/ui.js'
import { renderMarkdown } from '../utils/markdown.js'

/**
 * Markdown 编辑器（左写右看）
 * ─────────────────────────────────────────────────────────────
 * 没引第三方编辑器，原因有三：
 *  ① 体积——Milkdown/Tiptap 都是几百 KB，这个站点只需要「写文章」这点功能；
 *  ② 可控——粘贴/拖拽上传、光标处插入，自己写反而更贴合本站的上传接口；
 *  ③ 后台/前台共用——这里的预览和博客正文用同一个 renderMarkdown，
 *     预览是什么样，发出去就是什么样。
 *
 * 支持：工具栏插入、Tab 缩进、拖拽与粘贴上传图片、左右滚动同步。
 */

const props = defineProps({
  modelValue: { type: String, default: '' },
  rows: { type: Number, default: 24 },
  placeholder: { type: String, default: '在这里写正文（Markdown）。可直接拖入 / 粘贴图片自动上传。' },
  /** 左右滚动同步：长文写作时，写着左边能看着右边大致对得上 */
  syncScroll: { type: Boolean, default: true },
  /** 关联的文章 id：上传的图片会记到这篇文章名下（媒体库「所属文章」用） */
  postId: { type: [Number, String], default: null },
  /**
   * split = 自带左写右看（前台 / 简单场景）
   * edit  = 只出编辑区（后台三栏编辑器自己放预览列，用 scroll 事件做同步）
   */
  mode: { type: String, default: 'split' },
  extraTools: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:modelValue', 'save', 'publish', 'uploaded', 'scroll'])

const ta = ref(null)
const viewEl = ref(null)
const uploading = ref(false)
const previewHtml = computed(() => renderMarkdown(props.modelValue || ''))
const dragOver = ref(false)
let syncing = 0

const TOOLS = [
  { label: 'H1', title: '一级标题', wrap: false, prefix: '# ' },
  { label: 'H2', title: '二级标题', wrap: false, prefix: '## ' },
  { label: 'H3', title: '三级标题', wrap: false, prefix: '### ' },
  { label: 'B', title: '加粗（Ctrl/Cmd + B）', wrap: true, prefix: '**', suffix: '**', style: 'font-weight:700', key: 'b' },
  { label: 'I', title: '斜体（Ctrl/Cmd + I）', wrap: true, prefix: '*', suffix: '*', style: 'font-style:italic', key: 'i' },
  { label: 'U', title: '下划线', wrap: true, prefix: '<u>', suffix: '</u>', style: 'text-decoration:underline' },
  { label: '🔗', title: '链接', wrap: true, prefix: '[', suffix: '](https://)' },
  { label: '🖼', title: '插入图片（也可直接拖入 / 粘贴）', action: 'image' },
  { label: '❝', title: '引用', wrap: false, prefix: '> ', block: true },
  { label: '•', title: '无序列表', wrap: false, prefix: '- ', block: true },
  { label: '1.', title: '有序列表', wrap: false, prefix: '1. ', block: true },
  { label: '</>', title: '代码块', wrap: false, snippet: '\n```\n\n```\n' },
  { label: '`', title: '行内代码', wrap: true, prefix: '`', suffix: '`' },
  {
    label: '▦',
    title: '表格',
    wrap: false,
    snippet: '\n| 词牌 | 字数 | 韵 |\n| --- | --- | --- |\n| 浣溪沙 | 42 | 平 |\n| 如梦令 | 33 | 仄 |\n\n'
  },
  { label: '—', title: '分隔线', wrap: false, snippet: '\n---\n' },
  {
    label: '词',
    title: '词牌格律块',
    wrap: false,
    snippet:
      '\n> **《浣溪沙》**　42 字 · 6 句 · 平韵\n> ◐●◐○○●●○　◐○◐●●○○　◐○◐●●○○\n> ◐●◐○○●●　◐○◐●●○○　◐○◐●●○○\n\n'
  }
]

function insertAtCursor(text, { selectOffset = 0 } = {}) {
  const el = ta.value
  if (!el) return
  const start = el.selectionStart
  const end = el.selectionEnd
  const cur = props.modelValue || ''
  const next = cur.slice(0, start) + text + cur.slice(end)
  emit('update:modelValue', next)
  nextTick(() => {
    el.focus()
    const pos = start + text.length - selectOffset
    el.setSelectionRange(pos, pos)
  })
}

function applyTool(t) {
  if (t.action === 'image') {
    pickFiles()
    return
  }
  const el = ta.value
  if (!el) return
  const start = el.selectionStart
  const end = el.selectionEnd
  const cur = props.modelValue || ''
  const sel = cur.slice(start, end)

  if (t.snippet) {
    insertAtCursor(t.snippet, { selectOffset: t.snippet.length - 3 > 0 ? 3 : 0 })
    return
  }
  if (t.wrap) {
    const text = (t.prefix || '') + (sel || '') + (t.suffix || '')
    const next = cur.slice(0, start) + text + cur.slice(end)
    emit('update:modelValue', next)
    nextTick(() => {
      el.focus()
      el.setSelectionRange(start + (t.prefix || '').length, start + (t.prefix || '').length + sel.length)
    })
    return
  }
  const prefix = t.prefix || ''
  if (sel && sel.includes('\n')) {
    const text = sel
      .split('\n')
      .map((l) => prefix + l)
      .join('\n')
    const next = cur.slice(0, start) + text + cur.slice(end)
    emit('update:modelValue', next)
    nextTick(() => {
      el.focus()
      el.setSelectionRange(start, start + text.length)
    })
    return
  }
  const lineStart = cur.lastIndexOf('\n', start - 1) + 1
  const lineEnd = cur.indexOf('\n', start)
  const stop = lineEnd === -1 ? cur.length : lineEnd
  const line = cur.slice(lineStart, stop)
  const text = prefix + line
  const next = cur.slice(0, lineStart) + text + cur.slice(stop)
  emit('update:modelValue', next)
  nextTick(() => {
    el.focus()
    const pos = start + prefix.length
    el.setSelectionRange(pos, pos)
  })
}

/** 直接套用某个工具（供父组件响应 Ctrl+B / Ctrl+I） */
function applyToolByKey(k) {
  const t = TOOLS.find((x) => x.key === k)
  if (t) applyTool(t)
}

function onKeydown(e) {
  if (e.key === 'Tab') {
    e.preventDefault()
    insertAtCursor('  ')
    return
  }
  // Ctrl/Cmd+S、Ctrl/Cmd+Enter 交给父组件（它才知道该存草稿还是发布）
  const mod = e.ctrlKey || e.metaKey
  if (mod && ['s', 'enter'].includes(e.key.toLowerCase())) return
}

/** 左右滚动同步：按滚动比例映射，避免两侧行高不同导致越滚越偏 */
function onEditScroll() {
  const src = ta.value
  if (!src) return
  const max = src.scrollHeight - src.clientHeight
  const ratio = max > 0 ? src.scrollTop / max : 0
  // 三栏模式下预览在父组件里，把比例交给它自己算
  emit('scroll', ratio)
  if (!props.syncScroll || props.mode === 'edit' || syncing === 2) return
  const dst = viewEl.value
  if (!dst) return
  syncing = 1
  dst.scrollTop = ratio * (dst.scrollHeight - dst.clientHeight)
  requestAnimationFrame(() => {
    syncing = 0
  })
}

function onViewScroll() {
  if (!props.syncScroll || syncing === 1) return
  const src = viewEl.value
  const dst = ta.value
  if (!src || !dst) return
  const max = src.scrollHeight - src.clientHeight
  if (max <= 0) return
  syncing = 2
  dst.scrollTop = (src.scrollTop / max) * (dst.scrollHeight - dst.clientHeight)
  requestAnimationFrame(() => {
    syncing = 0
  })
}

async function uploadFiles(files) {
  const imgs = [...files].filter((f) => /^image\//.test(f.type))
  if (!imgs.length) {
    toast('只支持粘贴 / 拖入图片文件', 'info')
    return
  }
  uploading.value = true
  let ok = 0
  for (const f of imgs) {
    if (f.size > 4 * 1024 * 1024) {
      toast(`${f.name} 超过 4MB，已跳过`, 'error')
      continue
    }
    try {
      const { data } = await Api.adminMediaUpload(f, props.postId || undefined)
      const alt = f.name.replace(/\.[^.]+$/, '')
      insertAtCursor(`\n![${alt}](${data.url})\n`)
      ok++
      emit('uploaded', data)
    } catch (err) {
      toast(err.message || '上传失败', 'error')
    }
  }
  uploading.value = false
  if (ok) toast(`已上传并插入 ${ok} 张图片 ✓`, 'success')
}

function onPaste(e) {
  const items = [...(e.clipboardData?.items || [])]
  const files = items.filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean)
  if (files.length) {
    e.preventDefault()
    uploadFiles(files)
  }
}

async function onDrop(e) {
  dragOver.value = false
  const files = [...(e.dataTransfer?.files || [])]
  if (files.length) {
    e.preventDefault()
    await uploadFiles(files)
  }
}

function pickFiles() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = true
  input.onchange = () => uploadFiles(input.files)
  input.click()
}

onBeforeUnmount(() => {
  syncing = 0
})

const stats = computed(() => {
  const s = props.modelValue || ''
  const cn = (s.match(/[\u4e00-\u9fa5]/g) || []).length
  return { chars: s.length, cn, minutes: Math.max(1, Math.round(s.length / 400)) }
})

defineExpose({ insertAtCursor, applyToolByKey, focus: () => ta.value?.focus() })
</script>

<template>
  <div
    class="mde"
    :class="{ 'drag-on': dragOver }"
    @dragover.prevent="dragOver = true"
    @dragleave="dragOver = false"
    @drop="onDrop"
  >
    <div class="bar">
      <button
        v-for="t in [...TOOLS, ...extraTools]"
        :key="t.label + (t.title || '')"
        class="tb"
        type="button"
        :title="t.title || t.label"
        :style="t.style"
        @click="applyTool(t)"
      >
        {{ t.label }}
      </button>
    </div>

    <div class="split" :class="{ solo: mode === 'edit' }">
      <textarea
        ref="ta"
        class="pane edit"
        :rows="rows"
        :value="modelValue"
        :placeholder="placeholder"
        spellcheck="false"
        @input="emit('update:modelValue', $event.target.value)"
        @keydown="onKeydown"
        @paste="onPaste"
        @scroll="onEditScroll"
      ></textarea>

      <div v-if="mode !== 'edit'" ref="viewEl" class="pane view">
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-if="modelValue" class="prose" v-html="previewHtml"></div>
        <div v-else class="ph muted small">右侧实时预览</div>
      </div>
    </div>

    <!-- 上传中：淡墨晕染 -->
    <div v-if="uploading" class="ink-veil"><span class="adm-inkdrop"></span> 图片上传中…</div>

    <div class="foot tiny muted">
      <span>共 {{ stats.chars }} 字符（中文 {{ stats.cn }} 字）· 约 {{ stats.minutes }} 分钟读完</span>
      <span class="sp"></span>
      <span>拖入图片即可上传 · Ctrl/Cmd+S 存草稿 · Ctrl/Cmd+Enter 发布</span>
    </div>
  </div>
</template>

<style scoped>
.mde {
  border: 1px solid var(--a-line, var(--line-strong));
  border-radius: var(--r);
  overflow: hidden;
  background: var(--a-card, var(--paper-2));
  position: relative;
}
.mde.drag-on {
  box-shadow: 0 0 0 2px var(--a-primary, var(--cinnabar));
}
.bar {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  padding: 6px 7px;
  border-bottom: 1px solid var(--a-line-2, var(--line));
  background: var(--a-card-2, var(--paper-inset));
  position: sticky;
  top: 0;
  z-index: 2;
}
.tb {
  border: 1px solid transparent;
  background: transparent;
  color: var(--a-text-2, var(--ink-2));
  border-radius: 3px;
  min-width: 29px;
  height: 28px;
  padding: 0 6px;
  cursor: pointer;
  font-size: var(--fs-sm);
  font-family: var(--a-font-mono, var(--font-mono));
  transition: all 120ms;
}
.tb:hover {
  background: var(--a-card, var(--paper-2));
  border-color: var(--a-line, var(--line-strong));
  color: var(--a-primary, var(--cinnabar));
}
.sp {
  flex: 1;
}
.split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: 0;
}
.split.solo {
  grid-template-columns: 1fr;
}
.pane {
  min-width: 0;
  max-height: 64vh;
  overflow: auto;
}
.edit {
  border: 0;
  border-right: 1px solid var(--a-line-2, var(--line));
  background: var(--a-card, var(--paper-2));
  color: var(--a-text, var(--ink));
  padding: 14px 16px;
  font-family: var(--a-font-mono, var(--font-mono));
  font-size: 0.9rem;
  line-height: 1.9;
  resize: vertical;
  outline: none;
}
.view {
  padding: 14px 16px;
  background: var(--a-surface, var(--paper));
}
.ph {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
}
.foot {
  display: flex;
  gap: 10px;
  padding: 6px 10px;
  border-top: 1px solid var(--a-line-2, var(--line));
  background: var(--a-card-2, var(--paper-inset));
}
.ink-veil {
  position: absolute;
  right: 12px;
  bottom: 40px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border-radius: 999px;
  background: var(--a-card, var(--paper-2));
  border: 1px solid var(--a-line, var(--line-strong));
  box-shadow: var(--a-shadow-2, var(--shadow-2));
  font-size: 0.82rem;
  color: var(--a-primary, var(--cinnabar));
  z-index: 3;
}
@media (max-width: 900px) {
  .split {
    grid-template-columns: 1fr;
  }
  .edit {
    border-right: 0;
    border-bottom: 1px solid var(--a-line-2, var(--line));
    max-height: 42vh;
  }
  .pane {
    max-height: 42vh;
  }
}
</style>
