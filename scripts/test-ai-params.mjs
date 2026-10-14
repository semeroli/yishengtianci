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

import { buildAiPrompt, callUpstream, parseAiLines } from '../shared/api-handler.js'
import { getCipai } from '../shared/cipai.js'

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

globalThis.fetch = async (url, init) => {
  sent.push({ url, init, body: JSON.parse(init.body) })
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
const reset = () => (sent = [])

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
