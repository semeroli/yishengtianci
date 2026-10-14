<script setup>
import { computed, onMounted, ref } from 'vue'
import { Api } from '../api.js'
import { useWorkbench } from '../stores/workbench.js'
import { confirmDialog, toast } from '../stores/ui.js'
import { fmtRelative } from '../utils/format.js'

/**
 * 我的词笺
 * ─────────────────────────────────────────────────────────────
 * 词笺按「访客标识」存，不需要注册。
 * 存的是快照（词牌名 + 正文 + 意境），即使原记录被清理也还能读。
 */

const { favorites, favLoading, loadFavorites } = useWorkbench()
const tab = ref('poem')

const poems = computed(() => favorites.value.filter((f) => f.target_type === 'poem'))
const posts = computed(() => favorites.value.filter((f) => f.target_type === 'post'))
const shown = computed(() => (tab.value === 'poem' ? poems.value : posts.value))

function snap(f) {
  try {
    return JSON.parse(f.snapshot_json || '{}')
  } catch {
    return {}
  }
}

/** 快照里的正文是「句1|句2|…」，取出来还原成竖排/横排都能看的字符串 */
function snapLines(f) {
  const s = snap(f)
  return String(s.text || '').split('|').filter(Boolean)
}

async function remove(f, e) {
  e?.stopPropagation?.()
  const ok = await confirmDialog({
    title: '移出词笺',
    message: '这条收藏会从词笺中删除，原词作记录不受影响。确定移出吗？',
    confirmText: '移出',
    danger: true
  })
  if (!ok) return
  try {
    await Api.removeFavorite(f.id)
    favorites.value = favorites.value.filter((x) => x.id !== f.id)
    toast('已移出词笺', 'info')
  } catch (err) {
    toast(err.message || '操作失败', 'error')
  }
}

async function copyPoem(f) {
  const s = snap(f)
  const lines = snapLines(f)
  const text = `《${s.cipaiName || ''}》\n` + lines.join('\n')
  try {
    await navigator.clipboard.writeText(text)
    toast('已复制', 'success')
  } catch {
    toast('复制失败，请手动选中', 'error')
  }
}

onMounted(loadFavorites)
</script>

<template>
  <div class="page wrap">
    <section class="head reveal">
      <h1>我的词笺</h1>
      <p class="sub">
        收藏的词作与文章都记在这个浏览器里（不需要注册）。
        <span class="muted">换浏览器或清了数据就会丢，重要作品请先用「生成卡片」存成图片。</span>
      </p>
    </section>

    <div class="seg">
      <button class="seg-btn" :class="{ on: tab === 'poem' }" @click="tab = 'poem'">
        🖊️ 词作（{{ poems.length }}）
      </button>
      <button class="seg-btn" :class="{ on: tab === 'post' }" @click="tab = 'post'">
        📖 文章（{{ posts.length }}）
      </button>
      <button class="seg-btn ghost" :disabled="favLoading" @click="loadFavorites">↻ 刷新</button>
    </div>

    <div v-if="favLoading" class="center muted mt3"><span class="spin">◌</span> 载入词笺……</div>

    <p v-else-if="!shown.length" class="empty mt3">
      <span class="glyph">笺</span>
      <span class="line">词笺还是空的</span>
      <span class="sub">
        {{ tab === 'poem' ? '去工作台生成一首，点「收藏到词笺」' : '在博客里点「收藏到词笺」' }}
      </span>
    </p>

    <!-- 词作 -->
    <div v-else-if="tab === 'poem'" class="fav-grid">
      <article v-for="f in shown" :key="f.id" class="panel fav-card">
        <div class="row between wrap">
          <b class="kai fs-lg">{{ snap(f).cipaiName || '词作' }}</b>
          <div class="row gap-xs">
            <button class="mini" @click="copyPoem(f)">⧉</button>
            <button class="mini bad" @click="remove(f, $event)">✕</button>
          </div>
        </div>
        <div class="poem-lines">
          <p v-for="(l, i) in snapLines(f)" :key="i">{{ l }}</p>
        </div>
        <p v-if="snap(f).prompt" class="tiny muted mb0">意境：{{ snap(f).prompt }}</p>
        <div class="row between mt1">
          <span class="tiny muted">{{ fmtRelative(f.created_at) }}</span>
          <span class="tag tiny plain">{{ snap(f).engine === 'ai' ? 'AI' : '本地引擎' }}</span>
        </div>
      </article>
    </div>

    <!-- 文章 -->
    <div v-else class="fav-list">
      <article v-for="f in shown" :key="f.id" class="panel fav-row">
        <RouterLink class="grow link" :to="`/blog/${encodeURIComponent(snap(f).slug || f.target_id)}`">
          <b>{{ snap(f).title || '文章' }}</b>
          <div class="tiny muted mt1">收藏于 {{ fmtRelative(f.created_at) }}</div>
        </RouterLink>
        <button class="mini bad" @click="remove(f, $event)">✕ 移出</button>
      </article>
    </div>
  </div>
</template>

<style scoped>
.head {
  padding: 12px 0 18px;
}
.head h1 {
  font-family: var(--font-kai);
  font-size: clamp(1.6rem, 3.4vw, 2.1rem);
  letter-spacing: 0.14em;
  margin: 0 0 10px;
}
.head .sub {
  color: var(--ink-2);
  margin: 0;
  line-height: 1.9;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--line-strong);
  border-radius: var(--r);
  overflow: hidden;
  margin-bottom: 20px;
}
.seg-btn {
  padding: 7px 15px;
  background: transparent;
  border: 0;
  color: var(--ink-3);
  cursor: pointer;
  font-size: 0.88rem;
  transition: all var(--t-fast);
}
.seg-btn.on {
  background: var(--ink);
  color: var(--paper);
}
.seg-btn.ghost:hover:not(:disabled) {
  color: var(--cinnabar);
}
.fav-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(255px, 1fr));
  gap: 16px;
}
.fav-card {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.fs-lg {
  font-size: 1.16rem;
}
.poem-lines {
  font-family: var(--font-kai);
  font-size: 1.02rem;
  line-height: 2;
  color: var(--ink);
  border-left: 2px solid var(--line-strong);
  padding-left: 12px;
}
.poem-lines p {
  margin: 0;
}
.gap-xs {
  gap: 5px;
}
.mini {
  border: 1px solid var(--line-strong);
  background: var(--paper-2);
  color: var(--ink-3);
  border-radius: var(--r);
  font-size: 0.74rem;
  padding: 2px 8px;
  cursor: pointer;
  transition: all var(--t-fast);
}
.mini:hover {
  border-color: var(--cinnabar);
  color: var(--cinnabar);
}
.mini.bad:hover {
  background: var(--cinnabar);
  color: var(--paper-2);
}
.fav-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.fav-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
}
.link {
  text-decoration: none;
  color: var(--ink);
}
.link:hover b {
  color: var(--cinnabar);
}
</style>
