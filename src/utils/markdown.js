/**
 * Markdown 渲染（博客正文 / 后台预览共用）
 * ─────────────────────────────────────────────────────────────
 * 三个要点：
 *  ① 代码高亮交给 highlight.js，语言包按需注册（避免整包进浏览器）
 *  ② 图片统一加 loading="lazy"，正文插图多时不至于一次全拉
 *  ③ 允许少量 HTML（后台的「下划线」需要 <u>），但**渲染前先过一遍白名单清洗**，
 *     把 <script> / on* 事件 / javascript: 这类东西摘掉 —— 打开 html 开关
 *     不等于把整站交给作者笔下，清洗这一步不能省。
 */

import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/core'

import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import sql from 'highlight.js/lib/languages/sql'
import python from 'highlight.js/lib/languages/python'
import markdown from 'highlight.js/lib/languages/markdown'
import plaintext from 'highlight.js/lib/languages/plaintext'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('vue', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('text', plaintext)

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
  typographer: false,
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const out = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
        return `<pre class="code-block"><code class="hljs language-${lang}">${out}</code></pre>`
      } catch {}
    }
    return `<pre class="code-block"><code class="hljs">${md.utils.escapeHtml(str)}</code></pre>`
  }
})

// 外链新窗口打开；图片懒加载
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') || ''
  if (/^https?:\/\//.test(href)) {
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noopener noreferrer')
  }
  return defaultLinkOpen(tokens, idx, options, env, self)
}

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('loading', 'lazy')
  tokens[idx].attrSet('decoding', 'async')
  return self.renderToken(tokens, idx, options)
}

// ── HTML 清洗 ───────────────────────────────────────────────
// ⚠️ 清洗的是「markdown-it 渲染完的结果」，所以白名单必须把 markdown-it
//    自己会产出的标签全都放进来（p/h1-6/ul/pre/code/a/img/table…），
//    漏掉任何一个都会把正文结构打烂 —— 这是最容易写错的地方。
//    真正要拦的只有三类：脚本类标签、on* 事件属性、javascript: 协议。
const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'a', 'img', 'strong', 'em', 'b', 'i', 's', 'del', 'ins',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'figure', 'figcaption', 'div', 'span',
  'u', 'mark', 'sub', 'sup', 'small', 'kbd', 'abbr', 'dl', 'dt', 'dd'
])
// 这些标签连同里面的内容一起丢掉（不是转义，是整段删）
const DROP_WITH_CONTENT =
  /<(script|style|iframe|object|embed|form|input|textarea|link|meta|base|svg|math)\b[\s\S]*?<\/\1\s*>|<(script|style|iframe|object|embed|form|input|textarea|link|meta|base|svg|math)\b[^>]*\/?>/gi

export function sanitizeHtml(html) {
  const out = String(html || '').replace(DROP_WITH_CONTENT, '')
  return out.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^>]*)?)>/g, (m, tag, attrs) => {
    const t = String(tag).toLowerCase()
    if (!ALLOWED_TAGS.has(t)) {
      return m.replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'))
    }
    const keep = String(attrs || '')
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s(?:style|srcdoc|formaction)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(href|src)\s*=\s*(["']?)\s*(?:javascript|data):[^"'\s>]*\2/gi, '$1="#"')
    return `<${m.startsWith('</') ? '/' : ''}${t}${keep}>`
  })
}

export function renderMarkdown(src) {
  if (!src) return ''
  return sanitizeHtml(md.render(String(src)))
}

/** 纯文本预览：从 Markdown 里剥掉标记，用于摘要 / 字数统计 */
export function plainFromMarkdown(src, limit = 160) {
  const text = String(src || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[#>|*\-+\s]+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > limit ? text.slice(0, limit) + '…' : text
}

export default md
