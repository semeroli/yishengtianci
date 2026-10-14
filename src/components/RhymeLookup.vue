<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { Api } from '../api.js'

/**
 * 韵书速查 + 词林正韵简表
 * ─────────────────────────────────────────────────────────────
 * 两个视图共用一个组件：
 *   「查字」——输入一个字，看它属于哪几个韵部（多音字会落多个部）；
 *   「简表」——十二个常用韵部一览，写词时先认韵部，再挑字。
 */

const props = defineProps({
  compact: { type: Boolean, default: false },
  tab: { type: String, default: 'lookup' } // lookup | table
})

const view = ref(props.tab)
watch(
  () => props.tab,
  (v) => {
    view.value = v
  }
)

const q = ref('')
const loading = ref(false)
const tableLoading = ref(false)
const bus = ref([])
const result = ref(null)
const err = ref('')

const hotChars = ['风', '月', '花', '春', '秋', '江', '山', '愁', '梦', '寒']

async function loadTable() {
  if (bus.value.length || tableLoading.value) return
  tableLoading.value = true
  try {
    const { data } = await Api.rhyme('')
    bus.value = data.bus || []
  } catch (e) {
    err.value = e.message || '韵书加载失败'
  } finally {
    tableLoading.value = false
  }
}

async function search(text) {
  const s = (text ?? q.value).trim()
  if (!s) {
    result.value = null
    return
  }
  q.value = s
  loading.value = true
  err.value = ''
  try {
    const { data } = await Api.rhyme(s)
    result.value = data
  } catch (e) {
    err.value = e.message || '查询失败'
    result.value = null
  } finally {
    loading.value = false
  }
}

function reset() {
  q.value = ''
  result.value = null
}

onMounted(() => {
  if (view.value === 'table') loadTable()
})
watch(view, (v) => {
  if (v === 'table') loadTable()
})

const pingBus = computed(() => bus.value.filter((b) => b.tone === '平'))
const zeBus = computed(() => bus.value.filter((b) => b.tone === '仄'))
</script>

<template>
  <div class="rhyme-tools">
    <div class="row between wrap mb2">
      <div class="seg">
        <button class="seg-btn" :class="{ on: view === 'lookup' }" @click="view = 'lookup'">查字归韵</button>
        <button class="seg-btn" :class="{ on: view === 'table' }" @click="view = 'table'">词林正韵简表</button>
      </div>
      <router-link v-if="compact" class="small muted link" to="/rhyme">独立页 ↗</router-link>
    </div>

    <!-- ── 查字 ── -->
    <div v-if="view === 'lookup'">
      <div class="row gap">
        <input
          v-model="q"
          class="input"
          type="text"
          maxlength="8"
          placeholder="输入一个字，如：风 / 月 / 愁"
          @keyup.enter="search()"
        />
        <button class="btn" :disabled="loading || !q.trim()" @click="search()">查韵</button>
        <button v-if="result" class="btn ghost sm" @click="reset">清空</button>
      </div>

      <div class="row wrap gap-sm mt1">
        <span class="small muted">常用：</span>
        <button v-for="c in hotChars" :key="c" class="chip tiny-chip" @click="search(c)">{{ c }}</button>
      </div>

      <div v-if="loading" class="center muted small mt3">
        <span class="spin">◌</span> 翻检韵书……
      </div>

      <p v-else-if="err" class="hint err mt2">{{ err }}</p>

      <template v-else-if="result">
        <div v-if="result.results.length" class="mt3">
          <div v-for="b in result.results" :key="b.id" class="bu-hit panel-soft">
            <div class="row between wrap">
              <div class="row wrap">
                <b class="kai bu-name">{{ b.name }}</b>
                <span class="tag plain tiny">{{ b.short }}</span>
                <span class="tag tiny" :class="b.tone === '平' ? 'azurite' : 'plain'">{{ b.tone }}声</span>
                <span class="small muted">{{ b.mood }}</span>
              </div>
              <span class="small muted">本次命中：<b class="cinnabar">{{ b.matched.join(' ') }}</b></span>
            </div>
            <p class="chars tiny mono">{{ b.chars.join('') }}</p>
          </div>
        </div>
        <p v-else class="empty">
          <span class="glyph">◌</span>
          <span class="line">韵书里没有收录这几个字</span>
          <span class="sub">试试常见的词韵用字：风月花春江秋寒</span>
        </p>
        <p v-if="result.unknown?.length" class="hint mt2">
          未收录：<span class="mono">{{ result.unknown.join(' ') }}</span>
          —— 本简表只收 12 个常用韵部的常用字，未收的字不代表不合韵。
        </p>
      </template>

      <div v-else class="empty">
        <span class="glyph">韵</span>
        <span class="line">填词先认韵部，再挑字</span>
        <span class="sub">输入一个字，看看它归属哪个韵部</span>
      </div>
    </div>

    <!-- ── 简表 ── -->
    <div v-else>
      <div v-if="tableLoading" class="center muted small mt3"><span class="spin">◌</span> 载入中……</div>
      <template v-else>
        <p class="hint mb2">
          词林正韵共十九部，此处收最常用的十二部。写小令一般「一韵到底」，
          <b>平声韵</b>多用于流丽婉转，<b>仄声韵</b>多用于顿挫沉郁。
          卡片上的<b>韵脚可用</b>是「这个韵部真正能落在句末、且互不重复的字数」——
          它比字表长度更能说明宽窄：太窄的韵部写长调容易撞字。
        </p>
        <h4 class="sub-h">平声韵（{{ pingBus.length }} 部）</h4>
        <div class="bu-grid">
          <div v-for="b in pingBus" :key="b.id" class="bu-card">
            <div class="row between">
              <b class="kai">{{ b.name }}</b>
              <span class="tag tiny azurite">{{ b.tone }}</span>
            </div>
            <div class="small muted">{{ b.short }} · 收 {{ b.count }} 字 · 韵脚可用 {{ b.totalDistinct }}</div>
            <div class="tiny muted2">{{ b.mood }}</div>
            <p class="chars tiny mono">{{ b.preview }}…</p>
          </div>
        </div>
        <h4 class="sub-h">仄声韵（{{ zeBus.length }} 部）</h4>
        <div class="bu-grid">
          <div v-for="b in zeBus" :key="b.id" class="bu-card">
            <div class="row between">
              <b class="kai">{{ b.name }}</b>
              <span class="tag tiny plain">{{ b.tone }}</span>
            </div>
            <div class="small muted">{{ b.short }} · 收 {{ b.count }} 字 · 韵脚可用 {{ b.totalDistinct }}</div>
            <div class="tiny muted2">{{ b.mood }}</div>
            <p class="chars tiny mono">{{ b.preview }}…</p>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.seg {
  display: flex;
  border: 1px solid var(--line-strong);
  border-radius: var(--r);
  overflow: hidden;
}
.seg-btn {
  padding: 5px 12px;
  background: transparent;
  border: 0;
  color: var(--ink-3);
  cursor: pointer;
  font-size: 0.84rem;
  transition: all var(--t-fast);
}
.seg-btn.on {
  background: var(--ink);
  color: var(--paper);
}
.link:hover {
  color: var(--cinnabar);
}
.gap {
  gap: 8px;
}
.gap-sm {
  gap: 5px;
}
.tiny-chip {
  font-size: 0.76rem;
  padding: 2px 9px;
}
.bu-hit {
  border: 1px solid var(--line);
  border-left: 2px solid var(--cinnabar);
  border-radius: var(--r);
  padding: 10px 12px;
  margin-bottom: 9px;
  background: var(--paper-2);
}
.bu-name {
  font-size: 1.05rem;
}
.bu-hit .chars {
  margin: 7px 0 0;
  word-break: break-all;
  color: var(--ink-3);
  line-height: 1.9;
  letter-spacing: 0.06em;
}
.cinnabar {
  color: var(--cinnabar);
}
.sub-h {
  font-size: 0.92rem;
  margin: 16px 0 8px;
  color: var(--ink-2);
  padding-left: 9px;
  border-left: 2px solid var(--gamboge);
}
.bu-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 9px;
}
.bu-card {
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: 10px;
  background: var(--paper-2);
  transition: all var(--t-fast);
}
.bu-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-1);
  border-color: var(--line-strong);
}
.bu-card .chars {
  margin: 7px 0 0;
  color: var(--ink-4);
  word-break: break-all;
  line-height: 1.7;
  max-height: 42px;
  overflow: hidden;
}
.muted2 {
  color: var(--ink-4);
}
.azurite {
  color: var(--azurite);
  border-color: var(--azurite-soft);
}
.hint.err {
  color: var(--cinnabar);
}
</style>
