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
 * 2026-11-08 改成**逐家上游**体检（商汤 / InferX / 魔搭）。
 * 上游清单一律从 shared/api-handler.js 的 resolveProviders() 取 ——
 * prompt、判卷、超时、关思考的写法也全部 import 同一份，
 * 也就是说：**它测的就是线上真正发出去的那份请求、真正用的那份判卷**。
 * （抄一份必然慢慢跑偏，最后变成「本地全是绿的、线上全回落本地引擎」。）
 *
 * 用法：
 *   node scripts/probe-models.mjs                     逐家测各自的默认模型
 *   node scripts/probe-models.mjs --provider=inferx   只测某几家（逗号分隔）
 *   node scripts/probe-models.mjs --fast              只跑「关思考」一档（省额度）
 *   node scripts/probe-models.mjs sensenova:m1 inferx:m2
 *                                                     指定「家:模型」逐个试
 *   node scripts/probe-models.mjs m1 m2                不带家名的当作魔搭模型（老用法）
 *
 * Key 从 `.dev.vars` 或环境变量读：
 *   SENSENOVA_API_KEY / INFERX_API_KEY / AI_API_KEY
 */
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDevVars } from '../server/load-dev-vars.mjs'
import { getCipai } from '../shared/cipai.js'
import { buildAiPrompt, callUpstream, parseAiLines, judgeAiLines, resolveProviders } from '../shared/api-handler.js'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
loadDevVars(join(ROOT, '.dev.vars'))

const argv = process.argv.slice(2)
const FAST = argv.includes('--fast')
const CONC = Math.max(1, Number((argv.find((a) => a.startsWith('--conc=')) || '').split('=')[1]) || 3)
const ONLY = (argv.find((a) => a.startsWith('--provider=')) || '').split('=')[1] || ''
const args = argv.filter((a) => !a.startsWith('--'))

const ENV = { ...process.env, ...(ONLY ? { AI_CHAIN: ONLY } : {}) }
const PROVIDERS = resolveProviders(ENV, { only: ONLY })

if (!PROVIDERS.length) {
  console.error('')
  console.error('  ✗ 一个可用的上游都没有（三个 Key 都没找到）。')
  console.error('')
  console.error('    把 Key 写进 .dev.vars（复制 .dev.vars.example 改一个），或临时传进来：')
  console.error('      SENSENOVA_API_KEY=xxx node scripts/probe-models.mjs --provider=sensenova')
  console.error('      INFERX_API_KEY=xxx   node scripts/probe-models.mjs --provider=inferx')
  console.error('      AI_API_KEY=ms-xxxx   node scripts/probe-models.mjs --provider=modelscope')
  console.error('')
  console.error('    线上不靠这个脚本，直接看：GET /api/ai-status?deep=1（不消耗额度、不泄露 Key）')
  console.error('')
  process.exit(1)
}

/** 每个上游要试的模型：默认模型 + 命令行追加的 */
const targets = []
for (const p of PROVIDERS) {
  const extra = args.filter((a) => a.startsWith(p.id + ':')).map((a) => a.slice(p.id.length + 1))
  const models = [p.model, ...extra].filter((m, i, a) => a.indexOf(m) === i)
  for (const m of models) targets.push({ provider: p, model: m })
}
// 不带家名的模型参数，按魔搭的候选处理（保住老用法）
for (const m of args.filter((a) => !a.includes(':'))) {
  const ms = PROVIDERS.find((p) => p.id === 'modelscope')
  if (ms) targets.push({ provider: ms, model: m })
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
async function runOnce(provider, model, noThink) {
  /* 用「该家的模型环境变量」覆盖模型名，这样一条代码路径就能把任意模型喂进去，
   * 不必为此在 api-handler 里开一个只为脚本用的后门。 */
  const env = { ...ENV, ...(ONLY ? { AI_CHAIN: ONLY } : {}) }
  for (const name of provider.modelEnv) env[name] = model
  env.AI_DISABLE_THINKING = noThink ? '1' : '0'

  const t0 = Date.now()
  try {
    const { text, model: usedModel } = await callUpstream(env, MESSAGES, { maxTokens: MAX_TOKENS, noThink, provider: provider.id })
    const ms = Date.now() - t0
    const arr = parseAiLines(text, CIPAI.lines.length)
    if (!arr) return { ok: false, ms, rawLen: text.length, verdict: '正文不是规定的 JSON', text }
    const bad = judgeAiLines(CIPAI, arr)
    return {
      ok: true,
      ms,
      rawLen: text.length,
      pass: CIPAI.lines.length - bad.length,
      total: CIPAI.lines.length,
      bad,
      lines: arr,
      clean: bad.length === 0,
      model: usedModel,
      text
    }
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, rawLen: 0, verdict: e?.message || String(e) }
  }
}

function fmt(r) {
  if (!r) return '（未测）'
  const s = `${(r.ms / 1000).toFixed(1)}s`
  if (!r.ok) return `❌ ${s} · ${r.verdict}`
  const tone = r.clean ? '✅' : '⚠️'
  const bad = r.bad.length ? `（${r.bad.slice(0, 2).join('；')}）` : ''
  return `${tone} ${s} · 正文 ${r.rawLen} 字 · 合律 ${r.pass}/${r.total}${bad}`
}

console.log('')
console.log('  倚声 · 模型体检（逐家上游）')
console.log('  ' + '─'.repeat(64))
console.log('  上游链    ' + PROVIDERS.map((p) => `${p.label}（${p.id}）`).join(' → '))
for (const p of PROVIDERS) console.log(`            ${p.id.padEnd(10)} ${p.base}  ${p.model}  Key ${String(p.key).length} 字符`)
console.log(`  超时      ${ENV.AI_TIMEOUT_MS || '12000'} ms / 总预算 ${ENV.AI_TOTAL_BUDGET_MS || '27000'} ms    max_tokens ${MAX_TOKENS}`)
console.log(`  试填      《${CIPAI.name}》${CIPAI.lines.length} 句 / ${CIPAI.lines.reduce((a, l) => a + l.p.length, 0)} 字 · 意境「${PROMPT}」`)
console.log(`  对照      ${FAST ? '已跳过（--fast）' : '每个模型跑「关思考 / 原样」两档'}`)
console.log('  ' + '─'.repeat(64))

const results = []
let cursor = 0
async function worker() {
  while (cursor < targets.length) {
    const idx = cursor++
    const { provider, model } = targets[idx]
    const think = await runOnce(provider, model, true)
    let raw = null
    if (!FAST && !think.clean) {
      // 只在「关思考没干净通过」时才跑对照，省一半额度又保留关键证据
      await sleep(600)
      raw = await runOnce(provider, model, false)
    }
    results[idx] = { provider, model, think, raw }
    console.log(`  ${String(idx + 1).padStart(2)}. [${provider.id}] ${model}\n        关思考  ${fmt(think)}`)
    if (raw) console.log(`        原  样  ${fmt(raw)}`)
  }
}
await Promise.all(Array.from({ length: Math.min(CONC, targets.length) }, worker))

console.log('')
console.log('  ' + '─'.repeat(64))
console.log('  结论')
console.log('')

const good = results.filter((r) => r.think.ok && r.think.clean)
const usable = results.filter((r) => r.think.ok)

if (good.length) {
  console.log('  ✅ 关思考后「句数/字数/平仄/韵脚」全过的（可直接用）：')
  good
    .slice()
    .sort((a, b) => a.think.ms - b.think.ms)
    .forEach((r, i) => {
      console.log(`     ${i + 1}) [${r.provider.id}] ${r.model}   ${(r.think.ms / 1000).toFixed(1)}s`)
    })
  const bestByProvider = new Map()
  for (const r of good) {
    const cur = bestByProvider.get(r.provider.id)
    if (!cur || r.think.ms < cur.think.ms) bestByProvider.set(r.provider.id, r)
  }
  console.log('')
  console.log('  👉 建议每家的默认模型（按速度挑）：')
  for (const [id, r] of bestByProvider) console.log(`     ${id.padEnd(10)} ${r.model}   ${(r.think.ms / 1000).toFixed(1)}s`)
  const best = good.slice().sort((a, b) => a.think.ms - b.think.ms)[0]
  console.log('')
  console.log(`  👉 全链最快的一家：${best.provider.label}（${best.provider.id}）· ${best.model}`)
  console.log(`     它的试填（《${CIPAI.name}》）：`)
  best.think.lines.forEach((l, i) => console.log(`       ${i + 1}. ${l}`))
} else if (usable.length) {
  console.log('  ⚠️ 有模型能吐出 JSON，但平仄/字数/韵脚没全过 —— 线上会回落本地引擎。')
  console.log('     可用的：' + usable.map((r) => `${r.provider.id}/${r.model}`).join('、'))
  console.log('     建议换一档更大的模型，或确认 AI_DISABLE_THINKING 为 1。')
} else {
  console.log('  ❌ 全部失败。按这个顺序排查：')
  console.log('     ① Key 对不对（各家控制台重新复制一次，注意别带空格）')
  console.log('     ② 地址对不对（商汤两套入口 Key 不通用；InferX 有 /endpoints/v1 与 /v1 两种）')
  console.log('     ③ 账号有没有开通服务、额度够不够')
  console.log('     ④ 把上面每行报错原文看完 —— 400 多是参数/模型名，401 是 Key，404 是模型或路径不存在')
  console.log('     ⑤ 线上直接看 GET /api/ai-status?deep=1，比在本地猜快得多')
}

const anyRawDirty = results.some((r) => r.raw && (!r.raw.ok || !r.raw.clean))
if (anyRawDirty) {
  console.log('')
  console.log('  🔎 对照档（原样、不关思考）的失败，正是「推理模型烧额度」的现场证据：')
  console.log('     它说明这类平台**必须**把 AI_DISABLE_THINKING 设为 1，否则正文一个字都出不来。')
}

console.log('')
process.exit(good.length ? 0 : 2)
