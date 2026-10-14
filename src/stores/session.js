import { computed, ref } from 'vue'
import { Api, getToken, onAuthExpired, setToken } from '../api.js'

/**
 * 管理员会话
 * ─────────────────────────────────────────────────────────────
 * ⚠️ 关键：整个会话放在一个 ref 里，token / user / role 一起读写。
 *    如果分别从 localStorage 里现读现用，computed 会缓存第一次的值，
 *    换账号后就会出现「名字变了、角色还是旧角色」这种鬼问题。
 */

const USER_KEY = 'ys_admin_user'

function readStored() {
  try {
    const raw = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY)
    if (!raw) return null
    const u = JSON.parse(raw)
    if (!u || !getToken()) return null
    return u
  } catch {
    return null
  }
}

const user = ref(readStored())
const ready = ref(false)
const loading = ref(false)

const isLoggedIn = computed(() => !!user.value && !!getToken())
const displayName = computed(() => user.value?.displayName || user.value?.username || '')
const role = computed(() => user.value?.role || '')

function persist(u, remember = true) {
  try {
    localStorage.removeItem(USER_KEY)
    sessionStorage.removeItem(USER_KEY)
    if (u) (remember ? localStorage : sessionStorage).setItem(USER_KEY, JSON.stringify(u))
  } catch {}
}

onAuthExpired(() => {
  user.value = null
  persist(null)
})

// 跨标签页同步：另一个标签登录/登出后，这里立刻跟上
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === USER_KEY || e.key === 'ys_admin_token') user.value = readStored()
  })
}

export function useSession() {
  async function login(username, password, remember = true, code = '') {
    loading.value = true
    try {
      const { data } = await Api.adminLogin(username, password, code)
      setToken(data.token)
      user.value = data.user
      persist(data.user, remember)
      ready.value = true
      return data
    } finally {
      loading.value = false
    }
  }

  function logout() {
    setToken('')
    user.value = null
    persist(null)
  }

  /** 启动时向服务端核实一次：localStorage 说自己是谁不算数 */
  async function verify() {
    if (!getToken()) {
      user.value = null
      ready.value = true
      return false
    }
    try {
      // 用 /admin/session 而不是 /admin/me：顺手把「剩余有效期 / 是否开启两步验证」也拿回来
      const { data } = await Api.adminSession()
      user.value = data.user
      persist(data.user, true)
      return true
    } catch {
      setToken('')
      user.value = null
      persist(null)
      return false
    } finally {
      ready.value = true
    }
  }

  return { user, ready, loading, isLoggedIn, displayName, role, login, logout, verify }
}
