<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Api } from '../../api.js'
import { confirmDialog, toast } from '../../stores/ui.js'
import { useSession } from '../../stores/session.js'
import { renderMarkdown } from '../../utils/markdown.js'
import AdminSkeleton from '../../components/admin/AdminSkeleton.vue'
import AdminEmpty from '../../components/admin/AdminEmpty.vue'

/**
 * 设置
 * ─────────────────────────────────────────────────────────────
 * 四个 Tab：博客设置 / 管理员设置 / API 设置 / 关于页面。
 * 博客设置的改动**只在点「保存」时写库**，不做自动保存 ——
 * 站点名称这类东西改错了，前台全站立刻跟着错，不适合手一滑就生效。
 */

const router = useRouter()
const { logout, user } = useSession()

const TAB = ref('blog')
const loading = ref(true)
const saving = ref(false)
const settings = ref({})
const banned = ref([])
const bannedText = ref('')
const savingBanned = ref(false)

// 管理员设置
const me = ref(null)
const pwd = ref({ oldPassword: '', newPassword: '', confirmPassword: '' })
const pwdErr = ref('')
const pwdBusy = ref(false)
const totp = ref({ enabled: false, code: '', secret: '', otpauth: '', busy: false, setupStarted: false, confirmOff: false, offPwd: '' })
const history = ref([])
const historyLoading = ref(false)

const aboutPreview = computed(() => renderMarkdown(settings.value.about_md || ''))

const pwdStrength = computed(() => {
  const p = pwd.value.newPassword
  // 空的时候别说「至少 8 位」—— 模板里紧接着还有一句固定的「· 至少 8 位」，
  // 两处一模一样会变成「至少 8 位 · 至少 8 位」。
  if (!p) return { level: 0, text: '尚未输入' }
  let score = 0
  if (p.length >= 8) score++
  if (p.length >= 12) score++
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++
  if (/\d/.test(p)) score++
  if (/[^A-Za-z0-9]/.test(p)) score++
  const map = [
    { level: 1, text: '偏弱' },
    { level: 2, text: '一般' },
    { level: 3, text: '够用' },
    { level: 4, text: '较强' },
    { level: 5, text: '很强' }
  ]
  return map[Math.min(score, 5) - 1] || { level: 1, text: '偏弱' }
})

async function loadAll() {
  loading.value = true
  try {
    const [s, b] = await Promise.all([Api.adminSettings(), Api.adminBannedWords()])
    settings.value = s.data || {}
    banned.value = b.data.list || []
    bannedText.value = banned.value.join('\n')
  } catch (e) {
    toast('设置加载失败：' + (e?.message || ''), 'error', 0, { label: '重试', run: loadAll })
  } finally {
    loading.value = false
  }
}

async function loadMe() {
  try {
    const { data } = await Api.adminSession()
    me.value = data
    totp.value.enabled = !!data.totpEnabled
  } catch {}
}

async function loadHistory() {
  historyLoading.value = true
  try {
    const { data } = await Api.adminLoginHistory(30)
    history.value = data.list || []
  } catch {} finally {
    historyLoading.value = false
  }
}

async function save(keys) {
  saving.value = true
  try {
    const patch = {}
    for (const k of keys) patch[k] = settings.value[k] ?? ''
    const { data } = await Api.adminSaveSettings(patch)
    settings.value = { ...settings.value, ...data.settings }
    toast('设置已保存 ✓', 'success')
  } catch (e) {
    toast('保存失败：' + (e?.message || ''), 'error')
  } finally {
    saving.value = false
  }
}

async function saveBanned() {
  savingBanned.value = true
  try {
    const words = bannedText.value
      .split('\n')
      .map((w) => w.trim())
      .filter(Boolean)
      .slice(0, 500)
    await Api.adminSaveBannedWords(words)
    banned.value = words
    toast(`已保存 ${words.length} 个敏感词 ✓`, 'success')
  } catch (e) {
    toast('保存失败：' + (e?.message || ''), 'error')
  } finally {
    savingBanned.value = false
  }
}

// ── 修改密码 ──────────────────────────────────────────
async function changePassword() {
  pwdErr.value = ''
  if (pwd.value.newPassword.length < 8) {
    pwdErr.value = '新密码至少 8 位'
    return
  }
  if (pwd.value.newPassword !== pwd.value.confirmPassword) {
    pwdErr.value = '两次输入的新密码不一致'
    return
  }
  pwdBusy.value = true
  try {
    await Api.adminChangePassword(pwd.value.oldPassword, pwd.value.newPassword, pwd.value.confirmPassword)
    toast('密码已修改，其他设备上的会话仍然有效', 'success')
    pwd.value = { oldPassword: '', newPassword: '', confirmPassword: '' }
  } catch (e) {
    pwdErr.value = e?.message || '修改失败'
  } finally {
    pwdBusy.value = false
  }
}

// ── 两步验证 ──────────────────────────────────────────
async function startTotp() {
  totp.value.busy = true
  try {
    const { data } = await Api.adminTotpSetup()
    totp.value.secret = data.secret
    totp.value.otpauth = data.otpauth
    totp.value.setupStarted = true
    totp.value.code = ''
  } catch (e) {
    toast('生成密钥失败：' + (e?.message || ''), 'error')
  } finally {
    totp.value.busy = false
  }
}

async function confirmTotp() {
  totp.value.busy = true
  try {
    await Api.adminTotpVerify(totp.value.code)
    totp.value.enabled = true
    totp.value.setupStarted = false
    toast('两步验证已开启 ✓', 'success')
    loadMe()
  } catch (e) {
    toast(e?.message || '验证码不正确', 'error')
  } finally {
    totp.value.busy = false
  }
}

async function disableTotp() {
  if (!totp.value.offPwd) {
    totp.value.confirmOff = true
    return
  }
  totp.value.busy = true
  try {
    await Api.adminTotpDisable({ password: totp.value.offPwd })
    totp.value.enabled = false
    totp.value.confirmOff = false
    totp.value.offPwd = ''
    toast('已关闭两步验证', 'info')
    loadMe()
  } catch (e) {
    toast(e?.message || '关闭失败：密码不正确', 'error')
  } finally {
    totp.value.busy = false
  }
}

async function copyText(t, what) {
  try {
    await navigator.clipboard.writeText(t)
    toast(`${what}已复制 ✓`, 'success')
  } catch {
    toast('复制失败，请手动选中', 'error')
  }
}

async function revokeAll() {
  const ok = await confirmDialog({
    title: '注销所有会话',
    message: '所有设备（包括当前这台）上的后台登录都会失效，需要重新登录。\n\n确定继续吗？',
    confirmText: '全部注销',
    danger: true
  })
  if (!ok) return
  try {
    await Api.adminRevokeAllSessions()
  } catch {}
  logout()
  toast('已注销所有会话，请重新登录', 'info')
  router.replace('/admin/login')
}

function fmt(s) {
  return String(s || '').slice(0, 16)
}

const REASON_TEXT = {
  ok: '登录成功',
  bad_password: '密码错误',
  locked: '账号锁定中',
  totp_failed: '验证码错误',
  no_user: '账号不存在'
}

watch(TAB, (t) => {
  if (t === 'admin') {
    loadMe()
    loadHistory()
  }
})

onMounted(async () => {
  await loadAll()
  loadMe()
})
</script>

<template>
  <div>
    <div class="adm-page-head">
      <h1>设置</h1>
      <span class="desc">博客外观 · 管理员账户 · 接口通道 · 关于页</span>
    </div>

    <div class="adm-tabs">
      <button type="button" :class="{ on: TAB === 'blog' }" @click="TAB = 'blog'">博客设置</button>
      <button type="button" :class="{ on: TAB === 'admin' }" @click="TAB = 'admin'">管理员设置</button>
      <button type="button" :class="{ on: TAB === 'api' }" @click="TAB = 'api'">API 设置</button>
      <button type="button" :class="{ on: TAB === 'about' }" @click="TAB = 'about'">关于页面</button>
    </div>

    <AdminSkeleton v-if="loading" :rows="6" />

    <!-- ① 博客设置 -->
    <div v-else-if="TAB === 'blog'" class="adm-card">
      <div class="adm-card-head"><h3>博客外观与信息</h3></div>
      <div class="adm-card-body maxw">
        <div class="adm-field">
          <label>博客名称</label>
          <input v-model="settings.site_name" class="input" type="text" placeholder="倚声 · AI填词工坊" />
        </div>
        <div class="adm-field">
          <label>博客描述</label>
          <textarea v-model="settings.site_desc" class="textarea" rows="2" maxlength="200"></textarea>
        </div>
        <div class="grid2">
          <div class="adm-field">
            <label>Logo（emoji 或图片地址）</label>
            <input v-model="settings.logo" class="input" type="text" placeholder="🏮" />
          </div>
          <div class="adm-field">
            <label>Favicon 地址</label>
            <input v-model="settings.favicon" class="input" type="text" placeholder="/favicon.svg" />
          </div>
        </div>
        <div class="adm-field">
          <label>首页 SEO 标题</label>
          <input v-model="settings.seo_title" class="input" type="text" maxlength="80" placeholder="显示在搜索结果里的标题" />
        </div>
        <div class="adm-field">
          <label>SEO 描述</label>
          <textarea v-model="settings.seo_desc" class="textarea" rows="2" maxlength="200" placeholder="一句话说明这个站点是做什么的"></textarea>
        </div>
        <div class="grid2">
          <div class="adm-field">
            <label>GitHub</label>
            <input v-model="settings.social_github" class="input" type="text" placeholder="https://github.com/..." />
          </div>
          <div class="adm-field">
            <label>微博</label>
            <input v-model="settings.social_weibo" class="input" type="text" placeholder="https://weibo.com/..." />
          </div>
        </div>
        <div class="adm-field">
          <label>页脚版权</label>
          <input v-model="settings.copyright" class="input" type="text" placeholder="© 倚声 · AI填词工坊" />
        </div>
        <div class="adm-field">
          <label>页脚小字</label>
          <input v-model="settings.footer_note" class="input" type="text" placeholder="倚声填词，以韵为骨。" />
        </div>
        <div class="adm-field">
          <label>评论审核策略</label>
          <select v-model="settings.comment_moderation" class="select">
            <option value="auto">自动通过（命中敏感词的才转待审）</option>
            <option value="manual">全部人工审核</option>
          </select>
          <p class="tiny" style="color: var(--a-text-3); margin: 4px 0 0">
            选「全部人工审核」后，所有新评论都会进入「评论管理 → 待审核」。
          </p>
        </div>
        <button class="btn primary" type="button" :disabled="saving" @click="save(['site_name','site_desc','logo','favicon','seo_title','seo_desc','social_github','social_weibo','copyright','footer_note','comment_moderation'])">
          {{ saving ? '保存中…' : '保存博客设置' }}
        </button>
      </div>
    </div>

    <!-- ② 管理员设置 -->
    <div v-else-if="TAB === 'admin'" class="adm-grid2">
      <div class="adm-card">
        <div class="adm-card-head"><h3>当前账号</h3></div>
        <div class="adm-card-body">
          <div class="kv"><span>账号</span><b>{{ me?.user?.username || user?.username }}</b></div>
          <div class="kv"><span>显示名</span><b>{{ me?.user?.displayName || '—' }}</b></div>
          <div class="kv"><span>角色</span><b>{{ me?.user?.role === 'admin' ? '管理员' : me?.user?.role }}</b></div>
          <div class="kv"><span>上次登录</span><b>{{ fmt(me?.lastLoginAt) || '—' }}</b></div>
          <div class="kv"><span>本次会话剩余</span><b>{{ Math.round((me?.expiresIn || 0) / 3600) }} 小时（上限 24 小时）</b></div>
          <button class="btn" type="button" style="color: var(--a-danger); margin-top: 10px" @click="revokeAll">
            注销所有会话
          </button>
          <p class="tiny" style="color: var(--a-text-3)">
            换过密码、或怀疑账号被人用过时点这个，所有设备的登录会一起失效。
          </p>
        </div>
      </div>

      <div class="adm-card">
        <div class="adm-card-head"><h3>修改密码</h3></div>
        <div class="adm-card-body">
          <div class="adm-field">
            <label>原密码</label>
            <input v-model="pwd.oldPassword" class="input" type="password" autocomplete="current-password" />
          </div>
          <div class="adm-field">
            <label>新密码</label>
            <input v-model="pwd.newPassword" class="input" type="password" autocomplete="new-password" />
            <div class="strength" :class="'lv' + pwdStrength.level">
              <i :style="{ width: pwdStrength.level * 20 + '%' }"></i>
            </div>
            <p class="tiny" style="color: var(--a-text-3); margin: 4px 0 0">{{ pwdStrength.text }} · 至少 8 位</p>
          </div>
          <div class="adm-field">
            <label>确认新密码</label>
            <input v-model="pwd.confirmPassword" class="input" type="password" autocomplete="new-password" />
          </div>
          <p v-if="pwdErr" class="err" style="color: var(--a-danger); font-size: 0.82rem">{{ pwdErr }}</p>
          <button class="btn primary" type="button" :disabled="pwdBusy" @click="changePassword">
            {{ pwdBusy ? '提交中…' : '修改密码' }}
          </button>
        </div>
      </div>

      <div class="adm-card">
        <div class="adm-card-head">
          <h3>两步验证（TOTP）</h3>
          <span class="sp"></span>
          <span class="adm-st" :class="totp.enabled ? 'pub' : 'archive'">
            {{ totp.enabled ? '🟢 已开启' : '⚪ 未开启' }}
          </span>
        </div>
        <div class="adm-card-body">
          <template v-if="totp.enabled">
            <p class="tiny" style="color: var(--a-text-2)">
              登录时需要额外输入验证器 App 里的 6 位数字。换手机前请先关闭，否则会进不去后台。
            </p>
            <template v-if="totp.confirmOff">
              <div class="adm-field">
                <label>输入登录密码以确认关闭</label>
                <input
                  v-model="totp.offPwd"
                  class="input"
                  type="password"
                  autocomplete="current-password"
                  @keydown.enter="disableTotp"
                />
              </div>
              <button class="btn" type="button" style="color: var(--a-danger)" :disabled="totp.busy" @click="disableTotp">
                确认关闭
              </button>
              <button class="btn ghost" type="button" @click="totp.confirmOff = false; totp.offPwd = ''">取消</button>
            </template>
            <button v-else class="btn" type="button" @click="totp.confirmOff = true">关闭两步验证</button>
          </template>
          <template v-else-if="totp.setupStarted">
            <p class="tiny" style="color: var(--a-text-2)">
              在验证器 App（Google Authenticator / 微软 Authenticator / 1Password 等）里
              <b>选择「手动输入密钥」</b>，把下面这串填进去：
            </p>
            <div class="secret">
              <code class="mono">{{ totp.secret }}</code>
              <button class="adm-act" type="button" @click="copyText(totp.secret, '密钥')">复制</button>
            </div>
            <details class="tiny">
              <summary>也可以粘贴 otpauth 链接（部分 App 支持）</summary>
              <p class="mono break">{{ totp.otpauth }}</p>
              <button class="adm-act" type="button" @click="copyText(totp.otpauth, '链接')">复制链接</button>
            </details>
            <div class="adm-field mt2">
              <label>输入 App 里显示的 6 位验证码以确认</label>
              <input v-model="totp.code" class="input mono" type="text" inputmode="numeric" maxlength="6" placeholder="000000" />
            </div>
            <button class="btn primary" type="button" :disabled="totp.busy || totp.code.length !== 6" @click="confirmTotp">
              确认开启
            </button>
            <button class="btn ghost" type="button" @click="totp.setupStarted = false">取消</button>
          </template>
          <template v-else>
            <p class="tiny" style="color: var(--a-text-2)">
              开启后，即使密码泄露，别人没有你手机上的验证码也进不来。
            </p>
            <button class="btn primary" type="button" :disabled="totp.busy" @click="startTotp">
              {{ totp.busy ? '生成中…' : '开启两步验证' }}
            </button>
          </template>
        </div>
      </div>

      <div class="adm-card">
        <div class="adm-card-head">
          <h3>登录历史</h3>
          <span class="sp"></span>
          <button class="adm-act" type="button" @click="loadHistory">↻ 刷新</button>
        </div>
        <div v-if="historyLoading" style="padding: 14px 16px">
          <span class="adm-inkdrop"></span> 加载中…
        </div>
        <AdminEmpty v-else-if="!history.length" line="暂无登录记录" />
        <div v-else class="adm-log-list">
          <div v-for="h in history" :key="h.id" class="adm-log-row" :class="{ abn: h.abnormal }">
            <span class="t">{{ fmt(h.created_at) }}</span>
            <span class="ip">{{ h.ip_address || '—' }}</span>
            <span class="tiny" style="color: var(--a-text-3)">{{ h.city || '' }}</span>
            <span class="sp"></span>
            <span v-if="h.abnormal" title="与最近一次成功登录的 IP 不同，或是失败记录" style="color: var(--a-danger)">⚠️</span>
            <span class="tiny" :style="h.success ? '' : 'color:var(--a-danger)'">
              {{ REASON_TEXT[h.reason] || (h.success ? '成功' : '失败') }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- ③ API 设置 -->
    <div v-else-if="TAB === 'api'" class="adm-grid2">
      <div class="adm-card">
        <div class="adm-card-head"><h3>AI 通道</h3></div>
        <div class="adm-card-body">
          <p class="tiny" style="color: var(--a-text-2); line-height: 1.9">
            密钥写在 <b>Cloudflare 控制台的 Secret</b> 里（本机写在 <code class="mono">.dev.vars</code>），
            不通过这个页面保存 —— 放数据库里等于把钥匙搁在门口。
          </p>
          <div class="kv"><span>通道状态</span><b>{{ settings.aiEnabled ? '已配置' : '未配置' }}</b></div>
          <div class="kv"><span>需要的变量</span><b class="mono">AI_API_KEY / AI_BASE_URL / AI_MODEL / AI_DISABLE_THINKING</b></div>
          <p class="tiny" style="color: var(--a-text-3); line-height: 1.9">
            没配密钥时，填词全部由本地格律引擎完成，功能不受影响。
            接了推理型模型（如魔搭的 Qwen）记得把 <code class="mono">AI_DISABLE_THINKING</code> 设为 <code class="mono">1</code>，
            否则 max_tokens 会被思考过程吃掉，正文还没开始就截断了。
          </p>
        </div>
      </div>

      <div class="adm-card">
        <div class="adm-card-head"><h3>敏感词（评论过滤）</h3></div>
        <div class="adm-card-body">
          <p class="tiny" style="color: var(--a-text-3)">
            一行一个，最多 500 个。命中敏感词的评论会自动转「待审核」，且词会被替换成 ＊。
          </p>
          <textarea v-model="bannedText" class="textarea" rows="12" spellcheck="false" placeholder="一行一个敏感词"></textarea>
          <div class="row between mt1">
            <span class="tiny" style="color: var(--a-text-3)">
              当前 {{ bannedText.split('\n').filter((x) => x.trim()).length }} 个
            </span>
            <button class="btn primary sm" type="button" :disabled="savingBanned" @click="saveBanned">
              {{ savingBanned ? '保存中…' : '保存敏感词' }}
            </button>
          </div>
        </div>
      </div>

      <div class="adm-card">
        <div class="adm-card-head"><h3>素材与存储</h3></div>
        <div class="adm-card-body">
          <div class="kv"><span>图片存储</span><b>R2 对象存储</b></div>
          <p class="tiny" style="color: var(--a-text-3); line-height: 1.9">
            本地开发没有 R2 绑定时，图片会以 base64 存进 SQLite 的 media 表（功能一样，只是不适合放大量图）。
            上线后在 <code class="mono">wrangler.toml</code> 里配好 R2 绑定即可自动切换，无需改代码。
          </p>
          <RouterLink class="btn sm" to="/admin/media">打开媒体库 →</RouterLink>
        </div>
      </div>
    </div>

    <!-- ④ 关于页面 -->
    <div v-else class="adm-grid2">
      <div class="adm-card">
        <div class="adm-card-head"><h3>关于页正文（Markdown）</h3></div>
        <div class="adm-card-body">
          <textarea
            v-model="settings.about_md"
            class="textarea"
            rows="18"
            spellcheck="false"
            placeholder="## 关于倚声&#10;&#10;这里写站点的由来、格律依据与联系方式。"
          ></textarea>
          <button class="btn primary mt1" type="button" :disabled="saving" @click="save(['about_md'])">
            {{ saving ? '保存中…' : '保存关于页' }}
          </button>
        </div>
      </div>
      <div class="adm-card">
        <div class="adm-card-head"><h3>预览</h3></div>
        <div class="adm-card-body">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-if="settings.about_md" class="prose" v-html="aboutPreview"></div>
          <p v-else class="tiny" style="color: var(--a-text-3)">左边写点什么，这里会出现预览。</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.maxw {
  max-width: 620px;
}
.adm-grid2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}
.grid2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  /* 不加这个，同一行里矮的卡片会被拉成和高的卡片一样高，底部一大片空白 */
  align-items: start;
}
.kv {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 7px 0;
  font-size: 0.86rem;
  border-bottom: 1px dashed var(--a-line-2);
}
.kv span {
  color: var(--a-text-3);
  width: 88px;
  flex-shrink: 0;
}
.kv b {
  color: var(--a-text);
  font-weight: 500;
  word-break: break-all;
}
.secret {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--a-line);
  background: var(--a-card-2);
  border-radius: var(--a-radius);
  padding: 9px 12px;
  margin: 8px 0;
}
.secret code {
  flex: 1;
  letter-spacing: 0.14em;
  word-break: break-all;
}
.break {
  word-break: break-all;
  line-height: 1.7;
}
.strength {
  height: 3px;
  background: var(--a-line-2);
  border-radius: 2px;
  margin-top: 6px;
  overflow: hidden;
}
.strength i {
  display: block;
  height: 100%;
  background: var(--a-success);
  transition: width 200ms;
}
.strength.lv1 i,
.strength.lv2 i {
  background: var(--a-danger);
}
.strength.lv3 i {
  background: var(--a-warn);
}
@media (max-width: 1024px) {
  .adm-grid2,
  .grid2 {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
