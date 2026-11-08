/**
 * AI 通道参数回归自测（**不需要网络、不需要 Key**）
 * ─────────────────────────────────────────────────────────────
 * 为什么单独写这一套：接魔搭这类平台的线上故障，绝大多数**不是业务代码错**，
 * 而是请求体里少了一个字段。最典型的两种：
 *   ① 没关思考 ⇒ 推理模型把 max_tokens 整段烧在思考上，正文一个字不吐；
 *   ② 关了思考、但平台不认这个字段 ⇒ 直接 400，整条 AI 通道全死。
 * 这两种在真机上表现为同一句话「出不来词」，排查一次要十几分钟。
 * 所以这里用**桩件替换 fetch** 把请求体逐字节验一遍 —— 毫秒级、零额度、
 * 而且能把「退让逻辑」这种只在极端分支里走到的路径真正跑到。
 *
 * 用法：npm run test:ai   （失败以非零码退出）
 */

import { buildAiPrompt, callUpstream, parseAiLines, judgeAiLines, AI_PROVIDERS, resolveProviders, hasAiUpstream } from '../shared/api-handler.js'
import { getCipai } from '../shared/cipai.js'
import { compose } from '../shared/engine.js'

let pass = 0
let fail = 0
const problems = []
function check(name, cond, extra = '') {
  if (cond) {
    pass++
  } else {
    fail++
    problems.push(name + (extra ? `（${extra}）` : ''))
  }
}

// ── 桩件：把 fetch 换掉，记录每次真正发出去的请求 ──────────────
let sent = []
let reply = () => okReply('{"lines":["测试"]}')
/** 命中就「只连不出字」——用来复现「上游悬死」那一类故障 */
let hangMatch = null

function okReply(content, extra = {}) {
  return new Response(
    JSON.stringify({
      // ⚠️ ...extra 必须展开在 message 里 —— 展开到 choices 一层的话
      // reasoning_content 就挂错了地方，被测代码读不到，会得到假结论。
      choices: [{ finish_reason: 'stop', message: { content, ...extra } }]
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

/** 永不回字，直到 signal 超时被中止 */
function hangUntilAbort(signal) {
  return new Promise((_, reject) => {
    const fail = (msg) => {
      const e = new Error(msg)
      e.name = 'AbortError'
      reject(e)
    }
    /* ⚠️ AbortSignal.timeout 的定时器是 unref 的，撑不住事件循环 ——
     * 只挂监听的话，Node 会以「unsettled top-level await」直接退出。
     * 所以这里必须自己留一个 ref 的兜底闹钟。 */
    const guard = setTimeout(() => fail('桩件保护：5 秒内没收到中止信号'), 5000)
    const onAbort = () => {
      clearTimeout(guard)
      fail('This operation was aborted')
    }
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort)
  })
}

globalThis.fetch = async (url, init) => {
  sent.push({ url, init, body: JSON.parse(init.body) })
  if (hangMatch && hangMatch(url)) return hangUntilAbort(init.signal)
  return reply(sent.length)
}

const ENV = {
  AI_API_KEY: 'test-key',
  AI_BASE_URL: 'https://api-inference.modelscope.cn/v1',
  AI_MODEL: 'Qwen/Qwen3.8-Flash-Next',
  AI_DISABLE_THINKING: '1',
  AI_TIMEOUT_MS: '45000'
}
const MSGS = [{ role: 'user', content: '试填一首' }]
const reset = () => {
  sent = []
  hangMatch = null
}

console.log('')
console.log('  AI 通道参数回归自测')
console.log('  ' + '─'.repeat(52))

// ── ① 关思考：两个字段都要发出去 ──────────────────────────────
reset()
await callUpstream(ENV, MSGS)
check('关思考时发出 enable_thinking=false', sent[0].body.enable_thinking === false)
check(
  '关思考时同时发出 chat_template_kwargs（双保险）',
  sent[0].body.chat_template_kwargs?.enable_thinking === false,
  JSON.stringify(sent[0].body.chat_template_kwargs)
)

// ── ② 不关思考时一个字段都不该带 ──────────────────────────────
reset()
await callUpstream({ ...ENV, AI_DISABLE_THINKING: '0' }, MSGS)
check('不关思考时不带 enable_thinking', !('enable_thinking' in sent[0].body))
check('不关思考时不带 chat_template_kwargs', !('chat_template_kwargs' in sent[0].body))

// ── ③ 平台不认该字段（400）⇒ 必须自动退让重发，而不是整条通道报废 ──
reset()
reply = (n) =>
  n === 1
    ? new Response(JSON.stringify({ error: { message: 'unknown field: enable_thinking' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    : okReply('{"lines":["退让后成功"]}')
const r3 = await callUpstream(ENV, MSGS)
check('400 时自动退让重发（共 2 次）', sent.length === 2, `实际 ${sent.length} 次`)
check('退让后不再带该字段', !('enable_thinking' in sent[1].body))
check('退让后拿到了正文', r3.text.includes('退让后成功'), r3.text)

// ── ④ 422 同样应退让 ─────────────────────────────────────────
reset()
reply = (n) => (n === 1 ? new Response('{}', { status: 422 }) : okReply('{"lines":["x"]}'))
await callUpstream(ENV, MSGS)
check('422 时同样退让', sent.length === 2, `实际 ${sent.length} 次`)

// ── ⑤ 但 500 这类服务端错误不该靠「去掉字段」掩盖 ────────────
reset()
reply = () => new Response('{}', { status: 500 })
let e5 = null
try {
  await callUpstream(ENV, MSGS)
} catch (e) {
  e5 = e
}
check('500 不重复发（只 1 次）', sent.length === 1, `实际 ${sent.length} 次`)
check('500 会抛出且标记可重试', e5?.status === 500 && e5?.retryable === true)
reply = () => okReply('{"lines":["测试"]}')

// ── ⑥ 空正文的三种成因，必须报得出来 ─────────────────────────
async function catchMsg(env, responder) {
  reset()
  reply = responder
  try {
    const r = await callUpstream(env, MSGS)
    return { text: r.text }
  } catch (e) {
    return { err: e.message }
  } finally {
    reply = () => okReply('{"lines":["测试"]}')
  }
}

const thinkBurn = await catchMsg({ ...ENV, AI_DISABLE_THINKING: '0' }, () =>
  okReply('', { reasoning_content: '想'.repeat(900) })
)
// 上面这条 finish=stop 且正文空 ⇒ 思考段顶替正文（正常收尾时的兜底）
check('正文空但思考段正常收尾 ⇒ 顶替正文', (thinkBurn.text || '').length === 900, JSON.stringify(thinkBurn).slice(0, 80))

const burned = await catchMsg({ ...ENV, AI_DISABLE_THINKING: '0' }, () =>
  new Response(
    JSON.stringify({
      choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: '想'.repeat(7557) } }]
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
)
check('额度被思考吃光 ⇒ 报错点明「思考」', /思考/.test(burned.err || ''), burned.err)
check('该报错给出解法（AI_DISABLE_THINKING）', /AI_DISABLE_THINKING/.test(burned.err || ''))
check('该报错带上 finish_reason', /finish_reason=length/.test(burned.err || ''))
check('不把 7557 字思绪当正文返回', !burned.text)

const trulyEmpty = await catchMsg(ENV, () => okReply(''))
check('纯空正文也会报错', !!trulyEmpty.err, JSON.stringify(trulyEmpty))

// ── ⑦ 请求本身的形状 ─────────────────────────────────────────
reset()
await callUpstream(ENV, MSGS, { maxTokens: 1600 })
check('地址拼成 {base}/chat/completions', sent[0].url === 'https://api-inference.modelscope.cn/v1/chat/completions', sent[0].url)
check('Authorization 带 Bearer', sent[0].init.headers.Authorization === 'Bearer test-key')
check('max_tokens 透传 1600', sent[0].body.max_tokens === 1600)
check('temperature 0.85', sent[0].body.temperature === 0.85)
check('带了超时 signal', !!sent[0].init.signal)
check('base 末尾斜杠会被去掉', (await (async () => {
  reset()
  await callUpstream({ ...ENV, AI_BASE_URL: 'https://x/v1///' }, MSGS)
  return sent[0].url
})()) === 'https://x/v1/chat/completions', sent[0]?.url)

// ── ⑧ 异常响应的判别 ─────────────────────────────────────────
const notJson = await catchMsg(ENV, () => new Response('<html>502</html>', { status: 200 }))
check('上游返回非 JSON ⇒ 明确报错', /不是 JSON/.test(notJson.err || ''), notJson.err)

const noChoices = await catchMsg(ENV, () => new Response('{"foo":1}', { status: 200 }))
check('响应缺 choices ⇒ 明确报错', /choices/.test(noChoices.err || ''), noChoices.err)

// ── ⑨ prompt 的关键约束（防回归：别把符号改回 ⊙、别去掉 JSON 格式要求）──
const cipai = getCipai('huanxisha')
const promptText = buildAiPrompt(cipai, '秋夜独坐')
check('prompt 用了全站统一的 ◐ 符号', promptText.includes('◐') && !promptText.includes('⊙'))
check('prompt 明确要求只输出 JSON', /只输出\s*JSON/.test(promptText), promptText.slice(-120))
check('prompt 带上句数（6 句）', promptText.includes('共 6 句'))
check('prompt 逐句标注字数', /第1句\(7字\)/.test(promptText), promptText.split('\n').find((l) => l.includes('第1句')))

// ── ⑩ parseAiLines 的容错（注意：正文里的非汉字一律被剥掉，所以用例得用汉字）──
check('剥掉 ```json 围栏', parseAiLines('```json\n{"lines":["第一句","第二句"]}\n```', 2)?.join() === '第一句,第二句')
check('前后夹解释文字也能取到 JSON', parseAiLines('好的：{"lines":["第一句","第二句"]} 以上', 2)?.join() === '第一句,第二句')
check('句数不符返回 null', parseAiLines('{"lines":["第一句"]}', 2) === null)
check('非汉字字符会被剥掉', parseAiLines('{"lines":["依，旧。"]}', 1)?.[0] === '依旧')
check('完全不是 JSON 时按换行退化', parseAiLines('第一句\n第二句', 2)?.join() === '第一句,第二句')
// 这条是「模型跑偏」的兜底说明：正文只留汉字，所以输出英文/拼音/火星文会被剥成空串，
// 之后句数或字数校验必然不过 ⇒ 线上回落本地引擎，而不是给用户一首乱码词。
check(
  '全英文正文会被剥成空串（所以必须出汉字）',
  parseAiLines('{"lines":["abc","def"]}', 2)?.every((x) => x === '') === true
)

// ── ⑪ 多上游链（商汤 / InferX / 魔搭，2026-11-08 加装）──────────────
// 这一段的重心不是「能调通」，而是「一家坏掉时链还能走完」。
// 带候选链的调度器最致命的 bug 是：主循环只在等一家，而那家
// 「连得上但永不出字」时，后面的候选一次都轮不到 —— 参数配得再好全是死代码。
const MULTI = {
  SENSENOVA_API_KEY: 'sn-test-key',
  INFERX_API_KEY: 'ix-test-key',
  AI_API_KEY: 'ms-test-key',
  AI_DISABLE_THINKING: '1',
  AI_TIMEOUT_MS: '300', // 单次尝试 300ms，测试才跑得快
  AI_TOTAL_BUDGET_MS: '3000'
}
const ids = (env) => resolveProviders(env).map((p) => p.id).join(',')

check('三个 Key 都在 ⇒ 默认顺序 商汤 → InferX → 魔搭', ids(MULTI) === 'sensenova,inferx,modelscope', ids(MULTI))
check('AI_CHAIN 能改顺序，没提到的接在末尾', ids({ ...MULTI, AI_CHAIN: 'inferx' }) === 'inferx,sensenova,modelscope', ids({ ...MULTI, AI_CHAIN: 'inferx' }))
check('只配了商汤 Key ⇒ 链里只有商汤', ids({ SENSENOVA_API_KEY: 'x' }) === 'sensenova', ids({ SENSENOVA_API_KEY: 'x' }))
check('密钥别名也认（SENSETIME_API_KEY）', resolveProviders({ SENSETIME_API_KEY: 'x' })[0]?.id === 'sensenova')
check('密钥别名也认（MODELSCOPE_API_KEY）', resolveProviders({ MODELSCOPE_API_KEY: 'x' })[0]?.id === 'modelscope')
check('一个 Key 都没有 ⇒ 链为空', resolveProviders({}).length === 0)
check('hasAiUpstream 判得对', hasAiUpstream(MULTI) === true && hasAiUpstream({}) === false)
check(
  '模型名与地址都能被环境变量覆盖（末尾斜杠会被去掉）',
  resolveProviders({ INFERX_API_KEY: 'x', INFERX_MODEL: 'm2', INFERX_BASE: 'https://a/v9///' })[0].model === 'm2' &&
    resolveProviders({ INFERX_API_KEY: 'x', INFERX_BASE: 'https://a/v9///' })[0].base === 'https://a/v9'
)

// ── 关思考按 dialect 发，不是一招通吃 ────────────────────────
reset()
await callUpstream(MULTI, MSGS, { provider: 'sensenova' })
check('商汤用 reasoning_effort:"none" 关思考', sent[0].body.reasoning_effort === 'none', JSON.stringify(sent[0].body))
check('商汤不会瞎发 enable_thinking（那是魔搭的字段）', !('enable_thinking' in sent[0].body))
reset()
await callUpstream(MULTI, MSGS, { provider: 'inferx' })
check('InferX 是纯文本上游 ⇒ 一个关思考字段都不发', !('enable_thinking' in sent[0].body) && !('reasoning_effort' in sent[0].body))
check('InferX 只发一次（不为一个不存在的开关白烧额度）', sent.length === 1, `实际 ${sent.length} 次`)
reset()
await callUpstream(MULTI, MSGS, { provider: 'modelscope' })
check(
  '魔搭仍发 enable_thinking 双保险',
  sent[0].body.enable_thinking === false && sent[0].body.chat_template_kwargs?.enable_thinking === false
)

// ── 商汤两套入口：Key 串区就是 401，必须自动换另一套 ──────────
reset()
reply = (n) => (n === 1 ? new Response('{"error":{"message":"Authorization Not Found"}}', { status: 401 }) : okReply('收到'))
const baseSwap = await callUpstream(MULTI, MSGS, { provider: 'sensenova' })
check('商汤第一套入口 401 ⇒ 自动换 sensecore 入口', sent.length === 2 && sent[1].url.includes('compatible-mode/v2'), sent.map((s) => s.url).join(' → '))
check('换入口后拿到了内容', baseSwap.text.includes('收到'), baseSwap.text)
reply = () => okReply('{"lines":["测试"]}')

// ── 🔴🔴 最关键：第一家「连得上但永不出字」时，必须走到第二家 ──
reset()
hangMatch = (url) => url.includes('token.sensenova.cn')
const tHang = Date.now()
const afterHang = await callUpstream(MULTI, MSGS)
const hangMs = Date.now() - tHang
check('第一家悬死 ⇒ 超时后自动换下一家', sent.length === 2 && sent[1].url.includes('inferx'), sent.map((s) => s.url).join(' → '))
check('悬死判定真的执行了（没有一直干等）', hangMs < 2000, `${hangMs}ms`)
check('换到第二家后拿到了内容', afterHang.text.includes('测试') && afterHang.provider === 'inferx', JSON.stringify(afterHang).slice(0, 90))

// ── 401 不值得在同一家死等，但链要继续走 ─────────────────────
reset()
reply = () => new Response('{"error":{"message":"bad key"}}', { status: 401 })
let e401 = null
try {
  await callUpstream(MULTI, MSGS)
} catch (e) {
  e401 = e
}
check('401 会把整条链走完（三家都试过）', sent.length >= 4, `实际 ${sent.length} 次`)
check(
  '全灭时报错点名每一家',
  /商汤日日新/.test(e401?.message || '') && /InferX/.test(e401?.message || '') && /魔搭/.test(e401?.message || ''),
  e401?.message
)
reply = () => okReply('{"lines":["测试"]}')

// ── 判卷函数：本地引擎出的词，自己必须也能过 ──────────────────
// 否则会出现「AI 拒掉一首本来合格的好词」这种自相矛盾的回落。
const huanxisha = getCipai('huanxisha')
const goodPoem = compose({ cipaiId: 'huanxisha', prompt: '秋夜独坐', seed: 20261108 })
const goodText = goodPoem.lines.map((l) => l.text)
check('引擎产出的词能通过 AI 判卷（两处判据一致）', judgeAiLines(huanxisha, goodText).length === 0, JSON.stringify(judgeAiLines(huanxisha, goodText)))
check('字数不符会被判出问题', judgeAiLines(huanxisha, goodText.map((t, i) => (i === 0 ? t + '多' : t))).length > 0)
check(
  'AI_PROVIDERS 里每一家的必需字段都齐（id/label/bases/model/keyEnv）',
  AI_PROVIDERS.every((p) => p.id && p.label && p.bases?.length && p.model && p.keyEnv?.length)
)

// ── 汇总 ─────────────────────────────────────────────────────
console.log('')
console.log('  ══════════════════════════════════════════')
console.log(`  通过 ${pass} 项 · 失败 ${fail} 项`)
if (problems.length) {
  console.log('')
  console.log('  失败明细：')
  for (const p of problems) console.log('   · ' + p)
}
console.log('')
process.exit(fail ? 1 : 0)
