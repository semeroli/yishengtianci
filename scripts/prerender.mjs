/**
 * 预渲染（Prerender）
 * ─────────────────────────────────────────────────────────────
 * 要解决的问题：本站是「单页应用」（SPA），服务器上的 index.html 里只有一个
 * 空壳 `<div id="app"></div>`，正文全靠浏览器执行 JS 才出现。
 *   · 谷歌能执行 JS，但排队，收录慢；
 *   · **百度基本不执行 JS** —— 爬到的是一个空页面，于是判定「无正文」不收录。
 * 预渲染就是：构建完之后，用 Chrome 真的把页面渲染一遍，把渲染结果（完整正文）
 * 存成静态 HTML，放回 `dist/<路由>/index.html`。爬虫不跑 JS 也能读到全文。
 *
 * 为什么不用 `vite build --ssr` + `createSSRApp`：
 *   那是官方路线，但要改编排入口、给每个组件加 SSR 兼容（本项目多处用到
 *   window / localStorage），改造成本高、且容易「本地能过线上报错」。
 *   这里的做法是「渲染完把 DOM 抄下来」，一个字都不用改业务代码，
 *   渲染出来的就是用户真正看到的那个页面。
 *
 * 为什么站点根地址要单独指定：
 *   预渲染时页面是从 127.0.0.1 打开的。canonical / og:url 现在由
 *   `src/utils/seo.js` 的 `SITE_ORIGIN` 统一给出（已经是绝对地址），
 *   所以这里这一项**主要是一道保险**：最后一步仍会把整串本地 origin 替换成
 *   规范域（默认 https://ystianci.de5.net，用 YS_ORIGIN 覆盖），
 *   万一将来哪个组件又用 location 拼了绝对地址，也不至于把 127.0.0.1 写进产物。
 *
 * ⚠️ 本站现在有**三个域名**同时能打开（ystianci.de5.net / ystianci.kdns.fr /
 *    yishengtianci.pages.dev）。规范域只能有一个，写在 `seo.js` 的 SITE_ORIGIN；
 *    这里的默认值与它保持一致，两处一起改。
 * ⚠️ 域名**实测过**，不要凭项目名去猜：项目在 wrangler.toml 里叫 yisheng，
 *    但 `yisheng.pages.dev` 是别人占着的（301 跳到 cctv.com）。
 *
 * 用法：
 *   npm run build && node scripts/prerender.mjs      （或直接 npm run prerender）
 *   YS_ORIGIN=https://你的域名 node scripts/prerender.mjs
 *   YS_API=https://ystianci.de5.net npm run prerender   # 连线上取真实文章
 *   node scripts/prerender.mjs --strict              渲染失败就算失败（默认只警告）
 *
 * 兜底原则：**任何一页渲染失败，都要把空壳 index.html 放回去。**
 *   因为 public/_redirects 已经改成「精确指向预渲染文件」，
 *   如果文件不在，那一页线上就是 404。宁可退回旧行为（空壳 + 前端渲染），
 *   也不能整个页面打不开。
 */
import { spawn } from 'node:child_process'
import { promises as fs, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startPreview } from './lib/preview-server.mjs'

/* ═══════════════ 参数 ═══════════════ */
const argv = process.argv.slice(2)
const STRICT = argv.includes('--strict')
const ORIGIN = (process.env.YS_ORIGIN || 'https://ystianci.de5.net').replace(/\/+$/, '')
const DIST = 'dist'
const DB_FILE = join('.data', 'yisheng.db')

/* ═══════════════ 要预渲染哪些页 ═══════════════
 * minText / marker 是**验收门槛**：渲染出来的正文少于这么多字、
 * 或者该出现的关键词没出现，就说明这一页没真正渲染出来（白屏/报错），
 * 此时不写文件、退回空壳，并在报告里标红。
 *
 * ⚠️ 产物放在 dist 根下的**同级 .html**（如 dist/blog.html），不放进子目录
 *    （不用 dist/blog/index.html）。原因在 public/_redirects：
 *    文章详情走 `/blog/*  → /index.html` 这条通配，而「/blog → /blog/index.html」
 *    的重写目标自己也会落进 `/blog/*` 的范围里 —— 一旦平台把重写目标再过一遍
 *    规则，预渲染好的正文就会被空壳顶掉。平铺之后两条规则不可能重叠。
 */
const ROUTES = [
  { path: '/', file: 'index.html', label: '落地页', marker: '写意境', minText: 600 },
  { path: '/studio', file: 'studio.html', label: '填词工作台', marker: '词牌', minText: 200 },
  { path: '/blog', file: 'blog.html', label: '填词博客', marker: '填词博客', minText: 120 },
  { path: '/rhyme', file: 'rhyme.html', label: '韵书速查', marker: '韵', minText: 150 },
  { path: '/about', file: 'about.html', label: '关于', marker: '倚声', minText: 150 },
  { path: '/favorites', file: 'favorites.html', label: '我的词笺', marker: '词笺', minText: 80 }
]

/** 404 页：随便造一个不存在的地址，让前端路由渲染出「未找到」那一页 */
const NOT_FOUND_PROBE = '/__prerender_probe_404__'

/* ═══════════════ Chrome 位置 ═══════════════ */
const CANDIDATES = [
  process.env.YS_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean)
const CHROME = CANDIDATES.find((p) => existsSync(p))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ═══════════════ 极简 CDP 客户端 ═══════════════ */
class Tab {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.waiting = new Map()
    this.listeners = new Set()
    /** 还在飞的请求数（Network 事件维护）——「正文稳定」不等于「加载完了」，
     *  接口慢的时候页面会先停在一个「加载中」的稳定状态，只按字数判断会把它抄下来。 */
    this.inflight = 0
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.waiting.has(msg.id)) {
        const { res, rej } = this.waiting.get(msg.id)
        this.waiting.delete(msg.id)
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)
        return
      }
      if (msg.method === 'Network.requestWillBeSent') this.inflight++
      else if (msg.method === 'Network.loadingFinished' || msg.method === 'Network.loadingFailed') {
        this.inflight = Math.max(0, this.inflight - 1)
      }
      if (msg.method) for (const fn of this.listeners) fn(msg)
    }
  }
  static async open(wsUrl) {
    const ws = new WebSocket(wsUrl)
    await new Promise((res, rej) => {
      ws.onopen = res
      ws.onerror = () => rej(new Error('CDP WebSocket 连接失败'))
    })
    return new Tab(ws)
  }
  on(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = ++this.seq
      this.waiting.set(id, { res, rej })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.waiting.has(id)) {
          this.waiting.delete(id)
          rej(new Error('CDP 超时：' + method))
        }
      }, 25000)
    })
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || '页面内脚本报错')
    return r.result?.value
  }
  close() {
    try {
      this.ws.close()
    } catch {}
  }
}

/* ═══════════════ 正文抽取（仅用于验收字数） ═══════════════ */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/* ═══════════════ 主流程 ═══════════════ */
async function main() {
  const shell = await fs.readFile(join(DIST, 'index.html'), 'utf8')
  console.log('')
  console.log('  倚声 · 预渲染')
  console.log('  ────────────────────────────────────────────')
  console.log(`  产物目录   ${DIST}/`)
  console.log(`  站点根地址 ${ORIGIN}${process.env.YS_ORIGIN ? '' : '（默认值，可用 YS_ORIGIN 覆盖）'}`)

  /* ── 本地数据库：只用来取「词牌谱 / 韵书」这类代码算得出来的数据。
   *    博客文章 / 站点设置**故意走替身**返回空 —— 构建机上没有线上数据库，
   *    拿本地种子文章灌进静态 HTML，会让爬虫读到一批线上并不存在的文章。 */
  const hasDbRaw = existsSync(join(process.cwd(), DB_FILE))
  let apiEnv = null
  let hasDb = false
  if (hasDbRaw) {
    try {
      // 动态引入：老版本 Node 没有 node:sqlite，直接静态 import 会让整个脚本起不来
      const { createLocalEnv } = await import('../server/d1-adapter.mjs')
      apiEnv = createLocalEnv({ dbFile: join(process.cwd(), DB_FILE) })
      hasDb = true
    } catch (e) {
      console.warn('  ⚠ 本地数据库打不开，词牌/韵书数据改用空替身：' + (e?.message || e))
    }
  }
  /* ── 要不要顺手取线上真数据（可选）──
   * **只有显式给 YS_API 才连**。默认不连的理由：
   *   ① 构建不该依赖网络 —— 断网就构建失败是最烦人的一类事故；
   *   ② 「构建时把线上数据抄进静态文件」本身就是一份快照，
   *      线上改了而你没重新构建，静态文件里就是过期数据。
   * 想连的时候：YS_API=https://yisheng.pages.dev npm run prerender
   */
  let liveApi = ''
  const apiArg = process.env.YS_API || ''
  if (apiArg && !['0', 'off', 'no'].includes(apiArg.toLowerCase())) {
    const base = apiArg.replace(/\/+$/, '')
    try {
      const r = await fetch(base + '/api/posts?pageSize=1', { signal: AbortSignal.timeout(8000) })
      const j = await r.json()
      if (r.ok && j && typeof j === 'object' && 'data' in j) liveApi = base
      else throw new Error('返回的不是本站接口格式')
    } catch (e) {
      console.warn(`  ⚠ 连不上 ${base}（${e?.message || e}），文章数据改用空替身\n`)
    }
  }

  const preview = await startPreview({
    dir: DIST,
    spaFallback: true, // 预渲染阶段：还没生成的页面要能打开（此时由前端渲染出内容）
    useRedirects: false, // 产物还没生成，规则此时必然指不到文件
    api: hasDb ? 'local' : 'stub',
    apiEnv,
    stubFirst: ['/api/posts', '/api/settings', '/api/favorites'],
    proxyApi: liveApi
  })
  console.log(
    `  接口来源   ${liveApi ? `线上 ${liveApi}（文章与设置取真数据）` : hasDb ? '本地数据库（词牌谱/韵书）＋ 空数据（文章/设置）' : '全部空数据替身'}`
  )
  console.log(`  临时预览   ${preview.origin}`)
  console.log('')

  const results = []
  let chrome = null
  let profileDir = null
  try {
    if (!CHROME) throw new Error('找不到 Chrome（可用 YS_CHROME 指定）')
    profileDir = join(tmpdir(), 'ys-prerender-' + Date.now())
    const port = 9500 + Math.floor(Math.random() * 400)
    chrome = spawn(
      CHROME,
      [
        '--headless=new',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-features=CalculateNativeWinOcclusion',
        '--force-color-profile=srgb',
        'about:blank'
      ],
      { stdio: 'ignore' }
    )

    let up = false
    for (let i = 0; i < 80; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/version`)
        if (r.ok) {
          up = true
          break
        }
      } catch {}
      await sleep(250)
    }
    if (!up) throw new Error('Chrome 没起来（端口 ' + port + '）')

    for (const route of ROUTES) {
      results.push(await render(port, preview.origin, route))
    }
    results.push(await render(port, preview.origin, { path: NOT_FOUND_PROBE, file: '404.html', label: '404 页', marker: '', minText: 30 }))
  } catch (e) {
    console.error('\n  ✗ 预渲染中断：' + (e?.message || e))
    for (const route of ROUTES) {
      if (!results.some((r) => r.path === route.path)) results.push({ ...route, ok: false, reason: '未执行' })
    }
    if (!results.some((r) => r.file === '404.html')) results.push({ path: NOT_FOUND_PROBE, file: '404.html', label: '404 页', ok: false, reason: '未执行' })
  } finally {
    if (chrome) {
      try {
        chrome.kill()
      } catch {}
    }
    await preview.close()
    await sleep(300)
    if (profileDir) await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {})
  }

  /* ── 落盘：成功的写渲染结果，失败的写空壳（保证线上不 404） ── */
  let failed = 0
  for (const r of results) {
    const target = join(DIST, r.file)
    await fs.mkdir(join(DIST, r.file.replace(/[^/\\]+$/, '')), { recursive: true }).catch(() => {})
    if (r.ok && r.html) {
      await fs.writeFile(target, r.html, 'utf8')
    } else {
      failed++
      await fs.writeFile(target, shell, 'utf8')
    }
  }

  /* ── 报告 ── */
  console.log('  预渲染结果')
  console.log('  ────────────────────────────────────────────')
  for (const r of results) {
    const size = r.html ? `${(Buffer.byteLength(r.html) / 1024).toFixed(1)} KB`.padStart(8) : '       —'
    const mark = r.ok ? '✓' : '✗'
    const tail = r.ok
      ? `${String(r.textLen).padStart(5)} 字  ${r.title || ''}`
      : `退回空壳：${r.reason || '未知原因'}`
    console.log(`  ${mark} ${r.path.padEnd(30)} ${size}  ${tail}`)
    if (r.ok && r.warn?.length) for (const w of r.warn) console.log(`       ⚠ ${w}`)
  }

  const okCount = results.filter((r) => r.ok).length
  console.log('')
  if (failed) {
    console.log(`  ⚠ ${failed} 个页面没能预渲染，已退回空壳（这些页爬虫仍读不到正文）。`)
    console.log(`    常见原因：Chrome 打不开 / 该页依赖的接口没响应。可加 --strict 让它直接算失败。`)
  } else {
    console.log(`  ✅ ${okCount} 个页面已生成静态正文，爬虫不用执行 JS 也能读到。`)
  }
  if (!liveApi) {
    const blog = results.find((r) => r.file === 'blog.html')
    if (blog?.ok) {
      console.log('')
      console.log('  ℹ 博客列表页是按「空数据」渲染的（构建机没有线上数据库，也没有连线上接口）。')
      console.log('    站上已经有文章时，把真实列表也写进静态文件可以这样跑：')
      console.log('      YS_API=https://ystianci.de5.net npm run prerender')
    }
  }
  console.log('')

  if (STRICT && failed) process.exit(1)
}

/**
 * 渲染一页并返回 { ok, html, textLen, title, warn }
 */
async function render(port, origin, route) {
  let tabInfo = null
  let tab = null
  try {
    tabInfo = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
    tab = await Tab.open(tabInfo.webSocketDebuggerUrl)
    await tab.send('Page.enable')
    await tab.send('Runtime.enable')
    await tab.send('Network.enable')

    const errors = []
    tab.on((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails
        errors.push((d.exception?.description || d.text || '').split('\n')[0])
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push((msg.params.args || []).map((a) => a.value ?? a.description).join(' ').split('\n')[0])
      }
    })

    // 每一页都从「干净状态」开始：别把上一页写进 localStorage 的东西带过来
    await tab.eval(`try{localStorage.clear()}catch(e){}`)

    const url = origin + route.path
    await tab.send('Page.navigate', { url })

    // 等正文出现并稳定：字数连续两次相同、**并且没有请求还在飞**，才算渲染完
    // （只看字数会在接口慢的时候把「加载中」抄下来）
    let last = -1
    let stable = 0
    let len = 0
    let settled = false
    for (let i = 0; i < 120; i++) {
      await sleep(150)
      len = (await tab.eval(`(()=>{const a=document.querySelector('#app');return a?(a.innerText||'').replace(/\\s+/g,' ').trim().length:0})()`)) || 0
      if (len > 0 && len === last) stable++
      else stable = 0
      last = len
      if (stable >= 3 && tab.inflight === 0 && i > 4) {
        settled = true
        break
      }
    }

    // 滚动一遍，把「滚动才出现」的段落（IntersectionObserver）也渲染出来
    await tab.eval(`(async()=>{const h=document.body.scrollHeight;for(let y=0;y<h;y+=Math.round(innerHeight*0.8)){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,60))}window.scrollTo(0,0);await new Promise(r=>setTimeout(r,120))})()`)
    // 滚动会触发懒加载图片，再等网络安静下来
    for (let i = 0; i < 40 && tab.inflight > 0; i++) await sleep(150)
    await sleep(300)

    const html = await tab.eval(`document.documentElement.outerHTML`)
    if (!html || html.length < 200) throw new Error('拿到的 HTML 过短')

    /* 本地地址 → 线上域名。canonical / og:url / og:image 都是运行时拼出来的绝对地址，
     * 不改写就会把 127.0.0.1 写进静态文件。 */
    let out = '<!doctype html>\n' + html
    out = out.split(origin).join(ORIGIN)

    const text = htmlToText(out)
    const title = (out.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ''

    const warn = []
    if (!settled) warn.push('等了 18 秒页面还在动（请求没停），正文可能不全')
    if (/127\.0\.0\.1|localhost/.test(out)) warn.push('产物里仍残留本机地址，检查 setSeo 的 url 拼接')
    if (errors.length) warn.push('控制台报错：' + errors.filter(Boolean).slice(0, 2).join(' | ').slice(0, 160))
    if (route.minText && text.length < route.minText) warn.push(`正文字数偏少（${text.length} < ${route.minText}）`)
    if (route.marker && !text.includes(route.marker)) warn.push(`没找到关键词「${route.marker}」`)
    if (/加载失败|加载出错|服务器内部错误/.test(text)) warn.push('正文里出现报错文案，这一页接口没通')

    const hardFail = text.length < (route.minText || 1) || (route.marker && !text.includes(route.marker))

    return {
      path: route.path,
      file: route.file,
      label: route.label,
      ok: !hardFail,
      reason: hardFail ? `正文只有 ${text.length} 字，未通过门槛` : '',
      html: out,
      textLen: text.length,
      title: title.trim(),
      warn
    }
  } catch (e) {
    return { path: route.path, file: route.file, label: route.label, ok: false, reason: e?.message || String(e) }
  } finally {
    if (tab) tab.close()
    if (tabInfo?.id) {
      try {
        await fetch(`http://127.0.0.1:${port}/json/close/${tabInfo.id}`)
      } catch {}
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
