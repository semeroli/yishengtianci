<script setup>
import { computed } from 'vue'

const props = defineProps({
  poem: { type: Object, default: null },
  vertical: { type: Boolean, default: true },
  loading: { type: Boolean, default: false },
  changingLine: { type: Number, default: -1 },
  lineAnim: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['change-line', 'show-analysis'])

/** 该句是否是本次单独重写的（单独重写不参与整篇的逐句错峰） */
const soloIndex = computed(() => {
  for (const [k, v] of Object.entries(props.lineAnim || {})) {
    if (Number(v) > 1) return Number(k)
  }
  return -1
})

function lineDelay(i) {
  if (i === soloIndex.value) return 0
  return i * 210
}

function charDelay(i, j) {
  return lineDelay(i) + j * 58
}

const rhymeSet = computed(() => {
  const s = new Set()
  if (!props.poem?.lines) return s
  props.poem.lines.forEach((l, i) => {
    if (l.rhyme) s.add(i)
  })
  return s
})

function isRhymeChar(line, idx, total) {
  return line.rhyme && idx === total - 1
}

/** 句末标点：押韵句用句号，其余用逗号（传统词作句读） */
function punctuation(line) {
  return line.rhyme ? '。' : '，'
}

const engineLabel = computed(() => {
  const p = props.poem
  if (!p) return ''
  return p.engine === 'ai' ? `AI 生成（${p.model || '大模型'}）` : '本地格律引擎'
})
</script>

<template>
  <section class="board panel stamp-corner">
    <div class="board-head row between wrap">
      <div class="row wrap">
        <h3 class="mb0">词作</h3>
        <span v-if="poem" class="tag gold">{{ poem.cipaiName }}</span>
        <span v-if="poem" class="tag plain tiny">{{ poem.generatedSyllables }} 字</span>
        <span v-if="poem" class="tag tiny" :class="poem.engine === 'ai' ? 'red' : 'plain'">{{ engineLabel }}</span>
      </div>
      <slot name="actions"></slot>
    </div>

    <!-- 加载中：像运笔未落 -->
    <div v-if="loading" class="loading">
      <div class="ink-dots">
        <span></span><span></span><span></span>
      </div>
      <p class="kai">研墨运笔中……</p>
    </div>

    <!-- 空状态 -->
    <div v-else-if="!poem" class="empty">
      <span class="glyph">✦</span>
      <span class="line">提笔欲写心中事</span>
      <span class="sub">请先描述意境，再择一词牌，然后点「起韵填词」</span>
    </div>

    <!-- 词作 -->
    <template v-else>
      <div class="poem-area" :class="vertical ? 'board-v' : 'board-h'">
        <div
          v-for="(line, i) in poem.lines"
          :key="`${i}-${lineAnim[i] || 1}`"
          class="line-wrap"
          :class="{ changing: changingLine === i }"
          :style="{ animationDelay: lineDelay(i) + 'ms' }"
        >
          <div class="vline" :class="{ 'rhyme-line': line.rhyme }">
            <span
              v-for="(c, j) in line.chars"
              :key="j"
              class="char-cell brush-char"
              :class="{
                rhyme: isRhymeChar(line, j, line.chars.length),
                both: c.spec === '◐'
              }"
              :style="{ animationDelay: charDelay(i, j) + 'ms' }"
            >
              <span class="ch" :style="{ animationDelay: charDelay(i, j) + 'ms' }">{{ c.ch }}</span>
              <span
                class="mark dot-in"
                :class="{
                  ping: c.actual === '○',
                  ze: c.actual === '●',
                  off: c.hit === false
                }"
                :style="{ animationDelay: charDelay(i, j) + 120 + 'ms' }"
                :title="`谱：${c.spec}　实际：${c.actual}${c.hit === false ? '（通融位）' : ''}`"
              >
                {{ c.actual === '◐' ? '·' : c.actual }}
              </span>
            </span>
            <span class="punc" :style="{ animationDelay: charDelay(i, line.chars.length - 1) + 220 + 'ms' }">
              {{ punctuation(line) }}
            </span>
          </div>

          <div class="line-tools">
            <button
              class="mini"
              :disabled="changingLine >= 0"
              title="只重写这一句"
              @click="emit('change-line', i)"
            >
              <span v-if="changingLine === i" class="spin">◌</span>
              <span v-else>↻ 换一句</span>
            </button>
            <span class="verdict tiny" :class="line.verdict === '正格' ? 'ok' : line.verdict === '变体' ? 'mid' : 'bad'">
              {{ line.verdict }}
            </span>
          </div>
        </div>
      </div>

      <div class="board-foot">
        <div class="legend small muted">
          <span>字旁小点：</span>
          <span><i class="dotk p">○</i> 平</span>
          <span><i class="dotk z">●</i> 仄</span>
          <span><i class="dotk r">朱</i> 韵脚</span>
          <span class="ml">点色发红 = 该字用了「一三五不论」的通融位</span>
        </div>
        <div class="row wrap mt1">
          <span
            v-for="r in poem.rhyme"
            :key="r.buId + r.short"
            class="tag red"
            :title="r.buName"
          >
            押 {{ r.short }}（{{ r.tone }}）：{{ r.chars.join(' ') }}
          </span>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.board {
  min-height: 340px;
  display: flex;
  flex-direction: column;
}
.board-head {
  padding-bottom: 14px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 6px;
}
.loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  color: var(--ink-3);
  padding: 60px 0;
}
.ink-dots {
  display: flex;
  gap: 10px;
}
.ink-dots span {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--ink-3);
  animation: inkPulse 1.4s ease-in-out infinite;
}
.ink-dots span:nth-child(2) {
  animation-delay: 0.18s;
}
.ink-dots span:nth-child(3) {
  animation-delay: 0.36s;
}
@keyframes inkPulse {
  0%,
  100% {
    opacity: 0.25;
    transform: scale(0.7);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

.poem-area {
  flex: 1;
  display: flex;
  gap: 10px;
  padding: 22px 4px 10px;
}

/* ── 横排 ── */
.board-h {
  flex-direction: column;
  gap: 6px;
}
.board-h .line-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.board-h .vline {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  flex-wrap: wrap;
}
.board-h .char-cell {
  flex-direction: column;
}

/* ── 竖排（右起左行） ── */
.board-v {
  flex-direction: row-reverse;
  gap: 16px;
  justify-content: center;
  overflow-x: auto;
  padding-bottom: 18px;
}
.board-v .line-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.board-v .vline {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.board-v .char-cell {
  flex-direction: row;
  align-items: center;
  gap: 2px;
}
.board-v .char-cell .mark {
  margin-top: 0;
}

/* ── 字格 ── */
.char-cell {
  display: inline-flex;
  line-height: 1;
}
.char-cell .ch {
  font-family: var(--font-kai);
  font-size: 1.52rem;
  line-height: 1.2;
  letter-spacing: 0.04em;
  transition: color var(--t), text-shadow var(--t);
}
.char-cell .mark {
  font-size: var(--fs-xs);
  line-height: 1;
  margin-top: 2px;
  color: var(--ink-3);
  font-family: var(--font-mono);
}
.char-cell .mark.ping {
  color: var(--azurite);
}
.char-cell .mark.ze {
  color: var(--ink-2);
}
.char-cell .mark.off {
  color: var(--cinnabar);
  opacity: 0.9;
}
.char-cell.rhyme .ch {
  color: var(--cinnabar);
  font-weight: 600;
  text-shadow: 0 0 12px color-mix(in srgb, var(--cinnabar) 22%, transparent);
}
.punc {
  font-family: var(--font-kai);
  color: var(--ink-3);
  font-size: 1.1rem;
  align-self: flex-end;
  padding-bottom: 12px;
  opacity: 0;
  animation: brushIn 400ms var(--ease-ink) both;
}
.board-v .punc {
  align-self: center;
  padding-bottom: 0;
}
.line-wrap {
  animation: pageFade 520ms var(--ease-ink) both;
  position: relative;
}
.line-wrap.changing {
  animation: inkFade 300ms ease-in both;
}
.line-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0;
  transition: opacity var(--t);
  margin-top: 2px;
}
.board-v .line-tools {
  flex-direction: column;
}
.line-wrap:hover .line-tools {
  opacity: 1;
}
.mini {
  border: 1px solid var(--line-strong);
  background: var(--paper-2);
  color: var(--ink-2);
  border-radius: var(--r);
  font-size: var(--fs-xs);
  padding: 2px 7px;
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--t-fast);
}
.mini:hover:not(:disabled) {
  border-color: var(--cinnabar);
  color: var(--cinnabar);
}
.mini:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.verdict {
  padding: 1px 6px;
  border-radius: var(--r-pill);
  border: 1px solid var(--line-strong);
}
.verdict.ok {
  color: var(--moss);
  border-color: var(--moss);
}
.verdict.mid {
  color: var(--gamboge);
  border-color: var(--gamboge);
}
.verdict.bad {
  color: var(--cinnabar);
  border-color: var(--cinnabar);
}

.board-foot {
  border-top: 1px solid var(--line);
  padding-top: 12px;
  margin-top: 8px;
}
.legend {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}
.dotk {
  font-style: normal;
  font-size: var(--fs-xs);
  padding: 0 4px;
  border: 1px solid var(--line-strong);
  border-radius: 3px;
}
.dotk.p {
  color: var(--azurite);
}
.dotk.z {
  color: var(--ink-2);
}
.dotk.r {
  color: var(--cinnabar);
  border-color: var(--cinnabar-soft);
}
.ml {
  margin-left: 4px;
}

@media (max-width: 640px) {
  .board-h .char-cell .ch {
    font-size: 1.34rem;
  }
  .board-v .char-cell .ch {
    font-size: 1.28rem;
  }
  .board-v {
    gap: 9px;
  }
}
</style>
