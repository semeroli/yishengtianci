#!/usr/bin/env node
/**
 * 模型体检 —— 一次把「网络 / Key / 模型 / 参数」四类纠缠在一起的现象分清
 * ─────────────────────────────────────────────────────────────
 * 为什么要有这个脚本：接 AI 的项目里，「出不来词」这一个现象至少有四种原因 ——
 *   ① 没配 Key            ② Key 或地址不对
 *   ③ 模型选错（平台没有这个模型 / 这个模型不支持该参数）
 *   ④ 参数问题：**推理模型把 max_tokens 整段烧在思考上，正文一个字不吐**
 * 只看「失败了」永远定位不到是哪一类。这个脚本把候选模型挨个真机跑一遍，
 * 并且**同时跑「关思考」和「原样」两档做对照** —— ④ 类原因一眼就现形。
 *
 * 它用的 prompt 与判卷逻辑，都是从 shared/api-handler.js 直接 import 的
 * （buildAiPrompt / callUpstream / parseAiLines），
 * 也就是说：**它测的就是线上真正发出去的那份请求、真正用的那份解析**，
 * 不是脚本里另抄一份（抄一份必然慢慢跑偏，测了个寂寞）。
 *
 * 用法：
 *   node scripts/probe-models.mjs                  测默认候选（每个模型跑两档）
 *   node scripts/probe-models.mjs --fast           只跑「关思考」一档（省额度）
 *   node scripts/probe-models.mjs --conc=4         并发数（默认 3）
 *   node scripts/probe-models.mjs Qwen/Qwen3.8-Flash-Next deepseek-ai/DeepSeek-V4-Flash-0731
 *                                                  只测指定的模型
 *
 * Key 从 `.dev.vars` 或环境变量读（AI_API_KEY / AI_BASE_URL / AI_MODEL）。
 */

import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDevVars } from '../server/load-dev-vars.mjs'
import { getCipai } from '../shared/cipai.js'
import { checkLine } from '../shared/engine.js'
import { buildAiPrompt, callUpstream, parseAiLines } from '../shared/api-handler.js'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
loadDevVars(join(ROOT, '.dev.vars'))

/**
 * 默认候选：魔搭清单里「Flash / 轻量」一档为主 ——
 * 我们的目的不是挑最强的，而是挑**在 45 秒内稳定吐出一首合律小词**的。
 * 顺序即推荐顺序，第一项是项目当前默认值。
 */
const DEFAULT_CANDIDATES = [
  'Qwen/Qwen3.8-Flash-Next',
  'Qwen/Qwen3.8-27B',
  'deepseek-ai/DeepSeek-V4-Flash-0731',
  'ZhipuAI/GLM-4.7-Flash',
  'ZhipuAI/GLM-5.2',
  'stepfun-ai/Step-3.7-Flash',
  'Shanghai_AI_Laboratory/Intern-S2-Preview',
  'MiniMax/MiniMax-M3'
]

const argv = process.argv.slice(2)
const FAST = argv.includes('--fast')
const CONC = Math.max(1, Number((argv.find((a) => a.startsWith('--conc=')) || '').split('=')[1]) || 3)
const args = argv.filter((a) => !a.startsWith('--'))
const CANDIDATES = args.length ? args : DEFAULT_CANDIDATES

const API_KEY = (process.env.AI_API_KEY || '').trim()
const BASE_URL = (process.env.AI_BASE_URL || 'https://api-inference.modelscope.cn/v1').trim()
const TIMEOUT_MS = (process.env.AI_TIMEOUT_MS || '').trim() || '45000'

if (!API_KEY) {
  console.error('')
  console.error('  ✗ 没找到 AI_API_KEY。')
  console.error('')
  console.error('    办法一：把 Key 写进 .dev.vars（复制 .dev.vars.example 改一个）')
  console.error('            AI_API_KEY=你的魔搭访问令牌')
  console.error('    办法二：临时传进来')
  console.error('            AI_API_KEY=ms-xxxx node scripts/probe-models.mjs')
  console.error('')
  console.error('    魔搭访问令牌在这里拿：https://modelscope.cn → 右上头像 → 访问令牌')
  console.error('')
  process.exit(1)
}

// 体检用的真实词牌（浣溪沙，6 句 42 字，够短但结构完整，能暴露句数/字数/韵脚问题）
const CIPAI = getCipai('huanxisha')
const PROMPT = '秋夜独坐，思念远方故人'
const MESSAGES = [
  { role: 'system', content: '你是精通词律的中文古典诗词专家，只输出 JSON。' },
  { role: 'user', content: buildAiPrompt(CIPAI, PROMPT) }
]
const MAX_TOKENS = 1600

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 跑一档：noThink=true 是「关思考」，false 是「原样」对照 */
async function runOnce(model, noThink) {
  const env = {
    AI_API_KEY: API_KEY,
    AI_BASE_URL: BASE_URL,
    AI_MODEL: model,
    AI_DISABLE_THINKING: noThink ? '1' : '0',
    AI_TIMEOUT_MS: TIMEOUT_MS
  }
  const t0 = Date.now()
  try {
    const { text } = await callUpstream(env, MESSAGES, { maxTokens: MAX_TOKENS, noThink })
    const ms = Date.now() - t0
    const rawLen = text.length
    const arr = parseAiLines(text, CIPAI.lines.length)
    if (!arr) {
      return { ok: false, ms, rawLen, verdict: '正文不是规定的 JSON', text }
    }
    // 逐句核字数与硬平仄（与线上 aiCompose 同一套判据）
    let pass = 0
    const bad = []
    arr.forEach((line, i) => {
      const spec = CIPAI.lines[i]
      if (line.length !== spec.p.length) {
        bad.push(`第${i + 1}句字数 ${line.length}≠${spec.p.length}`)
        return
      }
      const chk = checkLine(spec.p, line)
      if (chk.hard > 0) {
        bad.push(`第${i + 1}句失律×${chk.hard}`)
        return
      }
      pass++
    })
    return {
      ok: true,
      ms,
      rawLen,
      pass,
      total: CIPAI.lines.length,
      bad,
      lines: arr,
      clean: bad.length === 0,
      text
    }
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, rawLen: 0, verdict: e?.message || String(e) }
  }
}

function fmtThink(r) {
  if (!r) return '（未测）'
  const s = `${(r.ms / 1000).toFixed(1)}s`
  if (!r.ok) return `❌ ${s} · ${r.verdict}`
  const tone = r.clean ? '✅' : '⚠️'
  const bad = r.bad.length ? `（${r.bad.slice(0, 2).join('；')}）` : ''
  return `${tone} ${s} · 正文 ${r.rawLen} 字 · 合律 ${r.pass}/${r.total}${bad}`
}

console.log('')
console.log('  倚声 · 模型体检')
console.log('  ' + '─'.repeat(64))
console.log(`  接口      ${BASE_URL}`)
console.log(`  Key       ${API_KEY.slice(0, 3)}…（${API_KEY.length} 字符）`)
console.log(`  超时      ${TIMEOUT_MS} ms     max_tokens  ${MAX_TOKENS}`)
console.log(`  试填      《${CIPAI.name}》${CIPAI.lines.length} 句 / ${CIPAI.lines.reduce((a, l) => a + l.p.length, 0)} 字 · 意境「${PROMPT}」`)
console.log(`  对照      ${FAST ? '已跳过（--fast）' : '每个模型跑「关思考 / 原样」两档'}`)
console.log('  ' + '─'.repeat(64))

const results = []
let cursor = 0
async function worker() {
  while (cursor < CANDIDATES.length) {
    const idx = cursor++
    const model = CANDIDATES[idx]
    const think = await runOnce(model, true)
    let raw = null
    if (!FAST && !think.clean) {
      // 只在「关思考没干净通过」时才跑对照，省一半额度又保留关键证据
      await sleep(600)
      raw = await runOnce(model, false)
    }
    results[idx] = { model, think, raw }
    const line = `  ${String(idx + 1).padStart(2)}. ${model}\n        关思考  ${fmtThink(think)}`
    console.log(line)
    if (raw) console.log(`        原  样  ${fmtThink(raw)}`)
  }
}
await Promise.all(Array.from({ length: Math.min(CONC, CANDIDATES.length) }, worker))

console.log('')
console.log('  ' + '─'.repeat(64))
console.log('  结论')
console.log('')

const good = results.filter((r) => r.think.ok && r.think.clean)
const usable = results.filter((r) => r.think.ok)

if (good.length) {
  console.log('  ✅ 关思考后「句数/字数/平仄」全过的模型（可直接用）：')
  good
    .slice()
    .sort((a, b) => a.think.ms - b.think.ms)
    .forEach((r, i) => {
      console.log(`     ${i + 1}) ${r.model}   ${(r.think.ms / 1000).toFixed(1)}s`)
    })
  const best = good.slice().sort((a, b) => a.think.ms - b.think.ms)[0]
  console.log('')
  console.log(`  👉 推荐写进配置的模型：${best.model}`)
  console.log('')
  console.log(`     它的试填（《${CIPAI.name}》）：`)
  best.think.lines.forEach((l, i) => console.log(`       ${i + 1}. ${l}`))
} else if (usable.length) {
  console.log('  ⚠️ 有模型能吐出 JSON，但平仄/字数没全过 —— 线上会回落本地引擎。')
  console.log('     可用的：' + usable.map((r) => r.model).join('、'))
  console.log('     建议换一档更大的模型，或把 AI_DISABLE_THINKING 确认为 1。')
} else {
  console.log('  ❌ 全部失败。按这个顺序排查：')
  console.log('     ① Key 对不对（魔搭「访问令牌」页面重新复制一次，注意别带上空格）')
  console.log('     ② 地址对不对（必须是 https://api-inference.modelscope.cn/v1）')
  console.log('     ③ 账号有没有开通「模型推理」服务、额度够不够')
  console.log('     ④ 把上面每行报错原文看完 —— 400 多是参数/模型名，401 是 Key，404 是模型不存在')
}

const anyRawFail = results.some((r) => r.raw && !r.raw.ok)
const anyRawDirty = results.some((r) => r.raw && r.raw.ok && !r.raw.clean)
if (anyRawFail || anyRawDirty) {
  console.log('')
  console.log('  🔎 对照档（原样、不关思考）的失败，正是「推理模型烧额度」的现场证据：')
  console.log('     它说明这类平台**必须**把 AI_DISABLE_THINKING 设为 1，否则正文一个字都出不来。')
}

console.log('')
process.exit(good.length ? 0 : 2)
