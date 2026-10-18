<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  cipai: { type: Object, default: null },
  open: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])

const rhymeIdx = computed(() => {
  if (!props.cipai?.lines) return []
  return props.cipai.lines.map((l, i) => (l.r ? i + 1 : null)).filter(Boolean)
})

function toneClass(ch) {
  if (ch === '○') return 'p'
  if (ch === '●') return 'z'
  return 'b'
}
function toneName(ch) {
  if (ch === '○') return '平'
  if (ch === '●') return '仄'
  return '可平可仄'
}

/* Esc 关闭 + 焦点归还：本弹窗是 role="dialog"，键盘用户理应能按 Esc 退出。 */
const dialogEl = ref(null)
let opener = null
function onKey(e) {
  if (e.key === 'Escape' && props.open) {
    e.preventDefault()
    emit('close')
  }
}
watch(
  () => props.open,
  (v, prev) => {
    if (v && !prev) {
      opener = document.activeElement
      nextTick(() => dialogEl.value?.focus())
    } else if (!v && prev) {
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus()
      opener = null
    }
  }
)
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open && cipai" class="mask no-print" @click.self="emit('close')">
        <div ref="dialogEl" class="dlg" role="dialog" aria-modal="true" aria-labelledby="cp-title" tabindex="-1">
          <header class="dlg-head">
            <div>
              <h2 id="cp-title" class="mb0 kai">{{ cipai.name }}</h2>
              <div class="small muted mt1">
                又名 {{ (cipai.alias || []).join('、') || '—' }}
              </div>
            </div>
            <button class="close" aria-label="关闭" title="关闭" @click="emit('close')">✕</button>
          </header>

          <div class="facts row wrap">
            <span class="tag">{{ cipai.syllables }} 字</span>
            <span class="tag plain">{{ cipai.sentenceCount }} 句</span>
            <span class="tag plain">{{ cipai.rhymeType }}韵</span>
            <span class="tag gold">{{ cipai.styleTag }}</span>
          </div>

          <p v-if="cipai.origin" class="origin">
            <b>来历</b>　{{ cipai.origin }}
          </p>
          <p class="desc">{{ cipai.description }}</p>

          <div v-if="cipai.highlights" class="hl kai">「{{ cipai.highlights }}」</div>

          <template v-if="cipai.lines?.length">
            <h3 class="mt3">格律总览</h3>
            <div class="legend small muted">
              <span>图例：</span>
              <span><i class="dot p">○</i> 平</span>
              <span><i class="dot z">●</i> 仄</span>
              <span><i class="dot b">◐</i> 可平可仄</span>
              <span class="ml"><i class="dot r">◉</i> 韵脚</span>
            </div>

            <div class="pattern-table">
              <div
                v-for="(l, i) in cipai.lines"
                :key="i"
                class="prow"
                :class="{ rhyme: l.r }"
              >
                <div class="pno">{{ i + 1 }}</div>
                <div class="pcells">
                  <span
                    v-for="(ch, j) in l.p"
                    :key="j"
                    class="pcell"
                    :class="[toneClass(ch), { last: j === l.p.length - 1 }]"
                    :title="toneName(ch)"
                  >
                    <span class="sym">{{ ch }}</span>
                    <span v-if="j === l.p.length - 1 && l.r" class="rmark">韵</span>
                  </span>
                </div>
                <div class="pmeta tiny">
                  {{ l.p.length }}字
                  <template v-if="l.rhythm">· {{ l.rhythm }}</template>
                </div>
                <div v-if="l.note" class="pnote small">{{ l.note }}</div>
              </div>
            </div>

            <p class="small muted mt2">
              全篇押韵位置：第 {{ rhymeIdx.join('、') }} 句。
              <template v-if="cipai.rhymeType === '换'">
                本调为<strong>换韵</strong>体——上下片各两仄两平，共四换韵脚，声情由促转舒、再促再舒。
              </template>
              <template v-else>
                本调一韵到底，押<strong>{{ cipai.rhymeType }}声韵</strong>，不可通押。
              </template>
            </p>
          </template>

          <p v-else-if="cipai.note" class="note-red">
            {{ cipai.note }}
          </p>

          <template v-if="cipai.masterpieces?.length">
            <h3 class="mt3">代表作</h3>
            <div v-for="(m, i) in cipai.masterpieces" :key="i" class="mp">
              <div class="small muted">{{ m.author }}　{{ m.title }}</div>
              <p class="kai mptext" style="white-space: pre-wrap">{{ m.text }}</p>
            </div>
          </template>

          <div class="dlg-foot row center">
            <button class="btn" @click="emit('close')">收起</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 400;
  background: rgba(30, 32, 34, 0.42);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px 16px;
  overflow-y: auto;
}
.dlg {
  width: min(760px, 100%);
  background: var(--paper-2);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-3);
  padding: 26px 26px 20px;
  animation: pageFade 300ms var(--ease-ink) both;
}
.dlg-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.close {
  border: 1px solid var(--line-strong);
  background: transparent;
  color: var(--ink-2);
  width: 30px;
  height: 30px;
  border-radius: var(--r);
  cursor: pointer;
  flex-shrink: 0;
}
.close:hover {
  border-color: var(--cinnabar);
  color: var(--cinnabar);
}
.facts {
  gap: 7px;
  margin: 14px 0 16px;
}
.origin,
.desc {
  font-size: 0.94rem;
  color: var(--ink-2);
  line-height: 1.9;
}
.origin b {
  color: var(--ink);
  letter-spacing: 0.1em;
}
.hl {
  border-left: 2px solid var(--gamboge);
  padding: 4px 0 4px 12px;
  color: var(--ink-2);
  font-size: 0.92rem;
  margin-bottom: 8px;
}
.legend {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 12px;
}
.dot {
  font-style: normal;
}
.ml {
  margin-left: 6px;
}
.pattern-table {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--line);
  border-radius: var(--r);
  overflow: hidden;
}
.prow {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 8px 12px;
  background: var(--paper-2);
  border-bottom: 1px solid var(--line);
}
.prow:last-child {
  border-bottom: 0;
}
.prow:nth-child(even) {
  background: var(--paper-3);
}
.prow.rhyme .pno {
  color: var(--cinnabar);
  font-weight: 600;
}
.pno {
  font-variant-numeric: tabular-nums;
  color: var(--ink-3);
  font-size: 0.82rem;
}
.pcells {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
}
.pcell {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  width: 22px;
  font-size: 0.95rem;
  line-height: 1.2;
}
.pcell .sym {
  font-family: var(--font-mono);
}
.pcell.p .sym {
  color: var(--azurite);
}
.pcell.z .sym {
  color: var(--ink-2);
}
.pcell.b .sym {
  color: var(--ink-3);
}
.pcell.last .sym {
  font-weight: 700;
}
.rmark {
  font-size: var(--fs-xs);
  color: var(--cinnabar);
  line-height: 1;
}
.pmeta {
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}
.pnote {
  grid-column: 2 / -1;
  color: var(--ink-3);
  font-size: 0.82rem;
  line-height: 1.7;
  margin-top: -2px;
}
.note-red {
  background: var(--cinnabar-soft);
  border-left: 2px solid var(--cinnabar);
  padding: 10px 14px;
  border-radius: var(--r);
  font-size: 0.9rem;
  color: var(--ink-2);
}
.mp {
  border-bottom: 1px dashed var(--line-strong);
  padding-bottom: 12px;
  margin-bottom: 14px;
}
.mp:last-child {
  border-bottom: 0;
}
.mptext {
  font-size: 1.06rem;
  line-height: 2.1;
  letter-spacing: 0.05em;
  margin-top: 6px;
  margin-bottom: 0;
}
.dlg-foot {
  margin-top: 22px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 220ms;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
@media (max-width: 640px) {
  .mask {
    padding: 12px 8px;
  }
  .dlg {
    padding: 18px 14px 14px;
  }
  .prow {
    grid-template-columns: 26px minmax(0, 1fr);
  }
  .pmeta {
    display: none;
  }
  .pnote {
    grid-column: 2;
  }
}
</style>
