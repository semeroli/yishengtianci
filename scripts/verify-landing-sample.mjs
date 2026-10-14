/**
 * 复核落地页首屏那首《浣溪沙》——它必须真合律，且平仄标记必须用引擎本来的符号（◐）。
 * ─────────────────────────────────────────────────────────────
 * 落地页上摆的每一个字都要站得住：在一个主打「格律严谨」的站上摆一首出律的词，最打脸。
 * 这个脚本把 LandingView.vue 里 SAMPLE.lines 的六句逐句喂回 checkLine()，
 * 并顺手验「把末字换成仄声字应恰好第 7 位出律」（演示卡里那个错例的依据）。
 * 改样例词之后**必须**跑它，别手改 —— 手改极易写出律（曾把只有平声一读的「回」标成可平可仄）。
 *
 * 用法：npm run verify:landing
 *   CIPAI=jiangchengzi node scripts/verify-landing-sample.mjs   # 换词牌
 */
import { checkLine, annotate } from '../shared/engine.js'
import { getCipai } from '../shared/cipai.js'

const cp = getCipai(process.env.CIPAI || 'huanxisha')
if (!cp) { console.error('没有该词牌'); process.exit(1) }
const patOf = (l) => l.pattern || l.p || ''

console.log(`词牌：${cp.name}  ${cp.syllables} 字 · ${cp.sentenceCount} 句 · ${cp.rhymeType}韵 · ${cp.styleTag}`)
console.log(`谱式行数：${cp.lines.length}　（落地页样例有 6 句，应一致）`)
console.log(`第 1 句谱式：${patOf(cp.lines[0])}\n`)

// 落地页 LandingView.vue 里 SAMPLE.lines 的六句原文（逐字照抄）
const TEXTS = [
  '依旧清宵欲断魂',
  '回归归雁语频频',
  '徒留残夜故乡云',
  '空有月华秋易老',
  '恍如官柳忆双亲',
  '闲来露冷倚楼人'
]

let hard = 0, soft = 0, lenBad = 0
console.log('　原文　　　　谱式　　　　实际平仄　　硬 软 字数')
for (let i = 0; i < TEXTS.length; i++) {
  const pat = patOf(cp.lines[i])
  const r = checkLine(pat, TEXTS[i])
  const marks = annotate(TEXTS[i]).map((c) => c.tone).join('')
  hard += r.hard; soft += r.soft
  if (!r.lengthOk) lenBad++
  console.log(`　${TEXTS[i]}　${pat}　${marks}　${r.hard}  ${r.soft}  ${r.lengthOk ? 'ok' : '✗'}`)
}
const total = TEXTS.reduce((n, t) => n + [...t].length, 0)
console.log(`\n合计：硬性出律 ${hard} 处 · 软性出入 ${soft} 处 · 字数 ${total}/${cp.syllables} · 句数 ${TEXTS.length}/${cp.sentenceCount}`)

// 韵脚：六句里第 1/2/3/5/6 句末字应同部
const RHYME_LINES = [0, 1, 2, 4, 5]
const ends = RHYME_LINES.map((i) => TEXTS[i].slice(-1))
console.log('韵脚字：' + ends.join('、'))

// 错例验证：把「魂」换成仄声的「酒」，应当恰好第 7 位硬性出律
const bad = '依旧清宵欲断酒'
const rb = checkLine(patOf(cp.lines[0]), bad)
console.log(`\n错例「${bad}」：硬性出律 ${rb.hard} 处，位置 ${JSON.stringify(rb.deviations)}`)
console.log(`实际平仄：${annotate(bad).map((c) => c.tone).join('')}`)

const ok = hard === 0 && soft === 0 && lenBad === 0 && rb.hard === 1
console.log('\n' + (ok ? '✅ 首屏样例与错例均可直接写进落地页（符号用 ◐ 不用 ⊙）' : '❌ 有出入，不要照抄'))
