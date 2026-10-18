/**
 * 预渲染验收（站在爬虫的角度看站点）
 * ─────────────────────────────────────────────────────────────
 * 它做的事很简单：**不发一个 JS，只用 fetch 把页面拿下来**，
 * 然后检查正文在不在。百度蜘蛛基本不执行 JS，所以这个脚本看到什么，
 * 百度就大致看到什么。这也是唯一能证明「预渲染真的生效了」的办法 ——
 * 用浏览器打开再看是看不出来的（浏览器本来就执行 JS）。
 *
 * 同时把 public/_redirects 真的跑一遍（不是另写一套等价物）：
 *   · 每个预渲染页面拿到的必须是**带正文的那份文件**，不是空壳；
 *   · /blog/某篇文章、/admin/** 仍回空壳（动态路由保持前端渲染）；
 *   · 不存在的地址回**真 404**（旧配置会回 200 + 首页，属于「软 404」）。
 *
 * 用法：
 *   npm run build && npm run prerender && node scripts/verify-prerender.mjs
 *   node scripts/verify-prerender.mjs --serve     # 验完留一个预览地址给浏览器看
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { startPreview } from './lib/preview-server.mjs'

const SERVE = process.argv.includes('--serve')
const DIST = 'dist'
/** 与 scripts/prerender.mjs 的默认值保持一致；换域名时两边一起改 */
const ORIGIN = (process.env.YS_ORIGIN || 'https://ystianci.de5.net').replace(/\/+$/, '')

/** 与 scripts/prerender.mjs 里的 ROUTES 保持一致 */
const ROUTES = [
  { path: '/', file: 'index.html', label: '落地页', marker: '写意境', minText: 600 },
  { path: '/studio', file: 'studio.html', label: '填词工作台', marker: '词牌', minText: 200 },
  { path: '/blog', file: 'blog.html', label: '填词博客', marker: '填词博客', minText: 120 },
  { path: '/rhyme', file: 'rhyme.html', label: '韵书速查', marker: '韵', minText: 150 },
  { path: '/about', file: 'about.html', label: '关于', marker: '倚声', minText: 150 },
  { path: '/favorites', file: 'favorites.html', label: '我的词笺', marker: '词笺', minText: 80 }
]

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const checks = []
function check(ok, name, detail = '') {
  checks.push({ ok, name, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '　' + detail : ''}`)
}

async function get(origin, path) {
  const r = await fetch(origin + path)
  const body = await r.text()
  return { status: r.status, type: r.headers.get('content-type') || '', body, text: htmlToText(body) }
}

async function main() {
  console.log('')
  console.log('  倚声 · 预渲染验收（不执行任何 JS，只看静态 HTML）')
  console.log('  ────────────────────────────────────────────')

  /* ── ① 文件层面 ── */
  console.log('\n  ▸ 产物文件')
  for (const r of ROUTES) {
    let size = 0
    try {
      size = (await fs.stat(join(DIST, r.file))).size
    } catch {}
    check(size > 0, `${r.file} 存在`, size ? `${(size / 1024).toFixed(1)} KB` : '缺失')
  }
  let has404 = false
  try {
    has404 = (await fs.stat(join(DIST, '404.html'))).size > 0
  } catch {}
  check(has404, '404.html 存在', has404 ? '' : '缺失（未知地址会显示 Cloudflare 默认页）')

  /* ── ② 路由规则是否覆盖了每个预渲染文件 ── */
  console.log('\n  ▸ 路由规则（dist/_redirects）')
  const rulesText = await fs.readFile(join(DIST, '_redirects'), 'utf8')
  const ruleLines = rulesText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  for (const r of ROUTES) {
    if (r.path === '/') continue // 根目录天然由 index.html 承担，不需要规则
    const hit = ruleLines.some((l) => {
      const [from, to] = l.split(/\s+/)
      return from === r.path && to === '/' + r.file
    })
    check(hit, `${r.path} → /${r.file}`, hit ? '' : '规则缺失，该页线上会 404')
  }
  const hasSoft404 = ruleLines.some((l) => l.split(/\s+/)[0] === '/*')
  check(!hasSoft404, '没有 `/*` 通配兜底（否则会盖掉预渲染 + 造成软 404）')

  /* ── ③ 真请求验证 ── */
  const preview = await startPreview({ dir: DIST, useRedirects: true, api: 'stub' })
  console.log(`\n  ▸ 真请求（预览地址 ${preview.origin}）`)

  for (const r of ROUTES) {
    const res = await get(preview.origin, r.path)
    const isShell = !/<div id="app"[^>]*>\s*<\/(div)?/i.test(res.body) && res.text.length < 60
    check(res.status === 200, `GET ${r.path} → 200`, String(res.status))
    check(!isShell, `${r.path} 拿到的是带正文的文件`, `${res.text.length} 字`)
    check(res.text.length >= r.minText, `${r.path} 正文达标`, `${res.text.length} ≥ ${r.minText} 字`)
    if (r.marker) check(res.text.includes(r.marker), `${r.path} 含关键词「${r.marker}」`)
    check(!/127\.0\.0\.1|localhost/.test(res.body), `${r.path} 没有残留本机地址`)
    check(/<script type="module"/.test(res.body), `${r.path} 仍挂载了入口脚本（能交互，不是死页面）`)

    /* 规范地址（canonical）必须指向线上域名，且是本页自己的地址 ——
     * 写错域的后果比没有更严重：等于对外声明「这一页的正版在别人家」。 */
    const canonical = (res.body.match(/<link rel="canonical" href="([^"]+)"/) || [])[1] || ''
    const want = ORIGIN + (r.path === '/' ? '/' : r.path)
    check(canonical === want, `${r.path} canonical 指向本站`, canonical || '（无 canonical）')
    check(!/og:image" content="(?!https?:)/.test(res.body), `${r.path} og:image 是绝对地址`)
  }

  /* 带结尾斜杠的写法不能变成空壳 */
  for (const p of ['/studio/', '/blog/', '/about/']) {
    const res = await get(preview.origin, p)
    check(res.status === 200 && res.text.length >= 120, `GET ${p} → 200 且有正文`, `${res.status} / ${res.text.length} 字`)
  }

  /* 动态路由：仍交给前端 */
  for (const p of ['/blog/some-article-slug', '/admin', '/admin/settings', '/admin/posts/edit/new']) {
    const res = await get(preview.origin, p)
    check(res.status === 200, `GET ${p} → 200（前端路由接管）`, String(res.status))
  }

  /* 真 404：这是顺带修掉的另一个毛病 */
  for (const p of ['/this-page-does-not-exist', '/blog/../etc', '/studio/extra/deep']) {
    const res = await get(preview.origin, p)
    check(res.status === 404, `GET ${p} → 404（不再是软 404）`, String(res.status))
  }

  /* 静态资源别被规则吃掉 */
  const assets = await fs.readdir(join(DIST, 'assets'))
  const js = assets.find((f) => f.endsWith('.js'))
  const css = assets.find((f) => f.endsWith('.css'))
  for (const f of [js, css].filter(Boolean)) {
    const ext = f.split('.').pop()
    const res = await get(preview.origin, '/assets/' + f)
    check(res.status === 200 && res.type.includes(ext === 'js' ? 'javascript' : 'css'), `/assets/${f} → 200`, `${res.status} ${res.type}`)
  }
  const icon = await get(preview.origin, '/favicon.ico')
  check(icon.status === 200, '/favicon.ico → 200', String(icon.status))

  const bad = checks.filter((c) => !c.ok)
  console.log('\n  ────────────────────────────────────────────')
  if (bad.length) {
    console.log(`  ❌ ${bad.length} 项未通过（共 ${checks.length} 项）：`)
    for (const b of bad) console.log(`     · ${b.name} ${b.detail}`)
  } else {
    console.log(`  ✅ ${checks.length} 项全部通过 —— 爬虫不执行 JS 也能读到正文。`)
  }
  console.log('')

  if (SERVE) {
    console.log(`  预览（按 _redirects 规则）：${preview.origin}/`)
    console.log('  看完按 Ctrl+C 结束。\n')
    await new Promise(() => {})
  } else {
    await preview.close()
  }
  process.exit(bad.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
