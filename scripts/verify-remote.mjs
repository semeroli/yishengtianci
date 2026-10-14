/**
 * 远端独立复核 —— 推送之后**必须**跑一次。
 * ─────────────────────────────────────────────────────────────
 * 为什么不能只看 `git push` 的回显：本机出现过「push 返回 exit 0、输出为空、
 * 远端其实没动」的静默失败。所以要用与 git 通道**完全无关**的路子核对：
 * 走 api.github.com 读远端 tree，再把本地文件按 git blob 规则（sha1("blob <n>\0"+bytes)）
 * 算哈希，逐个比对。字节一样才是真的推上去了。
 *
 * 用法：npm run verify:remote
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, sep } from 'node:path'

const OWNER = 'semeroli'
const REPO = 'yishengtianci'
const API = 'https://api.github.com'
const ROOT = process.cwd()

const gh = (p) =>
  fetch(API + p, { headers: { 'user-agent': 'ys-verify', accept: 'application/vnd.github+json' } }).then(async (r) => {
    const t = await r.text()
    if (!r.ok) throw new Error(`GET ${p} → ${r.status} ${t.slice(0, 120)}`)
    return JSON.parse(t)
  })

/** git 的 blob 哈希 = sha1("blob " + 字节数 + "\0" + 内容) */
function gitBlobSha(buf) {
  return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`, 'utf8'), buf])).digest('hex')
}

/** 本地要提交的文件（排除忽略项）—— 直接照 .gitignore 的口径手工排一遍，
 *  避免为了复核再引一套依赖。 */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.data', '_shots', '_shots-landing', '_crop', '_zoom'])
const isTemp = (name) => /^_.*\.(mjs|txt|html|log|json)$/i.test(name) || /^_icon-.*\.png$/i.test(name)

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      walk(join(dir, e.name), out)
    } else {
      const rel = relative(ROOT, join(dir, e.name)).split(sep).join('/')
      if (rel.includes('/')) { /* 子目录里的 _ 开头文件不算临时物 */ } else if (isTemp(e.name)) continue
      if (rel === 'package-lock.json') continue
      if (/\.local\.sql$/i.test(rel)) continue
      out.push(rel)
    }
  }
  return out
}

const head = await gh(`/repos/${OWNER}/${REPO}/commits/main`)
const sha = head.sha
console.log(`远端 main HEAD = ${sha.slice(0, 12)}  «${(head.commit.message || '').split('\n')[0].slice(0, 50)}»`)

const tree = await gh(`/repos/${OWNER}/${REPO}/git/trees/${sha}?recursive=1`)
if (tree.truncated) console.log('⚠ 远端 tree 被截断，结果可能不全')
const remote = new Map()
for (const n of tree.tree) if (n.type === 'blob') remote.set(n.path, n.sha)
console.log(`远端 blob 数 = ${remote.size}\n`)

const local = walk(ROOT).sort()
const miss = []      // 本地有、远端没有
const diff = []      // 两边都有但字节不同
const okList = []

for (const rel of local) {
  if (!existsSync(join(ROOT, rel))) continue
  const buf = readFileSync(join(ROOT, rel))
  const mine = gitBlobSha(buf)
  const theirs = remote.get(rel)
  if (!theirs) miss.push(rel)
  else if (theirs !== mine) diff.push({ rel, mine, theirs })
  else okList.push(rel)
}

// 远端有、本地没有（不该有）
const extra = [...remote.keys()].filter((p) => !local.includes(p))

console.log(`✓ 字节一致 ${okList.length} 个`)
console.log(`✗ 本地有远端没有 ${miss.length} 个` + (miss.length ? ':\n   ' + miss.join('\n   ') : ''))
console.log(`✗ 两边内容不同 ${diff.length} 个` + (diff.length ? ':\n   ' + diff.map((d) => `${d.rel}  本地${d.mine.slice(0, 8)} 远端${d.theirs.slice(0, 8)}`).join('\n   ') : ''))
console.log(`${extra.length ? '✗' : '✓'} 远端多出 ${extra.length} 个` + (extra.length ? ':\n   ' + extra.join('\n   ') : ''))

// 关键文件点名
const MUST = [
  'public/favicon.svg', 'public/favicon.ico', 'public/favicon-16.png', 'public/favicon-32.png',
  'public/favicon-48.png', 'public/favicon-96.png', 'public/apple-touch-icon.png',
  'public/icon-192.png', 'public/icon-512.png', 'public/site.webmanifest',
  'src/views/LandingView.vue', 'src/utils/branding.js', 'src/router/index.js',
  'public/_redirects', 'public/_headers', 'functions/sitemap.xml.js', 'functions/robots.txt.js', 'wrangler.toml'
]
console.log('\n=== 关键文件 ===')
for (const p of MUST) console.log(' ', remote.has(p) ? (okList.includes(p) ? '✓ 在且一致' : '△ 在但内容不同') : '✗ 缺失', p)

const bad = miss.length + diff.length + extra.length + MUST.filter((p) => !remote.has(p)).length
console.log('\n' + (bad ? `❌ ${bad} 项需处理` : '✅ 远端与本地逐字节一致，推送确已生效'))
process.exit(bad ? 1 : 0)
