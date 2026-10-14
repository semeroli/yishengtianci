/**
 * 倚声 · API 总入口（单文件路由）
 * ─────────────────────────────────────────────────────────────
 * 同一份代码跑两个运行时：
 *   · 本地开发  → server/api-server.mjs（node:sqlite 模拟 D1）
 *   · 线上      → functions/api/[[path]].js（Cloudflare Pages Functions + 真 D1/R2/KV）
 *
 * 约定：
 *   · 所有表在首次请求时 CREATE TABLE IF NOT EXISTS（每个 isolate 只跑一次），
 *     所以一个全新的数据库不需要手工建表也能跑起来；
 *   · 统一响应体 { code, message, data }，code 0 成功 / 4xxx 客户端错 / 5xxx 服务端错；
 *   · 密钥一律从 env 读，代码里不出现明文。
 */

import { CIPAI, ALL_CIPAI, getCipai, isGeneratable } from './cipai.js'
import { RHYME_BU, BU_BY_ID, lookupChar, charsOf, rhymeTailStats } from './rhyme.js'
import { compose, recomposeLine, toPlainText, checkLine, annotate } from './engine.js'
import { ALL_TAGS } from './lexicon.js'
import { INSPIRATIONS } from './inspiration.js'

// ══════════════════════════════════════════ 基础工具

const enc = new TextEncoder()

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  })
}

const ok = (data) => json({ code: 0, message: 'ok', data })
const fail = (status, message, extra = {}) => json({ code: status, message, ...extra }, status)

async function readJson(request) {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

function toB64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH))
  }
  return btoa(s)
}

function fromB64(str) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'base64'))
  const bin = atob(str)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const b64url = (bytes) => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s) => fromB64(String(s).replace(/-/g, '+').replace(/_/g, '/'))

function timingSafeEqual(a, b) {
  const A = String(a)
  const B = String(b)
  if (A.length !== B.length) return false
  let d = 0
  for (let i = 0; i < A.length; i++) d |= A.charCodeAt(i) ^ B.charCodeAt(i)
  return d === 0
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacB64Url(msg, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg))
  return b64url(new Uint8Array(sig))
}

/**
 * 口令散列：pbkdf2$迭代数$盐$派生值
 * ⚠️ Cloudflare Workers 上 PBKDF2 的硬上限是 100,000 次迭代
 *    （超过会直接 500 且响应体为空），所以这里固定 10 万，不要照抄 OWASP 的 60 万。
 */
const PBKDF2_ITER = 100000

export async function hashPassword(pwd) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', enc.encode(String(pwd)), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    key,
    256
  )
  return `pbkdf2$${PBKDF2_ITER}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`
}

export async function verifyPassword(pwd, stored) {
  const parts = String(stored || '').split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iter = parseInt(parts[1], 10) || PBKDF2_ITER
  const salt = unb64url(parts[2])
  const expect = parts[3]
  const key = await crypto.subtle.importKey('raw', enc.encode(String(pwd)), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    key,
    256
  )
  return timingSafeEqual(b64url(new Uint8Array(bits)), expect)
}

// ── 令牌（HMAC 签名，无状态） ───────────────────────────────

function siteSecret(env) {
  const s = env.SITE_SECRET
  if (s && String(s).length >= 16) return String(s)
  return 'yisheng-dev-secret-please-change-in-production'
}

/**
 * 令牌里的过期时间统一用**秒**（与 JWT 惯例一致）。
 * 不用毫秒的原因：毫秒精度会让「同一秒内两次登录」签出两个不同的令牌，
 * 无谓地让令牌看起来是随机的（排查问题时会误以为有随机盐）。
 * 校验时按数量级自动识别单位，老令牌（毫秒）也照常有效。
 */
const nowSec = () => Math.floor(Date.now() / 1000)
const expPassed = (exp) => {
  if (!exp) return true
  const now = exp > 1e11 ? Date.now() : nowSec()
  return exp < now
}

async function issueToken(env, user, hours = 72, sid = '') {
  const payload = {
    uid: user.id,
    u: user.username,
    r: user.role || 'admin',
    exp: nowSec() + hours * 3600
  }
  if (sid) payload.sid = sid
  const body = b64url(enc.encode(JSON.stringify(payload)))
  const sig = await hmacB64Url(body, siteSecret(env))
  return `${body}.${sig}`
}

async function readToken(env, request) {
  const h = request.headers.get('Authorization') || ''
  const raw = h.startsWith('Bearer ') ? h.slice(7) : request.headers.get('X-Admin-Token') || ''
  if (!raw || !raw.includes('.')) return null
  const [body, sig] = raw.split('.')
  const expect = await hmacB64Url(body, siteSecret(env))
  if (!timingSafeEqual(sig, expect)) return null
  try {
    const payload = JSON.parse(new TextDecoder().decode(unb64url(body)))
    if (expPassed(payload.exp)) return null
    return payload
  } catch {
    return null
  }
}

async function requireAdmin(env, request) {
  const t = await readToken(env, request)
  if (!t) return null
  // 令牌签名有效 ≠ 会话还在（可能刚被「注销所有会话」清掉）
  if (t.sid) {
    const alive = await kvGet(env, SESSION_PREFIX + t.sid)
    if (!alive) return null
  }
  try {
    const row = await env.DB.prepare(`SELECT id, username, display_name, role FROM users WHERE id = ?`).bind(t.uid).first()
    return row || null
  } catch {
    return null
  }
}

// ══════════════════════════════════════════ 会话 / 登录防护 / 两步验证

/**
 * 会话存放：KV（规格要求「Session 存储在 KV，有效期 24 小时」）。
 * · 令牌是 HMAC 签名的无状态串，但**同时**在 KV 留一条会话记录——
 *   这样「退出登录」「注销所有会话」才能真正生效（纯无状态令牌是注销不掉的）。
 * · 没有 KV 绑定时退化到进程内存，本地开发够用。
 */
const SESSION_TTL_SEC = 24 * 3600
const SESSION_PREFIX = 'sess:'
const LOCK_MAX_FAILS = 5      // 连续失败 5 次
const LOCK_MINUTES = 15       // 锁定 15 分钟

const memKv = new Map()

async function kvPut(env, key, value, ttlSec) {
  if (env.CACHE_KV) {
    try {
      await env.CACHE_KV.put(key, value, { expirationTtl: ttlSec })
      return
    } catch {}
  }
  memKv.set(key, { v: String(value), exp: Date.now() + ttlSec * 1000 })
  if (memKv.size > 4000) {
    const now = Date.now()
    for (const [k, e] of memKv) if (e.exp && e.exp < now) memKv.delete(k)
    if (memKv.size > 4000) memKv.clear()
  }
}

async function kvGet(env, key) {
  if (env.CACHE_KV) {
    try {
      const v = await env.CACHE_KV.get(key)
      if (v !== null && v !== undefined) return v
    } catch {}
  }
  const hit = memKv.get(key)
  if (!hit) return null
  if (hit.exp && hit.exp < Date.now()) {
    memKv.delete(key)
    return null
  }
  return hit.v
}

async function kvDel(env, key) {
  if (env.CACHE_KV) {
    try {
      await env.CACHE_KV.delete(key)
    } catch {}
  }
  memKv.delete(key)
}

const randomId = (n = 16) => b64url(crypto.getRandomValues(new Uint8Array(n)))

/** 签发会话：令牌里带 sid，KV 里存这条 sid 的详情 */
async function createSession(env, user, request) {
  const sid = randomId(16)
  const rec = {
    uid: user.id,
    username: user.username,
    role: user.role || 'admin',
    ip: clientKey(request),
    ua: String(request.headers.get('User-Agent') || '').slice(0, 200),
    created: nowSec()
  }
  await kvPut(env, SESSION_PREFIX + sid, JSON.stringify(rec), SESSION_TTL_SEC)
  const token = await issueToken(env, user, SESSION_TTL_SEC / 3600, sid)
  return { token, sid, expiresIn: SESSION_TTL_SEC }
}

async function destroySession(env, request) {
  const t = await readToken(env, request)
  if (t?.sid) await kvDel(env, SESSION_PREFIX + t.sid)
}

/** 「注销所有会话」：把该账号的所有 sid 登记表清空 */
async function destroyAllSessions(env, uid) {
  const listKey = `sessidx:${uid}`
  const raw = await kvGet(env, listKey)
  const sids = safeJson(raw || '[]', [])
  for (const sid of sids) await kvDel(env, SESSION_PREFIX + sid)
  await kvDel(env, listKey)
}

async function trackSession(env, uid, sid) {
  const listKey = `sessidx:${uid}`
  const raw = await kvGet(env, listKey)
  const sids = safeJson(raw || '[]', [])
  if (!sids.includes(sid)) sids.push(sid)
  // 只保留最近 40 条，避免无限增长
  await kvPut(env, listKey, JSON.stringify(sids.slice(-40)), SESSION_TTL_SEC * 2)
}

// ── 两步验证（TOTP / RFC 6238，纯 JS，不引依赖） ──────────────

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes) {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

function base32Decode(str) {
  const s = String(str || '')
    .toUpperCase()
    .replace(/[\s=]+/g, '')
  let bits = 0
  let value = 0
  const out = []
  for (const ch of s) {
    const idx = B32.indexOf(ch)
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

async function hotp(secretBytes, counter, digits = 6) {
  const buf = new ArrayBuffer(8)
  const view = new DataView(buf)
  view.setUint32(0, Math.floor(counter / 0x100000000) >>> 0)
  view.setUint32(4, counter >>> 0)
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf))
  const off = sig[sig.length - 1] & 0x0f
  const num = ((sig[off] & 0x7f) << 24) | (sig[off + 1] << 16) | (sig[off + 2] << 8) | sig[off + 3]
  return String(num % 10 ** digits).padStart(digits, '0')
}

/** 允许前后各 1 个时间窗（共 ±30 秒），容忍手机与服务端的时钟偏差 */
async function verifyTotp(secret, code, { window = 1, step = 30, digits = 6 } = {}) {
  const clean = String(code || '').replace(/\D/g, '')
  if (clean.length !== digits) return false
  const bytes = base32Decode(secret)
  if (!bytes.length) return false
  const t = Math.floor(Date.now() / 1000)
  for (let i = -window; i <= window; i++) {
    const expect = await hotp(bytes, Math.floor((t + i * step) / step), digits)
    if (timingSafeEqual(clean, expect)) return true
  }
  return false
}

const newTotpSecret = () => base32Encode(crypto.getRandomValues(new Uint8Array(20)))

function otpauthUrl(username, secret, issuer = '倚声') {
  const label = encodeURIComponent(`${issuer}:${username}`)
  const q = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' })
  return `otpauth://totp/${label}?${q.toString()}`
}

// ── 登录防护：连续失败 5 次锁 15 分钟 ────────────────────────

async function lockState(env, row) {
  if (!row?.locked_until) return { locked: false, minutes: 0 }
  try {
    const r = await env.DB.prepare(
      `SELECT CAST((julianday(?) - julianday('now')) * 1440 AS INTEGER) AS mins`
    )
      .bind(row.locked_until)
      .first()
    const mins = r?.mins || 0
    return mins > 0 ? { locked: true, minutes: mins } : { locked: false, minutes: 0 }
  } catch {
    return { locked: false, minutes: 0 }
  }
}

async function bumpFailCount(env, userId) {
  try {
    await env.DB.prepare(
      `UPDATE users
          SET failed_count = COALESCE(failed_count, 0) + 1,
              locked_until = CASE WHEN COALESCE(failed_count, 0) + 1 >= ${LOCK_MAX_FAILS}
                                  THEN datetime('now', '+${LOCK_MINUTES} minutes') ELSE locked_until END
        WHERE id = ?`
    )
      .bind(userId)
      .run()
  } catch {}
}

async function clearFailCount(env, userId) {
  try {
    await env.DB.prepare(`UPDATE users SET failed_count = 0, locked_until = NULL WHERE id = ?`).bind(userId).run()
  } catch {}
}

async function logLogin(env, { adminId = null, username = '', request, success = 0, reason = '' }) {
  try {
    // 云端 Pages Functions 有 request.cf（城市/国家），本地没有
    const cf = request.cf || {}
    const city = [cf.city, cf.region, cf.country].filter(Boolean).join(' ') || (request.headers.get('CF-Connecting-IP') ? '' : '本地')
    await env.DB.prepare(
      `INSERT INTO login_logs (admin_id, username, ip_address, user_agent, city, success, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        adminId,
        String(username).slice(0, 60),
        String(clientKey(request)).slice(0, 60),
        String(request.headers.get('User-Agent') || '').slice(0, 200),
        String(city).slice(0, 60),
        success ? 1 : 0,
        reason
      )
      .run()
  } catch {}
}

// ── 建表（每个 isolate 只跑一次） ────────────────────────────

const schemaReady = new WeakSet()

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, display_name TEXT DEFAULT '', role TEXT DEFAULT 'admin', must_change_pwd INTEGER DEFAULT 0, totp_secret TEXT DEFAULT '', totp_enabled INTEGER DEFAULT 0, failed_count INTEGER DEFAULT 0, locked_until TEXT, last_login_at TEXT, created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS login_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER, username TEXT DEFAULT '', ip_address TEXT DEFAULT '', user_agent TEXT DEFAULT '', city TEXT DEFAULT '', success INTEGER DEFAULT 0, reason TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_login_logs_admin ON login_logs(admin_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_login_logs_time ON login_logs(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS ci_pai (id TEXT PRIMARY KEY, name TEXT NOT NULL, alias TEXT DEFAULT '', syllables TEXT DEFAULT '', sentences TEXT DEFAULT '', style_tag TEXT DEFAULT '', rhyme_type TEXT DEFAULT '', tones_json TEXT DEFAULT '', example TEXT DEFAULT '', example_author TEXT DEFAULT '', description TEXT DEFAULT '', sort_order INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, updated_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS poems (id INTEGER PRIMARY KEY AUTOINCREMENT, cipai_id TEXT NOT NULL, cipai_name TEXT NOT NULL, prompt TEXT DEFAULT '', content_json TEXT NOT NULL, content_text TEXT DEFAULT '', engine TEXT DEFAULT 'local', model TEXT DEFAULT '', visitor_id TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_poems_created ON poems(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_poems_cipai ON poems(cipai_id)`,
  `CREATE TABLE IF NOT EXISTS blog_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, content_md TEXT DEFAULT '', excerpt TEXT DEFAULT '', cover_image TEXT DEFAULT '', category TEXT DEFAULT '填词教程', tags TEXT DEFAULT '[]', status TEXT DEFAULT 'draft', author TEXT DEFAULT '管理员', view_count INTEGER DEFAULT 0, share_count INTEGER DEFAULT 0, like_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), published_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_status ON blog_posts(status, published_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_slug ON blog_posts(slug)`,
  `CREATE TABLE IF NOT EXISTS blog_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, author_name TEXT DEFAULT '匿名', author_email TEXT DEFAULT '', content TEXT NOT NULL, parent_id INTEGER DEFAULT NULL, likes INTEGER DEFAULT 0, is_approved INTEGER DEFAULT 0, is_spam INTEGER DEFAULT 0, ip_hash TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_comments_post ON blog_comments(post_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_state ON blog_comments(is_spam, is_approved, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS favorites (id INTEGER PRIMARY KEY AUTOINCREMENT, visitor_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id INTEGER NOT NULL, snapshot_json TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), UNIQUE(visitor_id, target_type, target_id))`,
  `CREATE INDEX IF NOT EXISTS idx_fav_visitor ON favorites(visitor_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT DEFAULT '', updated_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS stats_events (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, ref_id TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_events_kind ON stats_events(kind, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS media (key TEXT PRIMARY KEY, filename TEXT DEFAULT '', content_type TEXT DEFAULT '', size INTEGER DEFAULT 0, data_b64 TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS media_files (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT DEFAULT '', original_name TEXT DEFAULT '', r2_key TEXT DEFAULT '', storage TEXT DEFAULT 'db', mime_type TEXT DEFAULT '', size_bytes INTEGER DEFAULT 0, width INTEGER DEFAULT 0, height INTEGER DEFAULT 0, post_id INTEGER DEFAULT NULL, uploaded_at TEXT DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_media_uploaded ON media_files(uploaded_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_media_post ON media_files(post_id)`,
  `CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, slug TEXT DEFAULT '', description TEXT DEFAULT '', sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, slug TEXT DEFAULT '', color TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS banned_words (word TEXT PRIMARY KEY)`
]

/**
 * 老库补列（CREATE TABLE IF NOT EXISTS 不会给已存在的表加列）。
 * SQLite 没有 ADD COLUMN IF NOT EXISTS，只能靠 try/catch 兜住「列已存在」。
 */
const MIGRATION_COLUMNS = [
  `ALTER TABLE users ADD COLUMN totp_secret TEXT DEFAULT ''`,
  `ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN failed_count INTEGER DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN locked_until TEXT`,
  `ALTER TABLE blog_comments ADD COLUMN is_spam INTEGER DEFAULT 0`,
  `ALTER TABLE media ADD COLUMN width INTEGER DEFAULT 0`,
  `ALTER TABLE media ADD COLUMN height INTEGER DEFAULT 0`
]

const DEFAULT_CATEGORIES = [
  ['填词教程', 'tutorial', '格律基础、韵书入门与填词方法', 10],
  ['词作赏析', 'appreciation', '历代名篇的读法与技法拆解', 9],
  ['词牌考据', 'cipai', '词牌的来历、别名与格律流变', 8],
  ['工坊日志', 'journal', '倚声工坊的更新与随想', 1]
]

const DEFAULT_BANNED = ['广告', '加微信', '代写', '刷单', '赌博', '办证', '博彩', '色情', '枪支', '毒品', 'http://', 'https://', 'www.']

async function ensureSchema(env) {
  const db = env.DB
  if (!db) throw new Error('数据库未绑定（env.DB 为空）')
  if (schemaReady.has(db)) return
  for (const sql of SCHEMA_STATEMENTS) {
    try {
      await db.prepare(sql).run()
    } catch (e) {
      // 单个语句失败不应让整站挂掉（例如表已存在但索引冲突）
      console.warn('[schema]', sql.slice(0, 60), e?.message)
    }
  }
  // 给老库补列：列已存在时 SQLite 会报错，静默跳过即可
  for (const sql of MIGRATION_COLUMNS) {
    try {
      await db.prepare(sql).run()
    } catch {}
  }
  // 敏感词种子
  try {
    const c = await db.prepare(`SELECT COUNT(*) AS n FROM banned_words`).first()
    if (!c || !c.n) {
      const stmts = DEFAULT_BANNED.map((w) => db.prepare(`INSERT OR IGNORE INTO banned_words (word) VALUES (?)`).bind(w))
      if (db.batch) await db.batch(stmts)
      else for (const s of stmts) await s.run()
    }
  } catch {}
  // 分类种子（后台「N 篇」统计需要一张清单表）
  try {
    const c = await db.prepare(`SELECT COUNT(*) AS n FROM categories`).first()
    if (!c || !c.n) {
      const stmts = DEFAULT_CATEGORIES.map(([name, slug, desc, order]) =>
        db.prepare(`INSERT OR IGNORE INTO categories (name, slug, description, sort_order) VALUES (?, ?, ?, ?)`).bind(name, slug, desc, order)
      )
      if (db.batch) await db.batch(stmts)
      else for (const s of stmts) await s.run()
    }
  } catch {}
  schemaReady.add(db)
}

// ── 设置项 ──────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  site_name: '倚声 · AI填词工坊',
  site_desc: '输入一段意境，选一个词牌，得一首合律的词。',
  // 站头/页脚的品牌记号。留空 ⇒ 前台渲染朱砂方印「倚」（与 favicon 同一枚记号）。
  // 1.0 时这里是 '🏮'；前台把那个旧默认值仍当作「未设置」，所以老库不用手工改。
  logo: '',
  favicon: '',
  footer_note: '倚声填词，以韵为骨。',
  copyright: '© 倚声 · AI填词工坊',
  seo_title: '倚声 · AI填词工坊 —— 合律填词，以韵为骨',
  seo_desc: '输入一段意境，选一个词牌，得一首合律的词。内置词林正韵与十个常用词牌格律。',
  social_weibo: '',
  social_github: '',
  social_wechat: '',
  social_email: '',
  comment_moderation: 'auto',
  show_engine_badge: '1',
  about_md: ''
}

/** 前台能看到的设置（审核策略这类内部开关不外泄） */
const PUBLIC_SETTING_KEYS = new Set([
  'site_name',
  'site_desc',
  'logo',
  'favicon',
  'footer_note',
  'copyright',
  'seo_title',
  'seo_desc',
  'social_weibo',
  'social_github',
  'social_wechat',
  'social_email',
  'show_engine_badge',
  'about_md'
])

async function getSettings(env) {
  const out = { ...DEFAULT_SETTINGS }
  try {
    const { results } = await env.DB.prepare(`SELECT key, value FROM settings`).all()
    for (const r of results || []) if (r.key in out || true) out[r.key] = r.value
  } catch {}
  return out
}

async function putSettings(env, patch) {
  const entries = Object.entries(patch || {}).filter(([k]) => /^[a-z0-9_]{2,40}$/i.test(k))
  if (!entries.length) return 0
  const stmts = entries.map(([k, v]) =>
    env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).bind(k, String(v ?? ''))
  )
  if (env.DB.batch) await env.DB.batch(stmts)
  else for (const s of stmts) await s.run()
  return entries.length
}

// ── 词牌（合并代码内置 + 数据库增补） ───────────────────────

async function listCipai(env) {
  let rows = []
  try {
    const r = await env.DB.prepare(`SELECT * FROM ci_pai WHERE enabled = 1`).all()
    rows = r.results || []
  } catch {}
  const byId = new Map(rows.map((r) => [r.id, r]))
  const merged = ALL_CIPAI.map((c) => {
    const over = byId.get(c.id)
    const base = {
      id: c.id,
      name: c.name,
      alias: c.alias || [],
      syllables: c.syllables,
      sentenceCount: c.sentenceCount || c.lines.length,
      styleTag: c.styleTag,
      rhymeType: c.rhymeType,
      rhymeGroups: c.rhymeGroups || [],
      origin: c.origin || '',
      description: c.description || '',
      highlights: c.highlights || '',
      masterpieces: c.masterpieces || [],
      generatable: isGeneratable(c),
      note: c.note || '',
      lines: c.lines || [],
      sortOrder: 0
    }
    if (over) {
      return {
        ...base,
        description: over.description || base.description,
        styleTag: over.style_tag || base.styleTag,
        syllables: Number(over.syllables) || base.syllables,
        sortOrder: over.sort_order || 0
      }
    }
    return base
  })
  // 数据库里独有、代码里没有的词条也算进来
  for (const r of rows) {
    if (merged.some((m) => m.id === r.id)) continue
    merged.push({
      id: r.id,
      name: r.name,
      alias: safeJson(r.alias, []),
      syllables: Number(r.syllables) || 0,
      sentenceCount: Number(r.sentences) || 0,
      styleTag: r.style_tag,
      rhymeType: r.rhyme_type,
      rhymeGroups: [],
      origin: '',
      description: r.description,
      highlights: '',
      masterpieces: r.example ? [{ title: r.example_author || '', author: r.example_author || '', text: r.example }] : [],
      generatable: false,
      note: '该词条由后台添加，格律谱待补。',
      lines: [],
      sortOrder: r.sort_order || 0
    })
  }
  merged.sort((a, b) => (b.sortOrder - a.sortOrder) || (a.syllables - b.syllables))
  return merged
}

function safeJson(s, dflt) {
  try {
    const v = JSON.parse(s)
    return v ?? dflt
  } catch {
    return dflt
  }
}

// ── 敏感词 ──────────────────────────────────────────────────

async function bannedList(env) {
  try {
    const r = await env.DB.prepare(`SELECT word FROM banned_words`).all()
    return (r.results || []).map((x) => x.word)
  } catch {
    return DEFAULT_BANNED
  }
}

async function filterContent(env, text) {
  const list = await bannedList(env)
  const hits = list.filter((w) => w && text.includes(w))
  let out = text
  for (const w of hits) out = out.split(w).join('＊'.repeat(Math.min(w.length, 4)))
  return { clean: out, hits }
}

// ── 简易限流（有 KV 用 KV，否则用 isolate 内存） ─────────────

const memRate = new Map()

async function rateLimit(env, key, limit, windowSec) {
  const bucket = Math.floor(Date.now() / (windowSec * 1000))
  const k = `rl:${key}:${bucket}`
  if (env.CACHE_KV) {
    try {
      const cur = parseInt((await env.CACHE_KV.get(k)) || '0', 10)
      if (cur >= limit) return false
      await env.CACHE_KV.put(k, String(cur + 1), { expirationTtl: windowSec + 5 })
      return true
    } catch {}
  }
  const n = (memRate.get(k) || 0) + 1
  memRate.set(k, n)
  if (memRate.size > 5000) memRate.clear()
  return n <= limit
}

const clientKey = (request) =>
  request.headers.get('CF-Connecting-IP') ||
  request.headers.get('X-Forwarded-For') ||
  request.headers.get('X-Real-IP') ||
  'local'

// ── AI 通道（可选） ─────────────────────────────────────────

const AI_TIMEOUT_MS = 45000

async function callUpstream(env, messages, { maxTokens = 1200 } = {}) {
  const base = (env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const model = env.AI_MODEL || 'gpt-4o-mini'
  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.AI_API_KEY ? { Authorization: `Bearer ${env.AI_API_KEY}` } : {})
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.85,
      max_tokens: maxTokens,
      // 推理型模型会先花掉 max_tokens 再输出 content，这里明确关掉思考
      ...(env.AI_DISABLE_THINKING === '1' ? { enable_thinking: false } : {})
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS)
  })
  if (!resp.ok) {
    let hint = ''
    try {
      const j = await resp.json()
      hint = j?.error?.message || j?.message || ''
    } catch {}
    const err = new Error(`上游返回 ${resp.status}${hint ? '：' + hint : ''}`)
    err.status = resp.status
    err.retryable = resp.status === 429 || resp.status >= 500
    throw err
  }
  const body = await resp.json().catch(() => null)
  if (!body) throw new Error('上游返回的不是 JSON')
  if (!body.choices) throw new Error('上游响应缺少 choices 字段')
  const msg = body.choices[0]?.message || {}
  const text = msg.content || msg.reasoning_content || ''
  if (!text) throw new Error(`上游未返回内容（finish_reason=${body.choices[0]?.finish_reason || '?'}）`)
  return { text, model }
}

function buildAiPrompt(cipai, prompt) {
  const groups = cipai.rhymeGroups?.length ? cipai.rhymeGroups : [{ key: true, type: '平' }]
  const buHint = RHYME_BU.filter((b) => b.tone === groups[0].type)
    .slice(0, 4)
    .map((b) => `${b.short}（如 ${b.chars.slice(0, 14).join('')}）`)
    .join('、')
  const lines = cipai.lines
    .map((l, i) => `第${i + 1}句(${l.p.length}字)：${l.p}${l.r ? '  ← 押韵' : ''}`)
    .join('\n')
  return [
    '你是一位精通《词林正韵》的词学专家，擅长依谱填词。',
    `请依下列格律填写一首《${cipai.name}》。`,
    `【意境】${prompt || '（无特别要求，请自行立意）'}`,
    `【格律】共 ${cipai.lines.length} 句。○=平声 ●=仄声 ◐=可平可仄：`,
    lines,
    `【押韵】标「押韵」的句子押同一${groups[0].type}声韵，建议韵部：${buHint}。`,
    '【硬性要求】',
    '1. 每句字数必须与标注完全一致，不增不减，不加标点；',
    '2. 每句第 2、4、6 位与末字必须合谱；第 1、3、5 位可通融；',
    '3. 押韵句的末字必须与给定韵部同韵，且不得重复用同一个韵脚字；',
    '4. 全篇意境统一，同一个字尽量不重复出现；',
    '5. 只输出 JSON，不要解释、不要代码块围栏，格式：{"lines":["第一句","第二句"]}'
  ].join('\n')
}

function parseAiLines(text, expected) {
  let s = String(text).trim()
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  let obj = null
  const tryParse = (t) => {
    try {
      return JSON.parse(t)
    } catch {
      return null
    }
  }
  obj = tryParse(s)
  if (!obj) {
    const a = s.indexOf('{')
    const b = s.lastIndexOf('}')
    if (a >= 0 && b > a) obj = tryParse(s.slice(a, b + 1))
  }
  let arr = obj?.lines || obj?.sentences || (Array.isArray(obj) ? obj : null)
  if (!Array.isArray(arr)) {
    // 退化：按换行/逗号切
    arr = s
      .split(/[\n，。！？；、,]/)
      .map((x) => x.replace(/[^\u4e00-\u9fa5]/g, ''))
      .filter(Boolean)
  }
  arr = arr.map((x) => String(x).replace(/[^\u4e00-\u9fa5]/g, ''))
  if (arr.length !== expected) return null
  return arr
}

/**
 * 尝试用大模型填词。
 * 返回 { ok:true, poem, model } 或 { ok:false, reason }
 * 任何一步不达标都退化到本地引擎 —— 宁可退，不给用户一首不合律的词。
 */
async function aiCompose(env, { cipai, prompt }) {
  if (!env.AI_API_KEY) return { ok: false, reason: '未配置 AI_API_KEY' }
  const messages = [
    { role: 'system', content: '你是精通词律的中文古典诗词专家，只输出 JSON。' },
    { role: 'user', content: buildAiPrompt(cipai, prompt) }
  ]
  let last = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text, model } = await callUpstream(env, messages, { maxTokens: 1600 })
      const arr = parseAiLines(text, cipai.lines.length)
      if (!arr) {
        last = '模型输出的句数或格式不符'
        continue
      }
      // 逐句校验
      const bad = []
      arr.forEach((line, i) => {
        const spec = cipai.lines[i]
        if (line.length !== spec.p.length) {
          bad.push(`第${i + 1}句字数 ${line.length}≠${spec.p.length}`)
          return
        }
        const chk = checkLine(spec.p, line)
        if (chk.hard > 0) bad.push(`第${i + 1}句平仄失律×${chk.hard}`)
      })
      // 韵脚检查
      const groupOk = new Map()
      const groupChars = new Map()
      const buByGroup = new Map()
      cipai.lines.forEach((spec, i) => {
        if (!spec.r) return
        const key = String(spec.r)
        const last = arr[i][arr[i].length - 1]
        if (!buByGroup.has(key)) {
          // 取该韵组第一个韵脚字的韵部
          const cands = lookupChar(last).filter((id) => BU_BY_ID[id]?.tone === (cipai.rhymeGroups.find((g) => String(g.key) === key)?.type || '平'))
          buByGroup.set(key, cands[0] || null)
        }
        const bu = buByGroup.get(key)
        if (!bu) {
          bad.push(`第${i + 1}句韵脚「${last}」不在预想韵部`)
          return
        }
        if (!groupChars.has(key)) groupChars.set(key, new Set())
        groupChars.get(key).add(last)
        if (!charsOf(bu).includes(last)) bad.push(`第${i + 1}句韵脚「${last}」出韵`)
      })
      for (const [k, set] of groupChars) {
        const expectCount = cipai.lines.filter((l) => String(l.r) === k).length
        if (set.size < Math.ceil(expectCount * 0.7)) bad.push(`韵脚字重复过多（${k} 组仅 ${set.size} 个不同字）`)
      }

      if (bad.length) {
        last = bad.slice(0, 4).join('；')
        continue
      }
      return { ok: true, lines: arr, model }
    } catch (e) {
      last = e?.message || String(e)
      if (!e?.retryable) break
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
  return { ok: false, reason: last || 'AI 通道失败' }
}

/** 把 AI 给出的句子包装成与本地引擎一致的词作结构 */
function wrapAiPoem(cipai, prompt, lines, model) {
  const poemLines = cipai.lines.map((spec, i) => {
    const chk = checkLine(spec.p, lines[i])
    return {
      index: i,
      text: lines[i],
      pattern: spec.p,
      rhythm: spec.rhythm,
      note: spec.note,
      rhyme: !!spec.r,
      rhymeGroup: spec.r ? String(spec.r) : null,
      buId: null,
      soft: chk.soft,
      chars: annotate(lines[i]).map((c, j) => ({
        ch: c.ch,
        spec: spec.p[j] || '◐',
        actual: c.tone,
        strict: (j + 1) % 2 === 0 || j + 1 === spec.p.length,
        hit: spec.p[j] === '◐' || c.tone === '◐' ? null : spec.p[j] === c.tone,
        isLast: j === lines[i].length - 1
      })),
      verdict: chk.hard > 0 ? '破格' : chk.soft > 0 ? '变体' : '正格',
      deviations: chk.deviations
    }
  })
  const groups = new Map()
  cipai.lines.forEach((spec, i) => {
    if (!spec.r) return
    const k = String(spec.r)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(lines[i][lines[i].length - 1])
  })
  const rhyme = [...groups.entries()].map(([k, chars]) => {
    const tone = cipai.rhymeGroups.find((g) => String(g.key) === k)?.type || '平'
    const buIds = lookupChar(chars[0]).filter((id) => BU_BY_ID[id]?.tone === tone)
    const bu = buIds[0] ? BU_BY_ID[buIds[0]] : null
    return {
      buId: bu?.id || '',
      buName: bu?.name || '（由模型自选）',
      short: bu?.short || '—',
      tone,
      chars,
      sameRhyme: new Set(chars).size === chars.length
    }
  })
  return {
    cipaiId: cipai.id,
    cipaiName: cipai.name,
    syllables: cipai.syllables,
    generatedSyllables: lines.join('').length,
    styleTag: cipai.styleTag,
    prompt,
    engine: 'ai',
    model,
    lines: poemLines,
    rhyme,
    tags: [],
    appreciation: '',
    createdAt: new Date().toISOString()
  }
}

// ══════════════════════════════════════════ 路由

export async function handleApi({ request, env }) {
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/'
  const method = request.method.toUpperCase()

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    if (path === '/health') return ok({ status: 'up', time: new Date().toISOString() })
    await ensureSchema(env)
    const res = await route(path, method, { url, request, env })
    if (res) return res
    return fail(404, `接口不存在：${method} ${path}`)
  } catch (e) {
    const msg = e?.message || String(e)
    console.error('[api]', method, path, msg)
    return fail(500, '服务端错误：' + msg)
  }
}

async function route(path, method, ctx) {
  const { url, request, env } = ctx
  const q = url.searchParams

  // ── 公共：词牌 ────────────────────────────────────────────
  if (path === '/cipai' && method === 'GET') {
    const list = await listCipai(env)
    return ok({
      list: list.map((c) => ({
        id: c.id,
        name: c.name,
        alias: c.alias,
        syllables: c.syllables,
        sentenceCount: c.sentenceCount,
        styleTag: c.styleTag,
        rhymeType: c.rhymeType,
        description: c.description,
        origin: c.origin,
        highlights: c.highlights,
        masterpieces: c.masterpieces,
        generatable: c.generatable,
        note: c.note,
        lines: c.lines
      })),
      styleTags: [...new Set(list.map((c) => c.styleTag).filter(Boolean))],
      tags: ALL_TAGS
    })
  }

  let m = path.match(/^\/cipai\/([\w-]+)$/)
  if (m && method === 'GET') {
    const c = await listCipai(env).then((l) => l.find((x) => x.id === m[1]))
    if (!c) return fail(404, '未找到该词牌')
    return ok(c)
  }

  // ── 公共：填词生成 ───────────────────────────────────────
  if (path === '/generate' && method === 'POST') {
    if (!(await rateLimit(env, `gen:${clientKey(request)}`, 30, 60))) {
      return fail(429, '填词请求过于频繁，请稍候再试')
    }
    const body = await readJson(request)
    const cipai = getCipai(body.cipaiId)
    if (!cipai) return fail(400, '请选择一个词牌')
    if (!isGeneratable(cipai)) {
      return fail(
        400,
        `《${cipai.name}》的格律谱尚未整理，暂不支持自动填词。可在页面上查看它的简介与代表作。`
      )
    }
    const prompt = String(body.prompt || '').slice(0, 500)
    if (prompt.trim().length < 4) return fail(400, '请先写下你的意境（至少几个字）')

    let poem = null
    let engineNote = ''
    if (env.AI_API_KEY) {
      const ai = await aiCompose(env, { cipai, prompt })
      if (ai.ok) {
        poem = wrapAiPoem(cipai, prompt, ai.lines, ai.model)
      } else {
        engineNote = `AI 通道未使用（${ai.reason}），已改用本地格律引擎`
      }
    } else {
      engineNote = '未配置 AI 密钥，当前由本地格律引擎生成'
    }

    if (!poem) {
      const seed = Number.isFinite(body.seed) ? body.seed : (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0
      poem = compose({ cipaiId: body.cipaiId, prompt, seed, buId: buIdOf(body.buId) })
    }
    poem.engineNote = engineNote

    // 落库 + 计数
    let poemId = null
    try {
      const r = await env.DB.prepare(
        `INSERT INTO poems (cipai_id, cipai_name, prompt, content_json, content_text, engine, model, visitor_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          poem.cipaiId,
          poem.cipaiName,
          prompt,
          JSON.stringify(poem),
          toPlainText(poem),
          poem.engine,
          poem.model || '',
          String(body.visitorId || '').slice(0, 64)
        )
        .run()
      poemId = r?.meta?.last_row_id ?? null
      await env.DB.prepare(`INSERT INTO stats_events (kind, ref_id) VALUES ('generate', ?)`)
        .bind(String(poem.cipaiId))
        .run()
    } catch (e) {
      console.warn('[generate] 落库失败', e?.message)
    }
    poem.id = poemId
    return ok(poem)
  }

  if (path === '/generate/line' && method === 'POST') {
    if (!(await rateLimit(env, `genl:${clientKey(request)}`, 60, 60))) {
      return fail(429, '换句过于频繁，请稍候')
    }
    const body = await readJson(request)
    const cipai = getCipai(body.cipaiId)
    if (!cipai || !isGeneratable(cipai)) return fail(400, '该词牌不支持自动填词')
    const idx = parseInt(body.lineIndex, 10)
    if (!Number.isFinite(idx) || idx < 0 || idx >= cipai.lines.length) return fail(400, '句序超出范围')
    // buId / rhymeChars 由前端从「当前这首词」里带过来：
    // 不带的话引擎会现挑韵部，换一句就会换到别的韵去（整首词散架），
    // 或者换出重韵。这两条都是词的硬伤，所以必须原样传下来。
    const line = recomposeLine({
      cipaiId: body.cipaiId,
      lineIndex: idx,
      prompt: String(body.prompt || '').slice(0, 500),
      avoid: Array.isArray(body.avoid) ? body.avoid.slice(0, 10).map((x) => String(x).slice(0, 40)) : [],
      buId: typeof body.buId === 'string' ? body.buId : undefined,
      rhymeChars: Array.isArray(body.rhymeChars) ? body.rhymeChars.slice(0, 24).map((x) => String(x).slice(0, 2)) : [],
      seed: (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0
    })
    return ok(line)
  }

  // ── 公共：韵书 ───────────────────────────────────────────
  if (path === '/rhyme' && method === 'GET') {
    const qstr = (q.get('q') || '').trim()
    if (!qstr) {
      const width = new Map(rhymeTailStats().map((s) => [s.id, s]))
      return ok({
        bus: RHYME_BU.map((b) => ({
          id: b.id,
          name: b.name,
          short: b.short,
          tone: b.tone,
          mood: b.mood,
          count: b.chars.length,
          /** 这个韵部实际能当韵脚用多少个「不同的字」——比字表长度更能说明宽窄 */
          totalDistinct: width.get(b.id)?.totalDistinct ?? 0,
          tailEntries: Object.values(width.get(b.id)?.per || {}).reduce((a, x) => a + x.entries, 0),
          preview: b.chars.slice(0, 40).join('')
        }))
      })
    }
    const found = []
    for (const ch of [...qstr].slice(0, 8)) {
      for (const id of lookupChar(ch)) found.push({ ch, bu: id })
    }
    const byBu = new Map()
    for (const f of found) {
      const b = BU_BY_ID[f.bu]
      if (!b) continue
      if (!byBu.has(b.id)) byBu.set(b.id, { ...b, matched: [] })
      byBu.get(b.id).matched.push(f.ch)
    }
    return ok({
      query: qstr,
      results: [...byBu.values()].map((b) => ({
        id: b.id,
        name: b.name,
        short: b.short,
        tone: b.tone,
        mood: b.mood,
        matched: b.matched,
        chars: b.chars
      })),
      unknown: [...qstr].filter((c) => /[\u4e00-\u9fa5]/.test(c) && !lookupChar(c).length)
    })
  }

  // ── 公共：名句灵感 ───────────────────────────────────────
  if (path === '/inspiration' && method === 'GET') {
    const i = Math.floor(Math.random() * INSPIRATIONS.length)
    return ok({ item: INSPIRATIONS[i], total: INSPIRATIONS.length })
  }

  // ── 公共：站点设置 ───────────────────────────────────────
  if (path === '/settings' && method === 'GET') {
    // 白名单式对外：审核策略、后台专用项一律不出去
    const s = await getSettings(env)
    const pub = {}
    for (const k of PUBLIC_SETTING_KEYS) if (k in s) pub[k] = s[k]
    return ok({ ...pub, aiEnabled: !!env.AI_API_KEY })
  }

  // ── 博客 ────────────────────────────────────────────────
  if (path === '/posts' && method === 'GET') {
    const page = Math.max(1, parseInt(q.get('page') || '1', 10) || 1)
    const pageSize = Math.min(24, Math.max(1, parseInt(q.get('pageSize') || '9', 10) || 9))
    const category = (q.get('category') || '').trim()
    const kw = (q.get('q') || '').trim()
    const tag = (q.get('tag') || '').trim()

    const where = [`status = 'published'`]
    const binds = []
    if (category && category !== '全部') {
      where.push(`category = ?`)
      binds.push(category)
    }
    if (kw) {
      where.push(`(title LIKE ? OR excerpt LIKE ? OR content_md LIKE ? OR tags LIKE ?)`)
      const like = `%${kw}%`
      binds.push(like, like, like, like)
    }
    if (tag) {
      where.push(`tags LIKE ?`)
      binds.push(`%${tag}%`)
    }
    const whereSql = 'WHERE ' + where.join(' AND ')

    const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM blog_posts ${whereSql}`)
      .bind(...binds)
      .first()
    const { results } = await env.DB.prepare(
      `SELECT id, title, slug, excerpt, cover_image, category, tags, author, view_count, share_count, like_count, created_at, published_at
       FROM blog_posts ${whereSql}
       ORDER BY COALESCE(published_at, created_at) DESC
       LIMIT ? OFFSET ?`
    )
      .bind(...binds, pageSize, (page - 1) * pageSize)
      .all()

    const catRows = await env.DB.prepare(
      `SELECT category AS c, COUNT(*) AS n FROM blog_posts WHERE status='published' GROUP BY category ORDER BY n DESC`
    ).all()

    return ok({
      list: (results || []).map(mapPostRow),
      total: totalRow?.n || 0,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil((totalRow?.n || 0) / pageSize)),
      categories: (catRows.results || []).map((r) => ({ name: r.c, count: r.n }))
    })
  }

  m = path.match(/^\/posts\/([\w\u4e00-\u9fa5-]+)$/)
  if (m && method === 'GET') {
    const slug = decodeURIComponent(m[1])
    const row = await env.DB.prepare(`SELECT * FROM blog_posts WHERE slug = ? AND status='published'`).bind(slug).first()
    if (!row) return fail(404, '文章不存在或未发布')
    try {
      await env.DB.prepare(`UPDATE blog_posts SET view_count = view_count + 1 WHERE id = ?`).bind(row.id).run()
      await env.DB.prepare(`INSERT INTO stats_events (kind, ref_id) VALUES ('view', ?)`).bind(String(row.id)).run()
    } catch {}
    const comments = await fetchComments(env, row.id, true)
    const prev = await env.DB.prepare(
      `SELECT title, slug FROM blog_posts WHERE status='published' AND COALESCE(published_at,created_at) > COALESCE(?,'1970-01-01')
       ORDER BY COALESCE(published_at,created_at) ASC LIMIT 1`
    )
      .bind(row.published_at || row.created_at)
      .first()
    const next = await env.DB.prepare(
      `SELECT title, slug FROM blog_posts WHERE status='published' AND COALESCE(published_at,created_at) < COALESCE(?,'1970-01-01')
       ORDER BY COALESCE(published_at,created_at) DESC LIMIT 1`
    )
      .bind(row.published_at || row.created_at)
      .first()
    return ok({ ...mapPostRow(row), content_md: row.content_md, view_count: row.view_count + 1, comments, prev, next })
  }

  m = path.match(/^\/posts\/([\w\u4e00-\u9fa5-]+)\/(share|like)$/)
  if (m && method === 'POST') {
    const slug = decodeURIComponent(m[1])
    const kind = m[2]
    const row = await env.DB.prepare(`SELECT id FROM blog_posts WHERE slug = ?`).bind(slug).first()
    if (!row) return fail(404, '文章不存在')
    if (kind === 'share') {
      await env.DB.prepare(`UPDATE blog_posts SET share_count = share_count + 1 WHERE id = ?`).bind(row.id).run()
      await env.DB.prepare(`INSERT INTO stats_events (kind, ref_id) VALUES ('share', ?)`).bind(String(row.id)).run()
    } else {
      await env.DB.prepare(`UPDATE blog_posts SET like_count = like_count + 1 WHERE id = ?`).bind(row.id).run()
    }
    const fresh = await env.DB.prepare(`SELECT view_count, share_count, like_count FROM blog_posts WHERE id = ?`)
      .bind(row.id)
      .first()
    return ok(fresh)
  }

  // ── 评论 ────────────────────────────────────────────────
  if (path === '/comments' && method === 'GET') {
    const postId = parseInt(q.get('postId'), 10)
    if (!Number.isFinite(postId)) return fail(400, '缺少 postId')
    const list = await fetchComments(env, postId, true)
    return ok({ list })
  }

  if (path === '/comments' && method === 'POST') {
    if (!(await rateLimit(env, `cm:${clientKey(request)}`, 6, 300))) {
      return fail(429, '评论太频繁了，休息一下再来')
    }
    const body = await readJson(request)
    const postId = parseInt(body.postId, 10)
    const content = String(body.content || '').trim()
    const name = String(body.authorName || '').trim().slice(0, 24) || '匿名'
    const email = String(body.authorEmail || '').trim().slice(0, 80)
    if (!Number.isFinite(postId)) return fail(400, '缺少文章 id')
    if (content.length < 1) return fail(400, '评论内容不能为空')
    if (content.length > 800) return fail(400, '评论最多 800 字')
    const post = await env.DB.prepare(`SELECT id FROM blog_posts WHERE id = ? AND status='published'`).bind(postId).first()
    if (!post) return fail(404, '文章不存在')
    const parentId = Number.isFinite(parseInt(body.parentId, 10)) ? parseInt(body.parentId, 10) : null
    if (parentId) {
      const p = await env.DB.prepare(`SELECT id FROM blog_comments WHERE id = ? AND post_id = ?`).bind(parentId, postId).first()
      if (!p) return fail(400, '要回复的评论不存在')
    }
    const settings = await getSettings(env)
    const { clean, hits } = await filterContent(env, content)
    const manual = settings.comment_moderation === 'manual'
    const approved = manual || hits.length ? 0 : 1
    const ipHash = await sha256Hex(clientKey(request) + '|yisheng')
    const r = await env.DB.prepare(
      `INSERT INTO blog_comments (post_id, author_name, author_email, content, parent_id, is_approved, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(postId, name, email, clean, parentId, approved, ipHash)
      .run()
    await env.DB.prepare(`INSERT INTO stats_events (kind, ref_id) VALUES ('comment', ?)`).bind(String(postId)).run()
    return ok({
      id: r?.meta?.last_row_id ?? null,
      approved: !!approved,
      message: approved ? '评论已发布' : hits.length ? '评论包含敏感词，已提交待审核' : '评论已提交，待管理员审核'
    })
  }

  m = path.match(/^\/comments\/(\d+)\/like$/)
  if (m && method === 'POST') {
    await env.DB.prepare(`UPDATE blog_comments SET likes = likes + 1 WHERE id = ?`).bind(parseInt(m[1], 10)).run()
    const row = await env.DB.prepare(`SELECT likes FROM blog_comments WHERE id = ?`).bind(parseInt(m[1], 10)).first()
    return ok({ likes: row?.likes || 0 })
  }

  // ── 收藏（词笺） ────────────────────────────────────────
  if (path === '/favorites' && method === 'GET') {
    const visitor = (q.get('visitor') || '').slice(0, 64)
    if (!visitor) return fail(400, '缺少 visitor 标识')
    const { results } = await env.DB.prepare(
      `SELECT * FROM favorites WHERE visitor_id = ? ORDER BY created_at DESC LIMIT 200`
    )
      .bind(visitor)
      .all()
    return ok({ list: results || [] })
  }

  if (path === '/favorites' && method === 'POST') {
    const body = await readJson(request)
    const visitor = String(body.visitorId || '').slice(0, 64)
    const type = String(body.targetType || 'poem')
    const targetId = parseInt(body.targetId, 10)
    if (!visitor) return fail(400, '缺少 visitor 标识')
    if (!['poem', 'post'].includes(type)) return fail(400, '收藏类型不正确')
    if (!Number.isFinite(targetId)) return fail(400, '缺少目标 id')
    const snapshot = body.snapshot ? JSON.stringify(body.snapshot).slice(0, 20000) : ''
    await env.DB.prepare(
      `INSERT INTO favorites (visitor_id, target_type, target_id, snapshot_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(visitor_id, target_type, target_id) DO UPDATE SET snapshot_json = excluded.snapshot_json`
    )
      .bind(visitor, type, targetId, snapshot)
      .run()
    return ok({ ok: true })
  }

  m = path.match(/^\/favorites\/(\d+)$/)
  if (m && method === 'DELETE') {
    await env.DB.prepare(`DELETE FROM favorites WHERE id = ?`).bind(parseInt(m[1], 10)).run()
    return ok({ ok: true })
  }

  // ── 媒体 ────────────────────────────────────────────────
  m = path.match(/^\/media\/(.+)$/)
  if (m && method === 'GET') {
    const key = decodeURIComponent(m[1])
    if (env.BUCKET) {
      const obj = await env.BUCKET.get(key)
      if (!obj) return fail(404, '图片不存在')
      return new Response(obj.body, {
        headers: {
          'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      })
    }
    const row = await env.DB.prepare(`SELECT content_type, data_b64 FROM media WHERE key = ?`).bind(key).first()
    if (!row || !row.data_b64) return fail(404, '图片不存在')
    return new Response(fromB64(row.data_b64), {
      headers: {
        'Content-Type': row.content_type || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    })
  }

  // ── SEO ─────────────────────────────────────────────────
  if (path === '/sitemap.xml' && method === 'GET') {
    const origin = url.origin
    const { results } = await env.DB.prepare(
      `SELECT slug, COALESCE(published_at, created_at) AS t FROM blog_posts WHERE status='published' ORDER BY t DESC LIMIT 500`
    ).all()
    const urls = [
      // / 是落地页（官网首页），/studio 是填词工具本身 —— 两个都该被收录，
      // 所以首页之后紧跟一条 /studio。旧地址 / 仍然可用，不会因改版失效。
      `<url><loc>${origin}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
      `<url><loc>${origin}/studio</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>`,
      `<url><loc>${origin}/blog</loc><changefreq>daily</changefreq><priority>0.9</priority></url>`,
      `<url><loc>${origin}/rhyme</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>`,
      `<url><loc>${origin}/about</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>`,
      ...(results || []).map(
        (r) =>
          `<url><loc>${origin}/blog/${encodeURIComponent(r.slug)}</loc><lastmod>${String(r.t).slice(0, 10)}</lastmod><priority>0.8</priority></url>`
      )
    ]
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`,
      { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } }
    )
  }

  if (path === '/robots.txt' && method === 'GET') {
    return new Response(`User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${url.origin}/sitemap.xml\n`, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    })
  }

  // ══════════════════════════════════════════ 后台（需登录）

  if (path === '/admin/login' && method === 'POST') {
    if (!(await rateLimit(env, `login:${clientKey(request)}`, 20, 300))) {
      return fail(429, '登录尝试过于频繁，请 5 分钟后再试')
    }
    const body = await readJson(request)
    const username = String(body.username || '').trim()
    const password = String(body.password || '')
    const code = String(body.code || body.totp || '').trim()
    if (!username || !password) return fail(400, '请输入账号和密码')

    const user = await env.DB.prepare(`SELECT * FROM users WHERE username = ?`).bind(username).first()
    if (!user) {
      await logLogin(env, { username, request, success: 0, reason: 'no_user' })
      return fail(401, '账号或密码不正确')
    }

    // ① 锁定检查放在验密码之前——锁定期内即使密码正确也不放行
    const lock = await lockState(env, user)
    if (lock.locked) {
      await logLogin(env, { adminId: user.id, username, request, success: 0, reason: 'locked' })
      return json(
        {
          code: 423,
          message: `账号已锁定，请 ${lock.minutes} 分钟后再试`,
          data: { locked: true, minutes: lock.minutes }
        },
        423
      )
    }

    // ② 密码
    const good = await verifyPassword(password, user.password_hash)
    if (!good) {
      await bumpFailCount(env, user.id)
      const after = await env.DB.prepare(`SELECT failed_count FROM users WHERE id = ?`).bind(user.id).first()
      const left = Math.max(0, LOCK_MAX_FAILS - (after?.failed_count || 0))
      await logLogin(env, { adminId: user.id, username, request, success: 0, reason: 'bad_password' })
      return fail(401, left > 0 ? `账号或密码不正确（还可尝试 ${left} 次）` : '连续失败次数过多，账号已锁定 15 分钟')
    }

    // ③ 两步验证
    if (user.totp_enabled && user.totp_secret) {
      if (!code) {
        return json({ code: 428, message: '请输入两步验证码', data: { needTotp: true } }, 428)
      }
      const totpOk = await verifyTotp(user.totp_secret, code)
      if (!totpOk) {
        await bumpFailCount(env, user.id)
        await logLogin(env, { adminId: user.id, username, request, success: 0, reason: 'totp_failed' })
        return fail(401, '验证码不正确')
      }
    }

    // ④ 成功
    await clearFailCount(env, user.id)
    await env.DB.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).bind(user.id).run()
    const sess = await createSession(env, user, request)
    await trackSession(env, user.id, sess.sid)
    await logLogin(env, { adminId: user.id, username, request, success: 1, reason: 'ok' })
    return ok({
      token: sess.token,
      expiresIn: sess.expiresIn,
      user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role },
      mustChangePwd: !!user.must_change_pwd,
      totpEnabled: !!user.totp_enabled
    })
  }

  if (path.startsWith('/admin/')) {
    const admin = await requireAdmin(env, request)
    if (!admin) return fail(401, '请先登录')

    if (path === '/admin/me' && method === 'GET') {
      return ok({ user: { id: admin.id, username: admin.username, displayName: admin.display_name, role: admin.role } })
    }

    // ── 会话 ─────────────────────────────────────────────────
    if (path === '/admin/session' && method === 'GET') {
      const row = await env.DB.prepare(`SELECT totp_enabled, last_login_at, created_at FROM users WHERE id = ?`)
        .bind(admin.id)
        .first()
      const t = await readToken(env, request)
      const secondsLeft = t?.exp ? Math.max(0, t.exp - nowSec()) : 0
      return ok({
        user: { id: admin.id, username: admin.username, displayName: admin.display_name, role: admin.role },
        totpEnabled: !!row?.totp_enabled,
        lastLoginAt: row?.last_login_at || '',
        createdAt: row?.created_at || '',
        expiresIn: secondsLeft,
        sessionTtl: SESSION_TTL_SEC
      })
    }

    if (path === '/admin/logout' && method === 'POST') {
      await destroySession(env, request)
      return ok({ ok: true })
    }

    /** 注销所有会话：清掉该账号在 KV 里登记过的所有 sid（包括当前这一个） */
    if (path === '/admin/sessions/revoke-all' && method === 'POST') {
      await destroyAllSessions(env, admin.id)
      return ok({ ok: true })
    }

    // ── 密码 ─────────────────────────────────────────────────
    // 规格写的是 PUT /admin/password；旧路径 /admin/change-password 继续兼容。
    if ((path === '/admin/password' || path === '/admin/change-password') && ['PUT', 'POST'].includes(method)) {
      const body = await readJson(request)
      const oldPwd = String(body.oldPassword || body.old_password || '')
      const newPwd = String(body.newPassword || body.new_password || '')
      const confirm = String(body.confirmPassword ?? body.confirm_password ?? newPwd)
      if (newPwd.length < 8) return fail(400, '新密码至少 8 位')
      if (newPwd.length > 72) return fail(400, '新密码过长（最多 72 位）')
      if (newPwd !== confirm) return fail(400, '两次输入的新密码不一致')
      if (newPwd === oldPwd) return fail(400, '新密码不能与原密码相同')
      const row = await env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?`).bind(admin.id).first()
      if (!(await verifyPassword(oldPwd, row?.password_hash))) return fail(401, '原密码不正确')
      await env.DB.prepare(`UPDATE users SET password_hash = ?, must_change_pwd = 0 WHERE id = ?`)
        .bind(await hashPassword(newPwd), admin.id)
        .run()
      return ok({ ok: true })
    }

    // ── 两步验证（TOTP） ──────────────────────────────────────
    if (path === '/admin/totp/setup' && method === 'POST') {
      const secret = newTotpSecret()
      // 先只存进「待激活」字段，验证码核对通过才真正开启
      await env.DB.prepare(`UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?`).bind(secret, admin.id).run()
      return ok({ secret, otpauth: otpauthUrl(admin.username, secret), digits: 6, period: 30 })
    }

    if (path === '/admin/totp/verify' && method === 'POST') {
      const body = await readJson(request)
      const code = String(body.code || '').trim()
      const row = await env.DB.prepare(`SELECT totp_secret, totp_enabled FROM users WHERE id = ?`).bind(admin.id).first()
      const secret = row?.totp_secret || ''
      if (!secret) return fail(400, '请先生成密钥')
      if (!(await verifyTotp(secret, code))) return fail(400, '验证码不正确，请检查手机时间是否准确')
      await env.DB.prepare(`UPDATE users SET totp_enabled = 1 WHERE id = ?`).bind(admin.id).run()
      return ok({ enabled: true })
    }

    if (path === '/admin/totp/disable' && method === 'POST') {
      const body = await readJson(request)
      const code = String(body.code || '').trim()
      const row = await env.DB.prepare(`SELECT totp_secret, totp_enabled, password_hash FROM users WHERE id = ?`).bind(admin.id).first()
      if (!row?.totp_enabled) return ok({ enabled: false })
      const byCode = code && row.totp_secret ? await verifyTotp(row.totp_secret, code) : false
      const byPwd = body.password ? await verifyPassword(String(body.password), row.password_hash) : false
      if (!byCode && !byPwd) return fail(400, '请输入当前验证码或登录密码以确认')
      await env.DB.prepare(`UPDATE users SET totp_enabled = 0, totp_secret = '' WHERE id = ?`).bind(admin.id).run()
      return ok({ enabled: false })
    }

    // ── 登录历史 ─────────────────────────────────────────────
    if (path === '/admin/login-history' && method === 'GET') {
      const limit = Math.min(100, Math.max(5, parseInt(q.get('limit') || '20', 10) || 20))
      const { results } = await env.DB.prepare(
        `SELECT id, ip_address, user_agent, city, success, reason, created_at
           FROM login_logs WHERE admin_id = ? ORDER BY id DESC LIMIT ?`
      )
        .bind(admin.id, limit)
        .all()
      const rows = results || []
      // 判定「异常」：失败记录，或 IP 与最近一次成功登录不同
      const lastGoodIp = rows.find((r) => r.success)?.ip_address || ''
      const alerts = []
      const out = rows.map((r) => {
        const abnormal = !r.success || (lastGoodIp && r.ip_address !== lastGoodIp)
        if (abnormal) alerts.push(r.id)
        return { ...r, abnormal }
      })
      return ok({ list: out, lastGoodIp, alerts: alerts.length })
    }

    if (path === '/admin/posts' && method === 'GET') {
      const status = (q.get('status') || 'all').trim()
      const kw = (q.get('q') || '').trim()
      const category = (q.get('category') || '').trim()
      const tag = (q.get('tag') || '').trim()
      const sort = (q.get('sort') || 'updated').trim()
      const page = Math.max(1, parseInt(q.get('page') || '1', 10) || 1)
      const pageSize = Math.min(100, Math.max(1, parseInt(q.get('pageSize') || '20', 10) || 20))

      const where = []
      const binds = []
      if (status === 'published' || status === 'draft') {
        where.push(`status = ?`)
        binds.push(status)
      } else if (status === 'draftbox') {
        where.push(`status = 'draft'`)
      }
      if (category && category !== 'all') {
        where.push(`category = ?`)
        binds.push(category)
      }
      if (tag) {
        // tags 存的是 JSON 文本，用 LIKE 匹配「"标签"」避免子串误命中
        where.push(`tags LIKE ?`)
        binds.push(`%"${tag}"%`)
      }
      if (kw) {
        where.push(`(title LIKE ? OR slug LIKE ? OR COALESCE(excerpt,'') LIKE ?)`)
        binds.push(`%${kw}%`, `%${kw}%`, `%${kw}%`)
      }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
      const ORDER = {
        updated: 'updated_at DESC, id DESC',
        created: 'created_at DESC, id DESC',
        views: 'view_count DESC, id DESC',
        title: 'title ASC'
      }
      const orderSql = ORDER[sort] || ORDER.updated

      const [totalRow, { results }] = await Promise.all([
        env.DB.prepare(`SELECT COUNT(*) AS n FROM blog_posts ${whereSql}`)
          .bind(...binds)
          .first(),
        env.DB.prepare(
          `SELECT id, title, slug, excerpt, cover_image, category, tags, status, author,
                  view_count, share_count, like_count, created_at, updated_at, published_at,
                  substr(COALESCE(content_md,''),1,120) AS preview
             FROM blog_posts ${whereSql}
            ORDER BY ${orderSql} LIMIT ? OFFSET ?`
        )
          .bind(...binds, pageSize, (page - 1) * pageSize)
          .all()
      ])

      const [agg, draftAgg] = await Promise.all([
        env.DB.prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) AS published,
                  SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS draft
             FROM blog_posts`
        ).first(),
        env.DB.prepare(`SELECT COUNT(*) AS n FROM blog_posts WHERE status='draft'`).first()
      ])

      const total = totalRow?.n || 0
      return ok({
        list: (results || []).map((r) => ({ ...r, tags: safeJson(r.tags, []) })),
        total,
        page,
        pageSize,
        pages: Math.max(1, Math.ceil(total / pageSize)),
        counts: {
          all: agg?.total || 0,
          published: agg?.published || 0,
          draft: agg?.draft || draftAgg?.n || 0
        }
      })
    }

    // 批量操作：发布 / 删除 / 改分类。放在 /posts/:id 之前，避免被数字正则抢走
    if (path === '/admin/posts/batch' && ['PATCH', 'POST'].includes(method)) {
      const body = await readJson(request)
      const ids = (Array.isArray(body.ids) ? body.ids : [])
        .map((x) => parseInt(x, 10))
        .filter((x) => Number.isFinite(x))
        .slice(0, 200)
      const action = String(body.action || '')
      if (!ids.length) return fail(400, '请先勾选文章')
      const holes = ids.map(() => '?').join(',')
      let affected = 0
      if (action === 'publish' || action === 'draft') {
        const r = await env.DB.prepare(
          `UPDATE blog_posts
              SET status = ?,
                  published_at = CASE WHEN ? = 'published' AND published_at IS NULL THEN datetime('now') ELSE published_at END,
                  updated_at = datetime('now')
            WHERE id IN (${holes})`
        )
          .bind(action === 'publish' ? 'published' : 'draft', action === 'publish' ? 'published' : 'draft', ...ids)
          .run()
        affected = r?.meta?.changes ?? ids.length
      } else if (action === 'delete') {
        const stmts = [
          env.DB.prepare(`DELETE FROM blog_comments WHERE post_id IN (${holes})`).bind(...ids),
          env.DB.prepare(`DELETE FROM favorites WHERE target_type='post' AND target_id IN (${holes})`).bind(...ids),
          env.DB.prepare(`DELETE FROM blog_posts WHERE id IN (${holes})`).bind(...ids)
        ]
        if (env.DB.batch) await env.DB.batch(stmts)
        else for (const s of stmts) await s.run()
        affected = ids.length
      } else if (action === 'category') {
        const category = String(body.category || '').slice(0, 30)
        if (!category) return fail(400, '请选择目标分类')
        const r = await env.DB.prepare(
          `UPDATE blog_posts SET category = ?, updated_at = datetime('now') WHERE id IN (${holes})`
        )
          .bind(category, ...ids)
          .run()
        affected = r?.meta?.changes ?? ids.length
      } else {
        return fail(400, '不支持的批量操作')
      }
      return ok({ affected, action })
    }

    if (path === '/admin/posts' && method === 'POST') {
      const body = await readJson(request)
      const built = buildPostPayload(body)
      if (built.error) return fail(400, built.error)
      const exists = await env.DB.prepare(`SELECT id FROM blog_posts WHERE slug = ?`).bind(built.slug).first()
      if (exists) return fail(409, `别名「${built.slug}」已被占用`, { conflictId: exists.id })
      const r = await env.DB.prepare(
        `INSERT INTO blog_posts (title, slug, content_md, excerpt, cover_image, category, tags, status, author, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CASE WHEN ?='published' THEN datetime('now') ELSE NULL END))`
      )
        .bind(
          built.title,
          built.slug,
          built.content_md,
          built.excerpt,
          built.cover_image,
          built.category,
          built.tags,
          built.status,
          built.author,
          built.published_at,
          built.status
        )
        .run()
      return ok({ id: r?.meta?.last_row_id ?? null, slug: built.slug })
    }

    m = path.match(/^\/admin\/posts\/(\d+)$/)
    if (m && method === 'GET') {
      const row = await env.DB.prepare(`SELECT * FROM blog_posts WHERE id = ?`).bind(parseInt(m[1], 10)).first()
      if (!row) return fail(404, '文章不存在')
      return ok({ ...mapPostRow(row), content_md: row.content_md, status: row.status })
    }
    if (m && ['PUT', 'PATCH'].includes(method)) {
      const id = parseInt(m[1], 10)
      const old = await env.DB.prepare(`SELECT * FROM blog_posts WHERE id = ?`).bind(id).first()
      if (!old) return fail(404, '文章不存在')
      const body = await readJson(request)
      const built = buildPostPayload({ ...old, ...body }, old)
      if (built.error) return fail(400, built.error)
      if (built.slug !== old.slug) {
        const clash = await env.DB.prepare(`SELECT id FROM blog_posts WHERE slug = ? AND id <> ?`).bind(built.slug, id).first()
        if (clash) return fail(409, `别名「${built.slug}」已被占用`, { conflictId: clash.id })
      }
      await env.DB.prepare(
        `UPDATE blog_posts SET title=?, slug=?, content_md=?, excerpt=?, cover_image=?, category=?, tags=?, status=?, author=?,
           published_at = COALESCE(?, CASE WHEN ?='published' AND published_at IS NULL THEN datetime('now') ELSE published_at END),
           updated_at = datetime('now')
         WHERE id = ?`
      )
        .bind(
          built.title,
          built.slug,
          built.content_md,
          built.excerpt,
          built.cover_image,
          built.category,
          built.tags,
          built.status,
          built.author,
          built.published_at,
          built.status,
          id
        )
        .run()
      return ok({ id, slug: built.slug })
    }

    if (m && method === 'DELETE') {
      const id = parseInt(m[1], 10)
      const stmts = [
        env.DB.prepare(`DELETE FROM blog_comments WHERE post_id = ?`).bind(id),
        env.DB.prepare(`DELETE FROM favorites WHERE target_type='post' AND target_id = ?`).bind(id),
        env.DB.prepare(`DELETE FROM blog_posts WHERE id = ?`).bind(id)
      ]
      if (env.DB.batch) await env.DB.batch(stmts)
      else for (const s of stmts) await s.run()
      return ok({ ok: true })
    }

    if (path === '/admin/comments' && method === 'GET') {
      const status = (q.get('status') || 'all').trim()
      const kw = (q.get('q') || '').trim()
      const postId = parseInt(q.get('postId') || '0', 10)
      const page = Math.max(1, parseInt(q.get('page') || '1', 10) || 1)
      const pageSize = Math.min(100, Math.max(1, parseInt(q.get('pageSize') || '20', 10) || 20))

      const where = []
      const binds = []
      if (status === 'pending') where.push('c.is_spam = 0 AND c.is_approved = 0')
      if (status === 'approved') where.push('c.is_spam = 0 AND c.is_approved = 1')
      if (status === 'spam') where.push('c.is_spam = 1')
      if (postId) {
        where.push('c.post_id = ?')
        binds.push(postId)
      }
      if (kw) {
        where.push('(c.content LIKE ? OR c.author_name LIKE ?)')
        binds.push(`%${kw}%`, `%${kw}%`)
      }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

      const [totalRow, { results }, agg] = await Promise.all([
        env.DB.prepare(`SELECT COUNT(*) AS n FROM blog_comments c ${whereSql}`)
          .bind(...binds)
          .first(),
        env.DB.prepare(
          `SELECT c.*, p.title AS post_title, p.slug AS post_slug
             FROM blog_comments c LEFT JOIN blog_posts p ON p.id = c.post_id
             ${whereSql}
            ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`
        )
          .bind(...binds, pageSize, (page - 1) * pageSize)
          .all(),
        env.DB.prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN is_spam=0 AND is_approved=0 THEN 1 ELSE 0 END) AS pending,
                  SUM(CASE WHEN is_spam=0 AND is_approved=1 THEN 1 ELSE 0 END) AS approved,
                  SUM(CASE WHEN is_spam=1 THEN 1 ELSE 0 END) AS spam
             FROM blog_comments`
        ).first()
      ])

      const total = totalRow?.n || 0
      return ok({
        list: results || [],
        total,
        page,
        pageSize,
        pages: Math.max(1, Math.ceil(total / pageSize)),
        counts: {
          all: agg?.total || 0,
          pending: agg?.pending || 0,
          approved: agg?.approved || 0,
          spam: agg?.spam || 0
        },
        // 兼容旧调用方（AdminLayout 的角标）
        pending: agg?.pending || 0
      })
    }

    // 批量：通过 / 标垃圾 / 删除
    if (path === '/admin/comments/batch' && ['PATCH', 'POST'].includes(method)) {
      const body = await readJson(request)
      const ids = (Array.isArray(body.ids) ? body.ids : [])
        .map((x) => parseInt(x, 10))
        .filter((x) => Number.isFinite(x))
        .slice(0, 300)
      const action = String(body.action || '')
      if (!ids.length) return fail(400, '请先勾选评论')
      const holes = ids.map(() => '?').join(',')
      if (action === 'approve') {
        await env.DB.prepare(`UPDATE blog_comments SET is_approved = 1, is_spam = 0 WHERE id IN (${holes})`)
          .bind(...ids)
          .run()
      } else if (action === 'spam') {
        await env.DB.prepare(`UPDATE blog_comments SET is_spam = 1, is_approved = 0 WHERE id IN (${holes})`)
          .bind(...ids)
          .run()
      } else if (action === 'pending') {
        await env.DB.prepare(`UPDATE blog_comments SET is_spam = 0, is_approved = 0 WHERE id IN (${holes})`)
          .bind(...ids)
          .run()
      } else if (action === 'delete') {
        await env.DB.prepare(`DELETE FROM blog_comments WHERE id IN (${holes}) OR parent_id IN (${holes})`)
          .bind(...ids, ...ids)
          .run()
      } else {
        return fail(400, '不支持的批量操作')
      }
      return ok({ affected: ids.length, action })
    }

    // 后台内联回复：以「管理员」身份插一条已通过的评论，挂在原评论下
    m = path.match(/^\/admin\/comments\/(\d+)\/reply$/)
    if (m && method === 'POST') {
      const parentId = parseInt(m[1], 10)
      const parent = await env.DB.prepare(`SELECT id, post_id FROM blog_comments WHERE id = ?`).bind(parentId).first()
      if (!parent) return fail(404, '原评论不存在')
      const body = await readJson(request)
      const raw = String(body.content || '').trim()
      if (!raw) return fail(400, '回复内容不能为空')
      if (raw.length > 800) return fail(400, '回复过长（最多 800 字）')
      const { clean } = await filterContent(env, raw)
      const r = await env.DB.prepare(
        `INSERT INTO blog_comments (post_id, author_name, content, parent_id, is_approved, is_spam)
         VALUES (?, '管理员', ?, ?, 1, 0)`
      )
        .bind(parent.post_id, clean, parentId)
        .run()
      return ok({ id: r?.meta?.last_row_id ?? null })
    }

    m = path.match(/^\/admin\/comments\/(\d+)$/)
    if (m && ['PUT', 'PATCH'].includes(method)) {
      const id = parseInt(m[1], 10)
      const body = await readJson(request)
      const action = String(body.action || '')
      if (action === 'approve' || body.approve === true) {
        await env.DB.prepare(`UPDATE blog_comments SET is_approved = 1, is_spam = 0 WHERE id = ?`).bind(id).run()
      } else if (action === 'spam') {
        await env.DB.prepare(`UPDATE blog_comments SET is_spam = 1, is_approved = 0 WHERE id = ?`).bind(id).run()
      } else if (action === 'pending') {
        await env.DB.prepare(`UPDATE blog_comments SET is_spam = 0, is_approved = 0 WHERE id = ?`).bind(id).run()
      } else if (body.approve === false) {
        await env.DB.prepare(`UPDATE blog_comments SET is_approved = 0 WHERE id = ?`).bind(id).run()
      }
      if (typeof body.content === 'string') {
        const { clean } = await filterContent(env, body.content.slice(0, 800))
        await env.DB.prepare(`UPDATE blog_comments SET content = ? WHERE id = ?`).bind(clean, id).run()
      }
      return ok({ ok: true })
    }

    if (m && method === 'DELETE') {
      const id = parseInt(m[1], 10)
      await env.DB.prepare(`DELETE FROM blog_comments WHERE id = ? OR parent_id = ?`).bind(id, id).run()
      return ok({ ok: true })
    }

    if (path === '/admin/poems' && method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT id, cipai_id, cipai_name, prompt, substr(content_text,1,120) AS preview, engine, visitor_id, created_at
         FROM poems ORDER BY id DESC LIMIT 100`
      ).all()
      return ok({ list: results || [] })
    }

    if (path === '/admin/settings' && method === 'GET') {
      return ok(await getSettings(env))
    }

    if (path === '/admin/settings' && method === 'PUT') {
      const body = await readJson(request)
      const n = await putSettings(env, body)
      return ok({ updated: n, settings: await getSettings(env) })
    }

    if (path === '/admin/banned-words' && method === 'GET') {
      const { results } = await env.DB.prepare(`SELECT word FROM banned_words ORDER BY word`).all()
      return ok({ list: (results || []).map((r) => r.word) })
    }

    if (path === '/admin/banned-words' && method === 'PUT') {
      const body = await readJson(request)
      const words = (Array.isArray(body.words) ? body.words : [])
        .map((w) => String(w).trim())
        .filter((w) => w.length >= 1 && w.length <= 20)
        .slice(0, 500)
      const stmts = [env.DB.prepare(`DELETE FROM banned_words`), ...words.map((w) => env.DB.prepare(`INSERT OR REPLACE INTO banned_words (word) VALUES (?)`).bind(w))]
      if (env.DB.batch) await env.DB.batch(stmts)
      else for (const s of stmts) await s.run()
      return ok({ count: words.length })
    }

    // ── 上传（旧路径，保留兼容） ──────────────────────────────
    if (path === '/admin/upload' && method === 'POST') {
      const saved = await storeUpload(env, request, {})
      if (saved.error) return fail(saved.status || 400, saved.error)
      return ok(saved)
    }

    // ── 媒体库 ───────────────────────────────────────────────
    if (path === '/admin/media/upload' && method === 'POST') {
      // 注意：不能在这里 readJson(request) —— 会把 multipart 的 body 读掉。
      // 关联文章用查询参数传：/admin/media/upload?postId=12
      const postId = parseInt(q.get('postId') || '0', 10) || null
      const saved = await storeUpload(env, request, { postId })
      if (saved.error) return fail(saved.status || 400, saved.error)
      return ok(saved)
    }

    if (path === '/admin/media' && method === 'GET') {
      const kw = (q.get('q') || '').trim()
      const postId = parseInt(q.get('postId') || '0', 10)
      const page = Math.max(1, parseInt(q.get('page') || '1', 10) || 1)
      const pageSize = Math.min(120, Math.max(1, parseInt(q.get('pageSize') || '24', 10) || 24))
      const where = []
      const binds = []
      if (kw) {
        where.push(`(f.original_name LIKE ? OR f.filename LIKE ?)`)
        binds.push(`%${kw}%`, `%${kw}%`)
      }
      if (postId) {
        where.push(`f.post_id = ?`)
        binds.push(postId)
      }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
      const [totalRow, { results }] = await Promise.all([
        env.DB.prepare(`SELECT COUNT(*) AS n FROM media_files f ${whereSql}`)
          .bind(...binds)
          .first(),
        env.DB.prepare(
          `SELECT f.*, p.title AS post_title, p.slug AS post_slug
             FROM media_files f LEFT JOIN blog_posts p ON p.id = f.post_id
             ${whereSql}
            ORDER BY f.id DESC LIMIT ? OFFSET ?`
        )
          .bind(...binds, pageSize, (page - 1) * pageSize)
          .all()
      ])
      const total = totalRow?.n || 0
      return ok({
        list: (results || []).map((r) => ({ ...r, url: `/api/media/${r.r2_key || r.filename}` })),
        total,
        page,
        pageSize,
        pages: Math.max(1, Math.ceil(total / pageSize))
      })
    }

    m = path.match(/^\/admin\/media\/(\d+)\/replace$/)
    if (m && method === 'POST') {
      const id = parseInt(m[1], 10)
      const old = await env.DB.prepare(`SELECT * FROM media_files WHERE id = ?`).bind(id).first()
      if (!old) return fail(404, '文件不存在')
      const saved = await storeUpload(env, request, { postId: old.post_id, index: false })
      if (saved.error) return fail(saved.status || 400, saved.error)
      await env.DB.prepare(
        `UPDATE media_files SET filename=?, original_name=?, r2_key=?, storage=?, mime_type=?, size_bytes=?, width=?, height=?, uploaded_at=datetime('now')
          WHERE id = ?`
      )
        .bind(
          saved.filename,
          saved.original_name,
          saved.key,
          saved.storage,
          saved.mime_type,
          saved.size,
          saved.width,
          saved.height,
          id
        )
        .run()
      // 旧文件清掉，避免留下孤儿
      await removeStored(env, old)
      return ok({ id, ...saved, url: `/api/media/${saved.key}` })
    }

    m = path.match(/^\/admin\/media\/(\d+)$/)
    if (m && method === 'GET') {
      const row = await env.DB.prepare(
        `SELECT f.*, p.title AS post_title, p.slug AS post_slug
           FROM media_files f LEFT JOIN blog_posts p ON p.id = f.post_id WHERE f.id = ?`
      )
        .bind(parseInt(m[1], 10))
        .first()
      if (!row) return fail(404, '文件不存在')
      return ok({ ...row, url: `/api/media/${row.r2_key || row.filename}` })
    }
    if (m && ['PATCH', 'PUT'].includes(method)) {
      const id = parseInt(m[1], 10)
      const body = await readJson(request)
      if (body.postId !== undefined) {
        const pid = body.postId === null || body.postId === '' ? null : parseInt(body.postId, 10) || null
        await env.DB.prepare(`UPDATE media_files SET post_id = ? WHERE id = ?`).bind(pid, id).run()
      }
      if (typeof body.original_name === 'string' && body.original_name.trim()) {
        await env.DB.prepare(`UPDATE media_files SET original_name = ? WHERE id = ?`)
          .bind(body.original_name.trim().slice(0, 120), id)
          .run()
      }
      const row = await env.DB.prepare(`SELECT * FROM media_files WHERE id = ?`).bind(id).first()
      if (!row) return fail(404, '文件不存在')
      return ok({ ...row, url: `/api/media/${row.r2_key || row.filename}` })
    }

    if (m && method === 'DELETE') {
      const id = parseInt(m[1], 10)
      const row = await env.DB.prepare(`SELECT * FROM media_files WHERE id = ?`).bind(id).first()
      if (!row) return fail(404, '文件不存在')
      await removeStored(env, row)
      await env.DB.prepare(`DELETE FROM media_files WHERE id = ?`).bind(id).run()
      return ok({ ok: true })
    }

    // ── 分类 ─────────────────────────────────────────────────
    if (path === '/admin/categories' && method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM blog_posts p WHERE p.category = c.name) AS post_count
           FROM categories c ORDER BY c.sort_order DESC, c.id ASC`
      ).all()
      return ok({ list: results || [] })
    }

    if (path === '/admin/categories' && method === 'POST') {
      const body = await readJson(request)
      const name = String(body.name || '').trim().slice(0, 30)
      if (!name) return fail(400, '分类名不能为空')
      const exists = await env.DB.prepare(`SELECT id FROM categories WHERE name = ?`).bind(name).first()
      if (exists) return fail(409, '该分类已存在')
      const r = await env.DB.prepare(
        `INSERT INTO categories (name, slug, description, sort_order) VALUES (?, ?, ?, ?)`
      )
        .bind(name, String(body.slug || slugify(name)).slice(0, 60), String(body.description || '').slice(0, 200), parseInt(body.sortOrder || '0', 10) || 0)
        .run()
      return ok({ id: r?.meta?.last_row_id ?? null, name })
    }

    m = path.match(/^\/admin\/categories\/(\d+)$/)
    if (m && ['PUT', 'PATCH'].includes(method)) {
      const id = parseInt(m[1], 10)
      const old = await env.DB.prepare(`SELECT * FROM categories WHERE id = ?`).bind(id).first()
      if (!old) return fail(404, '分类不存在')
      const body = await readJson(request)
      const name = String(body.name ?? old.name).trim().slice(0, 30)
      if (!name) return fail(400, '分类名不能为空')
      if (name !== old.name) {
        const clash = await env.DB.prepare(`SELECT id FROM categories WHERE name = ? AND id <> ?`).bind(name, id).first()
        if (clash) return fail(409, '该分类名已被占用')
      }
      await env.DB.prepare(`UPDATE categories SET name=?, slug=?, description=?, sort_order=? WHERE id=?`)
        .bind(
          name,
          String(body.slug ?? old.slug).slice(0, 60),
          String(body.description ?? old.description).slice(0, 200),
          parseInt(body.sortOrder ?? old.sort_order, 10) || 0,
          id
        )
        .run()
      // 分类改名要同步文章上的冗余字段
      if (name !== old.name) {
        await env.DB.prepare(`UPDATE blog_posts SET category = ? WHERE category = ?`).bind(name, old.name).run()
      }
      return ok({ id, name })
    }

    if (m && method === 'DELETE') {
      const id = parseInt(m[1], 10)
      const row = await env.DB.prepare(`SELECT name FROM categories WHERE id = ?`).bind(id).first()
      if (!row) return fail(404, '分类不存在')
      const used = await env.DB.prepare(`SELECT COUNT(*) AS n FROM blog_posts WHERE category = ?`).bind(row.name).first()
      if (used?.n) return fail(409, `还有 ${used.n} 篇文章在用这个分类，请先改掉它们`)
      await env.DB.prepare(`DELETE FROM categories WHERE id = ?`).bind(id).run()
      return ok({ ok: true })
    }

    // ── 标签 ─────────────────────────────────────────────────
    if (path === '/admin/tags' && method === 'GET') {
      const { results } = await env.DB.prepare(`SELECT * FROM tags ORDER BY name ASC`).all()
      // 标签使用次数：tags 存的是 JSON 文本，只能在 JS 里数
      const { results: posts } = await env.DB.prepare(`SELECT tags FROM blog_posts`).all()
      const counter = new Map()
      for (const p of posts || []) {
        for (const t of safeJson(p.tags, [])) counter.set(t, (counter.get(t) || 0) + 1)
      }
      return ok({
        list: (results || []).map((t) => ({ ...t, post_count: counter.get(t.name) || 0 })),
        usage: [...counter.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n)
      })
    }

    if (path === '/admin/tags' && method === 'POST') {
      const body = await readJson(request)
      const name = String(body.name || '').trim().slice(0, 20)
      if (!name) return fail(400, '标签名不能为空')
      const exists = await env.DB.prepare(`SELECT id FROM tags WHERE name = ?`).bind(name).first()
      if (exists) return fail(409, '该标签已存在')
      const r = await env.DB.prepare(`INSERT INTO tags (name, slug, color) VALUES (?, ?, ?)`)
        .bind(name, String(body.slug || slugify(name)).slice(0, 60), String(body.color || '').slice(0, 20))
        .run()
      return ok({ id: r?.meta?.last_row_id ?? null, name })
    }

    m = path.match(/^\/admin\/tags\/(\d+)$/)
    if (m && ['PUT', 'PATCH'].includes(method)) {
      const id = parseInt(m[1], 10)
      const old = await env.DB.prepare(`SELECT * FROM tags WHERE id = ?`).bind(id).first()
      if (!old) return fail(404, '标签不存在')
      const body = await readJson(request)
      const name = String(body.name ?? old.name).trim().slice(0, 20)
      if (!name) return fail(400, '标签名不能为空')
      if (name !== old.name) {
        const clash = await env.DB.prepare(`SELECT id FROM tags WHERE name = ? AND id <> ?`).bind(name, id).first()
        if (clash) return fail(409, '该标签名已被占用')
        // 同步文章里的 tags JSON
        const { results } = await env.DB.prepare(`SELECT id, tags FROM blog_posts WHERE tags LIKE ?`).bind(`%"${old.name}"%`).all()
        for (const p of results || []) {
          const next = safeJson(p.tags, []).map((t) => (t === old.name ? name : t))
          await env.DB.prepare(`UPDATE blog_posts SET tags = ?, updated_at = datetime('now') WHERE id = ?`)
            .bind(JSON.stringify(next), p.id)
            .run()
        }
      }
      await env.DB.prepare(`UPDATE tags SET name=?, slug=?, color=? WHERE id=?`)
        .bind(name, String(body.slug ?? old.slug).slice(0, 60), String(body.color ?? old.color).slice(0, 20), id)
        .run()
      return ok({ id, name })
    }

    if (m && method === 'DELETE') {
      const id = parseInt(m[1], 10)
      const row = await env.DB.prepare(`SELECT name FROM tags WHERE id = ?`).bind(id).first()
      if (!row) return fail(404, '标签不存在')
      await env.DB.prepare(`DELETE FROM tags WHERE id = ?`).bind(id).run()
      // 从文章中摘掉这个标签
      const { results } = await env.DB.prepare(`SELECT id, tags FROM blog_posts WHERE tags LIKE ?`).bind(`%"${row.name}"%`).all()
      for (const p of results || []) {
        const next = safeJson(p.tags, []).filter((t) => t !== row.name)
        await env.DB.prepare(`UPDATE blog_posts SET tags = ?, updated_at = datetime('now') WHERE id = ?`)
          .bind(JSON.stringify(next), p.id)
          .run()
      }
      return ok({ ok: true })
    }

    // ── 侧栏角标用的轻量计数（不要用 /admin/dashboard，它要跑十几条聚合） ──
    if (path === '/admin/counts' && method === 'GET') {
      const [draft, pending, spam, media] = await Promise.all([
        env.DB.prepare(`SELECT COUNT(*) AS n FROM blog_posts WHERE status = 'draft'`).first(),
        env.DB.prepare(`SELECT COUNT(*) AS n FROM blog_comments WHERE is_spam = 0 AND is_approved = 0`).first(),
        env.DB.prepare(`SELECT COUNT(*) AS n FROM blog_comments WHERE is_spam = 1`).first(),
        env.DB.prepare(`SELECT COUNT(*) AS n FROM media_files`).first()
      ])
      return ok({
        drafts: draft?.n || 0,
        pendingComments: pending?.n || 0,
        spamComments: spam?.n || 0,
        media: media?.n || 0
      })
    }

    // ── 数据看板 ─────────────────────────────────────────────
    if ((path === '/admin/dashboard' || path === '/admin/stats') && method === 'GET') {
      const days = Math.min(90, Math.max(7, parseInt(q.get('days') || '7', 10) || 7))
      const since = `-${days} days`
      const prevSince = `-${days * 2} days`

      const [postAgg, curAgg, prevAgg, pendingAgg, commentTotal, poemCur, poemPrev, byCipai, timeline, topPosts, recent, recentPoems, favoriteAgg] =
        await Promise.all([
          env.DB.prepare(
            `SELECT COUNT(*) AS total,
                    SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) AS published,
                    SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS draft,
                    COALESCE(SUM(view_count),0) AS views,
                    COALESCE(SUM(share_count),0) AS shares,
                    COALESCE(SUM(like_count),0) AS likes
               FROM blog_posts`
          ).first(),
          env.DB.prepare(
            `SELECT kind, COUNT(*) AS n FROM stats_events
              WHERE created_at >= datetime('now', ?) GROUP BY kind`
          )
            .bind(since)
            .all(),
          env.DB.prepare(
            `SELECT kind, COUNT(*) AS n FROM stats_events
              WHERE created_at >= datetime('now', ?) AND created_at < datetime('now', ?) GROUP BY kind`
          )
            .bind(prevSince, since)
            .all(),
          env.DB.prepare(`SELECT COUNT(*) AS n FROM blog_comments WHERE is_spam = 0 AND is_approved = 0`).first(),
          env.DB.prepare(`SELECT COUNT(*) AS n FROM blog_comments`).first(),
          env.DB.prepare(`SELECT COUNT(*) AS n FROM poems WHERE created_at >= datetime('now', ?)`).bind(since).first(),
          env.DB.prepare(
            `SELECT COUNT(*) AS n FROM poems WHERE created_at >= datetime('now', ?) AND created_at < datetime('now', ?)`
          )
            .bind(prevSince, since)
            .first(),
          env.DB.prepare(
            `SELECT cipai_id AS id, cipai_name AS name, COUNT(*) AS n FROM poems
              WHERE created_at >= datetime('now', ?) GROUP BY cipai_id ORDER BY n DESC LIMIT 12`
          )
            .bind(since)
            .all(),
          env.DB.prepare(
            `SELECT substr(created_at,1,10) AS d, kind, COUNT(*) AS n FROM stats_events
              WHERE created_at >= datetime('now', ?) GROUP BY d, kind ORDER BY d ASC`
          )
            .bind(since)
            .all(),
          env.DB.prepare(
            `SELECT id, title, slug, category, status, view_count, like_count, comment_count, published_at, updated_at
               FROM (SELECT p.*, (SELECT COUNT(*) FROM blog_comments c WHERE c.post_id = p.id) AS comment_count
                       FROM blog_posts p WHERE p.status = 'published')
              ORDER BY view_count DESC, comment_count DESC LIMIT 5`
          ).all(),
          env.DB.prepare(
            `SELECT * FROM (
               SELECT 'comment' AS kind, c.id AS ref, c.author_name AS who, substr(c.content,1,60) AS text,
                      datetime(c.created_at) AS at, p.title AS post_title, p.id AS post_id, c.is_approved, c.is_spam
                 FROM blog_comments c LEFT JOIN blog_posts p ON p.id = c.post_id
               UNION ALL
               SELECT 'publish', p.id, p.author, p.title, datetime(COALESCE(p.published_at, p.created_at)), p.title, p.id, 1, 0
                 FROM blog_posts p WHERE p.status = 'published'
               UNION ALL
               SELECT 'update', p.id, p.author, p.title, datetime(p.updated_at), p.title, p.id, 1, 0
                 FROM blog_posts p WHERE p.status <> 'published' AND p.updated_at IS NOT NULL
             ) ORDER BY at DESC LIMIT 12`
          ).all(),
          env.DB.prepare(
            `SELECT id, cipai_name, prompt, substr(content_text,1,80) AS preview, engine, created_at
               FROM poems ORDER BY id DESC LIMIT 12`
          ).all(),
          env.DB.prepare(`SELECT target_type, COUNT(*) AS n FROM favorites GROUP BY target_type`).all()
        ])

      const cur = {}
      for (const r of curAgg.results || []) cur[r.kind] = r.n
      const prev = {}
      for (const r of prevAgg.results || []) prev[r.kind] = r.n

      const series = new Map()
      const today = new Date()
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10)
        series.set(d, { date: d, generate: 0, view: 0, share: 0, comment: 0 })
      }
      for (const r of timeline.results || []) {
        if (!series.has(r.d)) series.set(r.d, { date: r.d, generate: 0, view: 0, share: 0, comment: 0 })
        const row = series.get(r.d)
        if (r.kind in row) row[r.kind] = r.n
      }
      const seriesArr = [...series.values()].sort((a, b) => (a.date < b.date ? -1 : 1))

      return ok({
        days,
        // 四张卡片：文章数 / 阅读 / 评论 / 填词次数
        cards: {
          posts: {
            value: postAgg?.total || 0,
            published: postAgg?.published || 0,
            draft: postAgg?.draft || 0,
            pending: pendingAgg?.n || 0
          },
          views: {
            value: postAgg?.views || 0,
            change: pct(cur.view || 0, prev.view || 0)
          },
          comments: {
            value: commentTotal?.n || 0,
            change: pct(cur.comment || 0, prev.comment || 0),
            pending: pendingAgg?.n || 0
          },
          generate: {
            value: poemCur?.n || 0,
            total: poemCur?.n || 0,
            change: pct(cur.generate || 0, prev.generate || 0)
          }
        },
        // 兼容旧字段
        posts: postAgg || {},
        pendingComments: pendingAgg?.n || 0,
        window: { generate: cur.generate || 0, view: cur.view || 0, share: cur.share || 0, comment: cur.comment || 0 },
        previous: { generate: prev.generate || 0, view: prev.view || 0, share: prev.share || 0, comment: prev.comment || 0 },
        poemsByCipai: byCipai.results || [],
        series: seriesArr,
        topPosts: topPosts.results || [],
        recent: recent.results || [],
        recentPoems: recentPoems.results || [],
        favorites: favoriteAgg.results || []
      })
    }
  }

  return null
}

// ── 辅助 ────────────────────────────────────────────────────

function buIdOf(x) {
  const s = String(x || '')
  return BU_BY_ID[s] ? s : undefined
}

function mapPostRow(r) {
  return {
    id: r.id,
    title: r.title,
    slug: r.slug,
    excerpt: r.excerpt,
    cover_image: r.cover_image,
    category: r.category,
    tags: safeJson(r.tags, []),
    author: r.author,
    view_count: r.view_count,
    share_count: r.share_count,
    like_count: r.like_count,
    created_at: r.created_at,
    updated_at: r.updated_at,
    published_at: r.published_at
  }
}

async function fetchComments(env, postId, approvedOnly) {
  const { results } = await env.DB.prepare(
    `SELECT id, post_id, author_name, content, parent_id, likes, is_approved, created_at
     FROM blog_comments WHERE post_id = ? ${approvedOnly ? 'AND is_approved = 1' : ''}
     ORDER BY created_at ASC LIMIT 500`
  )
    .bind(postId)
    .all()
  const rows = (results || []).map((r) => ({ ...r, replies: [] }))
  const byId = new Map(rows.map((r) => [r.id, r]))
  const roots = []
  for (const r of rows) {
    if (r.parent_id && byId.has(r.parent_id)) byId.get(r.parent_id).replies.push(r)
    else roots.push(r)
  }
  return roots
}

function slugify(title) {
  const base = String(title || '')
    .trim()
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (base || 'post-' + Date.now().toString(36)).slice(0, 80)
}

/** 环比：没有上期数据时返回 null（而不是 100%），避免误导 */
function pct(cur, prev) {
  if (!prev) return null
  return Math.round(((cur - prev) / prev) * 1000) / 10
}

const MAX_UPLOAD = 4 * 1024 * 1024

/**
 * 从图片字节里读宽高（PNG / GIF / JPEG / WebP）。
 * 不引 sharp 之类的库：Workers 上没有原生依赖可装，而这几种格式的
 * 头几十个字节就够标出尺寸了。读不出来就返回 0，详情页显示「未知」。
 */
function imageSize(b) {
  const n = b.length
  if (n < 24) return { width: 0, height: 0 }
  const u32be = (o) => b[o] * 0x1000000 + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]
  const u16be = (o) => (b[o] << 8) + b[o + 1]
  const u16le = (o) => b[o] + (b[o + 1] << 8)

  // PNG：签名后第一个块必然是 IHDR（长度 4 + 'IHDR' + 宽 4 + 高 4）
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: u32be(16), height: u32be(20) }
  }
  // GIF：逻辑屏幕宽高，小端
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { width: u16le(6), height: u16le(8) }
  }
  // WebP：RIFF 容器 + 三种子格式
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const fmt = String.fromCharCode(b[12], b[13], b[14], b[15])
    if (fmt === 'VP8X' && n >= 30) {
      return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
    }
    if (fmt === 'VP8 ' && n >= 30) {
      return { width: ((b[27] << 8) | b[26]) & 0x3fff, height: ((b[29] << 8) | b[28]) & 0x3fff }
    }
    if (fmt === 'VP8L' && n >= 25) {
      const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    return { width: 0, height: 0 }
  }
  // JPEG：逐个段往后找 SOF 标记
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < n) {
      if (b[i] !== 0xff) {
        i++
        continue
      }
      const marker = b[i + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2
        continue
      }
      const len = u16be(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: u16be(i + 7), height: u16be(i + 5) }
      }
      i += 2 + Math.max(2, len)
    }
  }
  return { width: 0, height: 0 }
}

/** 统一上传落盘：有 R2 就进 R2，否则进 media 表（base64）；两种模式都写 media_files 索引 */
async function storeUpload(env, request, { postId = null, index = true } = {}) {
  const ct = request.headers.get('Content-Type') || ''
  if (!ct.includes('form-data')) return { error: '请以 multipart/form-data 上传', status: 400 }
  let form
  try {
    form = await request.formData()
  } catch {
    return { error: '上传内容解析失败', status: 400 }
  }
  const file = form.get('file')
  if (!file || typeof file === 'string') return { error: '未找到上传文件', status: 400 }
  const name = String(file.name || 'image').slice(0, 120)
  const type = String(file.type || 'image/png')
  if (!/^image\//.test(type)) return { error: '只允许上传图片', status: 400 }
  const buf = new Uint8Array(await file.arrayBuffer())
  if (!buf.length) return { error: '文件是空的', status: 400 }
  if (buf.length > MAX_UPLOAD) return { error: '图片不能超过 4MB', status: 400 }

  const ext = (name.match(/\.(\w+)$/) || [, 'png'])[1].toLowerCase().slice(0, 5)
  const key = `blog/${new Date().toISOString().slice(0, 10)}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ext}`
  const storage = env.BUCKET ? 'r2' : 'db'
  if (env.BUCKET) {
    await env.BUCKET.put(key, buf, { httpMetadata: { contentType: type } })
  } else {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO media (key, filename, content_type, size, data_b64) VALUES (?, ?, ?, ?, ?)`
    )
      .bind(key, name, type, buf.length, toB64(buf))
      .run()
  }
  const { width, height } = imageSize(buf)
  let id = null
  // index=false 用在「替换图片」：那条 media_files 记录已经存在，别再插一条孤儿
  if (index) {
    try {
      const r = await env.DB.prepare(
        `INSERT INTO media_files (filename, original_name, r2_key, storage, mime_type, size_bytes, width, height, post_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(key, name, key, storage, type, buf.length, width, height, postId)
        .run()
      id = r?.meta?.last_row_id ?? null
    } catch {}
  }
  return {
    id,
    key,
    filename: key,
    original_name: name,
    mime_type: type,
    size: buf.length,
    width,
    height,
    storage,
    url: `/api/media/${key}`
  }
}

async function removeStored(env, row) {
  const key = row?.r2_key || row?.filename || ''
  if (!key) return
  try {
    if (row.storage === 'r2' && env.BUCKET) await env.BUCKET.delete(key)
    else await env.DB.prepare(`DELETE FROM media WHERE key = ?`).bind(key).run()
  } catch {}
}

function buildPostPayload(body, old = {}) {
  const title = String(body.title ?? old.title ?? '').trim()
  if (!title) return { error: '标题不能为空' }
  if (title.length > 120) return { error: '标题过长（最多 120 字）' }
  const slug = slugify(body.slug ?? old.slug ?? title)
  const content_md = String(body.content_md ?? old.content_md ?? '')
  const excerpt = String(
    body.excerpt ?? old.excerpt ?? content_md.replace(/[#>*`_\-\n\r]/g, ' ').trim().slice(0, 110)
  ).slice(0, 200)
  const cover_image = String(body.cover_image ?? old.cover_image ?? '')
  const category = String(body.category ?? old.category ?? '填词教程').slice(0, 30)
  let tags = body.tags ?? old.tags ?? []
  if (typeof tags === 'string') {
    tags = tags
      .split(/[,，\s]+/)
      .map((x) => x.trim())
      .filter(Boolean)
  }
  if (!Array.isArray(tags)) tags = []
  tags = tags.slice(0, 10).map((t) => String(t).slice(0, 20))
  let status = String(body.status ?? old.status ?? 'draft')
  if (!['draft', 'published'].includes(status)) status = 'draft'
  const author = String(body.author ?? old.author ?? '管理员').slice(0, 40)
  // 发布时间：支持前端传「日期 + 时间」，统一存成 'YYYY-MM-DD HH:MM:SS'
  let published_at = old.published_at || null
  if (body.published_at !== undefined && body.published_at !== null && body.published_at !== '') {
    published_at = normalizeDateTime(body.published_at)
  }
  return { title, slug, content_md, excerpt, cover_image, category, tags: JSON.stringify(tags), status, author, published_at }
}

/** 'YYYY-MM-DDTHH:MM' / 'YYYY-MM-DD HH:MM' / ISO → 'YYYY-MM-DD HH:MM:SS' */
function normalizeDateTime(v) {
  const s = String(v).trim()
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (!m) return null
  const [, y, mo, d, hh = '00', mm = '00', ss = '00'] = m
  return `${y}-${mo}-${d} ${hh}:${mm}:${ss}`
}

export { isGeneratable, getCipai, CIPAI }
