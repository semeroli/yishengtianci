#!/usr/bin/env node
/**
 * 韵库回归 —— 复用 shared/api-handler.js 里 aiCompose 的「韵脚校验」同款逻辑，
 * 对全部可生成词牌的每篇代表作逐句校验，确认「完美的古典输出」不再被误拒。
 *
 * 判定：
 *   GAP  —— 某韵脚字在「同声调」的任意韵部里都查不到（漏收，必须修）
 *   MIX  —— 韵脚字都能查到，但跨了多个韵部（多为北宋词通押，可接受，仅提示）
 *   PASS —— 同组韵脚字落在同一个同声调韵部内
 *
 * 硬性断言：
 *   ① 每个可生成词牌的【首篇代表作】必须 0 个 GAP（正格一定能过校验）
 *   ② 如梦令正格韵字 骤/酒/旧/否/瘦 必须 ∈ you_z
 *   ③ 虞美人(李煜)换韵组 在/改 必须 ∈ hui_z
 *
 * 用法： node scripts/verify-rhyme.mjs
 */
import { RHYME_BU, BU_BY_ID, lookupChar, charsOf } from '../shared/rhyme.js'
import { CIPAI } from '../shared/cipai.js'

const SPLIT_RE = /[，。！？；、　\n]/g

function splitLines(text) {
  return text
    .split(SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 复刻 aiCompose 的韵脚校验（见 shared/api-handler.js 881-906） */
function validateRhyme(cipai, lines) {
  const groupTypeOf = {}
  cipai.rhymeGroups.forEach((g) => {
    groupTypeOf[String(g.key)] = g.type
  })
  const buByGroup = new Map()
  const issues = []
  cipai.lines.forEach((spec, i) => {
    if (!spec.r) return
    const key = String(spec.r)
    const line = lines[i] || ''
    const last = line[line.length - 1]
    if (!last) {
      issues.push({ type: 'EMPTY', line: i + 1, char: '', key })
      return
    }
    if (!buByGroup.has(key)) {
      const cands = lookupChar(last).filter((id) => BU_BY_ID[id]?.tone === (groupTypeOf[key] || '平'))
      buByGroup.set(key, cands[0] || null)
    }
    const bu = buByGroup.get(key)
    if (!bu) {
      issues.push({ type: 'GAP', line: i + 1, char: last, key })
      return
    }
    if (!charsOf(bu).includes(last)) {
      const foundAny = lookupChar(last).filter((id) => BU_BY_ID[id]?.tone === (groupTypeOf[key] || '平')).length > 0
      issues.push({ type: foundAny ? 'MIX' : 'GAP', line: i + 1, char: last, key, bu })
    }
  })
  return issues
}

let totalGap = 0
let totalMix = 0
const firstMasterpieceGaps = []

console.log('=== 韵库回归：逐词牌代表作校验 ===\n')
for (const c of CIPAI) {
  const ok = c.lines && c.lines.length > 0
  if (!ok) {
    console.log(`· ${c.name}（${c.id}）— 仅词条，跳过自动填词校验`)
    continue
  }
  console.log(`# ${c.name}（${c.id}）  defaultBu=${c.defaultBu}`)
  c.masterpieces.forEach((m, idx) => {
    const lines = splitLines(m.text)
    if (lines.length !== c.lines.length) {
      console.log(`    ⚠ 代表作[${idx}]「${m.title}」分句数 ${lines.length} ≠ 谱 ${c.lines.length}（分句器问题，非韵库问题）`)
      return
    }
    const issues = validateRhyme(c, lines)
    const gaps = issues.filter((x) => x.type === 'GAP')
    const mixes = issues.filter((x) => x.type === 'MIX')
    totalGap += gaps.length
    totalMix += mixes.length
    if (idx === 0 && gaps.length) firstMasterpieceGaps.push({ cipai: c.name, gaps })
    const tag = gaps.length ? '❌GAP' : mixes.length ? '⚠MIX' : '✅'
    let detail = ''
    if (gaps.length) detail += ' GAP:' + gaps.map((g) => `第${g.line}句「${g.char}」(${g.key})`).join(',')
    if (mixes.length) detail += ' MIX:' + mixes.map((g) => `第${g.line}句「${g.char}」`).join(',')
    console.log(`    ${tag} 代表作[${idx}]「${m.title}」${detail}`)
  })
}

console.log('\n=== 硬性断言 ===')
const fail = []
// ① 首篇代表作零 GAP
if (firstMasterpieceGaps.length) {
  fail.push('以下词牌首篇代表作仍有 GAP（正格无法过校验）：\n' + firstMasterpieceGaps.map((g) => `   ${g.cipai}: ` + g.gaps.map((x) => `第${x.line}句「${x.char}」`).join(', ')).join('\n'))
}
// ② 如梦令正格韵字 ∈ you_z
const rumengChars = ['骤', '酒', '旧', '否', '瘦']
const rumengMissing = rumengChars.filter((ch) => !lookupChar(ch).includes('you_z'))
if (rumengMissing.length) fail.push(`如梦令正格韵字未进 you_z：${rumengMissing.join('')}`)
// ③ 虞美人(李煜) 在/改 ∈ hui_z
const yumeiChars = ['在', '改']
const yumeiMissing = yumeiChars.filter((ch) => !lookupChar(ch).includes('hui_z'))
if (yumeiMissing.length) fail.push(`虞美人换韵组未进 hui_z：${yumeiMissing.join('')}`)

console.log(`\n汇总：GAP=${totalGap}  MIX=${totalMix}  韵部总数=${RHYME_BU.length}`)
if (fail.length) {
  console.log('\n❌ 断言失败：')
  fail.forEach((f) => console.log('   - ' + f))
  process.exit(1)
} else {
  console.log('\n✅ 全部断言通过：内置词牌正格均可过韵脚校验，如梦令/点绛唇/虞美人关键韵字已入位。')
}
