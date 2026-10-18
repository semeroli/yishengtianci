/**
 * 端到端自测（不打网络，直接调 handleApi）
 * ─────────────────────────────────────────────────────────────
 * 为什么用独立数据库：自测会建文章、发评论、删东西，
 * 不能污染 .data/yisheng.db 里的真实数据。所以跑在 .data/smoke.db，
 * 每次开头把旧文件删掉，从一个干净库开始。
 *
 * 用法：npm run smoke
 */

import { rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleApi, hashPassword } from '../shared/api-handler.js'
import { createLocalEnv } from '../server/d1-adapter.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DB = join(ROOT, '.data', 'smoke.db')
try {
  rmSync(DB, { force: true })
  rmSync(DB + '-journal', { force: true })
} catch {}

const env = createLocalEnv({ dbFile: DB })

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    failures.push(name + (extra ? `  ← ${extra}` : ''))
    console.log(`  ✗ ${name}${extra ? '  ← ' + extra : ''}`)
  }
}

function section(t) {
  console.log(`\n  ${t}`)
}

/** 发一个请求，返回 { status, body } */
async function call(method, path, { body, token, form } = {}) {
  const headers = {}
  let payload
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  if (form !== undefined) {
    payload = form
  }
  if (token) headers.Authorization = 'Bearer ' + token
  const res = await handleApi({
    request: new Request('http://127.0.0.1/api' + path, { method, headers, body: payload }),
    env
  })
  const ct = res.headers.get('Content-Type') || ''
  let parsed = null
  if (ct.includes('json')) parsed = await res.json().catch(() => null)
  else parsed = await res.text().catch(() => '')
  return { status: res.status, body: parsed, ct }
}

const A = (r) => r.body?.data || {}
const code = (r) => r.body?.code

/**
 * 独立实现一遍 TOTP（RFC 6238），用来和后端交叉验证。
 * 故意不复用 shared/api-handler.js 里的那份：同一份代码算出来的码
 * 永远等于自己，测不出算法写错（比如位数、动态截断、字节序）。
 */
async function totpOf(b32, counter) {
  const AL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  const bytes = []
  for (const ch of String(b32).toUpperCase()) {
    const i = AL.indexOf(ch)
    if (i < 0) continue
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  const dv = new DataView(new ArrayBuffer(8))
  dv.setUint32(0, Math.floor(counter / 0x100000000))
  dv.setUint32(4, counter >>> 0)
  const key = await crypto.subtle.importKey('raw', new Uint8Array(bytes), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, dv.buffer))
  const off = sig[sig.length - 1] & 0x0f
  const n = ((sig[off] & 0x7f) << 24) | (sig[off + 1] << 16) | (sig[off + 2] << 8) | sig[off + 3]
  return String(n % 1000000).padStart(6, '0')
}

async function main() {
  console.log('\n  倚声 · 端到端自测\n  ══════════════════════════════')

  // ── 建表 ──────────────────────────────────────────────
  section('① 建表与基础接口')
  let r = await call('GET', '/health')
  ok('/health 返回 up', r.status === 200 && A(r).status === 'up')

  r = await call('GET', '/cipai')
  const cipai = A(r).list || []
  ok('词牌列表可读', r.status === 200 && cipai.length >= 10, `拿到 ${cipai.length} 个`)
  ok('词牌含格律谱', cipai.some((c) => Array.isArray(c.lines) && c.lines.length))
  const gen = cipai.filter((c) => c.generatable)
  ok('可填词词牌 ≥ 10', gen.length >= 10, `实际 ${gen.length}`)

  r = await call('GET', '/cipai/huanxisha')
  ok('单个词牌可查', r.status === 200 && A(r).name === '浣溪沙')
  r = await call('GET', '/cipai/not-exist-xyz')
  ok('不存在的词牌返回 404', r.status === 404)

  // ── 填词 ──────────────────────────────────────────────
  section('② 填词引擎')
  const ids = gen.map((c) => c.id)
  let allGood = true
  const badOnes = []
  for (const id of ids) {
    const rr = await call('POST', '/generate', { body: { cipaiId: id, prompt: '秋夜独坐，思念远方故人', seed: 20261013 } })
    if (rr.status !== 200) {
      allGood = false
      badOnes.push(`${id} 状态 ${rr.status}`)
      continue
    }
    const p = A(rr)
    const syllables = p.lines.reduce((a, l) => a + l.text.length, 0)
    // 叠句（如梦令「知否，知否」）照抄上一句，字面重复是格律要求，不算重韵
    const rhymeChars = p.lines.filter((l) => l.rhyme && !l.duplicated).map((l) => l.text.slice(-1))
    const problems = []
    if (syllables !== p.syllables) problems.push(`字数 ${syllables}≠${p.syllables}`)
    if (new Set(rhymeChars).size !== rhymeChars.length) problems.push('韵脚重字')
    if (p.rhymePlanOk === false) problems.push('韵脚编排降级')
    if (p.lines.some((l) => l.verdict === '破格')) problems.push('出现破格句')
    if (p.lines.some((l) => !l.text)) problems.push('存在空句')
    if (problems.length) {
      allGood = false
      badOnes.push(`${id}: ${problems.join('、')}`)
    }
  }
  ok(`${ids.length} 个词牌全部合律、字数准确、韵脚不重`, allGood, badOnes.join(' | '))

  r = await call('POST', '/generate', { body: { cipaiId: 'huanxisha', prompt: '短' } })
  ok('意境过短被拒（400）', r.status === 400)

  r = await call('POST', '/generate', { body: { cipaiId: 'manjianghong', prompt: '大江东去，浪淘尽' } })
  ok('谱待补的词牌被拒（400）', r.status === 400, `实际 ${r.status}`)

  r = await call('POST', '/generate', { body: { cipaiId: 'huanxisha', prompt: '一叶孤舟听秋雨', seed: 7 } })
  const poem = A(r)
  ok('生成结果带 id（已落库）', Number.isFinite(poem.id) && poem.id > 0, `id=${poem.id}`)
  ok('词作含逐句平仄标注', poem.lines?.[0]?.chars?.length > 0 && poem.lines[0].chars[0].actual)

  r = await call('POST', '/generate/line', { body: { cipaiId: 'huanxisha', lineIndex: 0, prompt: '一叶孤舟听秋雨', avoid: [poem.lines[0].text] } })
  ok('换一句可用', r.status === 200 && A(r).text?.length === poem.lines[0].text.length)
  r = await call('POST', '/generate/line', { body: { cipaiId: 'huanxisha', lineIndex: 99, prompt: 'x' } })
  ok('句序越界返回 400', r.status === 400)

  // ── 韵书 / 名句 / 设置 ─────────────────────────────────
  section('③ 韵书 · 名句 · 设置')
  r = await call('GET', '/rhyme')
  const bus = A(r).bus || []
  // 7 平 + 4 仄 + 本轮新增的「第三部 · 支微齐（平）」= 12
  ok('韵部简表 20 部', bus.length === 20, `实际 ${bus.length}`)
  ok('韵部分平仄', bus.filter((b) => b.tone === '平').length === 12, `平声 ${bus.filter((b) => b.tone === '平').length} 部`)
  ok('每部都附了韵脚字数（界面要显示宽窄）', bus.every((b) => Number.isFinite(b.tailChars) || Number.isFinite(b.totalDistinct)))

  r = await call('GET', '/rhyme?q=' + encodeURIComponent('风月愁'))
  const hits = A(r).results || []
  ok('查字归韵有命中', hits.length > 0 && hits.every((h) => h.matched.length > 0))
  ok('命中字准确', hits.some((h) => h.matched.includes('风')))

  r = await call('GET', '/inspiration')
  ok('名句灵感返回', r.status === 200 && !!A(r).item?.text)

  r = await call('GET', '/settings')
  ok('公开设置可读', r.status === 200 && !!A(r).site_name)
  ok('公开设置不泄露审核策略', A(r).comment_moderation === undefined)

  // ── 博客 ──────────────────────────────────────────────
  section('④ 博客（公开）')
  r = await call('GET', '/posts')
  ok('文章列表可读', r.status === 200 && Array.isArray(A(r).list))
  ok('文章列表返回分页字段', Number.isFinite(A(r).pages))

  // ── 管理员 ────────────────────────────────────────────
  section('⑤ 管理员登录与鉴权')
  const hash = await hashPassword('Smoke#2026')
  await env.DB.prepare(
    `INSERT INTO users (username, password_hash, display_name, role) VALUES ('smoke', ?, '自测账号', 'admin')`
  )
    .bind(hash)
    .run()

  r = await call('GET', '/admin/me')
  ok('无令牌访问后台 → 401', r.status === 401)

  r = await call('POST', '/admin/login', { body: { username: 'smoke', password: 'wrong-password' } })
  ok('错误密码 → 401', r.status === 401)

  r = await call('POST', '/admin/login', { body: { username: 'smoke', password: 'Smoke#2026' } })
  const token = A(r).token
  ok('正确密码 → 拿到令牌', r.status === 200 && typeof token === 'string' && token.split('.').length === 2, `段数 ${String(token).split('.').length}`)

  r = await call('POST', '/admin/login', { body: { username: 'smoke', password: 'Smoke#2026' } })
  const token2 = A(r).token
  // 会话改成 KV 存储后，每次登录带一个随机 sid —— 令牌不再「同秒同串」，
  // 这是刻意的：没有 sid 就没法注销（退出登录 / 注销所有会话都会失效）。
  ok('两次登录令牌不同（每次一个新会话）', token !== token2)
  ok('两次登录的令牌都有效', A(r).token && A(r).expiresIn === 86400, String(A(r).expiresIn))

  r = await call('GET', '/admin/session', { token })
  ok('会话查询返回剩余有效期', r.status === 200 && A(r).expiresIn > 86000, String(A(r).expiresIn))
  ok('会话查询返回两步验证状态', typeof A(r).totpEnabled === 'boolean')

  r = await call('POST', '/admin/logout', { token: token2 })
  ok('退出登录成功', r.status === 200 && A(r).ok)
  r = await call('GET', '/admin/session', { token: token2 })
  ok('退出后该令牌立刻失效', r.status === 401, String(r.status))
  r = await call('GET', '/admin/session', { token })
  ok('另一个会话不受影响', r.status === 200, String(r.status))

  r = await call('GET', '/admin/login-history', { token })
  ok('登录历史可读', r.status === 200 && (A(r).list || []).length >= 3, `n=${(A(r).list || []).length}`)
  ok('登录历史标出失败记录', (A(r).list || []).some((x) => x.abnormal && x.success === 0))

  r = await call('PUT', '/admin/password', { token, body: { oldPassword: 'nope-nope', newPassword: 'Another#2026', confirmPassword: 'Another#2026' } })
  ok('原密码错 → 401', r.status === 401)
  r = await call('PUT', '/admin/password', { token, body: { oldPassword: 'Smoke#2026', newPassword: 'Another#2026', confirmPassword: 'mismatch' } })
  ok('两次新密码不一致 → 400', r.status === 400)
  r = await call('PUT', '/admin/password', { token, body: { oldPassword: 'Smoke#2026', newPassword: 'Another#2026', confirmPassword: 'Another#2026' } })
  ok('改密码成功', r.status === 200 && A(r).ok)
  r = await call('POST', '/admin/login', { body: { username: 'smoke', password: 'Another#2026' } })
  ok('新密码可登录', r.status === 200 && !!A(r).token)
  // 改回去，后面的用例还用旧密码
  await call('PUT', '/admin/password', { token: A(r).token, body: { oldPassword: 'Another#2026', newPassword: 'Smoke#2026', confirmPassword: 'Smoke#2026' } })

  r = await call('GET', '/admin/me', { token: 'a.b.c' })
  ok('伪造令牌 → 401', r.status === 401)

  r = await call('GET', '/admin/me', { token })
  ok('有效令牌可读自己', r.status === 200 && A(r).user.username === 'smoke')

  // ── 登录锁定：连续 5 次失败锁 15 分钟 ──────────────────
  for (let i = 0; i < 4; i++) {
    r = await call('POST', '/admin/login', { body: { username: 'smoke', password: 'bad-' + i } })
  }
  ok('连错 4 次还不锁', r.status === 401)
  r = await call('POST', '/admin/login', { body: { username: 'smoke', password: 'bad-5' } })
  ok('第 5 次失败提示已锁定', /锁定/.test(r.body?.message || ''), r.body?.message)
  r = await call('POST', '/admin/login', { body: { username: 'smoke', password: 'Smoke#2026' } })
  ok('锁定期内正确密码也进不去', r.status === 423, `${r.status}`)
  // 手工解锁，避免影响后续用例
  await env.DB.prepare(`UPDATE users SET failed_count = 0, locked_until = NULL WHERE username = 'smoke'`).run()
  r = await call('POST', '/admin/login', { body: { username: 'smoke', password: 'Smoke#2026' } })
  ok('解锁后可登录', r.status === 200)
  const freshToken = A(r).token

  // ── 两步验证（TOTP）────────────────────────────────────
  r = await call('POST', '/admin/totp/setup', { token: freshToken })
  const totpSecret = A(r).secret
  ok('生成两步验证密钥', r.status === 200 && /^[A-Z2-7]{16,}$/.test(totpSecret || ''), String(totpSecret))
  ok('返回可扫码/手输的 otpauth 链接', String(A(r).otpauth).startsWith('otpauth://totp/'))
  r = await call('POST', '/admin/totp/verify', { token: freshToken, body: { code: '000000' } })
  ok('错误验证码不能开启', r.status === 400)
  // 用独立实现算一个当前验证码（与后端不是同一段代码，可交叉验证）
  const totpNow = await totpOf(totpSecret, Math.floor(Date.now() / 1000 / 30))
  r = await call('POST', '/admin/totp/verify', { token: freshToken, body: { code: totpNow } })
  ok('正确验证码开启两步验证', r.status === 200 && A(r).enabled)
  r = await call('POST', '/admin/login', { body: { username: 'smoke', password: 'Smoke#2026' } })
  ok('开启后登录要求验证码', r.status === 428 && A(r).needTotp, String(r.status))
  r = await call('POST', '/admin/login', { body: { username: 'smoke', password: 'Smoke#2026', code: '123456' } })
  ok('验证码错 → 401', r.status === 401, `${r.status}`)
  r = await call('POST', '/admin/login', {
    body: { username: 'smoke', password: 'Smoke#2026', code: await totpOf(totpSecret, Math.floor(Date.now() / 1000 / 30)) }
  })
  ok('带正确验证码登录成功', r.status === 200 && !!A(r).token, `${r.status}`)
  const totpToken = A(r).token
  r = await call('POST', '/admin/totp/disable', { token: totpToken, body: { password: 'Smoke#2026' } })
  ok('关闭两步验证', r.status === 200 && A(r).enabled === false)
  r = await call('POST', '/admin/login', { body: { username: 'smoke', password: 'Smoke#2026' } })
  ok('关闭后无需验证码', r.status === 200 && !A(r).needTotp)

  // ── 后台文章 ──────────────────────────────────────────
  section('⑥ 后台文章 CRUD')
  r = await call('GET', '/admin/posts?status=all', { token })
  ok('后台文章列表可读', r.status === 200 && Array.isArray(A(r).list))

  const draftTitle = '自测草稿 · 请忽略'
  r = await call('POST', '/admin/posts', {
    token,
    body: {
      title: draftTitle,
      slug: 'smoke-draft-post',
      content_md: '## 自测\n\n这是一篇自测文章，**跑完自测会自动删除**。',
      category: '格律知识',
      tags: ['自测'],
      status: 'draft'
    }
  })
  const newId = A(r).id
  ok('新建草稿成功', r.status === 200 && Number.isFinite(newId), `id=${newId}`)

  r = await call('POST', '/admin/posts', {
    token,
    body: { title: '别名冲突', slug: 'smoke-draft-post', content_md: 'x', status: 'draft' }
  })
  ok('别名冲突 → 409', r.status === 409, `实际 ${r.status}`)

  r = await call('GET', '/posts/smoke-draft-post')
  ok('草稿在前台不可见（404）', r.status === 404)

  r = await call('GET', `/admin/posts/${newId}`, { token })
  ok('后台可读到草稿正文（含 content_md）', r.status === 200 && !!A(r).content_md && A(r).status === 'draft')

  r = await call('PUT', `/admin/posts/${newId}`, {
    token,
    body: { status: 'published', title: draftTitle, excerpt: '自测摘要' }
  })
  ok('改为已发布成功', r.status === 200)

  r = await call('GET', '/posts/smoke-draft-post')
  ok('发布后前台可见', r.status === 200 && A(r).title === draftTitle)
  const postId = A(r).id
  ok('详情返回阅读量', Number.isFinite(A(r).view_count))

  /* ── 中文别名（回归：2026-10-18 线上「接口不存在」）──────────────
   * 病根：请求路径 `url.pathname` 是**百分号编码**过的，而旧的匹配正则写的是
   *   /^\/posts\/([\w\u4e00-\u9fa5-]+)$/
   * `%` 不属于 \w ⇒ 中文别名（编码后必带 %）一条都匹配不上，
   * 于是所有中文别名文章的详情页都回「接口不存在」。
   * 原来的自测只用 ASCII 别名 smoke-draft-post，所以 163 项全绿也测不出来。
   * ⚠️ 这里必须显式 encodeURIComponent（模拟真实网络路径），否则测的不是线上那条路。 */
  r = await call('POST', '/admin/posts', {
    token,
    body: { title: '中文别名测试：该选哪个词牌？', content_md: '正文', category: '填词教程', status: 'published' }
  })
  const cnId = A(r).id
  const cnSlug = A(r).slug
  ok('中文标题自动生成别名（标点变 -）', cnSlug === '中文别名测试-该选哪个词牌', `实际 ${cnSlug}`)

  r = await call('GET', '/posts/' + encodeURIComponent(cnSlug))
  ok('中文别名文章详情能打开', r.status === 200 && String(A(r).title || '').includes('中文别名测试'), `${r.status} ${JSON.stringify(r.body).slice(0, 90)}`)

  r = await call('POST', '/posts/' + encodeURIComponent(cnSlug) + '/like')
  ok('中文别名也能点赞', r.status === 200 && Number.isFinite(A(r).like_count), `${r.status}`)

  r = await call('POST', '/posts/' + encodeURIComponent(cnSlug) + '/share')
  ok('中文别名也能分享计数', r.status === 200 && Number.isFinite(A(r).share_count), `${r.status}`)

  r = await call('GET', '/posts/' + encodeURIComponent('并不存在的：别名'))
  ok('查不到的中文别名 → 说「文章不存在」，不是「接口不存在」', r.status === 404 && /文章不存在/.test(String(r.body.message || '')), `${r.status} ${r.body.message}`)

  r = await call('GET', '/posts/100%')
  ok('残缺的百分号不会 500', r.status === 404, `${r.status}`)

  await call('DELETE', `/admin/posts/${cnId}`, { token })

  r = await call('GET', '/posts?q=' + encodeURIComponent('自测草稿'))
  ok('关键词搜索命中', (A(r).total || 0) >= 1)
  r = await call('GET', '/posts?category=' + encodeURIComponent('格律知识'))
  ok('分类筛选生效', (A(r).list || []).every((p) => p.category === '格律知识'))

  // ── 评论 ──────────────────────────────────────────────
  section('⑦ 评论与敏感词')
  r = await call('POST', '/comments', {
    body: { postId, content: '这条是正常评论，应该直接发布。', authorName: '路人甲' }
  })
  ok('正常评论直接通过（auto 模式）', r.status === 200 && A(r).approved === true, JSON.stringify(r.body))

  r = await call('POST', '/comments', {
    body: { postId, content: '这是一条加微信的广告评论。', authorName: '广告号' }
  })
  ok('命中敏感词转待审', r.status === 200 && A(r).approved === false)

  r = await call('GET', `/comments?postId=${postId}`)
  const cList = A(r).list || []
  ok('前台只看到已通过的评论', cList.length === 1 && cList[0].author_name === '路人甲')
  const commentId = cList[0]?.id

  r = await call('POST', `/comments/${commentId}/like`)
  ok('评论点赞可用', r.status === 200 && A(r).likes === 1)

  r = await call('GET', '/admin/comments?status=pending', { token })
  ok('后台能看到待审评论', (A(r).list || []).length === 1)
  ok('待审计数正确', A(r).pending === 1)
  const pendingId = A(r).list[0].id

  r = await call('PUT', `/admin/comments/${pendingId}`, { token, body: { approve: true } })
  ok('审核通过可用', r.status === 200)

  r = await call('GET', `/comments?postId=${postId}`)
  ok('通过后前台可见 2 条', (A(r).list || []).length === 2)

  r = await call('PUT', `/admin/comments/${pendingId}`, {
    token,
    body: { content: '这是一条***的广告评论。' }
  })
  ok('后台改评论内容可用', r.status === 200)

  // ── 收藏 ──────────────────────────────────────────────
  section('⑧ 词笺收藏')
  const visitor = 'smoke-visitor-001'
  r = await call('POST', '/favorites', {
    body: { visitorId: visitor, targetType: 'poem', targetId: poem.id, snapshot: { cipaiName: '浣溪沙', text: '甲|乙' } }
  })
  ok('收藏词作成功', r.status === 200)

  r = await call('POST', '/favorites', {
    body: { visitorId: visitor, targetType: 'poem', targetId: poem.id, snapshot: { cipaiName: '浣溪沙', text: '改了' } }
  })
  ok('重复收藏走 UPSERT 不报错', r.status === 200)

  r = await call('GET', `/favorites?visitor=${visitor}`)
  const favs = A(r).list || []
  ok('同一目标只存一条', favs.length === 1, `实际 ${favs.length}`)
  ok('重复收藏覆盖了快照', JSON.parse(favs[0]?.snapshot_json || '{}').text === '改了')

  r = await call('DELETE', `/favorites/${favs[0].id}`)
  ok('移除收藏成功', r.status === 200)
  r = await call('GET', `/favorites?visitor=${visitor}`)
  ok('移除后列表为空', (A(r).list || []).length === 0)

  r = await call('POST', '/favorites', { body: { visitorId: '', targetType: 'poem', targetId: 1 } })
  ok('缺 visitor 被拒', r.status === 400)

  // ── 统计 ──────────────────────────────────────────────
  section('⑨ 数据看板')
  r = await call('GET', '/admin/stats?days=14', { token })
  const st = A(r)
  ok('看板可读', r.status === 200)
  ok('统计出文章数', Number.isFinite(st.posts?.total) && st.posts.total >= 1)
  ok('统计出填词次数', Number.isFinite(st.window?.generate) && st.window.generate >= 1)
  ok('返回时间序列数组', Array.isArray(st.series))
  ok('返回词牌分布数组', Array.isArray(st.poemsByCipai) && st.poemsByCipai.length >= 1)
  ok('返回最近生成', Array.isArray(st.recentPoems) && st.recentPoems.length >= 1)

  // ── 设置与敏感词 ──────────────────────────────────────
  section('⑩ 设置 · 敏感词 · 上传 · SEO')
  r = await call('PUT', '/admin/settings', { token, body: { site_name: '自测站点名' } })
  ok('保存设置成功', r.status === 200 && A(r).settings.site_name === '自测站点名')
  r = await call('GET', '/settings')
  ok('前台立刻读到新设置', A(r).site_name === '自测站点名')

  r = await call('GET', '/admin/banned-words', { token })
  ok('读敏感词成功', r.status === 200 && Array.isArray(A(r).list))
  r = await call('PUT', '/admin/banned-words', { token, body: { words: ['自测词', '加微信'] } })
  ok('写敏感词成功', r.status === 200 && A(r).count === 2)
  r = await call('GET', '/admin/banned-words', { token })
  ok('敏感词覆盖式写入（旧的被清掉）', A(r).list.length === 2)

  // 上传一张 1x1 PNG
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x05,
    0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
    0x60, 0x82
  ])
  const fd = new FormData()
  fd.append('file', new File([png], 'smoke.png', { type: 'image/png' }))
  r = await call('POST', '/admin/upload', { token, form: fd })
  const mediaUrl = A(r).url
  ok('图片上传成功', r.status === 200 && !!mediaUrl, JSON.stringify(r.body).slice(0, 120))

  if (mediaUrl) {
    const res = await handleApi({ request: new Request('http://127.0.0.1/api' + mediaUrl.replace(/^\/api/, '')), env })
    ok('上传后的图片能读回', res.status === 200 && res.headers.get('Content-Type') === 'image/png')
  }

  r = await call('GET', '/sitemap.xml')
  ok('sitemap 可读且含已发布文章', r.status === 200 && String(r.body).includes('smoke-draft-post'))
  r = await call('GET', '/robots.txt')
  ok('robots.txt 屏蔽 /admin', String(r.body).includes('Disallow: /admin'))

  r = await call('GET', '/not-a-real-endpoint')
  ok('未知接口 → 404', r.status === 404)

  // ── 文章批量与前台的可见性 ────────────────────────────
  section('⑪ 文章分页 · 批量操作')
  for (let i = 1; i <= 5; i++) {
    await call('POST', '/admin/posts', {
      token,
      body: {
        title: `批量用文章 ${i}`,
        content_md: `正文 ${i}`,
        category: i % 2 ? '格律知识' : '词作赏析',
        tags: ['批量', '自测'],
        status: i <= 2 ? 'published' : 'draft'
      }
    })
  }
  r = await call('GET', '/admin/posts?page=2&pageSize=3&sort=title', { token })
  ok('分页返回 page/pages/total', r.status === 200 && A(r).page === 2 && A(r).pages >= 2 && A(r).total >= 3, JSON.stringify({ page: A(r).page, total: A(r).total }))
  ok('分页每页条数受控', (A(r).list || []).length <= 3, String((A(r).list || []).length))

  r = await call('GET', '/admin/posts?status=draft', { token })
  const draftIds = (A(r).list || []).map((p) => p.id)
  ok('草稿筛选可用', draftIds.length >= 3 && (A(r).list || []).every((p) => p.status === 'draft'), String(draftIds.length))
  ok('草稿箱角标数字正确', A(r).counts?.draft >= 3, JSON.stringify(A(r).counts))

  r = await call('GET', '/admin/posts?category=' + encodeURIComponent('词作赏析'), { token })
  ok('分类筛选 + 计数', r.status === 200 && (A(r).list || []).every((p) => p.category === '词作赏析'))
  r = await call('GET', '/admin/posts?tag=' + encodeURIComponent('批量'), { token })
  ok('标签筛选命中', A(r).total >= 5, `total=${A(r).total}`)

  r = await call('PATCH', '/admin/posts/batch', { token, body: { ids: draftIds.slice(0, 2), action: 'publish' } })
  ok('批量发布', r.status === 200 && A(r).affected >= 2, JSON.stringify(r.body))
  r = await call('GET', '/admin/posts?status=draft', { token })
  ok('批量发布后草稿变少', !(A(r).list || []).some((p) => draftIds.slice(0, 2).includes(p.id)))

  r = await call('PATCH', '/admin/posts/batch', { token, body: { ids: draftIds.slice(0, 2), action: 'category', category: '工坊日志' } })
  ok('批量改分类', r.status === 200)
  r = await call('GET', '/admin/posts?category=' + encodeURIComponent('工坊日志'), { token })
  ok('批量改分类生效', A(r).total >= 2, `total=${A(r).total}`)

  r = await call('PATCH', '/admin/posts/batch', { token, body: { ids: draftIds.slice(0, 2), action: 'nonsense' } })
  ok('不支持的批量操作被拒', r.status === 400)
  r = await call('PATCH', '/admin/posts/batch', { token, body: { ids: [], action: 'publish' } })
  ok('没勾选就批量 → 400', r.status === 400)

  // 定时发布
  r = await call('POST', '/admin/posts', {
    token,
    body: { title: '定时发布的自测文章', content_md: 'x', status: 'published', published_at: '2027-01-02T08:05' }
  })
  const scheduledId = A(r).id
  r = await call('GET', `/admin/posts/${scheduledId}`, { token })
  ok('发布时间按「日期+时间」存', A(r).published_at === '2027-01-02 08:05:00', String(A(r).published_at))

  r = await call('PATCH', '/admin/posts/batch', { token, body: { ids: [scheduledId], action: 'delete' } })
  ok('批量删除', r.status === 200)
  r = await call('GET', `/admin/posts/${scheduledId}`, { token })
  ok('批量删除后确实没了', r.status === 404)

  // ── 评论批量与内联回复 ────────────────────────────────
  section('⑫ 评论批量 · 内联回复')
  for (let i = 1; i <= 3; i++) {
    await call('POST', '/comments', {
      body: { postId, authorName: '广告号' + i, content: `加微信 abc${i}，第 ${i} 条广告` }
    })
  }
  r = await call('GET', '/admin/comments', { token })
  ok('评论四态计数齐全', r.status === 200 && typeof A(r).counts.pending === 'number' && typeof A(r).counts.spam === 'number', JSON.stringify(A(r).counts))
  r = await call('GET', '/admin/comments?status=pending', { token })
  const spamIds = (A(r).list || []).map((c) => c.id)
  ok('待审筛选有内容', spamIds.length >= 3, String(spamIds.length))

  r = await call('POST', `/admin/comments/${spamIds[0]}/reply`, { token, body: { content: '谢谢留言，已处理。' } })
  ok('后台内联回复成功', r.status === 200 && A(r).id)
  r = await call('POST', `/admin/comments/${spamIds[0]}/reply`, { token, body: { content: '   ' } })
  ok('空回复被拒', r.status === 400)
  r = await call('POST', '/admin/comments/999999/reply', { token, body: { content: 'x' } })
  ok('回复不存在的评论 → 404', r.status === 404)

  r = await call('PATCH', '/admin/comments/batch', { token, body: { ids: spamIds.slice(0, 1), action: 'approve' } })
  ok('批量通过评论', r.status === 200)
  r = await call('PATCH', '/admin/comments/batch', { token, body: { ids: spamIds.slice(1), action: 'spam' } })
  ok('批量标垃圾', r.status === 200)
  r = await call('GET', '/admin/comments?status=spam', { token })
  ok('垃圾筛选命中', (A(r).list || []).length >= 2 && (A(r).list || []).every((c) => c.is_spam === 1))
  r = await call('PUT', `/admin/comments/${spamIds[1]}`, { token, body: { action: 'pending' } })
  ok('单条改回待审', r.status === 200)
  r = await call('PATCH', '/admin/comments/batch', { token, body: { ids: [spamIds[1]], action: 'delete' } })
  ok('批量删评论（连子回复一起删）', r.status === 200)

  // ── 媒体库 ────────────────────────────────────────────
  section('⑬ 媒体库（上传 · 尺寸 · 替换 · 删除）')
  // 一张 2×3 的合法 PNG：尺寸能被读出来才说明解析对了
  const png2x3 = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC8f2ZPAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
      'base64'
    )
  )
  const mkForm = (name, type, bytes) => {
    const fd = new FormData()
    fd.append('file', new Blob([bytes], { type }), name)
    return fd
  }
  r = await call('POST', '/admin/media/upload', { token, form: mkForm('封面图.png', 'image/png', png2x3) })
  ok('媒体库上传成功', r.status === 200 && A(r).id, JSON.stringify(r.body).slice(0, 150))
  ok('读出图片宽高', A(r).width === 2 && A(r).height === 3, `${A(r).width}x${A(r).height}`)
  const mediaId = A(r).id
  const mediaKey = A(r).key

  r = await call('POST', '/admin/media/upload', { token, form: mkForm('笔记.txt', 'text/plain', png2x3) })
  ok('非图片被拒', r.status === 400)

  r = await call('GET', '/admin/media', { token })
  ok('媒体库列表带 URL', r.status === 200 && (A(r).list || []).every((m) => m.url))
  r = await call('GET', '/admin/media?q=' + encodeURIComponent('封面'), { token })
  ok('媒体库搜索', A(r).total >= 1, `total=${A(r).total}`)
  r = await call('GET', `/admin/media/${mediaId}`, { token })
  ok('单张详情（含尺寸与上传时间）', r.status === 200 && A(r).width === 2 && !!A(r).uploaded_at)
  r = await call('GET', '/media/' + mediaKey)
  ok('图片能按 URL 读回', r.status === 200 && r.ct.startsWith('image/'), r.ct)

  r = await call('PATCH', `/admin/media/${mediaId}`, { token, body: { postId } })
  ok('图片关联到文章', r.status === 200 && A(r).post_id === postId, String(A(r).post_id))
  r = await call('GET', `/admin/media?postId=${postId}`, { token })
  ok('按文章筛媒体', A(r).total >= 1)

  r = await call('GET', '/admin/media', { token })
  const mediaBeforeReplace = A(r).total
  r = await call('POST', `/admin/media/${mediaId}/replace`, { token, form: mkForm('换了张图.png', 'image/png', png2x3) })
  ok('替换图片', r.status === 200 && A(r).width === 2, JSON.stringify(A(r)))
  r = await call('GET', '/admin/media', { token })
  ok('替换不会留下孤儿记录', A(r).total === mediaBeforeReplace, `${A(r).total} vs ${mediaBeforeReplace}`)

  r = await call('DELETE', `/admin/media/${mediaId}`, { token })
  ok('删除媒体', r.status === 200)
  r = await call('GET', '/admin/media', { token })
  ok('删除后少了一条', A(r).total === mediaBeforeReplace - 1, `total=${A(r).total}`)
  r = await call('GET', '/media/' + mediaKey)
  ok('删除后图片读不到了', r.status === 404, String(r.status))
  r = await call('DELETE', `/admin/media/${mediaId}`, { token })
  ok('重复删除 → 404', r.status === 404)

  // ── 分类与标签 ────────────────────────────────────────
  section('⑭ 分类与标签管理')
  r = await call('GET', '/admin/categories', { token })
  ok('分类列表带篇数', r.status === 200 && (A(r).list || []).length >= 4 && 'post_count' in (A(r).list || [])[0], JSON.stringify((A(r).list || [])[0]))
  ok('初始分类已就位', (A(r).list || []).some((c) => c.name === '填词教程'))

  r = await call('POST', '/admin/categories', { token, body: { name: '自测新分类', description: '描述', slug: 'selftest' } })
  ok('新建分类', r.status === 200 && A(r).id)
  const catId = A(r).id
  r = await call('POST', '/admin/categories', { token, body: { name: '自测新分类' } })
  ok('同名分类被拒', r.status === 409)
  r = await call('POST', '/admin/categories', { token, body: { name: '   ' } })
  ok('空名字被拒', r.status === 400)
  r = await call('PUT', `/admin/categories/${catId}`, { token, body: { name: '自测新分类改', description: '改了', slug: 'selftest2' } })
  ok('编辑分类', r.status === 200)
  r = await call('POST', '/admin/posts', { token, body: { title: '占用分类的文章', category: '自测新分类改', content_md: 'x' } })
  const catPostId = A(r).id
  r = await call('DELETE', `/admin/categories/${catId}`, { token })
  ok('分类还有文章时拒绝删除', r.status === 409, `${r.status} ${r.body?.message}`)
  r = await call('PATCH', '/admin/posts/batch', { token, body: { ids: [catPostId], action: 'category', category: '填词教程' } })
  ok('把文章挪到别的分类', r.status === 200)
  r = await call('DELETE', `/admin/categories/${catId}`, { token })
  ok('腾空后可删分类', r.status === 200, `${r.status} ${r.body?.message}`)

  r = await call('GET', '/admin/tags', { token })
  ok('标签列表含使用次数', r.status === 200 && Array.isArray(A(r).list) && Array.isArray(A(r).usage))
  r = await call('POST', '/admin/tags', { token, body: { name: '自测标签' } })
  ok('新建标签', r.status === 200 && A(r).id)
  const tagId = A(r).id
  r = await call('POST', '/admin/tags', { token, body: { name: '自测标签' } })
  ok('同名标签被拒', r.status === 409)
  r = await call('PUT', `/admin/tags/${tagId}`, { token, body: { name: '批量', color: 'cinnabar' } })
  ok('标签改名到「批量」（文章里在用）', r.status === 200)
  r = await call('GET', '/admin/tags', { token })
  ok('改名后文章里的标签同步计数', (A(r).list || []).find((t) => t.name === '批量')?.post_count >= 5, JSON.stringify((A(r).list || []).find((t) => t.name === '批量')))
  r = await call('DELETE', `/admin/tags/${tagId}`, { token })
  ok('删除标签', r.status === 200)
  r = await call('GET', '/admin/posts?tag=' + encodeURIComponent('批量'), { token })
  ok('删除标签后文章身上的也摘掉了', A(r).total === 0, `total=${A(r).total}`)

  // ── 看板 ──────────────────────────────────────────────
  section('⑮ 数据看板')
  r = await call('GET', '/admin/dashboard', { token })
  ok('看板四张卡片齐全', r.status === 200 && !!A(r).cards.posts && !!A(r).cards.views && !!A(r).cards.comments && !!A(r).cards.generate, JSON.stringify(A(r).cards).slice(0, 200))
  ok('文章卡片带待审数', Number.isFinite(A(r).cards.posts.pending), String(A(r).cards.posts.pending))
  ok('默认 7 天序列', (A(r).series || []).length === 7, String((A(r).series || []).length))
  ok('序列每项都有日期与四个指标', (A(r).series || []).every((d) => d.date && 'generate' in d && 'view' in d && 'share' in d && 'comment' in d))
  ok('热门文章 TOP5', Array.isArray(A(r).topPosts) && A(r).topPosts.length <= 5)
  ok('最近动态有内容', (A(r).recent || []).length > 0, String((A(r).recent || []).length))
  ok('动态带类型标记', (A(r).recent || []).every((x) => ['comment', 'publish', 'update'].includes(x.kind)))
  r = await call('GET', '/admin/dashboard?days=30', { token })
  ok('看板可指定天数', (A(r).series || []).length === 30, String((A(r).series || []).length))

  // ── 清理 ──────────────────────────────────────────────
  section('⑯ 清理与级联删除')
  r = await call('DELETE', `/admin/posts/${newId}`, { token })
  ok('删除文章成功', r.status === 200)

  const leftComments = await env.DB.prepare(`SELECT COUNT(*) AS n FROM blog_comments WHERE post_id = ?`)
    .bind(newId)
    .first()
  ok('文章删除后评论一并级联删除', leftComments.n === 0, `还剩 ${leftComments.n} 条`)

  r = await call('GET', '/posts/smoke-draft-post')
  ok('删除后前台查不到', r.status === 404)

  // ── 汇总 ──────────────────────────────────────────────
  console.log('\n  ══════════════════════════════')
  console.log(`  通过 ${pass} 项 · 失败 ${fail} 项`)
  if (failures.length) {
    console.log('\n  失败明细：')
    failures.forEach((f) => console.log('   · ' + f))
  }
  console.log('')
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('\n  ✗ 自测脚本本身出错：', e)
  process.exit(1)
})
