/**
 * 后台真机渲染扫描（回归闸门）
 * ─────────────────────────────────────────────────────────────
 * 为什么需要它：`vite build` 只证明「能编译」，不能证明「跑起来不白屏」。
 * 本项目就吃过一次亏 —— 路由守卫把 /admin/login 也当成需要登录的页面，
 * 未登录时无限重定向，登录页根本打不开；build 全绿，测试全绿，
 * 只有真的用浏览器打开才发现。所以改完后台 UI 一定要跑这个。
 *
 * 它做三件事：
 *   ① 抓控制台 error / warning 与网络非 2xx
 *   ② 截图（默认存 _shots/）
 *   ③ 取关键 DOM 文字，确认页面**真的渲染出来了**（不是白屏、也不是被踢回登录页）
 *
 * 用法：
 *   npm run dev                # 先起开发服务器（另开一个终端）
 *   npm run shots:admin
 *
 * 可用环境变量覆盖：
 *   YS_BASE   站点地址（默认 http://127.0.0.1:5173）
 *   YS_CHROME Chrome 可执行文件路径
 *   YS_USER / YS_PWD  管理员账号（默认 admin / yisheng2026）
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const BASE = process.env.YS_BASE || 'http://127.0.0.1:5173'
const PORT = 9300 + Math.floor(Math.random() * 500) // 随机端口，避开上次残留的僵尸进程
const OUT = process.env.YS_OUT || '_shots'
const PROFILE = join(tmpdir(), 'ys-cdp-profile-' + Date.now())
const USER = process.env.YS_USER || 'admin'
const PWD = process.env.YS_PWD || 'yisheng2026'

// ── 找 Chrome ────────────────────────────────────────────
const CANDIDATES = [
  process.env.YS_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean)
const CHROME = CANDIDATES.find((p) => existsSync(p))
if (!CHROME) {
  console.error('找不到 Chrome，请用 YS_CHROME 指定路径。试过：\n  ' + CANDIDATES.join('\n  '))
  process.exit(2)
}

// 令牌存在哪个 localStorage 键里，直接从 api.js 读出来 —— 不写死，
// 否则哪天前端改了键名，这里会静默地截一堆登录页，还以为页面坏了。
const TOKEN_KEY = (readFileSync('src/api.js', 'utf8').match(/TOKEN_KEY\s*=\s*['"]([^'"]+)['"]/) || [])[1]
if (!TOKEN_KEY) {
  console.error('没能从 src/api.js 里读出 TOKEN_KEY')
  process.exit(2)
}

mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 登录拿令牌 ───────────────────────────────────────────
let token = ''
try {
  const r = await fetch(BASE + '/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PWD })
  })
  const j = await r.json()
  token = j?.data?.token || ''
} catch (e) {
  console.error('连不上 ' + BASE + '（开发服务器起了吗？）：' + e.message)
  process.exit(2)
}
if (!token) {
  console.error('登录失败，无法截图。账号 ' + USER + ' 对不对？')
  process.exit(2)
}
console.log('✓ 已取得令牌')

// ── 起 Chrome ───────────────────────────────────────────
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  // 关掉后台标签页节流：/json/new 建出来的页不是前台页，
  // 不关的话渲染进程会被冻结，Runtime.evaluate 会永久挂住直到超时。
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-background-timer-throttling',
  '--disable-features=CalculateNativeWinOcclusion',
  'about:blank'
], { stdio: 'ignore' })

let version = null
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
    if (r.ok) { version = await r.json(); break }
  } catch {}
  await sleep(300)
}
if (!version) {
  console.error('Chrome 没起来（端口 ' + PORT + '）')
  chrome.kill()
  process.exit(2)
}
console.log('✓ ' + version.Browser)

/** 开一个标签页 → 接 CDP → 交给回调用 → 关掉。一页一个标签页，不反复导航。 */
async function withTab(url, fn, { settle = 2000 } = {}) {
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json()
  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

  let seq = 0
  const waiting = new Map()
  const logs = []
  const netFails = []

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && waiting.has(msg.id)) {
      const { res, rej } = waiting.get(msg.id)
      waiting.delete(msg.id)
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)
      return
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const t = msg.params.type
      if (t === 'error' || t === 'warning') {
        logs.push({ kind: t, text: (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 200) })
      }
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      logs.push({ kind: 'exception', text: (d.exception?.description || d.text || '').slice(0, 200) })
    }
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry
      if (e.level === 'error' || e.level === 'warning') logs.push({ kind: 'log:' + e.level, text: (e.text || '').slice(0, 200) })
    }
    if (msg.method === 'Network.responseReceived') {
      const { status, url: u } = msg.params.response
      if (status >= 400) netFails.push({ status, url: u })
    }
  }

  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      waiting.set(id, { res, rej })
      ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); rej(new Error('timeout ' + method)) } }, 20000)
    })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Network.enable')
  try { await send('Page.bringToFront') } catch {}
  await sleep(settle)

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval error')
    return r.result?.value
  }

  try {
    return await fn({ send, evaluate, logs, netFails })
  } finally {
    ws.close()
    try { await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`) } catch {}
  }
}

// ── 注入令牌 ─────────────────────────────────────────────
await withTab(BASE + '/', async ({ evaluate }) => {
  const ok = await evaluate(`(()=>{ try{ localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, ${JSON.stringify(token)}); return localStorage.getItem(${JSON.stringify(TOKEN_KEY)}) ? 'ok':'fail' }catch(e){ return 'err:'+e.message } })()`)
  if (ok !== 'ok') throw new Error('localStorage 注入失败 —— 后面截的都是登录页，中止')
  console.log(`✓ 令牌写入 localStorage[${TOKEN_KEY}]`)
}, { settle: 1500 })

// ── 页面清单 ─────────────────────────────────────────────
const PAGES = [
  { path: '/admin/dashboard', file: '01-dashboard.png', w: 1440, h: 1000 },
  { path: '/admin/posts', file: '02-posts.png', w: 1440, h: 1000 },
  { path: '/admin/posts/edit/new', file: '03-editor.png', w: 1600, h: 1000 },
  { path: '/admin/comments', file: '04-comments.png', w: 1440, h: 900 },
  { path: '/admin/categories', file: '05-categories.png', w: 1440, h: 900 },
  { path: '/admin/media', file: '06-media.png', w: 1440, h: 900 },
  { path: '/admin/settings', file: '07-settings.png', w: 1440, h: 1000 },
  { path: '/admin/settings', file: '07b-settings-admin.png', w: 1440, h: 1100, click: '管理员设置' },
  { path: '/admin/settings', file: '07c-settings-api.png', w: 1440, h: 1000, click: 'API 设置' },
  { path: '/admin/settings', file: '07d-settings-about.png', w: 1440, h: 1000, click: '关于页面' },
  { path: '/admin/login', file: '08-login.png', w: 1440, h: 900 },
  { path: '/admin/definitely-missing', file: '09-404.png', w: 1440, h: 900 },
  { path: '/admin/posts', file: '10-mobile-posts.png', w: 390, h: 844, mobile: true },
  { path: '/admin/dashboard', file: '11-mobile-dashboard.png', w: 390, h: 844, mobile: true },
  { path: '/admin/posts/edit/new', file: '12-mobile-editor.png', w: 390, h: 844, mobile: true }
]

// 哪些页面「内容短」是正常的（404 本来就一句话）
const SHORT_OK = new Set(['/admin/definitely-missing'])

const results = []
for (const p of PAGES) {
  await withTab(BASE + p.path, async ({ send, evaluate, logs, netFails }) => {
    if (p.mobile) {
      await send('Emulation.setDeviceMetricsOverride', { width: p.w, height: p.h, deviceScaleFactor: 2, mobile: true })
      await sleep(1200)
    } else {
      await send('Emulation.setDeviceMetricsOverride', { width: p.w, height: p.h, deviceScaleFactor: 1, mobile: false })
    }

    if (p.click) {
      const hit = await evaluate(`(() => {
        const want = ${JSON.stringify(p.click)}
        const el = [...document.querySelectorAll('.adm-tabs button, .adm-tabs a, .adm-tab, [role=tab], button')]
          .find((e) => (e.innerText || '').trim() === want)
        if (!el) return false
        el.click()
        return true
      })()`)
      if (!hit) console.log('       ⚠ 没找到要点的「' + p.click + '」，截出来还是默认 Tab')
      await sleep(1400)
    }

    const info = await evaluate(`(() => {
      const app = document.querySelector('#app')
      const txt = (app?.innerText || '').replace(/\\s+/g, ' ').trim()
      return {
        len: txt.length,
        head: txt.slice(0, 120),
        adm: !!document.querySelector('.adm-scope'),
        onLogin: !!document.querySelector('form input[type=password]') || /中台 · 仅限管理员|管理员登录/.test(txt),
        title: document.title,
        url: location.pathname
      }
    })()`)

    // 除登录页本身外，落到登录页 = 令牌没生效（被守卫踢回来了）
    if (info.onLogin && p.path !== '/admin/login') info.warn = '⚠ 落到了登录页（令牌没生效或被守卫踢回）'
    else if (info.len < 60 && !SHORT_OK.has(p.path)) info.warn = '⚠ 内容过少，疑似白屏'

    // ⚠️ 整页截图（captureBeyondViewport + 全高 clip）会把 position:fixed 的元素
    //    （底部 TabBar、浮动按钮）画在视口原本所在的位置，看起来像遮挡内容 —— 那是截图假象。
    //    移动端只截视口，所见即所得。
    const shotParams = p.mobile
      ? { format: 'png' }
      : {
          format: 'png',
          captureBeyondViewport: true,
          clip: await evaluate(`(()=>{const b=document.body;return {x:0,y:0,width:Math.max(b.scrollWidth,${p.w}),height:Math.min(Math.max(b.scrollHeight,${p.h}),4200),scale:1}})()`)
        }
    const shot = await send('Page.captureScreenshot', shotParams)
    writeFileSync(join(OUT, p.file), Buffer.from(shot.data, 'base64'))

    const uniqNets = [...new Map(netFails.map((f) => [f.status + f.url, f])).values()]
    results.push({ ...p, ...info, errs: logs, nets: uniqNets })

    console.log(
      (info.warn ? '✗' : '✓').padEnd(2),
      p.file.padEnd(24),
      String(info.len).padStart(5) + ' 字',
      (info.adm ? 'adm✓' : 'adm✗').padEnd(6),
      info.warn || info.head.slice(0, 62)
    )
    for (const l of logs) console.log('       ⚠', l.kind, l.text.slice(0, 120))
    for (const f of uniqNets) console.log('       ⚠ HTTP', f.status, f.url.replace(BASE, ''))
  })
}

// ── 汇总 ────────────────────────────────────────────────
const allErrs = results.flatMap((r) => r.errs.map((e) => ({ page: r.path, ...e })))
const allNets = [...new Map(results.flatMap((r) => r.nets.map((f) => ({ page: r.path, ...f }))).map((f) => [f.status + f.url, f])).values()]
const bad = results.filter((r) => r.warn)

console.log('\n══════════ 控制台问题 ══════════')
console.log(allErrs.length ? '' : '（无 error / warning）')
for (const l of allErrs) console.log(' ', l.kind.padEnd(13), l.page.padEnd(28), l.text.slice(0, 110))

console.log('\n══════════ 网络非 2xx ══════════')
console.log(allNets.length ? '' : '（无）')
for (const f of allNets) console.log(' ', String(f.status).padEnd(4), f.page.padEnd(28), f.url.replace(BASE, ''))

writeFileSync(join(OUT, 'report.json'), JSON.stringify({ results, errors: allErrs, netFails: allNets }, null, 2))

// ── 收尾 ────────────────────────────────────────────────
chrome.kill()
await sleep(400)
// 注意：**不要在这里删 Chrome profile**。本机删除会被改写成「进回收站」，
// 删几万文件的 profile 会 ETIMEDOUT 挂死（连 error.code 都是 undefined）。
// profile 在系统临时目录里，交给系统清理。

const failed = bad.length + allErrs.filter((e) => e.kind !== 'warning' && e.kind !== 'log:warning').length + allNets.length
console.log('\n' + (failed ? `❌ ${failed} 项需要注意` : '✅ 全部通过') + `　截图在 ${resolve(OUT)}`)
process.exit(failed ? 1 : 0)
