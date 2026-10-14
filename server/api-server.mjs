/**
 * 本地开发 / 预览服务器
 * ─────────────────────────────────────────────────────────────
 * 用法：
 *   node server/api-server.mjs          只跑 API（Vite 开发服务器会代理 /api 过来）
 *   node server/api-server.mjs --prod   同时托管 dist/ 静态文件（单端口预览，模拟线上）
 *
 * 端口读平台注入的 PORT（部署平台会给），否则默认 8787。
 */

import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, resolve, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleApi } from '../shared/api-handler.js'
import { createLocalEnv } from './d1-adapter.mjs'
import { loadDevVars } from './load-dev-vars.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PORT = Number(process.env.PORT || 8787)
const PROD = process.argv.includes('--prod')
const DIST = join(ROOT, 'dist')

// 先读本地密钥，再组装 env —— 顺序反了就白读。
loadDevVars(join(ROOT, '.dev.vars'))

const env = createLocalEnv({ dbFile: join(ROOT, '.data', 'yisheng.db') })

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
}

function nodeRequest(req) {
  const host = req.headers.host || `127.0.0.1:${PORT}`
  const url = `http://${host}${req.url}`
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x))
    else if (v !== undefined) headers.set(k, v)
  }
  const method = (req.method || 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') return Promise.resolve(new Request(url, { method, headers }))
  return new Promise((res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      res(new Request(url, { method, headers, body: body.length ? body : undefined }))
    })
    req.on('error', () => res(new Request(url, { method, headers })))
  })
}

async function send(res, response) {
  res.statusCode = response.status
  const skip = new Set(['content-length', 'transfer-encoding'])
  response.headers.forEach((v, k) => {
    if (!skip.has(k.toLowerCase())) res.setHeader(k, v)
  })
  const buf = Buffer.from(await response.arrayBuffer())
  res.setHeader('Content-Length', String(buf.length))
  res.end(buf)
}

async function serveStatic(req, res, pathname) {
  if (!existsSync(DIST)) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(
      `<html><body style="font:16px/1.7 system-ui;padding:40px;max-width:640px;margin:auto">
      <h2>还没有构建产物</h2>
      <p>预览模式需要先构建前端：</p>
      <pre style="background:#f4f4f0;padding:12px;border-radius:6px">npm run build</pre>
      <p>开发时请用 <code>npm run dev</code>（Vite 会代理 /api 到本服务）。</p>
      </body></html>`
    )
    return
  }
  let rel = decodeURIComponent(pathname)
  if (rel === '/' || rel === '') rel = '/index.html'
  const safe = normalize(rel).replace(/^([/\\])+/, '')
  if (safe.includes('..')) {
    res.statusCode = 400
    return res.end('bad path')
  }
  let file = join(DIST, safe)
  try {
    const buf = await readFile(file)
    res.statusCode = 200
    res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] || 'application/octet-stream')
    if (rel.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.end(buf)
    return
  } catch {
    // 没有扩展名 → 交给前端路由（SPA 兜底）
    if (!extname(safe)) {
      try {
        file = join(DIST, 'index.html')
        const buf = await readFile(file)
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(buf)
        return
      } catch {}
    }
    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('404 Not Found')
  }
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname
  try {
    if (pathname.startsWith('/api/') || pathname === '/api') {
      const request = await nodeRequest(req)
      const response = await handleApi({ request, env })
      await send(res, response)
      return
    }
    if (!PROD) {
      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'dev 模式下本端口只提供 /api/*，页面请访问 Vite 的 5173 端口' }))
      return
    }
    await serveStatic(req, res, pathname)
  } catch (e) {
    console.error('[server]', e)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
    }
    res.end(JSON.stringify({ code: 500, message: '服务器内部错误：' + (e?.message || e) }))
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  倚声 API 已启动  →  http://127.0.0.1:${PORT}${PROD ? '  (含静态站点)' : '  (仅 /api)'}`)
  console.log(`  数据库文件      →  ${join(ROOT, '.data', 'yisheng.db')}`)
  console.log(`  AI 通道         →  ${env.AI_API_KEY ? '已配置（模型 ' + (env.AI_MODEL || '默认') + '）' : '未配置，使用本地格律引擎'}\n`)
})

process.on('SIGINT', () => {
  server.close(() => process.exit(0))
})
