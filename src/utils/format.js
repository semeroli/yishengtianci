/**
 * 小工具：日期与文本格式化
 * ─────────────────────────────────────────────────────────────
 * 服务端存的是 SQLite 的 `datetime('now')`，格式为 UTC 的
 * "YYYY-MM-DD HH:MM:SS"（没有时区标记、也没带 T）。
 * `new Date('2026-01-02 03:04:05')` 在 Safari 上会得到 Invalid Date，
 * 所以这里统一把空格换成 T 并补上 Z，按 UTC 解析，再按本地时区显示。
 */

function parse(v) {
  if (!v) return null
  if (v instanceof Date) return v
  let s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00Z'
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) s = s.replace(' ', 'T') + 'Z'
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) s += 'Z'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export function fmtDate(v) {
  const d = parse(v)
  if (!d) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function fmtDateTime(v) {
  const d = parse(v)
  if (!d) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 相对时间：刚刚 / 3 分钟前 / 昨天 / 具体日期 */
export function fmtRelative(v) {
  const d = parse(v)
  if (!d) return ''
  const diff = Date.now() - d.getTime()
  if (diff < 0) return fmtDate(v)
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day === 1) return '昨天'
  if (day < 7) return `${day} 天前`
  return fmtDate(v)
}

export function fmtNum(n) {
  const x = Number(n) || 0
  if (x >= 10000) return (x / 10000).toFixed(1).replace(/\.0$/, '') + ' 万'
  return String(x)
}

/** 从 Markdown 里剥出纯文本，用于摘要 */
export function excerpt(text, limit = 90) {
  const s = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[#>|\-+\s]+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > limit ? s.slice(0, limit) + '…' : s
}
