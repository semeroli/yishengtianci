/**
 * 站点品牌信息（站名 / 顶栏图标 / 浏览器标签图标）
 * ─────────────────────────────────────────────────────────────
 * 为什么要单独一个模块：
 *   后台「设置」里能改站名、顶栏图标、favicon 三项。但原来这三个值
 *   只是**存进了数据库** —— 顶栏站名有人读，favicon 却从来没有人用它去改
 *   <link rel="icon">。也就是管理員在后台改了 favicon，前台一点反应都没有。
 *   这个模块把「读设置」和「把设置落到页面上」合成一处，并且**全站只请求一次**。
 *
 * 缓存策略：模块级 Promise 缓存。
 *   AppHeader、App、落地页都可能要用到，如果各自调一次 Api.settings()，
 *   页面一打开就是三个请求。这里缓存住 Promise，谁后到谁复用。
 *
 * 只在「后台填了值」时才覆盖静态资源里的默认图标 ——
 * 默认图标是 public/favicon.svg（那枚朱砂「倚」印），是设计好的成品，
 * 不该被一个空字符串覆盖掉。
 */
import { Api } from '../api.js'

export const BRAND_DEFAULTS = {
  site_name: '倚声 · AI填词工坊',
  site_desc: '输入一段意境，选一个词牌，得一首合律的词。',
  logo: '',
  favicon: ''
}

/**
 * 品牌记号（朱砂方印「倚」）的字符。
 * 与 public/favicon.svg 是同一枚记号 —— 标签页、顶栏、落地页落款用的是同一个字，
 * 这样「浏览器标签 → 站内首屏 → 页脚落款」三处能对上，才叫一个品牌。
 */
export const SEAL_TEXT = '倚'

/** 「🏮」是 1.0 版写进 settings 表的默认值。新一轮品牌改用朱砂方印，
 *  所以把旧默认值当成「没设过」——把老库里的 🏮 也纳入未设置，老站不用手动改库就能换新记号。
 *  （管理员若真想用灯笼，填一个其它值的 emoji 即可，这里只认这一个旧默认串。） */
const LEGACY_LOGO = '🏮'

/** 后台「站点图标」是否填了自定义值（旧默认值不算） */
export function hasCustomLogo(logo) {
  const v = String(logo || '').trim()
  return !!v && v !== LEGACY_LOGO
}

// public/ 下的静态图标（默认）
const DEFAULT_ICON = '/favicon.svg'
const DEFAULT_APPLE = '/apple-touch-icon.png'

function upsertLink(rel, href, extra = {}) {
  let el = document.head.querySelector(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
  for (const [k, v] of Object.entries(extra)) el.setAttribute(k, v)
}

/**
 * 把设置里的品牌信息落到页面上。可以重复调用（幂等）。
 * @param {object} s 设置对象
 */
export function applyBranding(s = {}) {
  const url = String(s.favicon || '').trim()
  if (!url) return // 没配 → 保持 public/ 里的默认图标，不改

  // 后台填的若是 svg，声明类型，浏览器才知道它可缩放
  const isSvg = /\.svg(\?|#|$)/i.test(url)
  upsertLink('icon', url, isSvg ? { type: 'image/svg+xml' } : {})
  // 同一个图也作为 iOS「添加到主屏幕」的图标。iOS 不认 svg，
  // 所以填 svg 时这里保持默认的 apple-touch-icon.png 不动。
  if (!isSvg) upsertLink('apple-touch-icon', url)
}

let cached = null

/**
 * 取站点设置（全站只发一次请求），并顺手把品牌信息应用上去。
 * @returns {Promise<object>} 设置对象（失败时返回默认值，绝不抛）
 */
export function loadBranding() {
  if (!cached) {
    cached = Api.settings()
      .then((r) => {
        const s = { ...BRAND_DEFAULTS, ...(r?.data || {}) }
        applyBranding(s)
        return s
      })
      .catch(() => ({ ...BRAND_DEFAULTS }))
  }
  return cached
}

export { DEFAULT_ICON, DEFAULT_APPLE }
