<script setup>
import { computed, onMounted, ref } from 'vue'
import { useWorkbench } from '../stores/workbench.js'
import { toast } from '../stores/ui.js'
import HeroMountains from '../components/HeroMountains.vue'
import CipaiPicker from '../components/CipaiPicker.vue'
import CipaiPatternDialog from '../components/CipaiPatternDialog.vue'
import PoemBoard from '../components/PoemBoard.vue'
import RhythmAnalysis from '../components/RhythmAnalysis.vue'
import RhymeLookup from '../components/RhymeLookup.vue'
import CardStudio from '../components/CardStudio.vue'
import { setSeo } from '../utils/seo.js'

const {
  cipaiList,
  cipaiError,
  prompt,
  selectedCipai,
  vertical,
  setVertical,
  poem,
  generating,
  genError,
  changingLine,
  lineAnim,
  isFavorited,
  inspiration,
  loadCipai,
  loadInspiration,
  generate,
  changeLine,
  loadFavorites,
  toggleFavorite
} = useWorkbench()

const patternCipai = ref(null)
const patternOpen = ref(false)
const studioOpen = ref(false)
const toolTab = ref('rhyme')

const MAX = 500
const promptLen = computed(() => [...prompt.value].length)
const canSubmit = computed(
  () => !!selectedCipai.value?.generatable && promptLen.value >= 4 && !generating.value
)

function showPattern(c) {
  patternCipai.value = c
  patternOpen.value = true
}

async function submit() {
  if (!selectedCipai.value?.generatable) {
    toast('该词牌的格律谱还没整理好，换一个试试', 'info')
    return
  }
  await generate()
}

function newSeed() {
  return (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0
}

async function anotherRound() {
  await generate(newSeed())
}

/** 带标点：押韵句用「。」，其余用「，」 */
function textWithPunc() {
  if (!poem.value) return ''
  const title = `《${poem.value.cipaiName}》\n`
  const body = poem.value.lines.map((l, i) => l.text + (l.rhyme ? '。' : i === poem.value.lines.length - 1 ? '。' : '，')).join('')
  return title + body
}

function textPlain() {
  if (!poem.value) return ''
  return `《${poem.value.cipaiName}》\n` + poem.value.lines.map((l) => l.text).join('\n')
}

async function copy(text, label) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    toast(label + '已复制', 'success')
  } catch {
    // 老浏览器 / 非 https 兜底
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
      toast(label + '已复制', 'success')
    } catch {
      toast('复制失败，请手动选中', 'error')
    }
    document.body.removeChild(ta)
  }
}

async function sharePoem() {
  if (!poem.value) return
  const text = textWithPunc() + '\n\n—— 由「倚声 · AI填词工坊」生成' + location.origin
  if (navigator.share) {
    try {
      await navigator.share({ title: `《${poem.value.cipaiName}》`, text })
      return
    } catch {}
  }
  await copy(text, '全词')
}

const inspirationLoading = ref(false)
async function rollInspiration() {
  inspirationLoading.value = true
  await loadInspiration()
  inspirationLoading.value = false
}

function useInspiration() {
  if (!inspiration.value) return
  const t = inspiration.value.text.replace(/[。！？]$/, '')
  prompt.value = `化用「${t}」的意境，写一段……`
  toast('已填入输入框，改成你自己的话效果更好', 'info')
}

onMounted(async () => {
  // 每页都要有自己的 description 与 canonical ——
  // 否则 /studio 与首页共用同一段描述，搜索结果里会显示成同一句话；
  // 而且 /studio 与 /studio/ 都能打开，没有 canonical 就是两份重复内容。
  setSeo({
    title: '填词工作台',
    description:
      '输入一句意境、选一个词牌，生成一首合律的词：平仄逐字校验，韵脚按《词林正韵》归部，自动避开重韵，不满意的句子可以单独换。',
    url: location.origin + '/studio'
  })
  await loadCipai()
  loadFavorites()
  loadInspiration()
})
</script>

<template>
  <div>
    <HeroMountains />

    <div class="page wrap">
      <!-- ── 引导 ── -->
      <section class="lead-row reveal">
        <h1 class="hero-title">倚声填词</h1>
        <p class="hero-sub">
          写下你心中的意境，择一个词牌，得一首合律的词。
          <span class="muted">平仄与韵脚皆按《词林正韵》校验，可逐句推敲。</span>
        </p>
      </section>

      <!-- ── 输入 + 词牌 ── -->
      <div class="compose-grid">
        <section class="panel stamp-corner compose-input reveal">
          <div class="row between wrap">
            <h3 class="mb0">写下意境</h3>
            <span class="counter" :class="{ warn: promptLen > MAX * 0.9 }">{{ promptLen }} / {{ MAX }}</span>
          </div>
          <textarea
            v-model="prompt"
            class="textarea mt1"
            rows="6"
            :maxlength="MAX"
            placeholder="写下你心中的意境…例如：秋夜独坐，思念远方故人"
          ></textarea>

          <div class="row between wrap mt1">
            <div class="inspiration grow">
              <template v-if="inspiration">
                <span class="quote">「{{ inspiration.text }}」</span>
                <span class="tiny muted">——{{ inspiration.author }}{{ inspiration.title }}</span>
              </template>
              <span v-else class="tiny muted">填不出词？让它给你一句引子</span>
            </div>
            <div class="row">
              <button class="btn ghost sm" :disabled="inspirationLoading" @click="rollInspiration">
                <span v-if="inspirationLoading" class="spin">◌</span>
                <span v-else>↻ 换一句名句</span>
              </button>
              <button v-if="inspiration" class="btn sm" @click="useInspiration">拿来用</button>
            </div>
          </div>

          <p class="hint mt1 mb0">
            小提示：写具体的场景比写抽象的情绪更容易出好句。
            「孤舟一叶听秋雨」比「我很孤独」好用得多。
          </p>
        </section>

        <CipaiPicker @show-pattern="showPattern" />
      </div>

      <!-- ── 起韵填词 ── -->
      <div class="cta-row reveal">
        <button class="btn cinnabar lg submit-btn" :disabled="!canSubmit" @click="submit">
          <span v-if="generating" class="spin">◌</span>
          <span v-else>🖊️ 起韵填词</span>
        </button>

        <div class="cta-side">
          <div v-if="selectedCipai" class="tiny muted">
            已选 <b class="kai ink">{{ selectedCipai.name }}</b>
            · {{ selectedCipai.syllables }} 字 · {{ selectedCipai.sentenceCount }} 句 ·
            {{ selectedCipai.rhymeType }}韵
            <span v-if="!selectedCipai.generatable" class="bad">（该词牌暂不支持自动填词）</span>
          </div>
          <div v-if="promptLen < 4" class="tiny muted">还需要：写下至少四个字的意境</div>
          <div v-else-if="cipaiError" class="tiny bad">{{ cipaiError }}</div>
          <div v-else-if="genError" class="tiny bad">{{ genError }}</div>
        </div>

        <label class="switch board-toggle">
          <input :checked="vertical" type="checkbox" @change="setVertical($event.target.checked)" />
          <span>竖排显示</span>
        </label>
      </div>

      <!-- ── 词作 ── -->
      <PoemBoard
        :poem="poem"
        :vertical="vertical"
        :loading="generating"
        :changing-line="changingLine"
        :line-anim="lineAnim"
        @change-line="changeLine"
      >
        <template #actions>
          <div v-if="poem" class="row wrap actions">
            <button class="btn sm" :disabled="generating" @click="anotherRound">↻ 换整首</button>
            <button class="btn sm" :class="{ 'faved': isFavorited }" @click="toggleFavorite">
              {{ isFavorited ? '★ 已入词笺' : '☆ 收藏到词笺' }}
            </button>
            <button class="btn sm" @click="studioOpen = true">🖼️ 生成卡片</button>
            <div class="btn-group">
              <button class="btn sm ghost" @click="copy(textWithPunc(), '全词（带标点）')">⧉ 复制带标点</button>
              <button class="btn sm ghost" @click="copy(textPlain(), '全词（纯文本）')">⧉ 复制纯文本</button>
            </div>
            <button class="btn sm ghost" @click="sharePoem">↗ 分享</button>
          </div>
        </template>
      </PoemBoard>

      <!-- ── 解析 + 辅助工具 ── -->
      <div v-if="poem" class="workbench-layout mt3">
        <RhythmAnalysis :poem="poem" :cipai="selectedCipai" />

        <section class="panel tools">
          <div class="row between wrap">
            <h3 class="mb0">创作辅助</h3>
            <div class="seg">
              <button class="seg-btn" :class="{ on: toolTab === 'rhyme' }" @click="toolTab = 'rhyme'">韵书速查</button>
              <button class="seg-btn" :class="{ on: toolTab === 'insp' }" @click="toolTab = 'insp'">名句灵感</button>
            </div>
          </div>

          <div class="mt2">
            <RhymeLookup v-if="toolTab === 'rhyme'" compact />

            <div v-else>
              <template v-if="inspiration">
                <blockquote class="insp-quote">
                  {{ inspiration.text }}
                  <footer class="tiny muted">——{{ inspiration.author }} {{ inspiration.title }}</footer>
                </blockquote>
              </template>
              <p class="hint">
                名句是引子不是模板。先读三遍，记住它的「气口」，再写你自己的话。
                直接套用古人原句会显得偷懒，化用意境才是正道。
              </p>
              <button class="btn sm" :disabled="inspirationLoading" @click="rollInspiration">
                ↻ 再换一句
              </button>
            </div>
          </div>
        </section>
      </div>

      <!-- ── 无词作时的说明 ── -->
      <section v-else class="panel mt3 howto">
        <h3>三步得一首合律词</h3>
        <ol class="steps">
          <li><b>写意境</b> —— 一句话，越具体越好。例：「雪夜归人，柴门犬吠」。</li>
          <li><b>择词牌</b> —— 字数少的叫小令，长调（水调歌头）更能铺陈。点卡片右下角的「谱」可先看格律。</li>
          <li><b>起韵填词</b> —— 生成后每句都能单独「换一句」，直到顺眼为止。</li>
        </ol>
        <p class="hint mb0">
          词牌选定后不可改字数：它决定了每句几个字、哪几句押韵、押平声还是仄声韵。
        </p>
      </section>
    </div>

    <CipaiPatternDialog :cipai="patternCipai" :open="patternOpen" @close="patternOpen = false" />
    <CardStudio
      :open="studioOpen"
      :poem="poem"
      :prompt="prompt"
      :vertical="vertical"
      @close="studioOpen = false"
    />
  </div>
</template>

<style scoped>
.lead-row {
  padding: 26px 0 20px;
  text-align: center;
}
.hero-title {
  font-family: var(--font-kai);
  font-size: clamp(1.9rem, 4.4vw, 2.9rem);
  letter-spacing: 0.24em;
  margin: 0 0 8px;
  color: var(--ink);
  text-indent: 0.24em;
}
.hero-sub {
  margin: 0;
  color: var(--ink-2);
  font-size: clamp(0.88rem, 1.6vw, 1rem);
  line-height: 1.9;
  max-width: 620px;
  margin-inline: auto;
}
.compose-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
  gap: 18px;
  align-items: start;
}
.inspiration {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.quote {
  font-family: var(--font-kai);
  color: var(--ink-2);
  font-size: 0.92rem;
  line-height: 1.7;
}
.cta-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin: 22px 0 18px;
  padding: 14px 18px;
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--r);
}
.submit-btn {
  min-width: 190px;
  font-size: 1.05rem;
  letter-spacing: 0.14em;
  padding: 13px 26px;
}
.cta-side {
  flex: 1;
  min-width: 180px;
  line-height: 1.7;
}
.ink {
  color: var(--ink);
}
.bad {
  color: var(--cinnabar);
}
.board-toggle {
  margin: 0;
  white-space: nowrap;
  color: var(--ink-2);
  font-size: 0.84rem;
}
.actions {
  gap: 7px;
}
.btn.faved {
  border-color: var(--cinnabar);
  color: var(--cinnabar);
}
.tools {
  min-height: 300px;
}
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
.insp-quote {
  font-family: var(--font-kai);
  font-size: 1.12rem;
  line-height: 2;
  margin: 0 0 14px;
  padding: 14px 18px;
  border-left: 3px solid var(--cinnabar);
  background: var(--paper-2);
  border-radius: 0 var(--r) var(--r) 0;
  color: var(--ink);
}
.insp-quote footer {
  margin-top: 8px;
  font-family: var(--font-serif);
}
.howto {
  background: linear-gradient(180deg, var(--paper-2), var(--paper));
}
.steps {
  margin: 12px 0 14px;
  padding-left: 20px;
  line-height: 2.1;
  color: var(--ink-2);
}
.steps b {
  color: var(--ink);
}
.switch {
  display: flex;
  gap: 8px;
  align-items: center;
  cursor: pointer;
}
.switch input {
  accent-color: var(--cinnabar);
}
@media (max-width: 1024px) {
  .compose-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 640px) {
  .cta-row {
    padding: 12px;
  }
  .submit-btn {
    width: 100%;
    min-width: 0;
  }
}
</style>
