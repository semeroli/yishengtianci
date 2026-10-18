<script setup>
/**
 * 落地页（官网首页）
 * ─────────────────────────────────────────────────────────────
 * 目标：第一次来的人 10 秒内明白「这是什么、凭什么可信、点哪里开始」。
 *
 * 风格上是两种语言的融合，不是折中：
 *   · 取自 Google / Material 的一面 —— 大标题压在宽留白里、唯一的朱砂主按钮、
 *     大圆角药丸按钮、卡片用高度（阴影）分层而不是描边、大字号数字条、
 *     一屏一个主张、滚动节奏均匀。
 *   · 取自宋式美学的一面 —— 古纸底 / 墨色字 / 朱砂为记；标题走宋体、
 *     诗句走楷体；平仄用 ○●◐ 而不是 ✗✓；朱砂印章既是图形也是品牌记号；
 *     栏线、句读这些刻本里的东西被当成装饰线条复用。
 *
 * 一条硬规矩：**页面上出现的每一个数字和每一句样例词，都必须是真的。**
 *   词牌数、韵部数从接口/代码里取；首屏那首《浣溪沙》是本地引擎真跑出来、
 *   并且逐句回验过平仄与韵脚的（0 处出律、无重韵），不是随便凑的七言。
 *   在一个主打「格律严谨」的站上摆假数据，是最快的自我否定。
 */
import { computed, onMounted, ref } from 'vue'
import { Api } from '../api.js'
import { setSeo, websiteJsonLd } from '../utils/seo.js'

/* ═══════════════ 首屏样例词 ═══════════════
 * 来源：`node _sample.mjs` 用 shared/engine.js 生成，`node _verify-sample.mjs` 逐句回验：
 *   硬性出律 0 处 · 软性出入 0 处 · 无重韵 · 字数 42/42 · 句数 6/6。
 * marks 是每个字的实际平仄（引擎 annotate() 的原样输出）：
 *   ○ 平、● 仄、◐ 平仄两读 / 未知。
 * ⚠️ 符号必须用 ◐，**不要写成 ⊙** —— 全站（RhymeView、CipaiPatternDialog、
 *    seed 文章、工作台的谱式）统一用 ◐ 表示「可平可仄 / 一三五不论」，
 *    落地页自创一个 ⊙ 会让用户点进工作台后对不上。
 * ⚠️ 改这首词之前请重跑 _verify-sample.mjs，别手改 —— 手改极易写出律
 *    （上一版就把「回」错标成了 ⊙，而它只有平声一读）。
 */
const SAMPLE = {
  cipaiName: '浣溪沙',
  syllables: 42,
  sentenceCount: 6,
  rhymeType: '平',
  styleTag: '婉约',
  prompt: '秋夜独坐，思念远方故人',
  buName: '第六部 · 真文元（平）',
  rhymeChars: ['魂', '频', '云', '亲', '人'],
  lines: [
    { text: '依旧清宵欲断魂', marks: '○●○○●◐○', rhyme: true },
    { text: '回归归雁语频频', marks: '○○○●●○○', rhyme: true },
    { text: '徒留残夜故乡云', marks: '○○○●◐○○', rhyme: true },
    { text: '空有月华秋易老', marks: '○●●○○●●', rhyme: false },
    { text: '恍如官柳忆双亲', marks: '●◐○◐●○○', rhyme: true },
    { text: '闲来露冷倚楼人', marks: '○○●●●○○', rhyme: true }
  ]
}

/* ═══════════════ 格律演示 ═══════════════
 * 用浣溪沙第一句（谱式 ◐●◐○◐●○）演示「逐字对照」。
 * 错例不是编的：把末字换成「酒」（仄声），checkLine 判定第 7 字应为平，
 * 硬性出律 1 处 —— 这正是界面上会标红的那一处（bad 是 0 起的下标）。
 */
const PATTERN = '◐●◐○◐●○'
const DEMO_OK = { text: '依旧清宵欲断魂', tones: '○●○○●◐○', bad: -1 }
const DEMO_BAD = { text: '依旧清宵欲断酒', tones: '○●○○●◐●', bad: 6 }

/* ═══════════════ 三步 ═══════════════ */
const STEPS = [
  {
    num: '一',
    title: '写意境',
    body: '一句话，说清你眼前的景。具体的场景远胜抽象的情绪 ——「孤舟一叶听秋雨」比「我很难过」好用得多。',
    hint: '例：雪夜归人，柴门犬吠'
  },
  {
    num: '二',
    title: '择词牌',
    body: '词牌决定这首词有几句、每句几个字、哪几句押韵。小令短促，长调（如水调歌头）更能铺陈。',
    hint: '点词牌上的「谱」可以先看格律再决定'
  },
  {
    num: '三',
    title: '起韵填词',
    body: '生成后逐句推敲。哪一句读着别扭，单独换那一句就好 —— 其余各句原样不动，韵脚也不会被换乱。',
    hint: '不满意就「换一句」，不用整首重来'
  }
]

/* ═══════════════ 能力（6 项，都是真做了的） ═══════════════
 * 图标统一 24×24、1.5 线宽、圆头端点，跟 Material 的线性图标同规格；
 * 图形本身用国风的意象（谱点、对勾、书、印章），不是通用齿轮 / 星星那一套。
 */
const FEATURES = computed(() => [
  {
    title: '逐字校验平仄',
    body: '谱上写「○」的地方用了仄声字，会直接标出来。不是给你一句「写得不错」，而是逐字告诉你哪一处出了律。',
    svg: `<circle cx="4" cy="7.5" r="1.5" fill="currentColor"/><circle cx="8.6" cy="7.5" r="1.5" fill="currentColor"/><circle cx="13.2" cy="7.5" r="1.5" fill="currentColor"/><circle cx="17.8" cy="7.5" r="1.5" fill="currentColor"/>
<path d="M5 14.5l3.5 3.5L19 9.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
  },
  {
    title: '重韵三道防线',
    body: '同一个韵部里不重复用同一个韵脚字。多数填词工具不管这件事，而内行一眼就看出来 —— 所以我们在生成前就把韵脚排好。',
    svg: `<circle cx="8.5" cy="9" r="4.3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="15.5" cy="9" r="4.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 19.5l17-15.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`
  },
  {
    title: '逐句替换',
    body: '对某一句不满意，就换那一句。只重写这一行，其余各句与韵脚编排都不动，不会越换越散。',
    svg: `<path d="M3.5 6.5h17M3.5 17.5h17" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M3.5 12h5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12.5 12h8M17.8 9L20.8 12l-3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
  },
  {
    title: '按《词林正韵》归部',
    body: `平声 ${RHYME_PING.value} 部、仄声 ${RHYME_ZE.value} 部，韵字按韵书归部，入声字单独处理。选字时就知道它能不能押、押哪一部，不必自己翻书。`,
    svg: `<path d="M12 6.4C9.9 4.4 6.6 3.8 3.6 4.4V19c3-.6 6.3 0 8.4 2 2.1-2 5.4-2.6 8.4-2V4.4c-3-.6-6.3 0-8.4 2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 6.4V21" fill="none" stroke="currentColor" stroke-width="1.5"/>`
  },
  {
    title: '先看谱，再落笔',
    body: '每个词牌的 ○● 谱、句读和韵脚位置都摆出来给你看。格律是明写的，不是藏在黑箱里的一句「已为您优化」。',
    svg: `<path d="M6 3.5h8.5L19 8v12.5H6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M14.5 3.5V8H19" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="13.5" r="1.2" fill="currentColor"/><circle cx="13.8" cy="13.5" r="1.2" fill="currentColor"/><circle cx="10" cy="17.5" r="1.2" fill="currentColor"/><circle cx="13.8" cy="17.5" r="1.2" fill="currentColor"/>`
  },
  {
    title: '词笺与词卡',
    body: '满意的作品收进「词笺」随时翻看；也能生成一张竖排的词卡存下来或转给别人，题款、韵脚都在上面。',
    svg: `<rect x="3.8" y="3.5" width="16.4" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="14" y="14" width="6.2" height="6.2" rx="1" fill="currentColor" opacity="0.9"/><path d="M7 8.5h8M7 12h5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`
  }
])

/* ═══════════════ 词牌（真实数据，接口取，失败才退回估算） ═══════════════ */
const cipaiCount = ref(10)
const cipaiExtra = ref(2)
const cipaiChips = ref([])

/** 韵部 / 韵字的口径**从接口现算**，不在前端写死 ——
 *  上一轮把韵库从 12 部补到 20 部之后，页面上的数字还是旧的，等于对外说假话。
 *  这四个默认值只是「接口没通时的兜底」，应等于当前真实值：
 *  20 部（平 12 / 仄 8）、去重后 1599 个韵字。 */
const RHYME_PARTS = ref(20)
const RHYME_PING = ref(12)
const RHYME_ZE = ref(8)
const RHYME_CHARS = ref(1599)

onMounted(async () => {
  setSeo({
    description:
      '输入一段意境，选一个词牌，得一首合律的词。平仄与韵脚按《词林正韵》逐字校验，附填词教程、名作赏析与韵书速查。',
    jsonLd: websiteJsonLd()
  })
  try {
    const { data } = await Api.cipai()
    const list = data?.list || []
    const gen = list.filter((c) => c.generatable)
    if (gen.length) {
      cipaiCount.value = gen.length
      cipaiExtra.value = list.length - gen.length
      cipaiChips.value = gen.map((c) => ({ id: c.id, name: c.name, syllables: c.syllables, styleTag: c.styleTag }))
    }
  } catch {
    /* 接口没通就保持默认值，页面照样完整 —— 落地页不该因为一个接口挂了就开天窗 */
  }
  try {
    const { data } = await Api.rhyme()
    if (data?.parts) {
      RHYME_PARTS.value = data.parts
      RHYME_PING.value = data.pingParts ?? RHYME_PING.value
      RHYME_ZE.value = data.parts - RHYME_PING.value
      RHYME_CHARS.value = data.totalChars ?? RHYME_CHARS.value
    }
  } catch {
    /* 同上：韵书接口不通就用内置默认值，但仍然是对的 */
  }
})

/** 把一行样例词拆成「字 + 平仄点」，与工作台里的字格同一套标记 */
function cells(line) {
  const chars = [...line.text]
  const marks = [...line.marks]
  return chars.map((ch, i) => ({
    ch,
    mark: marks[i] || '',
    rhyme: line.rhyme && i === chars.length - 1
  }))
}

const totalSyllables = computed(() => SAMPLE.lines.reduce((n, l) => n + [...l.text].length, 0))
</script>

<template>
  <div class="lp">
    <!-- ══════════════════ ① 首屏 ══════════════════ -->
    <section class="lp-hero">
      <div class="lp-hero-tint" aria-hidden="true"></div>
      <div class="lp-wrap lp-hero-grid">
        <div class="lp-hero-copy">
          <p class="lp-eyebrow">依谱填词 · 以韵为骨</p>

          <h1 class="lp-h1">
            写下意境，<br />得一首<em class="lp-hl">合律<svg class="lp-ul" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><path d="M2 6.6C20 3 38 8.2 56 5.4 74 2.6 88 7 98 4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" /></svg></em>的词
          </h1>

          <p class="lp-lead">
            选一个词牌，说一句你眼前的景。
            <span class="lp-nowrap">平仄与韵脚</span>按《词林正韵》逐字比对 —— 合不合律，当场看得见。
          </p>

          <div class="lp-actions">
            <RouterLink to="/studio" class="lp-btn lp-btn-primary">
              开始填词
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </RouterLink>
            <a href="#rules" class="lp-btn lp-btn-ghost">看格律怎么校验</a>
          </div>

          <ul class="lp-trust">
            <li>不用注册</li>
            <li>完全免费</li>
            <li>不联网也能填</li>
          </ul>
        </div>

        <!-- 产品实样：一首真跑出来的词，带上平仄与韵脚 -->
        <div class="lp-card lp-reveal">
          <div class="lp-card-head">
            <span class="lp-seal-mini" aria-hidden="true">倚</span>
            <div class="lp-card-title">
              <b>《{{ SAMPLE.cipaiName }}》</b>
              <span>{{ SAMPLE.syllables }} 字 · {{ SAMPLE.sentenceCount }} 句 · {{ SAMPLE.rhymeType }}韵 · {{ SAMPLE.styleTag }}</span>
            </div>
            <span class="lp-badge">
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8.4l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" /></svg>
              已校验
            </span>
          </div>

          <div class="lp-poem">
            <div v-for="(l, li) in SAMPLE.lines" :key="li" class="lp-pline">
              <span v-for="(c, ci) in cells(l)" :key="ci" class="lp-cell" :class="{ rhyme: c.rhyme }">
                <b>{{ c.ch }}</b>
                <i>{{ c.mark }}</i>
              </span>
            </div>
          </div>

          <div class="lp-card-foot">
            <span><em>意境</em>{{ SAMPLE.prompt }}</span>
            <span><em>韵脚</em><b class="lp-rhy">{{ SAMPLE.rhymeChars.join(' ') }}</b> · {{ SAMPLE.buName }}</span>
          </div>

          <div class="lp-card-tip">这一首由站内引擎生成，平仄与韵脚已逐句回验：{{ totalSyllables }}/{{ SAMPLE.syllables }} 字，0 处出律，无重韵。</div>
        </div>
      </div>
    </section>

    <!-- ══════════════════ ② 数字条 ══════════════════ -->
    <section class="lp-stats">
      <div class="lp-wrap lp-stats-grid">
        <div class="lp-stat">
          <b class="tabnum">{{ cipaiCount }}</b>
          <span>可自动填词的词牌</span>
          <em>另有 {{ cipaiExtra }} 个已录词牌、谱待整理</em>
        </div>
        <div class="lp-stat">
          <b class="tabnum">{{ RHYME_PARTS }}</b>
          <span>个韵部</span>
          <em>平声 {{ RHYME_PING }} 部 · 仄声 {{ RHYME_ZE }} 部</em>
        </div>
        <div class="lp-stat">
          <b class="tabnum">{{ RHYME_CHARS }}</b>
          <span>个韵字</span>
          <em>按《词林正韵》归部</em>
        </div>
        <div class="lp-stat">
          <b class="tabnum">0</b>
          <span>步注册</span>
          <em>打开就能用</em>
        </div>
      </div>
    </section>

    <!-- ══════════════════ ③ 三步 ══════════════════ -->
    <section id="how" class="lp-sec">
      <div class="lp-wrap">
        <header class="lp-sechead">
          <h2>三步得一首合律的词</h2>
          <p>从头到尾不会超过一分钟，而且每一步你都知道系统在做什么。</p>
        </header>

        <ol class="lp-steps">
          <li v-for="s in STEPS" :key="s.num" class="lp-step">
            <span class="lp-step-num" aria-hidden="true">{{ s.num }}</span>
            <h3>{{ s.title }}</h3>
            <p>{{ s.body }}</p>
            <span class="lp-step-hint">{{ s.hint }}</span>
          </li>
        </ol>
      </div>
    </section>

    <!-- ══════════════════ ④ 能力 ══════════════════ -->
    <section class="lp-sec lp-sec-alt">
      <div class="lp-wrap">
        <header class="lp-sechead">
          <h2>它到底替你做了哪些事</h2>
          <p>填词的门槛从来不在「想不出句子」，而在「想出来的句子不合律」。下面六件事，都是冲这个来的。</p>
        </header>

        <div class="lp-feats">
          <article v-for="f in FEATURES" :key="f.title" class="lp-feat">
            <!-- 图标是文件里的静态常量，不含任何用户输入 -->
            <span class="lp-feat-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="24" height="24" v-html="f.svg"></svg>
            </span>
            <h3>{{ f.title }}</h3>
            <p>{{ f.body }}</p>
          </article>
        </div>
      </div>
    </section>

    <!-- ══════════════════ ⑤ 格律怎么保证的 ══════════════════ -->
    <section id="rules" class="lp-sec">
      <div class="lp-wrap lp-rules-grid">
        <div class="lp-rules-copy">
          <header class="lp-sechead lp-sechead-left">
            <h2>合律不是「读起来像」，<br />是逐字对过一遍</h2>
            <p>
              每个词牌的格律都是一张固定的谱：哪一句几个字、第几个位置该平该仄、哪几句押韵，全是定数。
              我们把它写成了可以校验的规则 —— 生成的时候按谱填，生成完再按谱写回验一次。
            </p>
          </header>

          <ul class="lp-rules-list">
            <li>
              <b>平仄</b>
              <span>谱上的 <i class="mk">○</i> 处须用平声字，<i class="mk">●</i> 处须用仄声字，<i class="mk">◐</i> 处平仄皆可（就是常说的「一三五不论」）。</span>
            </li>
            <li>
              <b>韵脚</b>
              <span>押韵的那几句，末字必须落在<b class="c-red">同一个韵部</b>里，而且整首不能重复用同一个字。</span>
            </li>
            <li>
              <b>出律</b>
              <span>硬性位置出错会当场标出来，不会把问题藏在结果里让你自己发现。</span>
            </li>
          </ul>
        </div>

        <!-- 逐字对照演示：同一句，一个合律、一个不合律 -->
        <div class="lp-demo">
          <div class="lp-demo-head">
            <b>《浣溪沙》第一句</b>
            <span>谱式</span>
          </div>

          <div class="lp-demo-row">
            <span class="lp-demo-lb">谱式</span>
            <span class="lp-demo-cells lp-demo-pat">
              <i v-for="(m, i) in [...PATTERN]" :key="i">{{ m }}</i>
            </span>
          </div>

          <div class="lp-demo-row lp-demo-good">
            <span class="lp-demo-lb">原文</span>
            <span class="lp-demo-cells">
              <i v-for="(c, i) in [...DEMO_OK.text]" :key="i">{{ c }}</i>
            </span>
          </div>
          <div class="lp-demo-row lp-demo-tones">
            <span class="lp-demo-lb">平仄</span>
            <span class="lp-demo-cells">
              <i v-for="(m, i) in [...DEMO_OK.tones]" :key="i">{{ m }}</i>
            </span>
          </div>
          <p class="lp-demo-verdict ok">
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 8.4l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" /></svg>
            七个字与谱式逐位吻合，合律。
          </p>

          <hr class="lp-demo-hr" />

          <div class="lp-demo-row">
            <span class="lp-demo-lb">原文</span>
            <span class="lp-demo-cells">
              <i v-for="(c, i) in [...DEMO_BAD.text]" :key="i" :class="{ bad: i === DEMO_BAD.bad }">{{ c }}</i>
            </span>
          </div>
          <div class="lp-demo-row lp-demo-tones">
            <span class="lp-demo-lb">平仄</span>
            <span class="lp-demo-cells">
              <i v-for="(m, i) in [...DEMO_BAD.tones]" :key="i" :class="{ bad: i === DEMO_BAD.bad }">{{ m }}</i>
            </span>
          </div>
          <p class="lp-demo-verdict bad">
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" /></svg>
            末字是韵脚，谱式要求平声，此处用了仄声字 —— 第 7 处出律，标红。
          </p>

          <p class="lp-demo-foot">
            冷知识：这句里的「断」字平仄两读，所以标 <i class="mk">◐</i> 而不是判错。
            韵书里的多音字、入声字都按《词林正韵》单独处理过。
          </p>
        </div>
      </div>
    </section>

    <!-- ══════════════════ ⑥ 词牌一览 ══════════════════ -->
    <section class="lp-sec lp-sec-alt">
      <div class="lp-wrap">
        <header class="lp-sechead">
          <h2>现已整理格律的词牌</h2>
          <p>点任意一个词牌，直接带着它进工作台开始填。格律谱整理好一个补一个，不凑数。</p>
        </header>

        <div class="lp-chips">
          <RouterLink
            v-for="c in cipaiChips"
            :key="c.id"
            class="lp-chip"
            :to="{ path: '/studio', query: { cipai: c.id } }"
          >
            <b>{{ c.name }}</b>
            <span>{{ c.syllables }} 字 · {{ c.styleTag }}</span>
          </RouterLink>
        </div>

        <p class="lp-chips-note">
          还有 {{ cipaiExtra }} 个词牌（满江红、临江仙）已收录但格律谱尚未整理完，
          在工作台里能看到它们，但暂时不能自动填词。
        </p>
      </div>
    </section>

    <!-- ══════════════════ ⑦ 结尾 ══════════════════ -->
    <section class="lp-cta">
      <div class="lp-cta-tint" aria-hidden="true"></div>
      <div class="lp-wrap lp-cta-inner">
        <span class="lp-seal-big" aria-hidden="true">倚声</span>
        <h2>格律的事交给它，<br />你只管把话说好看。</h2>
        <p>不用注册，不用付费，打开就能写。</p>
        <RouterLink to="/studio" class="lp-btn lp-btn-primary lp-btn-lg">
          开始填词
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* ═════════════════════════════════════════════════════════
   命名前缀 lp- （landing page），避免和前台全局类名打架。
   颜色一律走 tokens.css 的变量，浅色 / 深色两套自动跟随。
   ═════════════════════════════════════════════════════════ */

.lp {
  --lp-r: 14px;     /* 大圆角：Google 的卡片尺度，配合下面的柔和阴影 */
  display: block;
}

.lp-wrap {
  width: 100%;
  max-width: var(--maxw);
  margin: 0 auto;
  padding: 0 22px;
}

.lp-sec {
  padding: clamp(52px, 7.4vw, 96px) 0;
}
.lp-sec-alt {
  background: color-mix(in srgb, var(--paper-2) 62%, var(--paper));
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

.lp-nowrap {
  white-space: nowrap;
}

/* ── 区块标题 ── */
.lp-sechead {
  max-width: 46em;
  margin: 0 auto clamp(30px, 4vw, 46px);
  text-align: center;
}
.lp-sechead-left {
  margin: 0 0 24px;
  text-align: left;
  max-width: none;
}
.lp-sechead h2 {
  font-family: var(--font-serif);
  font-weight: 700;
  font-size: clamp(1.5rem, 2.9vw, 2.15rem);
  line-height: 1.34;
  letter-spacing: 0.01em;
  margin: 0 0 12px;
  color: var(--ink);
}
.lp-sechead p {
  margin: 0;
  color: var(--ink-2);
  line-height: 1.95;
  font-size: 0.98rem;
}

/* ── 按钮：药丸，Material 的招牌形状 ── */
.lp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  height: 50px;
  padding: 0 26px;
  border-radius: var(--r-pill);
  border: 1px solid transparent;
  font-family: var(--font-sans);
  font-size: 1rem;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-decoration: none;
  white-space: nowrap;
  transition: transform var(--t) var(--ease-ink), box-shadow var(--t), background var(--t), border-color var(--t);
}
.lp-btn-primary {
  background: var(--cinnabar-solid);
  color: #fff;
  box-shadow: 0 1px 2px rgba(150, 40, 40, 0.24), 0 10px 24px -10px rgba(150, 40, 40, 0.55);
}
.lp-btn-primary:hover {
  color: #fff;
  transform: translateY(-2px);
  box-shadow: 0 2px 6px rgba(150, 40, 40, 0.26), 0 18px 34px -12px rgba(150, 40, 40, 0.6);
}
.lp-btn-ghost {
  border-color: var(--line-strong);
  color: var(--ink);
  background: transparent;
}
.lp-btn-ghost:hover {
  background: var(--paper-3);
  border-color: var(--ink-4);
  color: var(--ink);
}
.lp-btn-lg {
  height: 56px;
  padding: 0 34px;
  font-size: 1.06rem;
}

/* ═══════════ ① 首屏 ═══════════ */

.lp-hero {
  position: relative;
  overflow: hidden;
  padding: clamp(40px, 6vw, 76px) 0 clamp(46px, 6.4vw, 88px);
}
/* 极淡的双色晕染：右上一点朱砂、左下一点石青，像宣纸上洇开的水痕。
   不用图片、不用渐变图，色相跟着主题令牌走。 */
.lp-hero-tint {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(112% 76% at 82% 4%, color-mix(in srgb, var(--cinnabar) 8%, transparent), transparent 60%),
    radial-gradient(96% 72% at 6% 98%, color-mix(in srgb, var(--azurite) 9%, transparent), transparent 58%);
}
.lp-hero-grid {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.02fr) minmax(0, 1fr);
  gap: clamp(26px, 4vw, 54px);
  align-items: center;
}

.lp-eyebrow {
  display: inline-block;
  margin: 0;
  padding: 5px 15px;
  border-radius: var(--r-pill);
  border: 1px solid color-mix(in srgb, var(--cinnabar) 30%, transparent);
  background: color-mix(in srgb, var(--cinnabar) 7%, transparent);
  color: var(--cinnabar);
  font-size: var(--fs-sm);
  letter-spacing: 0.2em;
  text-indent: 0.2em;
}

.lp-h1 {
  font-family: var(--font-serif);
  font-weight: 700;
  font-size: clamp(2rem, 4.9vw, 3.3rem);
  line-height: 1.2;
  letter-spacing: 0.012em;
  margin: 20px 0 0;
  color: var(--ink);
}
/* 朱砂色 + 手写体感的波浪下划线（内联 SVG，不额外请求） */
.lp-hl {
  position: relative;
  font-style: normal;
  color: var(--cinnabar);
  white-space: nowrap;
}
.lp-ul {
  position: absolute;
  left: -2%;
  right: -2%;
  bottom: -0.24em;
  width: 104%;
  height: 0.3em;
  color: color-mix(in srgb, var(--cinnabar) 62%, transparent);
}

.lp-lead {
  margin: 20px 0 0;
  max-width: 30em;
  color: var(--ink-2);
  font-size: clamp(0.98rem, 1.5vw, 1.1rem);
  line-height: 2.05;
}

.lp-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 28px;
}

.lp-trust {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin: 24px 0 0;
  padding: 0;
  list-style: none;
  color: var(--ink-3);
  font-size: 0.86rem;
}
.lp-trust li {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.lp-trust li::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--cinnabar-solid);
  opacity: 0.6;
}

/* ── 产品卡：首屏右侧那张「真词样张」 ── */
.lp-card {
  position: relative;
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--lp-r);
  padding: 18px 20px 14px;
  /* Material 用高度分层而不是描边：一层贴地的硬阴影 + 一层散开的软阴影 */
  box-shadow: 0 1px 2px rgba(44, 36, 22, 0.05), 0 20px 46px -22px rgba(44, 36, 22, 0.34);
}
/* 首屏样张卡轻轻上浮入场，只演一次；下面 reduced-motion 里会关掉 */
.lp-reveal {
  animation: lpRise 640ms var(--ease-ink) 120ms both;
}
@keyframes lpRise {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
[data-theme='dark'] .lp-card {
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 22px 50px -24px rgba(0, 0, 0, 0.7);
}

.lp-card-head {
  display: flex;
  align-items: center;
  gap: 11px;
  padding-bottom: 13px;
  border-bottom: 1px solid var(--line);
}
/* 缩小版印章：和 favicon 同一枚记号，一进站就认得出来 */
.lp-seal-mini {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 3px;
  background: linear-gradient(135deg, #ce4a40, #9c2a25);
  color: #fdf6ec;
  font-family: var(--font-serif);
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
}
.lp-card-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.lp-card-title b {
  font-family: var(--font-serif);
  font-size: 1.04rem;
  letter-spacing: 0.04em;
  color: var(--ink);
}
.lp-card-title span {
  font-size: var(--fs-xs);
  color: var(--ink-3);
  letter-spacing: 0.04em;
}
.lp-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 3px 9px;
  border-radius: var(--r-pill);
  background: color-mix(in srgb, var(--moss) 14%, transparent);
  color: var(--moss);
  font-size: var(--fs-xs);
  letter-spacing: 0.04em;
}

.lp-poem {
  padding: 14px 0 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.lp-pline {
  display: flex;
  gap: 2px;
}
/* 字格：字在上、平仄点在下 —— 与工作台里的字格同一套标记法 */
.lp-cell {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  line-height: 1;
  min-width: 1.9em;
}
.lp-cell b {
  font-family: var(--font-kai);
  font-size: 1.32rem;
  font-weight: 400;
  line-height: 1.3;
  color: var(--ink);
}
/* 平仄标记一律单色墨 —— 刻意与工作台的谱式对照保持同一观感：
   那边 ○ ● ◐ 也是同一种墨色，只靠字形区分平与仄，只有出律才标红。
   落地页若自创一套「平=石青 / 仄=淡墨」的配色，用户点进工具会发现颜色全没了，
   等于承诺了产品其实没有的东西。 */
.lp-cell i {
  font-style: normal;
  font-size: var(--fs-xs);
  line-height: 1;
  margin-top: 2px;
  color: var(--ink-3);
}
.lp-cell.rhyme b {
  color: var(--cinnabar);
  font-weight: 600;
}

.lp-card-foot {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  font-size: var(--fs-sm);
  color: var(--ink-3);
  line-height: 1.7;
}
.lp-card-foot em {
  font-style: normal;
  margin-right: 8px;
  color: var(--ink-3);
  letter-spacing: 0.1em;
}
.lp-rhy {
  font-family: var(--font-kai);
  font-size: 0.98rem;
  color: var(--cinnabar);
  letter-spacing: 0.1em;
  font-weight: 400;
}
.lp-card-tip {
  margin-top: 11px;
  font-size: var(--fs-xs);
  line-height: 1.7;
  color: var(--ink-3);
}

/* ═══════════ ② 数字条 ═══════════ */

.lp-stats {
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--paper-2) 66%, var(--paper));
}
.lp-stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  padding-top: 0;
  padding-bottom: 0;
}
.lp-stat {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 26px 18px;
  text-align: center;
  border-left: 1px solid var(--line);
}
.lp-stat:first-child {
  border-left: 0;
}
.lp-stat b {
  font-family: var(--font-serif);
  font-size: clamp(1.7rem, 3.4vw, 2.4rem);
  font-weight: 700;
  line-height: 1.1;
  color: var(--ink);
  letter-spacing: 0.02em;
}
.lp-stat span {
  font-size: 0.9rem;
  color: var(--ink-2);
  letter-spacing: 0.04em;
}
.lp-stat em {
  font-style: normal;
  font-size: var(--fs-xs);
  color: var(--ink-3);
}

/* ═══════════ ③ 三步 ═══════════ */

.lp-steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: clamp(16px, 2.4vw, 26px);
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: none;
}
.lp-step {
  position: relative;
  /* 三张卡等高（网格默认拉伸），内部用 flex 把提示行压到底部，
     否则正文行数不同的卡会把虚线提示顶到不同高度，看着像排版错位。 */
  display: flex;
  flex-direction: column;
  padding: 24px 22px 22px;
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--lp-r);
  box-shadow: 0 1px 2px rgba(44, 36, 22, 0.04);
}
.lp-step-num {
  display: block;
  font-family: var(--font-kai);
  font-size: 1.9rem;
  line-height: 1;
  color: var(--cinnabar);
  opacity: 0.85;
  margin-bottom: 12px;
}
.lp-step h3 {
  margin: 0 0 9px;
  font-family: var(--font-serif);
  font-size: 1.14rem;
  letter-spacing: 0.04em;
  color: var(--ink);
}
.lp-step p {
  margin: 0 0 12px;
  color: var(--ink-2);
  line-height: 1.95;
  font-size: 0.92rem;
}
.lp-step-hint {
  display: block;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px dashed var(--line-strong);
  width: 100%;
  font-size: var(--fs-sm);
  color: var(--ink-3);
}

/* ═══════════ ④ 能力 ═══════════ */

.lp-feats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: clamp(14px, 2.2vw, 22px);
}
.lp-feat {
  padding: 24px 22px;
  background: var(--paper-2);
  border-radius: var(--lp-r);
  border: 1px solid transparent;
  transition: transform var(--t) var(--ease-ink), box-shadow var(--t), border-color var(--t);
}
.lp-feat:hover {
  transform: translateY(-3px);
  border-color: var(--line);
  box-shadow: 0 2px 6px rgba(44, 36, 22, 0.05), 0 16px 34px -18px rgba(44, 36, 22, 0.3);
}
.lp-feat-ico {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--cinnabar) 9%, transparent);
  color: var(--cinnabar);
  margin-bottom: 15px;
}
.lp-feat h3 {
  margin: 0 0 8px;
  font-family: var(--font-serif);
  font-size: 1.06rem;
  letter-spacing: 0.03em;
  color: var(--ink);
}
.lp-feat p {
  margin: 0;
  color: var(--ink-2);
  line-height: 1.95;
  font-size: 0.91rem;
}

/* ═══════════ ⑤ 格律演示 ═══════════ */

.lp-rules-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 0.92fr);
  gap: clamp(28px, 4.4vw, 60px);
  align-items: start;
}

.lp-rules-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 15px;
}
.lp-rules-list li {
  display: grid;
  grid-template-columns: 4.2em minmax(0, 1fr);
  gap: 14px;
  align-items: baseline;
  padding-left: 14px;
  border-left: 2px solid color-mix(in srgb, var(--cinnabar) 40%, transparent);
}
.lp-rules-list b {
  font-family: var(--font-serif);
  font-size: 1rem;
  color: var(--ink);
  letter-spacing: 0.06em;
}
.lp-rules-list span {
  color: var(--ink-2);
  line-height: 1.95;
  font-size: 0.93rem;
}
.lp-rules-list .c-red {
  color: var(--cinnabar);
}
.mk {
  font-style: normal;
  font-size: 0.95em;
  padding: 0 1px;
}

/* 逐字对照：谱 / 原文 / 平仄 三行对齐，一个字一格 */
.lp-demo {
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--lp-r);
  padding: 20px 20px 18px;
  box-shadow: 0 1px 2px rgba(44, 36, 22, 0.05), 0 18px 40px -24px rgba(44, 36, 22, 0.3);
}
.lp-demo-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 14px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--line);
}
.lp-demo-head b {
  font-family: var(--font-serif);
  font-size: 1.02rem;
  letter-spacing: 0.04em;
  color: var(--ink);
}
.lp-demo-head span {
  font-size: var(--fs-xs);
  color: var(--ink-3);
  letter-spacing: 0.16em;
}
.lp-demo-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}
.lp-demo-lb {
  flex-shrink: 0;
  width: 3.2em;
  font-size: var(--fs-xs);
  color: var(--ink-3);
  letter-spacing: 0.12em;
}
.lp-demo-cells {
  display: flex;
  gap: 3px;
}
/* ⚠️ 格子的宽高必须用 rem，**不能用 em**：
   em 相对的是「元素自身」的 font-size，而下面那条规则恰好把符号行的字号调小了，
   于是符号行格子 26.4px、汉字行格子 31.9px —— 七列下来整整错开 36px，
   这张卡最要紧的「逐位对照」当场作废（2026-01 实测复核）。
   rem 相对根字号，三行等宽，列列对齐。 */
.lp-demo-cells i {
  font-style: normal;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  font-family: var(--font-kai);
  font-size: 1.18rem;
  line-height: 1;
  color: var(--ink);
  border-radius: 4px;
}
.lp-demo-pat i,
.lp-demo-tones i {
  font-family: var(--font-sans);
  font-size: 1rem;
}
.lp-demo-pat {
  margin-bottom: 8px;
}
.lp-demo-pat i {
  background: var(--paper-inset);
}
.lp-demo-cells i.bad {
  background: color-mix(in srgb, var(--cinnabar) 20%, transparent);
  color: var(--cinnabar);
  font-weight: 700;
  box-shadow: inset 0 0 0 1px var(--cinnabar);
}
.lp-demo-verdict {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 10px 0 0;
  font-size: 0.82rem;
  line-height: 1.75;
}
.lp-demo-verdict svg {
  flex-shrink: 0;
  margin-top: 0.34em;
}
.lp-demo-verdict.ok {
  color: var(--moss);
}
.lp-demo-verdict.bad {
  color: var(--cinnabar);
}
.lp-demo-hr {
  height: 1px;
  border: 0;
  background: var(--line);
  margin: 18px 0 14px;
}
.lp-demo-foot {
  margin: 16px 0 0;
  padding-top: 13px;
  border-top: 1px dashed var(--line-strong);
  font-size: var(--fs-sm);
  line-height: 1.85;
  color: var(--ink-3);
}

/* ═══════════ ⑥ 词牌 ═══════════ */

.lp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
}
.lp-chip {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 13px 20px;
  border-radius: var(--r-pill);
  border: 1px solid var(--line-strong);
  background: var(--paper-2);
  color: var(--ink);
  text-decoration: none;
  transition: transform var(--t) var(--ease-ink), border-color var(--t), box-shadow var(--t), background var(--t);
}
.lp-chip:hover {
  transform: translateY(-2px);
  border-color: var(--cinnabar);
  color: var(--ink);
  box-shadow: 0 2px 6px rgba(44, 36, 22, 0.05), 0 14px 26px -16px rgba(150, 40, 40, 0.5);
}
.lp-chip b {
  font-family: var(--font-serif);
  font-size: 1.02rem;
  font-weight: 600;
  letter-spacing: 0.08em;
}
.lp-chip span {
  font-size: var(--fs-xs);
  color: var(--ink-3);
  letter-spacing: 0.02em;
}
.lp-chips-note {
  margin: 22px auto 0;
  max-width: 40em;
  text-align: center;
  font-size: 0.82rem;
  line-height: 1.9;
  color: var(--ink-3);
}

/* ═══════════ ⑦ 结尾 ═══════════ */

.lp-cta {
  position: relative;
  overflow: hidden;
  padding: clamp(56px, 8vw, 104px) 0;
  text-align: center;
  border-top: 1px solid var(--line);
}
.lp-cta-tint {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(80% 100% at 50% 120%, color-mix(in srgb, var(--cinnabar) 12%, transparent), transparent 62%),
    radial-gradient(60% 80% at 50% -20%, color-mix(in srgb, var(--azurite) 8%, transparent), transparent 60%);
}
.lp-cta-inner {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}
/* 落款印章：国风里「到此一游」的正式写法 */
.lp-seal-big {
  font-family: var(--font-serif);
  font-weight: 700;
  font-size: 1.02rem;
  line-height: 1;
  letter-spacing: 0.02em;
  padding: 9px 11px;
  border-radius: 4px;
  background: linear-gradient(135deg, #ce4a40, #9c2a25);
  color: #fdf6ec;
  writing-mode: vertical-rl;
  margin-bottom: 26px;
}
.lp-cta h2 {
  font-family: var(--font-serif);
  font-weight: 700;
  font-size: clamp(1.5rem, 3.2vw, 2.3rem);
  line-height: 1.4;
  letter-spacing: 0.015em;
  margin: 0 0 14px;
  color: var(--ink);
}
.lp-cta p {
  margin: 0 0 30px;
  color: var(--ink-2);
  font-size: 0.98rem;
  letter-spacing: 0.04em;
}

/* ═══════════ 响应式 ═══════════ */

@media (max-width: 1024px) {
  .lp-feats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 960px) {
  .lp-hero-grid,
  .lp-rules-grid {
    grid-template-columns: 1fr;
  }
  .lp-hero {
    padding-top: 34px;
  }
  .lp-card {
    order: 2;
  }
  .lp-steps {
    grid-template-columns: 1fr;
  }
  .lp-stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .lp-stat:nth-child(3) {
    border-left: 0;
  }
  .lp-stat:nth-child(n + 3) {
    border-top: 1px solid var(--line);
  }
}
@media (max-width: 640px) {
  .lp-wrap {
    padding: 0 16px;
  }
  .lp-feats {
    grid-template-columns: 1fr;
  }
  .lp-actions {
    flex-direction: column;
    align-items: stretch;
  }
  .lp-btn {
    width: 100%;
  }
  .lp-cell {
    min-width: 1.72em;
  }
  .lp-cell b {
    font-size: 1.18rem;
  }
  .lp-demo-lb {
    width: 2.7em;
    font-size: var(--fs-xs);
  }
  .lp-demo-cells i {
    width: 1.78rem;
    height: 1.78rem;
    font-size: 1.06rem;
  }
  .lp-demo-pat i,
  .lp-demo-tones i {
    font-size: 0.92rem;
  }
  .lp-rules-list li {
    grid-template-columns: 1fr;
    gap: 4px;
  }
  .lp-card-head {
    flex-wrap: wrap;
  }
}

@media (prefers-reduced-motion: reduce) {
  .lp-btn,
  .lp-chip,
  .lp-feat {
    transition: none;
  }
  .lp-btn:hover,
  .lp-chip:hover,
  .lp-feat:hover {
    transform: none;
  }
  .lp-reveal {
    animation: none;
  }
}
</style>
