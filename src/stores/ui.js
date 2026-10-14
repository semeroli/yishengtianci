import { ref } from 'vue'

/**
 * 界面状态：主题 + 轻提示
 * 主题用 data-theme 写在 <html> 上，样式全部由 tokens.css 承担。
 */

const THEME_KEY = 'ys_theme'

const theme = ref((() => {
  try {
    return localStorage.getItem(THEME_KEY) || 'light'
  } catch {
    return 'light'
  }
})())

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', t === 'dark' ? '#1E2022' : '#F5F0E8')
}

applyTheme(theme.value)

export function useTheme() {
  const toggle = () => {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem(THEME_KEY, theme.value)
    } catch {}
    applyTheme(theme.value)
  }
  return { theme, toggle }
}

// ── 轻提示 ──────────────────────────────────────────────

const toasts = ref([])
let seq = 0

/**
 * @param {string} message 文案
 * @param {'info'|'success'|'error'} type
 * @param {number} duration 毫秒；传 0 表示不自动消失（错误提示请配 action 用）
 * @param {{label:string, run:Function}} action 可选操作按钮（如「重试」）
 */
export function toast(message, type = 'info', duration = 2600, action = null) {
  const id = ++seq
  toasts.value.push({ id, message, type, action })
  if (duration > 0) {
    setTimeout(() => {
      dismissToast(id)
    }, duration)
  }
  return id
}

export function dismissToast(id) {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

export function useToast() {
  return { toasts, toast, dismissToast }
}

// ── 确认框（替代 window.confirm，样式统一） ──────────────

const confirmState = ref(null)

/**
 * @param {object} o
 * @param {string} o.title
 * @param {string} o.message
 * @param {string} o.confirmText
 * @param {boolean} o.danger
 * @param {string} [o.requireText] 必须一字不差输入这段文字才能确认（删除这类不可逆操作用）
 * @param {string} [o.hint] requireText 的提示语
 */
export function confirmDialog({
  title = '确认操作',
  message,
  confirmText = '确认',
  danger = false,
  requireText = '',
  hint = ''
}) {
  return new Promise((resolve) => {
    confirmState.value = { title, message, confirmText, danger, requireText, hint, resolve }
  })
}

export function resolveConfirm(v) {
  const s = confirmState.value
  confirmState.value = null
  if (s) s.resolve(v)
}

export function useConfirm() {
  return { confirmState }
}

/**
 * 「删除」这类不可逆操作的统一入口：
 * 强制用户手打「删除」两个字，避免误点。
 */
export function confirmDelete(what = '该项内容') {
  return confirmDialog({
    title: '确认删除',
    message: `即将删除${what}。\n\n⚠️ 此操作不可撤销，删除后无法恢复。`,
    confirmText: '永久删除',
    danger: true,
    requireText: '删除',
    hint: '请输入「删除」两个字以确认'
  })
}
