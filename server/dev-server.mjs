/**
 * 开发服务器（单进程 · 单端口）
 * ─────────────────────────────────────────────────────────────
 * `npm run dev` 走这里。它同时干两件事：
 *   ① 用 Vite 在内存里编译前端（含 HMR）
 *   ② 把 /api/* 交给 shared/api-handler.js，数据库用本地 D1 替身
 *
 * 为什么不用「Vite 代理到 8787」那种两进程写法：
 * 本机的 node 起子进程偶发 EBUSY，一个进程最省心。
 *
 * 用法：
 *   node server/dev-server.mjs            开发（默认 5173）
 *   PORT=4000 node server/dev-server.mjs  换端口
 */

import http from 'node:http'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'
import { handleApi } from '../shared/api-handler.js'
import { createLocalEnv } from './d1-adapter.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PORT = Number(process.env.PORT || 5173)

const env = createLocalEnv({ dbFile: join(ROOT, '.data', 'yisheng.db') })

/** Node 的 IncomingMessage → 标准 Request（api-handler 只认标准 Request） */
function toRequest(req) {
  const host = req.headers.host || `127.0.0.1:${PORT}`
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x))
    else if (v !== undefined) headers.set(k, v)
  }
  const method = (req.method || 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') {
    return Promise.resolve(new Request(`http://${host}${req.url}`, { method, headers }))
  }
  return new Promise((done) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      done(new Request(`http://${host}${req.url}`, { method, headers, body: body.length ? body : undefined }))
    })
    req.on('error', () => done(new Request(`http://${host}${req.url}`, { method, headers })))
  })
}

async function sendApi(req, res) {
  try {
    const response = await handleApi({ request: await toRequest(req), env })
    res.statusCode = response.status
    const skip = new Set(['content-length', 'transfer-encoding'])
    response.headers.forEach((v, k) => {
      if (!skip.has(k.toLowerCase())) res.setHeader(k, v)
    })
    const buf = Buffer.from(await response.arrayBuffer())
    res.setHeader('Content-Length', String(buf.length))
    res.end(buf)
  } catch (e) {
    console.error('[api] 未捕获异常', e)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
    }
    res.end(JSON.stringify({ code: 500, message: '服务器内部错误：' + (e?.message || e) }))
  }
}

let vite = null

const server = http.createServer((req, res) => {
  const url = req.url || '/'
  if (url === '/api' || url.startsWith('/api/') || url.startsWith('/api?')) {
    sendApi(req, res)
    return
  }
  if (!vite) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('Vite 正在启动，请稍候刷新……')
    return
  }
  vite.middlewares(req, res, () => {
    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('404 Not Found')
  })
})

vite = await createViteServer({
  root: ROOT,
  appType: 'spa',
  server: {
    middlewareMode: true,
    hmr: { server }
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('')
  console.log('  倚声 · AI填词工坊  开发服务器已启动')
  console.log(`  ────────────────────────────────────────────`)
  console.log(`  页面        →  http://127.0.0.1:${PORT}/`)
  console.log(`  后台入口    →  http://127.0.0.1:${PORT}/admin`)
  console.log(`  数据库文件  →  ${join(ROOT, '.data', 'yisheng.db')}`)
  console.log(`  AI 通道     →  ${env.AI_API_KEY ? '已配置（模型 ' + (env.AI_MODEL || '默认') + '）' : '未配置，使用本地格律引擎'}`)
  console.log('')
})

const bye = () => {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 800)
}
process.on('SIGINT', bye)
process.on('SIGTERM', bye)
