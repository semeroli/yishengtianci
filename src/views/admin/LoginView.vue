<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '../../stores/session.js'
import { toast } from '../../stores/ui.js'
import { ApiError } from '../../api.js'

/**
 * 管理员登录
 * ─────────────────────────────────────────────────────────────
 * 三个输入框：账号 / 密码 / 验证码。
 * 验证码框一直显示，没开两步验证时留空即可 —— 规格要求三个框，
 * 而且「先登录再引导去开启」比「开了才冒出第四个框」更好懂。
 * 背景是淡墨竹影，用内联 SVG，不额外请求图片。
 */

const route = useRoute()
const router = useRouter()
const { login, isLoggedIn } = useSession()

const username = ref('')
const password = ref('')
const code = ref('')
const remember = ref(true)
const busy = ref(false)
const err = ref('')
const lockMinutes = ref(0)
const needTotp = ref(false)
const showPwd = ref(false)

const canSubmit = computed(() => username.value.trim() && password.value && !busy.value && lockMinutes.value <= 0)

function go() {
  const target = route.query.redirect
  router.replace(typeof target === 'string' && target.startsWith('/admin') ? target : '/admin/dashboard')
}

async function submit() {
  if (!canSubmit.value) return
  err.value = ''
  busy.value = true
  try {
    const data = await login(username.value.trim(), password.value, remember.value, code.value.trim())
    if (data.mustChangePwd) {
      toast('这是初始密码，请尽快在「设置 → 管理员设置」里改掉', 'info', 4000)
    }
    toast('登录成功 ✓', 'success')
    go()
  } catch (e) {
    if (e instanceof ApiError && e.status === 423) {
      lockMinutes.value = e.payload?.data?.minutes || 15
      err.value = `连续失败次数过多，账号已锁定，请 ${lockMinutes.value} 分钟后再试`
    } else if (e instanceof ApiError && e.status === 428) {
      needTotp.value = true
      err.value = '该账号已开启两步验证，请输入验证码'
    } else {
      err.value = e?.message || '登录失败，请重试'
    }
    password.value = ''
  } finally {
    busy.value = false
  }
}

// 锁定倒计时：让用户知道还要等多久，而不是反复试
let timer = null
watch(lockMinutes, (v) => {
  if (timer) clearInterval(timer)
  if (v > 0) {
    timer = setInterval(() => {
      lockMinutes.value = Math.max(0, lockMinutes.value - 1)
      if (lockMinutes.value <= 0) {
        clearInterval(timer)
        err.value = ''
      } else {
        err.value = `连续失败次数过多，账号已锁定，请 ${lockMinutes.value} 分钟后再试`
      }
    }, 60000)
  }
})

onMounted(() => {
  if (isLoggedIn.value) go()
})
</script>

<template>
  <div class="adm-scope login-page">
    <!-- 淡墨竹影 -->
    <svg class="bamboo" viewBox="0 0 420 560" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="none" stroke="#2c2416" stroke-linecap="round">
        <path d="M96 560 C 88 420, 104 300, 96 180 C 92 120, 100 80, 96 40" stroke-width="7" opacity="0.09" />
        <path d="M196 560 C 190 430, 206 330, 198 240 C 194 190, 202 150, 198 110" stroke-width="5" opacity="0.07" />
        <path d="M300 560 C 296 440, 310 360, 304 280" stroke-width="4" opacity="0.06" />
        <path d="M96 300 C 140 286, 176 292, 214 276" stroke-width="3" opacity="0.1" />
        <path d="M96 420 C 132 406, 160 412, 190 398" stroke-width="3" opacity="0.08" />
        <path d="M198 200 C 234 188, 264 194, 296 180" stroke-width="2.5" opacity="0.07" />
        <path d="M96 170 C 132 158, 158 164, 186 150" stroke-width="2.5" opacity="0.08" />
        <path d="M304 330 C 336 320, 358 324, 382 312" stroke-width="2.5" opacity="0.06" />
      </g>
    </svg>

    <form class="login-card" @submit.prevent="submit">
      <div class="logo">
        <span class="seal kai">倚</span>
        <h1>倚声后台</h1>
        <p class="sub">内容管理中台 · 仅限管理员</p>
      </div>

      <div class="adm-field">
        <label for="lg-user">账号</label>
        <input id="lg-user" v-model="username" class="input" type="text" autocomplete="username" placeholder="请输入管理员账号" />
      </div>

      <div class="adm-field">
        <label for="lg-pwd">密码</label>
        <div class="pwd-wrap">
          <input
            id="lg-pwd"
            v-model="password"
            class="input"
            :type="showPwd ? 'text' : 'password'"
            autocomplete="current-password"
            placeholder="请输入密码"
          />
          <button class="peek" type="button" :title="showPwd ? '隐藏密码' : '显示密码'" @click="showPwd = !showPwd">
            {{ showPwd ? '隐藏' : '显示' }}
          </button>
        </div>
      </div>

      <div class="adm-field">
        <label for="lg-code">验证码 <span class="tiny">两步验证码，未开启可留空</span></label>
        <input
          id="lg-code"
          v-model="code"
          class="input mono"
          type="text"
          inputmode="numeric"
          maxlength="6"
          autocomplete="one-time-code"
          placeholder="6 位数字"
        />
      </div>

      <p v-if="err" class="err-line">{{ err }}</p>

      <label class="remember">
        <input v-model="remember" type="checkbox" />
        <span>保持登录状态</span>
      </label>

      <button class="btn primary lg block" type="submit" :disabled="!canSubmit">
        <span v-if="busy" class="adm-inkdrop"></span>
        {{ busy ? '登录中…' : '登 录' }}
      </button>

      <p class="foot tiny">
        忘记密码？<template v-if="needTotp">验证码不正确时可检查手机时间是否准确。</template>
        本地首次部署请执行 <code class="mono">npm run seed</code> 创建管理员。
      </p>
    </form>

    <RouterLink class="back" to="/">← 回到前台</RouterLink>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 30px 20px;
  position: relative;
  overflow: hidden;
  background: var(--a-surface);
}
.bamboo {
  position: absolute;
  right: -40px;
  top: 0;
  width: min(560px, 70vw);
  height: 100%;
  pointer-events: none;
}
.login-card {
  position: relative;
  z-index: 1;
  width: min(392px, 100%);
  background: var(--a-card);
  border: 1px solid var(--a-line);
  border-radius: var(--a-radius);
  box-shadow: var(--a-shadow-2);
  padding: 34px 32px 26px;
}
.logo {
  text-align: center;
  margin-bottom: 26px;
}
.seal {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 6px;
  background: var(--a-primary);
  color: #fff8f0;
  font-size: 1.5rem;
  margin-bottom: 12px;
  box-shadow: 0 6px 18px rgba(196, 61, 61, 0.26);
}
.logo h1 {
  margin: 0;
  font-family: var(--a-font-title);
  font-size: 1.35rem;
  font-weight: 500;
  letter-spacing: 0.16em;
  color: var(--a-text);
}
.logo .sub {
  margin: 6px 0 0;
  font-size: 0.8rem;
  color: var(--a-text-3);
  letter-spacing: 0.1em;
}
.pwd-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.pwd-wrap .input {
  padding-right: 52px;
}
.peek {
  position: absolute;
  right: 0;
  border: 0;
  background: transparent;
  color: var(--a-text-3);
  font-size: 0.78rem;
  cursor: pointer;
  font-family: var(--a-font);
  padding: 4px 2px;
}
.peek:hover {
  color: var(--a-primary);
}
.adm-field > label .tiny {
  color: var(--a-text-3);
  letter-spacing: 0;
  margin-left: 4px;
}
.err-line {
  color: var(--a-danger);
  font-size: 0.82rem;
  margin: 0 0 14px;
  line-height: 1.6;
}
.remember {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 0.84rem;
  color: var(--a-text-2);
  margin-bottom: 20px;
  cursor: pointer;
  user-select: none;
}
.foot {
  color: var(--a-text-3);
  line-height: 1.8;
  margin: 16px 0 0;
  text-align: center;
}
.foot code {
  background: var(--a-card-2);
  border: 1px solid var(--a-line);
  border-radius: 3px;
  padding: 1px 5px;
  color: var(--a-text-2);
}
.back {
  position: absolute;
  left: 20px;
  top: 18px;
  z-index: 1;
  color: var(--a-text-3);
  text-decoration: none;
  font-size: 0.84rem;
}
.back:hover {
  color: var(--a-primary);
}
</style>
