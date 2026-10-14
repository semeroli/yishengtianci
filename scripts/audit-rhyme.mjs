/**
 * 韵部容量体检（维护韵书时用）
 * ─────────────────────────────────────────────────────────────
 * 「重韵」这类硬伤，表面看是生成算法的毛病，根子却在数据：
 * 同一个韵部里，**能落在某个具体谱式形状上的韵脚字**够不够多。
 * 例如东冬部的三字韵脚几乎全是「●○○」形状，一旦谱式收在「◐●○」，
 * 这些字一条也用不上——引擎只能重复。
 *
 * 所以这个脚本不跑生成，直接把「够不够用」算出来：
 *   对每个词牌的每个韵组，用二部图最大匹配判断
 *   「该声调下的每个韵部，能不能给每一句分到一个不重复的韵脚字」。
 * 匹配不满 = 这个词牌一旦选到该韵部就必然重韵。
 *
 * 用法：npm run audit:rhyme
 *       node scripts/audit-rhyme.mjs 水调歌头 dong   ← 只打印某词牌某韵部的逐句可用字
 */

import { CIPAI, isGeneratable } from '../shared/cipai.js'
import { RHYME_BU, BU_BY_ID, RHYME_ISSUES, rhymeTailStats, tailCharsAt } from '../shared/rhyme.js'
import { rhythmOptions, rhymeFeasibility } from '../shared/engine.js'

const argv = process.argv.slice(2)

/** 逐句列出「这一句能押哪些字」——定位瓶颈用 */
function detail(cipaiName, buId) {
  const c = CIPAI.find((x) => x.name === cipaiName || x.id === cipaiName)
  if (!c) return console.log(`找不到词牌「${cipaiName}」`)
  const bu = BU_BY_ID[buId]
  if (!bu) return console.log(`找不到韵部「${buId}」，可用：${RHYME_BU.map((b) => b.id).join(' ')}`)
  console.log(`\n《${c.name}》 × ${buId}（${bu.name}）`)
  for (const [i, l] of c.lines.entries()) {
    if (!l.r) continue
    const N = l.p.length
    const rhythm = rhythmOptions(N, l.rhythm)[0]
    const len = rhythm[rhythm.length - 1]
    const offset = N - len
    const chars = [...tailCharsAt(buId, l.p, offset)]
    console.log(
      `  #${i} ${l.p}  尾块 ${len} 字 @${offset}  形状「${l.p.slice(offset)}」→ ${chars.length} 字：${chars.join('')}`
    )
  }
}

if (argv.length >= 2) {
  detail(argv[0], argv[1])
  process.exit(0)
}

console.log('\n  韵书容量体检')
console.log('  ══════════════════════════════════════════')

const stats = rhymeTailStats()
console.log('\n  ① 规模')
for (const s of stats) {
  const per = Object.keys(s.per)
    .sort()
    .map((k) => `${k}字 ${s.per[k].distinct}字/${s.per[k].entries}条`)
    .join('  ')
  console.log(`     ${s.name.padEnd(22)} 韵脚字 ${String(s.totalDistinct).padStart(2)}  ${per}`)
}

console.log('\n  ② 规范化的修正记录')
const moved = RHYME_ISSUES.filter((x) => x.moved)
const dropped = RHYME_ISSUES.filter((x) => !x.moved)
console.log(`     迁部 / 纠正平仄 ${moved.length} 条，丢弃 ${dropped.length} 条`)
for (const x of dropped) console.log(`     ⚠ 丢弃 ${x.bu}「${x.word}」：${x.why}`)

console.log('\n  ③ 可用性（每个词牌 × 每个韵组，哪些韵部撑得住）')
let bad = 0
for (const c of CIPAI) {
  if (!isGeneratable(c)) continue
  const parts = []
  for (const g of rhymeFeasibility(c.id)) {
    const pool = RHYME_BU.filter((b) => b.tone === g.type)
    if (g.feasible.length < pool.length) bad++
    parts.push(
      `${g.key}：${g.feasible.length}/${pool.length}` +
        (g.feasible.length < pool.length
          ? `（缺 ${pool.filter((b) => !g.feasible.includes(b.id)).map((b) => b.short).join('/')}）`
          : '')
    )
  }
  console.log(`     ${c.name.padEnd(6)} ${parts.join('   ')}`)
}

console.log(
  `\n  结论：${bad === 0 ? '✅ 每个词牌在当前韵书下都有充足选择' : `❌ 有 ${bad} 个「词牌×韵组」缺韵部`}`
)
console.log('')
