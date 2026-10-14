/**
 * 本地 D1 / KV 替身
 * ─────────────────────────────────────────────────────────────
 * 用 Node 22 内置的 node:sqlite 顶替 Cloudflare D1，
 * 让同一份 API 代码在本机跑出「真 SQL」的行为
 * （LEFT JOIN / GROUP BY / ON CONFLICT / datetime('now') 全部是真的）。
 *
 * 为什么不用手写 mock：手写 mock 只能验证 SELECT，一遇到
 * ON CONFLICT DO UPDATE 或 datetime('now') 就会悄悄通过，
 * 到了线上才炸。
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const normParam = (p) => {
  if (p === undefined || p === null) return null
  if (typeof p === 'boolean') return p ? 1 : 0
  if (p instanceof Date) return p.toISOString()
  return p
}

class LocalStmt {
  constructor(db, sql, params = []) {
    this._db = db
    this._sql = sql
    this._params = params
  }

  bind(...params) {
    return new LocalStmt(this._db, this._sql, params.map(normParam))
  }

  async first(colName) {
    const row = this._db.prepare(this._sql).get(...this._params)
    if (row === undefined || row === null) return null
    return colName ? row[colName] : row
  }

  async all() {
    const results = this._db.prepare(this._sql).all(...this._params)
    return { results, success: true, meta: {} }
  }

  async run() {
    const s = this._sql.trim()
    if (/^(CREATE|DROP|ALTER|PRAGMA)\b/i.test(s)) {
      this._db.exec(this._sql)
      return { success: true, meta: { changes: 0, last_row_id: 0 } }
    }
    const info = this._db.prepare(this._sql).run(...this._params)
    return {
      success: true,
      meta: {
        changes: Number(info.changes ?? 0),
        last_row_id: Number(info.lastInsertRowid ?? 0)
      }
    }
  }

  /** 供调试：拿到实际 SQL 与参数 */
  __peek() {
    return { sql: this._sql, params: this._params }
  }
}

export function createLocalD1(file = '.data/yisheng.db') {
  if (file !== ':memory:') {
    try {
      mkdirSync(dirname(file), { recursive: true })
    } catch {}
  }
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  return {
    prepare: (sql) => new LocalStmt(db, sql),
    /** D1 的 batch：一个事务里顺序执行 */
    async batch(stmts) {
      const out = []
      db.exec('BEGIN')
      try {
        for (const s of stmts) out.push(await s.run())
        db.exec('COMMIT')
      } catch (e) {
        try {
          db.exec('ROLLBACK')
        } catch {}
        throw e
      }
      return out
    },
    async exec(sql) {
      db.exec(sql)
      return { count: 0, duration: 0 }
    },
    /** 仅本地：直接跑一条查询，便于自测脚本 */
    _raw: db
  }
}

/** 内存 KV（本地限流用；进程内有效） */
export function createLocalKV() {
  const store = new Map()
  return {
    async get(key) {
      const hit = store.get(key)
      if (!hit) return null
      if (hit.exp && hit.exp < Date.now()) {
        store.delete(key)
        return null
      }
      return hit.v
    },
    async put(key, value, opts = {}) {
      const ttl = opts.expirationTtl || opts.expiration
      store.set(key, { v: String(value), exp: ttl ? Date.now() + ttl * 1000 : 0 })
    },
    async delete(key) {
      store.delete(key)
    },
    _size: () => store.size
  }
}

/** 组装出一个与 Pages Functions 一致的 env 对象 */
export function createLocalEnv({ dbFile = '.data/yisheng.db', extra = {} } = {}) {
  return {
    DB: createLocalD1(dbFile),
    CACHE_KV: createLocalKV(),
    BUCKET: null, // 本地不上 R2，图片存进 media 表（base64）
    SITE_SECRET: process.env.SITE_SECRET || 'yisheng-local-dev-secret-0123456789',
    AI_API_KEY: process.env.AI_API_KEY || '',
    AI_BASE_URL: process.env.AI_BASE_URL || '',
    AI_MODEL: process.env.AI_MODEL || '',
    AI_DISABLE_THINKING: process.env.AI_DISABLE_THINKING || '',
    AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS || '',
    ...extra
  }
}
