<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  poem: { type: Object, default: null },
  cipai: { type: Object, default: null }
})

const open = ref(new Set(['intro']))

function toggle(key) {
  const s = new Set(open.value)
  if (s.has(key)) s.delete(key)
  else s.add(key)
  open.value = s
}
const isOpen = (k) => open.value.has(k)

/** 逐句拆解：把谱式与实际对照列出来 */
const breakdown = computed(() => {
  if (!props.poem) return []
  return props.poem.lines.map((l, i) => {
    const offs = l.deviations || []
    return {
      index: i,
      text: l.text,
      pattern: l.pattern,
      rhythm: l.rhythm,
      note: l.note,
      rhyme: l.rhyme,
      verdict: l.verdict,
      strictPositions: [...l.pattern].map((ch, j) => ({ ch, pos: j + 1, strict: (j + 1) % 2 === 0 || j + 1 === l.pattern.length })),
      deviations: offs,
      diff: [...l.text].map((ch, j) => {
        const spec = l.pattern[j] || '◐'
        const mark = l.chars[j]?.actual || '◐'
        return {
          ch,
          spec,
          mark,
          isLast: j === l.text.length - 1,
          strict: (j + 1) % 2 === 0 || j + 1 === l.pattern.length,
          hit: spec === '◐' || mark === '◐' ? null : spec === mark
        }
      })
    }
  })
})

const rhymeReport = computed(() => {
  if (!props.poem) return []
  return props.poem.rhyme.map((r) => ({
    ...r,
    positions: props.poem.lines.map((l, i) => (l.rhyme && l.buId === r.buId ? i + 1 : null)).filter(Boolean)
  }))
})

const stats = computed(() => {
  if (!props.poem) return { total: 0, zheng: 0, bian: 0, po: 0, softCount: 0 }
  const lines = props.poem.lines
  return {
    total: lines.length,
    zheng: lines.filter((l) => l.verdict === '正格').length,
    bian: lines.filter((l) => l.verdict === '变体').length,
    po: lines.filter((l) => l.verdict === '破格').length,
    softCount: lines.reduce((a, l) => a + (l.deviations?.length || 0), 0)
  }
})
</script>

<template>
  <section class="analysis panel">
    <div class="row between wrap">
      <h3 class="mb0">格律解析</h3>
      <div v-if="poem" class="row wrap small">
        <span class="tag plain">{{ stats.total }} 句</span>
        <span class="tag" style="border-color: var(--moss); color: var(--moss)">正格 {{ stats.zheng }}</span>
        <span class="tag gold">变体 {{ stats.bian }}</span>
        <span v-if="stats.po" class="tag red">破格 {{ stats.po }}</span>
      </div>
    </div>

    <div v-if="!poem" class="empty">
      <span class="glyph">☰</span>
      <span class="line">填出一首词以后，这里会逐句展开</span>
      <span class="sub">词牌来历、平仄对照、用韵检查、意象赏析</span>
    </div>

    <div v-else class="acc">
      <!-- 一、词牌简介 -->
      <div class="acc-item" :class="{ open: isOpen('intro') }">
        <button class="acc-head" @click="toggle('intro')">
          <span class="idx">一</span>
          <span class="ttl">词牌简介</span>
          <span class="arrow">{{ isOpen('intro') ? '▾' : '▸' }}</span>
        </button>
        <div class="acc-body">
          <div class="fan">
            <p v-if="cipai?.origin" class="small"><b>来历　</b>{{ cipai.origin }}</p>
            <p class="small"><b>格律总览　</b>{{ cipai?.description || poem.cipaiName }}</p>
            <p class="small muted">
              全篇 {{ poem.generatedSyllables }} 字，{{ poem.lines.length }} 句，
              押{{ cipai?.rhymeType || '' }}韵。
              <template v-if="cipai?.highlights">此调最见工力处：{{ cipai.highlights }}</template>
            </p>
          </div>
        </div>
      </div>

      <!-- 二、逐句拆解 -->
      <div class="acc-item" :class="{ open: isOpen('lines') }">
        <button class="acc-head" @click="toggle('lines')">
          <span class="idx">二</span>
          <span class="ttl">逐句拆解</span>
          <span class="arrow">{{ isOpen('lines') ? '▾' : '▸' }}</span>
        </button>
        <div class="acc-body">
          <div class="fan">
            <div v-for="b in breakdown" :key="b.index" class="brow">
              <div class="bhead row wrap">
                <span class="bno">第 {{ b.index + 1 }} 句</span>
                <span class="tag tiny" :class="b.verdict === '正格' ? 'plain' : b.verdict === '变体' ? 'gold' : 'red'">
                  {{ b.verdict }}
                </span>
                <span v-if="b.rhyme" class="tag tiny red">韵脚</span>
                <span class="tiny muted">{{ b.text.length }} 字 · 节奏 {{ b.rhythm || '—' }}</span>
              </div>

              <div class="diff">
                <span
                  v-for="(d, j) in b.diff"
                  :key="j"
                  class="dcell"
                  :class="{ last: d.isLast, miss: d.hit === false, free: d.spec === '◐' }"
                >
                  <span class="dch kai">{{ d.ch }}</span>
                  <span class="dspec mono tiny">{{ d.spec }}</span>
                  <span class="dmark mono tiny" :class="{ bad: d.hit === false }">{{ d.mark }}</span>
                </span>
              </div>

              <p v-if="b.deviations.length" class="tiny dev">
                <template v-for="(d, j) in b.deviations" :key="j">
                  第 {{ d.pos }} 位谱作「{{ d.need }}」而实为「{{ d.got }}」 —— {{ d.strict ? '失律' : '属「一三五不论」的通融位，不计错' }}；
                </template>
              </p>
              <p v-else class="tiny ok-note">逐位合谱，无一处通融。</p>

              <p v-if="b.note" class="tiny muted mb0">{{ b.note }}</p>
            </div>
            <p class="tiny muted mt2 mb0">
              判读口径：每句第 2、4、6 位与末字为严格位（「二四六分明」）；
              第 1、3、5 位按「一三五不论」允许通融，标为「变体」，不算错。
            </p>
          </div>
        </div>
      </div>

      <!-- 三、用韵说明 -->
      <div class="acc-item" :class="{ open: isOpen('rhyme') }">
        <button class="acc-head" @click="toggle('rhyme')">
          <span class="idx">三</span>
          <span class="ttl">用韵说明</span>
          <span class="arrow">{{ isOpen('rhyme') ? '▾' : '▸' }}</span>
        </button>
        <div class="acc-body">
          <div class="fan">
            <div v-for="(r, i) in rhymeReport" :key="i" class="rrow">
              <div class="row wrap">
                <span class="tag red">{{ r.buName }}</span>
                <span class="small muted">
                  押韵位置：第 {{ r.positions.join('、') }} 句
                </span>
              </div>
              <div class="rchars mt1">
                <span v-for="(c, j) in r.chars" :key="j" class="rchar kai">{{ c }}</span>
              </div>
              <p class="tiny muted mb0 mt1">
                {{ r.sameRhyme ? '各韵脚字互不重复，避开了「重韵」之忌。' : '韵脚中有重复用字——古人于此颇忌，可「换一句」改换。' }}
              </p>
            </div>
            <p class="tiny muted mt2 mb0">
              韵部依《词林正韵》。{{ cipai?.rhymeType === '换'
                ? '本调为换韵体：上下片各两仄两平，四组韵脚互不相通。'
                : '本调一韵到底，中途不得换韵。' }}
            </p>
          </div>
        </div>
      </div>

      <!-- 四、意象赏析 -->
      <div class="acc-item" :class="{ open: isOpen('appr') }">
        <button class="acc-head" @click="toggle('appr')">
          <span class="idx">四</span>
          <span class="ttl">意象赏析</span>
          <span class="arrow">{{ isOpen('appr') ? '▾' : '▸' }}</span>
        </button>
        <div class="acc-body">
          <div class="fan">
            <p class="appr kai">{{ poem.appreciation }}</p>
            <div v-if="poem.tags?.length" class="row wrap mt1">
              <span class="tiny muted">全篇意象：</span>
              <span v-for="t in poem.tags" :key="t" class="tag tiny">{{ t }}</span>
            </div>
            <p class="tiny muted mt2 mb0">
              {{ poem.engine === 'ai'
                ? '本段由大模型依据词作内容生成。'
                : '本段由本地引擎依据全篇意象标签拼合而成——接上 AI 密钥后会换成模型撰写的赏析。' }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.analysis {
  min-height: 200px;
}
.acc {
  margin-top: 16px;
  border-top: 1px solid var(--line);
}
.acc-item {
  border-bottom: 1px solid var(--line);
}
.acc-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 4px;
  background: transparent;
  border: 0;
  cursor: pointer;
  text-align: left;
  color: var(--ink);
  transition: background var(--t-fast);
}
.acc-head:hover {
  background: var(--paper-3);
}
.idx {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-xs);
  border: 1px solid var(--line-strong);
  border-radius: 50%;
  color: var(--ink-3);
  flex-shrink: 0;
}
.acc-item.open .idx {
  border-color: var(--cinnabar);
  color: var(--cinnabar);
}
.ttl {
  flex: 1;
  font-size: 1rem;
  letter-spacing: 0.08em;
}
.arrow {
  color: var(--ink-3);
  font-size: var(--fs-sm);
}
.acc-body {
  max-height: 0;
  overflow: hidden;
  transition: max-height var(--t-slow) var(--ease-ink);
}
.acc-item.open .acc-body {
  max-height: 2600px;
}
/* 手风琴展开如折扇：每层内容微延迟浮现 */
.fan {
  padding: 4px 4px 18px 30px;
  opacity: 0;
  transform: translateY(-6px);
  transition: opacity 320ms var(--ease-ink) 120ms, transform 320ms var(--ease-ink) 120ms;
}
.acc-item.open .fan {
  opacity: 1;
  transform: translateY(0);
}
.acc-item.open .fan > * {
  animation: fanIn 340ms var(--ease-ink) both;
}
.acc-item.open .fan > *:nth-child(1) {
  animation-delay: 90ms;
}
.acc-item.open .fan > *:nth-child(2) {
  animation-delay: 150ms;
}
.acc-item.open .fan > *:nth-child(3) {
  animation-delay: 210ms;
}
.acc-item.open .fan > *:nth-child(4) {
  animation-delay: 270ms;
}
.acc-item.open .fan > *:nth-child(n + 5) {
  animation-delay: 320ms;
}
@keyframes fanIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.brow {
  padding: 10px 0;
  border-bottom: 1px dashed var(--line-strong);
}
.brow:last-of-type {
  border-bottom: 0;
}
.bhead {
  gap: 7px;
  margin-bottom: 6px;
}
.bno {
  font-size: 0.86rem;
  color: var(--ink-2);
  letter-spacing: 0.08em;
}
.diff {
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
}
.dcell {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  padding: 3px 4px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--paper-2);
  min-width: 26px;
}
.dcell.free {
  background: var(--paper-3);
}
.dcell.last {
  border-color: var(--ink-4);
}
.dcell.miss {
  border-color: var(--cinnabar);
  background: var(--cinnabar-soft);
}
.dch {
  font-size: 1.06rem;
  line-height: 1.2;
}
.dspec {
  /* 每格下方的平仄谱说明：报告口径是「符号和字要能一起看清」，
     所以按 ink-2 这一档给，而不是原先那档几乎看不见的 ink-4。 */
  color: var(--ink-2);
  line-height: 1.2;
}
.dmark {
  color: var(--ink-3);
  line-height: 1.2;
}
.dmark.bad {
  color: var(--cinnabar);
}
.dev {
  color: var(--gamboge);
  margin: 7px 0 0;
  line-height: 1.8;
}
.ok-note {
  color: var(--moss);
  margin: 7px 0 0;
}
.rrow {
  padding: 8px 0;
  border-bottom: 1px dashed var(--line-strong);
}
.rrow:last-of-type {
  border-bottom: 0;
}
.rchars {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
}
.rchar {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--cinnabar-soft);
  border-radius: 3px;
  color: var(--cinnabar);
  font-size: 1.12rem;
  background: color-mix(in srgb, var(--cinnabar) 5%, transparent);
}
.appr {
  font-size: 1.02rem;
  line-height: 2.1;
  letter-spacing: 0.04em;
  color: var(--ink);
}
@media (max-width: 640px) {
  .fan {
    padding-left: 6px;
  }
  .dcell {
    min-width: 22px;
    padding: 2px 3px;
  }
}
</style>
