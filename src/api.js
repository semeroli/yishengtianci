/**
 * 统一请求层
 * ─────────────────────────────────────────────────────────────
 * 所有接口都走这里：统一拼 /api 前缀、统一带令牌、统一解析 {code,message,data}。
 * 后台令牌只放一处（localStorage），组件里不要再各自读。
 */

const TOKEN_KEY = 'ys_admin_token'
const VISITOR_KEY = 'ys_visitor'

// ── 令牌：一个 ref 做唯一真相，避免「名字更新了角色没更新」那类陈旧状态 ──
let _token = null
try {
  _token = localStorage.getItem(TOKEN_KEY) || ''
} catch {
  _token = ''
}

export const getToken = () => _token || ''
export function setToken(t) {
  _token = t || ''
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {}
}

/** 访客标识（收藏词笺用，无需注册） */
export function visitorId() {
  let v = ''
  try {
    v = localStorage.getItem(VISITOR_KEY) || ''
  } catch {}
  if (!v) {
    v = 'v' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
    try {
      localStorage.setItem(VISITOR_KEY, v)
    } catch {}
  }
  return v
}

/** 令牌失效时广播，让界面统一回登录页 */
const AUTH_EVENT = 'ys-auth-expired'
export function onAuthExpired(fn) {
  window.addEventListener(AUTH_EVENT, fn)
  return () => window.removeEventListener(AUTH_EVENT, fn)
}

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload || {}
  }
}

/**
 * @param {string} path  形如 '/cipai' 或 '/admin/posts'
 * @param {object} opts  { method, body, query, raw, admin }
 */
export async function api(path, opts = {}) {
  const { method = 'GET', body, query, raw = false, admin = false, timeout = 60000 } = opts
  let url = '/api' + path
  if (query) {
    const qs = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString()
    if (qs) url += (url.includes('?') ? '&' : '?') + qs
  }

  const headers = {}
  if (admin) {
    const t = getToken()
    if (t) headers.Authorization = 'Bearer ' + t
  }
  let payload
  if (body !== undefined) {
    if (body instanceof FormData || body instanceof Blob || body instanceof ArrayBuffer) {
      payload = body
    } else {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
  }

  let res
  try {
    res = await fetch(url, { method, headers, body: payload, signal: AbortSignal.timeout(timeout) })
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new ApiError('请求超时，请稍后重试', 0)
    throw new ApiError('网络连接失败，请检查网络后重试', 0)
  }

  if (raw) {
    if (!res.ok) throw new ApiError(`请求失败：${res.status}`, res.status)
    return res
  }

  const ct = res.headers.get('Content-Type') || ''
  if (!ct.includes('json')) {
    // 平台级错误页（Cloudflare/网关）会返回 HTML —— 直接给状态码，
    // 这种情况不是业务错误，别去业务代码里找原因。
    throw new ApiError(`服务暂时不可用（${res.status}）`, res.status)
  }

  const data = await res.json().catch(() => null)
  if (!res.ok || (data && data.code !== undefined && data.code !== 0)) {
    const msg = data?.message || `请求失败：${res.status}`
    if (res.status === 401 && admin) {
      setToken('')
      window.dispatchEvent(new CustomEvent(AUTH_EVENT))
    }
    throw new ApiError(msg, res.status, data)
  }
  return data
}

export const get = (p, query, opts) => api(p, { query, ...opts })
export const post = (p, body, opts) => api(p, { method: 'POST', body, ...opts })
export const put = (p, body, opts) => api(p, { method: 'PUT', body, ...opts })
export const patch = (p, body, opts) => api(p, { method: 'PATCH', body, ...opts })
export const del = (p, opts) => api(p, { method: 'DELETE', ...opts })

// ── 具体接口 ──────────────────────────────────────────────

export const Api = {
  cipai: () => get('/cipai'),
  generate: (payload) => post('/generate', { visitorId: visitorId(), ...payload }),
  generateLine: (payload) => post('/generate/line', payload),
  rhyme: (q) => get('/rhyme', { q }),
  inspiration: () => get('/inspiration'),
  settings: () => get('/settings'),

  posts: (query) => get('/posts', query),
  post: (slug) => get(`/posts/${encodeURIComponent(slug)}`),
  sharePost: (slug) => post(`/posts/${encodeURIComponent(slug)}/share`),
  likePost: (slug) => post(`/posts/${encodeURIComponent(slug)}/like`),

  comments: (postId) => get('/comments', { postId }),
  addComment: (payload) => post('/comments', payload),
  likeComment: (id) => post(`/comments/${id}/like`),

  favorites: () => get('/favorites', { visitor: visitorId() }),
  addFavorite: (payload) => post('/favorites', { visitorId: visitorId(), ...payload }),
  removeFavorite: (id) => del(`/favorites/${id}`),

  adminLogin: (username, password, code) => post('/admin/login', { username, password, code }),
  adminLogout: () => post('/admin/logout', null, { admin: true }),
  adminRevokeAllSessions: () => post('/admin/sessions/revoke-all', null, { admin: true }),
  adminSession: () => get('/admin/session', null, { admin: true }),
  adminMe: () => get('/admin/me', null, { admin: true }),
  adminChangePassword: (oldPassword, newPassword, confirmPassword) =>
    put('/admin/password', { oldPassword, newPassword, confirmPassword }, { admin: true }),
  adminLoginHistory: (limit) => get('/admin/login-history', { limit }, { admin: true }),
  adminTotpSetup: () => post('/admin/totp/setup', null, { admin: true }),
  adminTotpVerify: (code) => post('/admin/totp/verify', { code }, { admin: true }),
  adminTotpDisable: (payload) => post('/admin/totp/disable', payload, { admin: true }),

  adminPosts: (query) => get('/admin/posts', query, { admin: true }),
  adminPost: (id) => get(`/admin/posts/${id}`, null, { admin: true }),
  adminCreatePost: (payload) => post('/admin/posts', payload, { admin: true }),
  adminUpdatePost: (id, payload) => put(`/admin/posts/${id}`, payload, { admin: true }),
  adminDeletePost: (id) => del(`/admin/posts/${id}`, { admin: true }),
  adminBatchPosts: (ids, action, extra) => api('/admin/posts/batch', { method: 'PATCH', body: { ids, action, ...extra }, admin: true }),

  adminComments: (query) => get('/admin/comments', query, { admin: true }),
  adminApproveComment: (id, approve) => put(`/admin/comments/${id}`, { approve }, { admin: true }),
  adminCommentAction: (id, action) => patch(`/admin/comments/${id}`, { action }, { admin: true }),
  adminReplyComment: (id, content) => post(`/admin/comments/${id}/reply`, { content }, { admin: true }),
  adminBatchComments: (ids, action) => api('/admin/comments/batch', { method: 'PATCH', body: { ids, action }, admin: true }),
  adminDeleteComment: (id) => del(`/admin/comments/${id}`, { admin: true }),

  adminMedia: (query) => get('/admin/media', query, { admin: true }),
  adminMediaOne: (id) => get(`/admin/media/${id}`, null, { admin: true }),
  adminMediaUpdate: (id, payload) => patch(`/admin/media/${id}`, payload, { admin: true }),
  adminMediaDelete: (id) => del(`/admin/media/${id}`, { admin: true }),
  adminMediaUpload: (file, postId) => {
    const fd = new FormData()
    fd.append('file', file)
    return post(`/admin/media/upload${postId ? '?postId=' + postId : ''}`, fd, { admin: true, timeout: 120000 })
  },
  adminMediaReplace: (id, file) => {
    const fd = new FormData()
    fd.append('file', file)
    return post(`/admin/media/${id}/replace`, fd, { admin: true, timeout: 120000 })
  },

  adminCategories: () => get('/admin/categories', null, { admin: true }),
  adminCreateCategory: (payload) => post('/admin/categories', payload, { admin: true }),
  adminUpdateCategory: (id, payload) => put(`/admin/categories/${id}`, payload, { admin: true }),
  adminDeleteCategory: (id) => del(`/admin/categories/${id}`, { admin: true }),

  adminTags: () => get('/admin/tags', null, { admin: true }),
  adminCreateTag: (payload) => post('/admin/tags', payload, { admin: true }),
  adminUpdateTag: (id, payload) => put(`/admin/tags/${id}`, payload, { admin: true }),
  adminDeleteTag: (id) => del(`/admin/tags/${id}`, { admin: true }),

  adminDashboard: (days) => get('/admin/dashboard', { days }, { admin: true }),
  adminCounts: () => get('/admin/counts', null, { admin: true }),
  adminStats: (days) => get('/admin/stats', { days }, { admin: true }),
  adminPoems: () => get('/admin/poems', null, { admin: true }),
  adminSettings: () => get('/admin/settings', null, { admin: true }),
  adminSaveSettings: (payload) => put('/admin/settings', payload, { admin: true }),
  adminBannedWords: () => get('/admin/banned-words', null, { admin: true }),
  adminSaveBannedWords: (words) => put('/admin/banned-words', { words }, { admin: true }),
  adminUpload: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return post('/admin/upload', fd, { admin: true, timeout: 120000 })
  }
}
