/**
 * SEO / 社交分享元信息
 * ─────────────────────────────────────────────────────────────
 * 纯前端 SPA 没法像 SSR 那样把 meta 直接写进 HTML，所以策略是：
 *   ① index.html 里放好默认值（爬虫首屏能拿到站点级信息）；
 *   ② 文章页挂载后由这里把 title / description / og / JSON-LD 改写成本篇的；
 *   ③ 构建时再由 scripts/prerender.mjs 把渲染结果抄成静态 HTML，让不执行 JS 的爬虫也读得到。
 * 支持 og:image 动态化：传图就用图，不传就用站点默认封面。
 */

const DEFAULT_IMAGE = '/og-default.svg'

/**
 * 站点的**规范地址**（canonical 的唯一真相）。
 * ─────────────────────────────────────────────────────────────
 * 为什么不能再用 `location.origin`：
 *   同一个站现在有三个域名同时能打开（ystianci.de5.net / ystianci.kdns.fr /
 *   yishengtianci.pages.dev）。规范地址必须**只有一个**，否则等于告诉搜索引擎
 *   「这三份不同内容各收一份」，权重被自己摊薄。
 *   所以这里写死一个规范域，任何域名下打开都声明同一份正版。
 *
 * ⚠️ 换主域名时**只改这一行**（外加 README 第十一节里对齐说一句）。
 *    实测过：de5.net 这一族域名比 kdns.fr 快约 0.4s，也和本站其它项目统一。
 */
export const SITE_ORIGIN = 'https://ystianci.de5.net'

/** 本站自己的域名（同一个站同时能打开的入口）。只有这些会被「拉回」规范域，
 *  其它域名一律原样放行 —— 封面图可能存在 R2 的自定义域上，不能把人家改掉。 */
const OWN_HOSTS = [
  'ystianci.de5.net',
  'ystianci.kdns.fr',
  'yishengtianci.pages.dev',
  '127.0.0.1',
  'localhost'
]

/**
 * 把「路径」或「本站任一域名下的绝对地址」归一到规范域名上。
 * 传 `/blog` 得 `https://ystianci.de5.net/blog`；
 * 传 kdns.fr / pages.dev 下的地址也拉回本站 —— 免得 canonical 被当前域名带偏。
 * 外站地址（比如 R2 上的图片域名）原样返回。
 */
function absUrl(u) {
  const s = String(u || '').trim()
  if (!s) return SITE_ORIGIN + location.pathname
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try {
      const p = new URL(s)
      if (p.origin === SITE_ORIGIN || !OWN_HOSTS.includes(p.hostname)) return s
      return SITE_ORIGIN + p.pathname + p.search
    } catch {
      return SITE_ORIGIN + '/'
    }
  }
  return SITE_ORIGIN + (s.startsWith('/') ? s : '/' + s)
}

function upsertMeta(attr, key, content) {
  if (content === undefined || content === null) return
  let el = document.head.querySelector(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', String(content))
}

function upsertLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

let jsonLdEl = null

/**
 * @param {object} o
 * @param {string} o.title        页面标题（不含站点后缀）
 * @param {string} o.description
 * @param {string} o.image        绝对或相对图片地址
 * @param {string} o.url          规范链接（默认当前地址）
 * @param {object} [o.jsonLd]     结构化数据（Article / WebSite）
 */
export function setSeo(o = {}) {
  const siteName = '倚声 · AI填词工坊'
  const full = o.title ? `${o.title} · 倚声` : siteName
  const url = absUrl(o.url)
  const image = absUrl(o.image || DEFAULT_IMAGE)

  document.title = full
  upsertMeta('name', 'description', o.description || '')
  upsertLink('canonical', url)

  upsertMeta('property', 'og:type', o.type || 'website')
  upsertMeta('property', 'og:site_name', siteName)
  upsertMeta('property', 'og:title', full)
  upsertMeta('property', 'og:description', o.description || '')
  upsertMeta('property', 'og:url', url)
  upsertMeta('property', 'og:image', image)

  upsertMeta('name', 'twitter:card', 'summary_large_image')
  upsertMeta('name', 'twitter:title', full)
  upsertMeta('name', 'twitter:description', o.description || '')
  upsertMeta('name', 'twitter:image', image)

  if (jsonLdEl) {
    jsonLdEl.remove()
    jsonLdEl = null
  }
  if (o.jsonLd) {
    jsonLdEl = document.createElement('script')
    jsonLdEl.type = 'application/ld+json'
    jsonLdEl.textContent = JSON.stringify(o.jsonLd)
    document.head.appendChild(jsonLdEl)
  }
}

export function articleJsonLd({ title, description, image, url, published, modified, author }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    image: image ? [absUrl(image)] : undefined,
    datePublished: published || undefined,
    dateModified: modified || published || undefined,
    author: { '@type': 'Person', name: author || '管理员' },
    publisher: {
      '@type': 'Organization',
      name: '倚声 · AI填词工坊',
      logo: { '@type': 'ImageObject', url: absUrl(DEFAULT_IMAGE) }
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': absUrl(url) }
  }
}

export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: '倚声 · AI填词工坊',
    url: SITE_ORIGIN + '/',
    description: '输入一段意境，选一个词牌，得一首合律的词。',
    potentialAction: {
      '@type': 'SearchAction',
      target: SITE_ORIGIN + '/blog?q={search_term_string}',
      'query-input': 'required name=search_term_string'
    }
  }
}
