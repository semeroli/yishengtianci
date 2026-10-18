<script setup>
import { computed } from 'vue'
import { useWorkbench } from '../stores/workbench.js'

const emit = defineEmits(['show-pattern'])

const {
  cipaiList,
  selectedId,
  selectedCipai,
  pickerMode,
  setPickerMode,
  filterStyle,
  filterSize,
  filteredCipai
} = useWorkbench()

const styles = computed(() => [...new Set(cipaiList.value.map((c) => c.styleTag).filter(Boolean))])

const sizeOptions = [
  { key: '', label: '不限字数' },
  { key: 'short', label: '小令 ≤45' },
  { key: 'mid', label: '中调 46–60' },
  { key: 'long', label: '长调 >60' }
]

function sizeLabel(n) {
  if (n <= 45) return '小令'
  if (n <= 60) return '中调'
  return '长调'
}

function pick(id) {
  selectedId.value = id
}
</script>

<template>
  <section class="picker panel">
    <div class="picker-head">
      <div class="row between wrap">
        <div class="row">
          <h3 class="mb0">择一词牌</h3>
          <span class="tag plain tiny">{{ filteredCipai.length }} / {{ cipaiList.length }}</span>
        </div>
        <div class="row seg">
          <button class="seg-btn" :class="{ on: pickerMode === 'grid' }" title="宫格视图" @click="setPickerMode('grid')">
            ▦ 宫格
          </button>
          <button class="seg-btn" :class="{ on: pickerMode === 'list' }" title="下拉视图" @click="setPickerMode('list')">
            ☰ 下拉
          </button>
        </div>
      </div>

      <div class="filters">
        <button class="chip" :class="{ active: !filterStyle }" @click="filterStyle = ''">全部风格</button>
        <button
          v-for="s in styles"
          :key="s"
          class="chip"
          :class="{ active: filterStyle === s }"
          @click="filterStyle = filterStyle === s ? '' : s"
        >
          {{ s }}
        </button>
        <span class="divider"></span>
        <button
          v-for="o in sizeOptions"
          :key="o.key"
          class="chip"
          :class="{ active: filterSize === o.key }"
          @click="filterSize = o.key"
        >
          {{ o.label }}
        </button>
      </div>
    </div>

    <!-- 下拉视图 -->
    <div v-if="pickerMode === 'list'" class="mt2">
      <select class="select" :value="selectedId" @change="pick($event.target.value)">
        <option v-for="c in filteredCipai" :key="c.id" :value="c.id">
          {{ c.name }}　{{ c.syllables }}字 · {{ c.sentenceCount }}句 · {{ c.styleTag }}{{ c.generatable ? '' : '（谱待补）' }}
        </option>
      </select>
      <div v-if="selectedCipai" class="list-detail mt2">
        <div class="row between wrap">
          <div class="row wrap">
            <b class="kai" style="font-size: 1.15rem">{{ selectedCipai.name }}</b>
            <span class="tag">{{ selectedCipai.syllables }} 字</span>
            <span class="tag plain">{{ selectedCipai.sentenceCount }} 句</span>
            <span class="tag plain">{{ selectedCipai.rhymeType }}韵</span>
            <span class="tag gold">{{ selectedCipai.styleTag }}</span>
            <span v-if="!selectedCipai.generatable" class="tag red">谱待补</span>
          </div>
          <div class="row">
            <button v-if="selectedCipai.lines?.length" class="btn sm" @click="emit('show-pattern', selectedCipai)">
              看格律谱
            </button>
          </div>
        </div>
        <p class="small muted mt1 mb0">{{ selectedCipai.description }}</p>
      </div>
    </div>

    <!-- 宫格视图 -->
    <div v-else class="grid cols-auto mt2">
      <button
        v-for="c in filteredCipai"
        :key="c.id"
        class="cipai-card stamp-corner"
        :class="{ on: selectedId === c.id, dim: !c.generatable }"
        @click="selectedId = c.id"
      >
        <span class="name kai">{{ c.name }}</span>
        <span class="meta tiny">
          {{ c.syllables }}字 · {{ c.sentenceCount }}句
        </span>
        <span class="tags">
          <em class="tg style">{{ c.styleTag }}</em>
          <em class="tg tone">{{ c.rhymeType }}韵</em>
          <em v-if="!c.generatable" class="tg soon">谱待补</em>
        </span>
        <span v-if="c.lines?.length" class="peek" title="查看格律谱" @click.stop="emit('show-pattern', c)">谱</span>
      </button>
    </div>

    <p v-if="!filteredCipai.length" class="empty">
      <span class="glyph">◌</span>
      <span class="line">此处无声胜有声</span>
      <span class="sub">换个筛选条件试试？</span>
    </p>

    <div v-if="selectedCipai && pickerMode === 'grid'" class="sel-note mt2 small muted">
      已选 <b class="kai">{{ selectedCipai.name }}</b>（{{ sizeLabel(selectedCipai.syllables) }}，
      {{ selectedCipai.rhymeType }}韵）—— {{ selectedCipai.highlights || selectedCipai.description }}
    </div>
  </section>
</template>

<style scoped>
.picker-head {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.seg {
  gap: 0;
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
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  align-items: center;
}
.divider {
  width: 1px;
  height: 18px;
  background: var(--line-strong);
  margin: 0 3px;
}

.cipai-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 14px 8px 12px;
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--r);
  cursor: pointer;
  transition: all var(--t) var(--ease-ink);
  text-align: center;
}
.cipai-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-2);
  border-color: var(--line-strong);
}
.cipai-card.on {
  transform: translateY(-3px);
  border-color: var(--cinnabar);
  box-shadow: 0 0 0 1px var(--cinnabar), var(--shadow-2);
  background: var(--paper-2);
}
.cipai-card.on::before {
  content: '';
  position: absolute;
  inset: 3px;
  border: 1px solid var(--cinnabar);
  border-radius: 2px;
  opacity: 0.35;
  animation: sealIn 320ms var(--ease-ink) both;
  pointer-events: none;
}
.cipai-card.dim {
  opacity: 0.72;
}
.cipai-card .name {
  font-size: 1.16rem;
  letter-spacing: 0.06em;
  color: var(--ink);
}
.cipai-card.on .name {
  color: var(--cinnabar);
}
.cipai-card .meta {
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
.cipai-card .tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 2px;
}
.tg {
  font-style: normal;
  font-size: var(--fs-xs);
  padding: 0 6px;
  border-radius: var(--r-pill);
  border: 1px solid var(--line-strong);
  color: var(--ink-3);
  line-height: 1.6;
}
.tg.style {
  border-color: var(--gamboge-ink);
  color: var(--gamboge-ink);
}
.tg.tone {
  border-color: var(--azurite-soft);
  color: var(--azurite);
}
.tg.soon {
  border-color: var(--cinnabar-soft);
  color: var(--cinnabar);
}
.peek {
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-xs);
  border: 1px solid var(--line-strong);
  border-radius: 3px;
  color: var(--ink-3);
  background: var(--paper);
  transition: all var(--t-fast);
}
.peek:hover {
  border-color: var(--cinnabar);
  color: var(--cinnabar);
  transform: scale(1.1);
}
.list-detail {
  border-top: 1px dashed var(--line-strong);
  padding-top: 12px;
}
.sel-note {
  border-left: 2px solid var(--line-strong);
  padding-left: 12px;
  line-height: 1.8;
}
</style>
