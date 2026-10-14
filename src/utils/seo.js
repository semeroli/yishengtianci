/**
 * SEO / 社交分享元信息
 * ─────────────────────────────────────────────────────────────
 * 纯前端 SPA 没法像 SSR 那样把 meta 直接写进 HTML，所以策略是：
 *   ① index.html 里放好默认值（爬虫首屏能拿到站点级信息）；
 *   ② 文章页挂载后由这里把 title / description / og / JSON-LD 改写成本篇的。
 * 支持 og:image 动态化：传图就用图，不传就用站点默认封面。
 */

const DEFAULT_IMAGE = '/og-default.svg'

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
  const url = o.url || location.origin + location.pathname
  const image = o.image ? new URL(o.image, location.origin).href : new URL(DEFAULT_IMAGE, location.origin).href

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
    image: image ? [new URL(image, location.origin).href] : undefined,
    datePublished: published || undefined,
    dateModified: modified || published || undefined,
    author: { '@type': 'Person', name: author || '管理员' },
    publisher: {
      '@type': 'Organization',
      name: '倚声 · AI填词工坊',
      logo: { '@type': 'ImageObject', url: new URL('/og-default.svg', location.origin).href }
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url }
  }
}

export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: '倚声 · AI填词工坊',
    url: location.origin + '/',
    description: '输入一段意境，选一个词牌，得一首合律的词。',
    potentialAction: {
      '@type': 'SearchAction',
      target: location.origin + '/blog?q={search_term_string}',
      'query-input': 'required name=search_term_string'
    }
  }
}
