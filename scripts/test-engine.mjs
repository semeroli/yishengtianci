/**
 * 填词引擎回归自测
 * ─────────────────────────────────────────────────────────────
 * 这套检查是照着「词的硬伤清单」写的，不是照着「程序有没有报错」写的。
 * 一条合格的词，至少要满足：
 *   ① 字数与词牌完全一致，且没有空句；
 *   ② 每个韵脚字都落在该句所属的韵部内（不出韵）；
 *   ③ **同一韵组内韵脚字互不重复**（重韵是硬伤；词牌自己写明的叠句除外）；
 *   ④ 没有「破格」句（偶数位与句末失守）；
 *   ⑤ 同一意境多次生成应当得到不同结果（否则引擎等于死记一个答案）。
 *
 * 重韵这一条曾经反复出现，根子在**数据**而不是判分逻辑：
 *   同一个韵部里，能落在某个具体谱式形状（如「●○○」）上的韵脚字太少，
 *   引擎找不到没用过的字，只好重复。所以这里除了「抽查生成结果」，
 *   还要直接体检数据层与容量层——把「会不会重韵」变成**加载时就能算出来的结论**，
 *   而不是等跑出坏结果再回头查。
 *
 * 用法：npm run test:engine   （失败会以非零码退出）
 */

import { CIPAI, isGeneratable, getCipai } from '../shared/cipai.js'
import { compose, recomposeLine, toPlainText, rhymeFeasibility, CONFUSABLE } from '../shared/engine.js'
import { BU_BY_ID, RHYME_BU, RHYME_ISSUES, rhymeTailStats } from '../shared/rhyme.js'

const PROMPTS = [
  ['huanxisha', '秋夜独坐，思念远方故人，檐下听雨，灯影摇摇'],
  ['rumengling', '春暮，落花满地，海棠被昨夜的雨打残了'],
  ['shuidiaogetou', '中秋望月，想家，也想这一路的奔波'],
  ['yumeiren', '故地重游，旧时楼台还在，人已经不在了'],
  ['xiangjianhuan', '无言独坐，离别之后说不出口的那些话'],
  ['dianjiangchun', '深秋的黄昏，一个人登楼远望，江水东流'],
  ['pusaman', '塞外行军途中，夜里听见笛声，想起故乡'],
  ['yijiangnan', '江南春雨，杏花开时想起故乡的小河'],
  ['zhegutian', '与故人重逢，喝酒叙旧，说起当年的豪情'],
  ['dielianhua', '深秋的黄昏，一个人登楼远望，江水东流']
]

const SEEDS_PER_PROMPT = 12

let pass = 0
let fail = 0
const problems = []

function check(name, cond, detail = '') {
  if (cond) {
    pass++
  } else {
    fail++
    problems.push(`${name}${detail ? '  ← ' + detail : ''}`)
  }
}

/**
 * 单首词的完整体检
 * @returns {string[]} 问题清单（空数组 = 合格）
 */
function audit(poem, cipai) {
  const bad = []
  const total = poem.lines.reduce((a, l) => a + l.text.length, 0)
  if (total !== cipai.syllables) bad.push(`总字数 ${total}≠${cipai.syllables}`)

  for (const l of poem.lines) {
    if (!l.text) bad.push(`第 ${l.index + 1} 句为空`)
    else if (l.text.length !== l.pattern.length) {
      bad.push(`第 ${l.index + 1} 句字数 ${l.text.length}≠${l.pattern.length}`)
    }
    if (l.verdict === '破格') bad.push(`第 ${l.index + 1} 句破格：${l.text}`)
  }

  // 韵脚必须在本部字表内
  for (const r of poem.rhyme) {
    const bu = BU_BY_ID[r.buId]
    if (!bu) {
      bad.push(`韵部 ${r.buId} 不存在`)
      continue
    }
    for (const ch of r.chars) {
      if (!bu.chars.includes(ch)) bad.push(`韵脚「${ch}」不在 ${bu.name} 内`)
    }
  }

  // 重韵：按韵组分别判，叠句豁免
  const byGroup = new Map()
  for (const l of poem.lines) {
    if (!l.rhyme) continue
    const key = String(l.rhymeGroup)
    if (!byGroup.has(key)) byGroup.set(key, [])
    byGroup.get(key).push(l)
  }
  for (const [, lines] of byGroup) {
    const seen = new Set()
    const chars = []
    for (const l of lines) {
      const ch = [...l.text].pop()
      if (l.duplicated) continue // 词牌写明的叠句，重复是对的
      if (seen.has(ch)) bad.push(`韵组 ${l.rhymeGroup} 重韵：「${ch}」`)
      seen.add(ch)
      chars.push(ch)
    }
    // 形近字并押：字理上不是重韵，但读者会当成重韵，观感更差
    for (const g of CONFUSABLE) {
      const hit = g.filter((c) => chars.includes(c))
      if (hit.length > 1) bad.push(`韵组 ${lines[0].rhymeGroup} 形近字并押：「${hit.join('」「')}」`)
    }
  }

  // 全篇同字堆叠（词牌自己写明的叠句照抄一遍，不算堆叠）
  const count = new Map()
  for (const l of poem.lines) {
    if (l.duplicated) continue
    for (const ch of l.text) count.set(ch, (count.get(ch) || 0) + 1)
  }
  for (const [ch, n] of count) {
    if (n >= 5) bad.push(`字「${ch}」重复 ${n} 次`)
  }

  return bad
}

console.log('\n  倚声 · 填词引擎回归自测')
console.log('  ══════════════════════════════════════════\n')

// ── ① 词牌结构自洽 ─────────────────────────────────────────
console.log('  ① 词牌结构')
for (const c of CIPAI) {
  const gen = isGeneratable(c)
  if (!gen) continue
  const sum = c.lines.reduce((a, l) => a + l.p.length, 0)
  const rhymeCount = c.lines.filter((l) => l.r).length
  check(
    `《${c.name}》谱面自洽（${c.syllables}字 / ${c.lines.length}句 / ${rhymeCount}韵脚）`,
    sum === c.syllables,
    `谱面合计 ${sum} 字，声明 ${c.syllables} 字`
  )
  check(
    `《${c.name}》每句都标注了节奏`,
    c.lines.every((l) => !!l.rhythm),
    c.lines.filter((l) => !l.rhythm).map((l) => l.p).join(' ')
  )
  check(
    `《${c.name}》韵组声明与韵脚句一致`,
    (() => {
      const groups = new Set(c.lines.filter((l) => l.r).map((l) => String(l.r)))
      const declared = new Set(c.rhymeGroups.map((g) => String(g.key)))
      if (groups.size !== declared.size) return false
      for (const g of groups) if (!declared.has(g)) return false
      return true
    })()
  )
}
console.log(`     ${CIPAI.filter(isGeneratable).length} 个可填词词牌，已逐个核对\n`)

// ── ①b 韵书数据体检 ────────────────────────────────────────
console.log('  ①b 韵书数据（重韵的根源在这一层）')
{
  // 被规范化流程丢弃的条目必须为 0：每一条都该有归宿，否则韵脚池会静默变小
  const dropped = RHYME_ISSUES.filter((x) => !x.moved)
  check(
    `韵脚库无「无家可归」的条目（${RHYME_ISSUES.length} 条修正记录）`,
    dropped.length === 0,
    dropped.map((x) => `${x.bu}「${x.word}」`).join('、')
  )
}
{
  const stats = rhymeTailStats()
  const thin = stats.filter((s) => s.totalDistinct < 12)
  check(
    `每个韵部都有足够宽的韵脚字（最窄 ${Math.min(...stats.map((s) => s.totalDistinct))} 字）`,
    thin.length === 0,
    thin.map((s) => `${s.short} 仅 ${s.totalDistinct} 字`).join('、')
  )
  // 形状分布：某一部如果只有一个字长的韵脚，换韵词牌就会无解
  const noShort = stats.filter((s) => !s.per['2'] || s.per['2'].distinct < 4)
  check(
    '每个韵部都有二字韵脚（短句收尾才不至于无解）',
    noShort.length === 0,
    noShort.map((s) => s.short).join('、')
  )
  const noLong = stats.filter((s) => !s.per['3'] || s.per['3'].distinct < 4)
  check(
    '每个韵部都有三字韵脚（七言句尾才不会无解）',
    noLong.length === 0,
    noLong.map((s) => s.short).join('、')
  )
  console.log(
    `     韵脚字规模：${stats.map((s) => s.short + ' ' + s.totalDistinct).join(' · ')}`
  )
  console.log(
    `     单部三字韵脚形状：${stats
      .slice(0, 3)
      .map((s) => s.short + ' ' + Object.keys(s.per).map((k) => `${k}字×${s.per[k].entries}`).join('/'))
      .join(' · ')}`
  )
}
console.log('')

// ── ①c 容量体检：哪些韵部真的撑得住 ────────────────────────
console.log('  ①c 韵部容量（每一句都要拿到一个不重复的韵脚字）')
{
  let weakest = 99
  const bad = []
  for (const c of CIPAI) {
    if (!isGeneratable(c)) continue
    for (const g of rhymeFeasibility(c.id)) {
      const pool = RHYME_BU.filter((b) => b.tone === g.type)
      weakest = Math.min(weakest, g.feasible.length)
      if (g.feasible.length < pool.length) {
        bad.push(
          `《${c.name}》韵组 ${g.key} 只有 ${g.feasible.length}/${pool.length} 个韵部可用（缺 ${pool
            .filter((b) => !g.feasible.includes(b.id))
            .map((b) => b.short)
            .join('/')}）`
        )
      }
    }
  }
  check(
    '每个词牌在它需要的声调下，所有韵部都能撑住（最窄处仍有余量）',
    bad.length === 0,
    bad.slice(0, 4).join('；')
  )
  console.log(`     最窄的词牌-韵组组合，可用韵部数 = ${weakest}`)
}
console.log('')

// ── ② 批量生成 ────────────────────────────────────────────
console.log(`  ② 交叉批量生成（每个词牌 × 全部 ${PROMPTS.length} 种意境 × ${SEEDS_PER_PROMPT} 个种子）`)
for (const [id] of PROMPTS) {
  const cipai = getCipai(id)
  const issues = []
  const texts = new Set()
  const rhymeSets = new Set()
  let maxRepeatChar = 0
  let unplanned = 0
  let runs = 0
  for (const [, prompt] of PROMPTS) {
    for (let k = 0; k < SEEDS_PER_PROMPT; k++) {
      const seed = 1000 + k * 7919
      const poem = compose({ cipaiId: id, prompt, seed })
      runs++
      const bad = audit(poem, cipai)
      if (bad.length && issues.length < 4) issues.push(`「${prompt.slice(0, 6)}…」seed=${seed} ${bad.join('；')}`)
      if (!poem.rhymePlanOk) unplanned++
      texts.add(poem.lines.map((l) => l.text).join(''))
      rhymeSets.add(poem.rhyme.map((r) => r.chars.join('')).join('|'))
      const cnt = new Map()
      for (const ch of poem.lines.map((l) => l.text).join('')) cnt.set(ch, (cnt.get(ch) || 0) + 1)
      maxRepeatChar = Math.max(maxRepeatChar, ...cnt.values())
    }
  }
  check(`《${cipai.name}》${runs} 次全部合律、无重韵、无空句`, issues.length === 0, issues.join(' ｜ '))
  check(`《${cipai.name}》每次都能完成韵脚编排（无降级）`, unplanned === 0, `${unplanned}/${runs} 次降级`)
  check(`《${cipai.name}》生成结果有变化（${texts.size} 种）`, texts.size > runs * 0.3, `只有 ${texts.size} 种`)
  // 「换整首」时韵脚也要换——若韵脚组合恒定，读者会觉得没换
  check(`《${cipai.name}》韵脚随种子变化（${rhymeSets.size} 组）`, rhymeSets.size >= Math.min(8, runs), `只有 ${rhymeSets.size} 组`)
  check(`《${cipai.name}》用字不密集重复（单字最多 ${maxRepeatChar} 次）`, maxRepeatChar <= 5)
}
console.log('')

// ── ③ 换一句：不能把韵换飞 ─────────────────────────────────
console.log('  ③ 换一句（守住韵部与重韵）')
for (const [id, prompt] of PROMPTS) {
  const cipai = getCipai(id)
  const base = compose({ cipaiId: id, prompt, seed: 424242 })
  const idx = cipai.lines.findIndex((l) => l.r)
  if (idx < 0) continue
  const bu = base.lines[idx].buId
  const others = base.lines.filter((l, i) => l.rhyme && i !== idx).map((l) => [...l.text].pop())

  let driftCount = 0
  let dupCount = 0
  for (let k = 0; k < 20; k++) {
    const nl = recomposeLine({
      cipaiId: id,
      lineIndex: idx,
      prompt,
      avoid: [base.lines[idx].text],
      buId: bu,
      rhymeChars: others,
      seed: 7000 + k * 104729
    })
    if (nl.buId !== bu) driftCount++
    const ch = [...nl.text].pop()
    if (others.includes(ch)) dupCount++
    if (nl.text.length !== base.lines[idx].pattern.length) dupCount++
    if (nl.verdict === '破格') driftCount++
  }
  check(`《${cipai.name}》换一句不换韵部、不出破格`, driftCount === 0, `${driftCount}/20 次跑偏`)
  check(`《${cipai.name}》换一句不与其它韵脚撞字`, dupCount === 0, `${dupCount}/20 次撞字`)
}
console.log('')

// ── ④ 人为篡改会怎样 ──────────────────────────────────────
console.log('  ④ 反向验证（确认体检项真的能抓到问题）')
const good = compose({ cipaiId: 'huanxisha', prompt: PROMPTS[0][1], seed: 20261013 })
check('合格词作：audit 返回空', audit(good, getCipai('huanxisha')).length === 0)

const tampered = JSON.parse(JSON.stringify(good))
tampered.lines[0].text = tampered.lines[0].text.slice(0, -1)
check('篡改：少一个字能被抓到', audit(tampered, getCipai('huanxisha')).some((x) => x.includes('字数')))
check('篡改：总字数不符能被抓到', audit(tampered, getCipai('huanxisha')).some((x) => x.includes('总字数')))

const dup = JSON.parse(JSON.stringify(good))
const firstRhyme = dup.lines.find((l) => l.rhyme).text.slice(-1)
const secondRhyme = dup.lines.filter((l) => l.rhyme)[1]
secondRhyme.text = secondRhyme.text.slice(0, -1) + firstRhyme
check('篡改：重韵能被抓到', audit(dup, getCipai('huanxisha')).some((x) => x.includes('重韵')))

const off = JSON.parse(JSON.stringify(good))
off.lines[0].verdict = '破格'
check('篡改：破格能被抓到', audit(off, getCipai('huanxisha')).some((x) => x.includes('破格')))
console.log('')

// ── ⑤ 样例输出（给人看） ────────────────────────────────────
console.log('  ⑤ 样例（便于肉眼复核）\n')
for (const [id, prompt] of PROMPTS.slice(0, 3)) {
  const cipai = getCipai(id)
  const p = compose({ cipaiId: id, prompt, seed: 20261013 })
  const verdicts = p.lines.map((l) => l.verdict).join(' ')
  console.log(`  《${cipai.name}》  ${p.lines.reduce((a, l) => a + l.text.length, 0)}字  [${verdicts}]`)
  console.log(`    韵：${p.rhyme.map((r) => `${r.short}(${r.chars.join('')})`).join(' / ')}`)
  console.log(`    ${p.lines.map((l) => l.text).join(' / ')}\n`)
}
console.log('  ── 文本导出示例 ──')
console.log(
  toPlainText(compose({ cipaiId: 'huanxisha', prompt: PROMPTS[0][1], seed: 20261013 }))
    .split('\n')
    .map((s) => '  ' + s)
    .join('\n')
)

// ── 汇总 ──────────────────────────────────────────────────
console.log('\n  ══════════════════════════════════════════')
console.log(`  通过 ${pass} 项 · 失败 ${fail} 项`)
if (problems.length) {
  console.log('\n  失败明细：')
  for (const p of problems) console.log('   · ' + p)
}
console.log('')
process.exit(fail ? 1 : 0)
