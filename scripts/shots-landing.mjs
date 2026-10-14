/**
 * 落地页真机渲染扫描
 * ─────────────────────────────────────────────────────────────
 * 改完落地页 / 路由后跑这个。它不只看「有没有白屏」，还专门验四件事：
 *   ① 控制台有没有 error / warning，网络有没有非 2xx；
 *   ② **有没有横向溢出**（落地页大字号 + 药丸按钮最容易撑破窄屏）；
 *   ③ favicon 家族是否真的挂上了 `<link rel="icon">`；
 *   ④ 站在 `/` 时导航**不该**点亮任何一项（点亮了会让人以为已在工具页）。
 * 另外顺手确认 `/studio` 仍然是填词工作台（改路由最容易把老地址弄丢）。
 *
 * 用法：npm run dev（另开终端）→ npm run shots:landing
 *   YS_BASE=http://127.0.0.1:5199 node scripts/shots-landing.mjs   # 换端口
 *   YS_THEME=dark ...                                              # （本脚本自带深浅两套）
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const BASE = process.env.YS_BASE || 'http://127.0.0.1:5173'
const PORT = 9400 + Math.floor(Math.random() * 400)
const OUT = process.env.YS_OUT || '_shots-landing'
const PROFILE = join(tmpdir(), 'ys-landing-profile-' + Date.now())

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

const THEME_KEY = (readFileSync('src/stores/ui.js', 'utf8').match(/THEME_KEY\s*=\s*['"]([^'"]+)['"]/) || [])[1]
if (!THEME_KEY) {
  console.error('没能从 src/stores/ui.js 里读出 THEME_KEY，主题注入会失效，中止')
  process.exit(2)
}

mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-background-timer-throttling',
  '--disable-features=CalculateNativeWinOcclusion',
  '--force-color-profile=srgb',
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

async function withTab(url, fn, { settle = 2400 } = {}) {
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
        logs.push({ kind: t, text: (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 220) })
      }
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      logs.push({ kind: 'exception', text: (d.exception?.description || d.text || '').slice(0, 220) })
    }
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry
      if (e.level === 'error' || e.level === 'warning') logs.push({ kind: 'log:' + e.level, text: (e.text || '').slice(0, 220) })
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

/* ── 页面清单 ─────────────────────────────────────────────
 * 落地页四张（桌面/移动 × 浅/深）+ 工作台回归一张。
 * dark=true 的走「先访问一次写 localStorage[ys_theme]，再重载」——
 * 因为主题是模块加载时读的，只改 localStorage 不重载不生效。
 */
const PAGES = [
  { path: '/', file: '01-landing-desktop-light.png', w: 1440, h: 900 },
  { path: '/', file: '02-landing-desktop-dark.png', w: 1440, h: 900, dark: true },
  { path: '/', file: '03-landing-mobile-light.png', w: 390, h: 844, mobile: true },
  { path: '/', file: '04-landing-mobile-dark.png', w: 390, h: 844, mobile: true, dark: true },
  { path: '/studio', file: '05-studio-desktop-light.png', w: 1440, h: 900 }
]

const results = []
for (const p of PAGES) {
  if (p.dark) {
    // 先种主题，再重载 —— 主题在 store 模块初始化时读，不重载拿不到
    await withTab(BASE + '/', async ({ evaluate }) => {
      await evaluate(`localStorage.setItem(${JSON.stringify(THEME_KEY)}, 'dark')`)
    }, { settle: 1200 })
  } else {
    await withTab(BASE + '/', async ({ evaluate }) => {
      await evaluate(`localStorage.removeItem(${JSON.stringify(THEME_KEY)})`)
    }, { settle: 1000 })
  }

  await withTab(BASE + p.path, async ({ send, evaluate, logs, netFails }) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width: p.w,
      height: p.h,
      deviceScaleFactor: p.mobile ? 2 : 1,
      mobile: !!p.mobile
    })
    await sleep(1400)

    const info = await evaluate(`(() => {
      const de = document.documentElement
      const app = document.querySelector('#app')
      const txt = (app?.innerText || '').replace(/\\s+/g, ' ').trim()
      const icons = [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')]
        .map((l) => l.getAttribute('rel') + (l.getAttribute('type') ? ' [' + l.getAttribute('type') + ']' : '') + ' → ' + l.getAttribute('href'))
      const navOn = [...document.querySelectorAll('.nav-item.on')].map((e) => e.innerText.trim())
      const land = !!document.querySelector('.lp-hero')
      return {
        len: txt.length,
        head: txt.slice(0, 120),
        theme: de.getAttribute('data-theme'),
        overflow: de.scrollWidth - window.innerWidth,
        scrollW: de.scrollWidth,
        innerW: window.innerWidth,
        icons,
        navOn,
        land,
        hasH1: (document.querySelector('.lp-h1')?.innerText || '').replace(/\\s+/g,' ').trim(),
        docH: de.scrollHeight,
        title: document.title
      }
    })()`)

    const shotParams = p.mobile
      ? { format: 'png' }
      : {
          format: 'png',
          captureBeyondViewport: true,
          clip: await evaluate(`(()=>{const b=document.body;return {x:0,y:0,width:Math.max(b.scrollWidth,${p.w}),height:Math.min(Math.max(b.scrollHeight,${p.h}),7200),scale:1}})()`)
        }
    const shot = await send('Page.captureScreenshot', shotParams)
    writeFileSync(join(OUT, p.file), Buffer.from(shot.data, 'base64'))

    const uniqNets = [...new Map(netFails.map((f) => [f.status + f.url, f])).values()]
    results.push({ ...p, ...info, errs: logs, nets: uniqNets })

    const flags = []
    if (info.overflow > 1) flags.push('⚠ 横向溢出 ' + info.overflow + 'px')
    if (p.path === '/' && !info.land) flags.push('⚠ 没渲染出落地页（.lp-hero 不在）')
    if (p.path === '/' && info.navOn.length) flags.push('⚠ 首页却点亮了导航：' + info.navOn.join(','))
    if (p.path === '/studio' && info.land) flags.push('⚠ /studio 竟然渲染成落地页')
    if (info.len < 60) flags.push('⚠ 内容过少，疑似白屏')
    info.flags = flags

    console.log(
      (flags.length ? '✗' : '✓').padEnd(2),
      p.file.padEnd(30),
      (info.theme || '?').padEnd(6),
      String(info.len).padStart(5) + ' 字',
      '溢出 ' + String(info.overflow).padStart(4) + 'px',
      flags.join(' | ') || (info.hasH1 || info.head).slice(0, 52)
    )
    for (const l of logs) console.log('       ⚠', l.kind, l.text.slice(0, 140))
    for (const f of uniqNets) console.log('       ⚠ HTTP', f.status, f.url.replace(BASE, ''))
  })
}

/* ── favicon 家族体检（只跑一次，看浅色桌面那页即可） ── */
const iconPage = results.find((r) => r.file === '01-landing-desktop-light.png')
console.log('\n══════════ favicon / manifest ══════════')
for (const s of iconPage?.icons || []) console.log('  ' + s)
if (!iconPage?.icons?.some((s) => s.includes('favicon.ico'))) console.log('  ⚠ 缺 favicon.ico（导航站爬虫只找这个）')
if (!iconPage?.icons?.some((s) => s.includes('image/svg+xml'))) console.log('  ⚠ 缺 svg 图标')
if (!iconPage?.icons?.some((s) => s.includes('manifest'))) console.log('  ⚠ 缺 manifest')

/* ── favicon 真的能取到吗（对每档发一次真请求） ── */
console.log('\n══════════ 图标资源可达性 ══════════')
const iconUrls = ['/favicon.svg', '/favicon.ico', '/favicon-16.png', '/favicon-32.png', '/favicon-48.png', '/favicon-96.png', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/site.webmanifest']
let iconBad = 0
for (const u of iconUrls) {
  try {
    const r = await fetch(BASE + u)
    const ct = r.headers.get('content-type') || ''
    const n = (await r.arrayBuffer()).byteLength
    const bad = !r.ok || n < 100
    if (bad) iconBad++
    console.log('  ' + (bad ? '✗' : '✓'), u.padEnd(22), String(r.status).padEnd(4), ct.padEnd(28), n + 'B')
  } catch (e) {
    iconBad++
    console.log('  ✗', u, e.message)
  }
}

/* ── sitemap / robots 里有没有 /studio ──
 * ⚠️ 本地开发服务器只把 `/api/*` 交给 handler，所以 /sitemap.xml 与 /robots.txt
 *    （不带 /api 前缀）在 5173/5199 上会落到 Vite 的 SPA 兜底、返回 index.html。
 *    这是 **dev 与 prod 的已知差异**，不是 bug —— 生产上由 functions/sitemap.xml.js
 *    与 functions/robots.txt.js 接管这两个路径。所以这里验 /api/ 前缀那份，
 *    它和线上是同一段 handler 代码。
 */
console.log('\n══════════ sitemap / robots（走 /api 前缀，与线上同源代码） ══════════')
try {
  const sm = await (await fetch(BASE + '/api/sitemap.xml')).text()
  console.log('  sitemap 含 /studio ：', sm.includes('/studio') ? '✓' : '✗ 漏了（改版后工具页收不到收录）')
  console.log('  sitemap 含 /blog   ：', sm.includes('/blog') ? '✓' : '✗')
  const rb = await (await fetch(BASE + '/api/robots.txt')).text()
  console.log('  robots 含 sitemap  ：', /Sitemap:\s*\S+\/sitemap\.xml/.test(rb) ? '✓' : '✗')
} catch (e) {
  console.log('  ✗', e.message)
}

/* ── 汇总 ──────────────────────────────────────────────── */
const allErrs = results.flatMap((r) => r.errs.map((e) => ({ page: r.path, ...e })))
const allNets = [...new Map(results.flatMap((r) => r.nets.map((f) => ({ page: r.path, ...f }))).map((f) => [f.status + f.url, f])).values()]
const flagged = results.filter((r) => r.flags?.length)

console.log('\n══════════ 控制台问题 ══════════')
console.log(allErrs.length ? '' : '（无 error / warning）')
for (const l of allErrs) console.log(' ', l.kind.padEnd(13), l.page.padEnd(10), l.text.slice(0, 120))

console.log('\n══════════ 网络非 2xx ══════════')
console.log(allNets.length ? '' : '（无）')
for (const f of allNets) console.log(' ', String(f.status).padEnd(4), f.page.padEnd(10), f.url.replace(BASE, ''))

writeFileSync(join(OUT, 'report.json'), JSON.stringify({ results, errors: allErrs, netFails: allNets }, null, 2))

chrome.kill()
await sleep(400)

const hardErrs = allErrs.filter((e) => !e.kind.includes('warning'))
const failed = flagged.length + hardErrs.length + allNets.length + iconBad
console.log('\n' + (failed ? `❌ ${failed} 项需要注意` : '✅ 全部通过') + `　截图在 ${resolve(OUT)}`)
process.exit(failed ? 1 : 0)
