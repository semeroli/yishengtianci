/**
 * 构建产物预览服务器（给脚本用，不对外）
 * ─────────────────────────────────────────────────────────────
 * 为什么不直接用 `npm run dev`：
 *   dev 跑的是**源码**（Vite 现场编译），而预渲染和它的验收都必须看
 *   **构建产物**（dist/）。两者行为不同 —— 例如 dev 下任何路径都由 Vite 兜底
 *   返回 index.html，所以「刷新 404」「静态文件被通配规则吃掉」这类问题
 *   在 dev 上根本复现不出来。
 *
 * 这个服务器按 public/_redirects 的**同一套规矩**托管 dist：
 *   · 命中真实文件 → 原样返回（这就是预渲染产物能被爬虫读到的前提）
 *   · 带 SPA 前缀（/blog/xxx、/admin/xxx）→ 返回根 index.html，交给前端路由
 *   · 其余没命中的路径 → 返回 404.html（真 404，不是软 404）
 *
 * /api/* 有两种模式：
 *   local —— 交给 shared/api-handler.js + 本地 D1（.data/yisheng.db），
 *            拿到的是真词牌谱、真韵书，和线上同一份代码算出来的；
 *   stub  —— 没有数据库时的替身，返回「空数据」而不是「报错」。
 *            这一点很关键：预渲染要是把「文章加载失败」烧进静态 HTML，
 *            爬虫读到的就是一句报错。
 */
import http from 'node:http'
import { promises as fs } from 'node:fs'
import { join, extname, normalize } from 'node:path'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webmanifest': 'application/manifest+json'
}

/** 走前端路由的路径前缀（_redirects 里对应 /blog/* 与 /admin/*） */
const SPA_PREFIXES = ['/blog/', '/admin']

/**
 * 解析 dist/_redirects 为规则表。
 * 只解析、不执行 —— 但**必须用真的规则文件**，不能在这里另写一套等价物：
 * 路由规则是本项目最容易写错的地方（通配盖掉静态文件、重写目标落进通配范围），
 * 另写一套就等于「验的不是线上那份」。
 */
function parseRedirects(text) {
  const rules = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const [from, to, status] = line.split(/\s+/)
    if (!from || !to) continue
    rules.push({ from, to, status: Number(status || 302) })
  }
  return rules
}

/** 按「先精确、后通配；命中第一条就停」的顺序匹配（与 Cloudflare 一致） */
function matchRule(rules, pathname) {
  for (const r of rules) {
    if (r.from.endsWith('/*')) {
      const base = r.from.slice(0, -2) // '/blog/*' → '/blog'
      if (pathname === base || pathname.startsWith(base + '/')) return r
    } else if (r.from === pathname) {
      return r
    }
  }
  return null
}

/** 没有数据库时各接口给什么 —— 全给「空」，不给「错」 */
const STUBS = [
  [/^\/api\/settings$/, () => ({})],
  [/^\/api\/posts$/, () => ({ list: [], total: 0, pages: 1, categories: [] })],
  [/^\/api\/favorites$/, () => ({ list: [] })],
  [/^\/api\/cipai$/, () => ({ list: [] })],
  [/^\/api\/rhyme$/, () => ({})]
]

export function isSpaPath(pathname) {
  return SPA_PREFIXES.some((p) => pathname === p.replace(/\/$/, '') || pathname.startsWith(p))
}

/** 把 URL 路径映射成 dist 里的真实文件；找不到返回 null */
async function findFile(root, pathname) {
  let rel
  try {
    rel = decodeURIComponent(pathname)
  } catch {
    return null
  }
  rel = normalize(rel).split(/[\\/]+/).filter(Boolean).join('/')
  if (!rel || rel.split('/').includes('..')) return rel === '' ? join(root, 'index.html') : null

  const candidates = [rel]
  if (!extname(rel)) candidates.push(rel + '/index.html', rel + '.html')

  for (const c of candidates) {
    const p = join(root, c)
    try {
      const st = await fs.stat(p)
      if (st.isFile()) return p
    } catch {
      /* 下一个候选 */
    }
  }
  return null
}

function toWebRequest(req, origin) {
  const method = (req.method || 'GET').toUpperCase()
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x))
    else if (v !== undefined) headers.set(k, v)
  }
  if (method === 'GET' || method === 'HEAD') {
    return Promise.resolve(new Request(origin + req.url, { method, headers }))
  }
  return new Promise((done) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const buf = Buffer.concat(chunks)
      done(new Request(origin + req.url, { method, headers, body: buf.length ? buf : undefined }))
    })
    req.on('error', () => done(new Request(origin + req.url, { method, headers })))
  })
}

/**
 * @param {object} o
 * @param {string} [o.dir='dist']           产物目录
 * @param {boolean} [o.spaFallback=false]   未命中时是否退回 index.html（预渲染阶段要 true）
 * @param {boolean} [o.useRedirects=true]   是否按 dist/_redirects 的规则分发（验收时必须 true）
 * @param {'local'|'stub'} [o.api='stub']   /api 的处理方式
 * @param {object} [o.apiEnv]               local 模式下的 env（含 DB 绑定）
 * @param {string[]} [o.stubFirst=[]]       这些前缀强制走 stub（哪怕 api=local）
 * @param {string} [o.proxyApi='']          把 /api/* 转发到这个线上域名取真实数据（优先级最高）
 */
export async function startPreview({
  dir = 'dist',
  spaFallback = false,
  useRedirects = true,
  api = 'stub',
  apiEnv = null,
  stubFirst = [],
  proxyApi = ''
} = {}) {
  const root = join(process.cwd(), dir)
  try {
    const st = await fs.stat(join(root, 'index.html'))
    if (!st.isFile()) throw new Error()
  } catch {
    throw new Error(`没找到 ${dir}/index.html —— 先跑 npm run build`)
  }

  // 预渲染阶段产物还没生成、规则必然指不到文件，所以那时不启用规则
  let rules = []
  if (useRedirects) {
    try {
      rules = parseRedirects(await fs.readFile(join(root, '_redirects'), 'utf8'))
    } catch {
      console.warn('[preview] 没读到 _redirects，按「找不到就 404」处理')
    }
  }

  let handleApi = null
  if (api === 'local') {
    try {
      ;({ handleApi } = await import('../../shared/api-handler.js'))
    } catch (e) {
      console.warn('[preview] 本地 API 加载失败，退回 stub：' + e.message)
    }
  }

  const server = http.createServer(async (req, res) => {
    const origin = `http://${req.headers.host || '127.0.0.1'}`
    const pathname = (req.url || '/').split('?')[0]

    /* ── 接口 ── */
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      // ① 转发线上（只有构建时显式指了 YS_API 才走这条）
      if (proxyApi) {
        try {
          const upstream = await fetch(proxyApi.replace(/\/+$/, '') + req.url, {
            method: req.method,
            signal: AbortSignal.timeout(10000)
          })
          const buf = Buffer.from(await upstream.arrayBuffer())
          res.writeHead(upstream.status, {
            'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
            'content-length': buf.length,
            'cache-control': 'no-store'
          })
          res.end(buf)
          return
        } catch (e) {
          console.warn('[preview] 线上接口取不到，本条改用空替身：' + (e?.message || e))
        }
      }
      const forced = stubFirst.some((p) => pathname === p || pathname.startsWith(p + '/'))
      if (handleApi && !forced) {
        try {
          const response = await handleApi({ request: await toWebRequest(req, origin), env: apiEnv })
          const skip = new Set(['content-length', 'transfer-encoding'])
          const h = {}
          response.headers.forEach((v, k) => {
            if (!skip.has(k.toLowerCase())) h[k] = v
          })
          const buf = Buffer.from(await response.arrayBuffer())
          res.writeHead(response.status, { ...h, 'content-length': buf.length })
          res.end(buf)
          return
        } catch (e) {
          console.warn('[preview] API 异常，本条退回 stub：' + (e?.message || e))
        }
      }
      const hit = STUBS.find(([re]) => re.test(pathname))
      const data = hit ? hit[1]() : {}
      const isWrite = !['GET', 'HEAD'].includes((req.method || 'GET').toUpperCase())
      const body = JSON.stringify(isWrite ? { code: 405, message: '预览模式不支持写操作', data: null } : { code: 0, message: 'ok', data })
      res.writeHead(isWrite ? 405 : 200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
      res.end(body)
      return
    }

    /* ── 路由规则（重定向/重写优先于静态文件，与 Cloudflare 一致）── */
    const rule = matchRule(rules, pathname)
    if (rule) {
      if (rule.status >= 300 && rule.status < 400) {
        res.writeHead(rule.status, { location: rule.to })
        res.end()
        return
      }
      const target = await findFile(root, rule.to)
      if (!target) {
        const msg = `_redirects 把 ${pathname} 指向 ${rule.to}，但产物里没有这个文件`
        console.error('[preview] ' + msg)
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(msg)
        return
      }
      const buf = await fs.readFile(target)
      res.writeHead(200, {
        'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
        'content-length': buf.length,
        'cache-control': 'no-store'
      })
      res.end(buf)
      return
    }

    /* ── 静态文件 ── */
    const file = await findFile(root, pathname)
    if (file) {
      const buf = await fs.readFile(file)
      res.writeHead(200, {
        'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'content-length': buf.length,
        'cache-control': 'no-store'
      })
      res.end(buf)
      return
    }

    /* ── SPA 兜底 / 404 ── */
    const useSpa = spaFallback || isSpaPath(pathname)
    if (useSpa) {
      const buf = await fs.readFile(join(root, 'index.html'))
      res.writeHead(200, { 'content-type': MIME['.html'], 'content-length': buf.length, 'cache-control': 'no-store' })
      res.end(buf)
      return
    }

    let body = '404 Not Found'
    let type = 'text/plain; charset=utf-8'
    try {
      body = await fs.readFile(join(root, '404.html'), 'utf8')
      type = MIME['.html']
    } catch {
      /* 没有 404.html 就用文本 */
    }
    res.writeHead(404, { 'content-type': type, 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' })
    res.end(body)
  })

  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address()
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    close: () => new Promise((done) => server.close(done))
  }
}
