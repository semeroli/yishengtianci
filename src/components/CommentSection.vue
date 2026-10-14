<script setup>
import { computed, onMounted, ref } from 'vue'
import { Api } from '../api.js'
import { toast } from '../stores/ui.js'
import { fmtRelative } from '../utils/format.js'

/**
 * 评论区
 * ─────────────────────────────────────────────────────────────
 * 两级结构：评论 + 回复（不再往下嵌套，回复的回复归到同一层，
 * 这是绝大多数博客的实际做法，读起来比深层缩进清楚）。
 */

const props = defineProps({
  postId: { type: Number, required: true },
  initial: { type: Array, default: () => [] }
})

const list = ref(props.initial || [])
const loading = ref(!props.initial?.length)
const sending = ref(false)

const form = ref({ authorName: '', authorEmail: '', content: '' })
const replyTo = ref(null) // { id, author_name }
const replyText = ref('')

const NAME_KEY = 'ys_comment_name'
const EMAIL_KEY = 'ys_comment_email'

const count = computed(() => {
  let n = 0
  const walk = (arr) => {
    for (const c of arr) {
      n++
      if (c.replies?.length) walk(c.replies)
    }
  }
  walk(list.value)
  return n
})

async function load() {
  loading.value = true
  try {
    const { data } = await Api.comments(props.postId)
    list.value = data.list || []
  } catch {
    /* 评论加载失败不阻塞正文阅读 */
  } finally {
    loading.value = false
  }
}

async function submit() {
  const content = form.value.content.trim()
  if (!content) return toast('先说点什么吧', 'info')
  sending.value = true
  try {
    const { data } = await Api.addComment({
      postId: props.postId,
      content,
      authorName: form.value.authorName.trim() || '匿名',
      authorEmail: form.value.authorEmail.trim()
    })
    try {
      localStorage.setItem(NAME_KEY, form.value.authorName.trim())
      localStorage.setItem(EMAIL_KEY, form.value.authorEmail.trim())
    } catch {}
    form.value.content = ''
    toast(data.message || '评论已提交', data.approved ? 'success' : 'info', 3400)
    if (data.approved) await load()
  } catch (e) {
    toast(e.message || '提交失败', 'error')
  } finally {
    sending.value = false
  }
}

function startReply(c) {
  replyTo.value = { id: c.id, author_name: c.author_name }
  replyText.value = ''
}

async function submitReply() {
  const content = replyText.value.trim()
  if (!content) return toast('回复内容不能为空', 'info')
  sending.value = true
  try {
    const { data } = await Api.addComment({
      postId: props.postId,
      content,
      parentId: replyTo.value.id,
      authorName: form.value.authorName.trim() || '匿名',
      authorEmail: form.value.authorEmail.trim()
    })
    replyTo.value = null
    replyText.value = ''
    toast(data.message || '回复已提交', data.approved ? 'success' : 'info', 3400)
    if (data.approved) await load()
  } catch (e) {
    toast(e.message || '提交失败', 'error')
  } finally {
    sending.value = false
  }
}

async function like(c) {
  const before = c.likes || 0
  c.likes = before + 1
  try {
    const { data } = await Api.likeComment(c.id)
    c.likes = data.likes ?? c.likes
  } catch {
    c.likes = before
    toast('点赞失败', 'error')
  }
}

onMounted(() => {
  try {
    form.value.authorName = localStorage.getItem(NAME_KEY) || ''
    form.value.authorEmail = localStorage.getItem(EMAIL_KEY) || ''
  } catch {}
  if (!props.initial?.length) load()
})

defineExpose({ load })
</script>

<template>
  <section class="comments panel">
    <div class="row between wrap">
      <h3 class="mb0">评论</h3>
      <span class="small muted">{{ count }} 条</span>
    </div>

    <!-- 发表 -->
    <div class="form">
      <div class="row wrap gap-sm">
        <input v-model="form.authorName" class="input mini-input" maxlength="24" placeholder="昵称（可留空）" />
        <input v-model="form.authorEmail" class="input mini-input" maxlength="80" placeholder="邮箱（不公开，选填）" />
      </div>
      <textarea
        v-model="form.content"
        class="textarea mt1"
        rows="3"
        maxlength="800"
        placeholder="说点什么…（支持普通文字，最多 800 字）"
      ></textarea>
      <div class="row between mt1">
        <span class="tiny muted">
          提交后可能需要管理员审核才显示，请勿重复提交。
        </span>
        <button class="btn primary sm" :disabled="sending || !form.content.trim()" @click="submit">
          <span v-if="sending" class="spin">◌</span>
          <span v-else>发表评论</span>
        </button>
      </div>
    </div>

    <hr class="rule" />

    <div v-if="loading" class="center muted small"><span class="spin">◌</span> 载入评论……</div>

    <p v-else-if="!list.length" class="empty">
      <span class="glyph">◌</span>
      <span class="line">还没有人说话</span>
      <span class="sub">来做第一个留下想法的人</span>
    </p>

    <ul v-else class="list">
      <li v-for="c in list" :key="c.id" class="cmt">
        <div class="cmt-head">
          <span class="avatar kai">{{ (c.author_name || '匿').slice(0, 1) }}</span>
          <div class="grow">
            <div class="row wrap gap-xs">
              <b class="small">{{ c.author_name || '匿名' }}</b>
              <span class="tiny muted">{{ fmtRelative(c.created_at) }}</span>
            </div>
            <p class="cmt-text">{{ c.content }}</p>
            <div class="row gap-sm">
              <button class="link-btn" @click="like(c)">♡ {{ c.likes || 0 }}</button>
              <button class="link-btn" @click="startReply(c)">↩ 回复</button>
            </div>
          </div>
        </div>

        <!-- 回复表单 -->
        <div v-if="replyTo?.id === c.id" class="reply-form">
          <textarea
            v-model="replyText"
            class="textarea"
            rows="2"
            maxlength="800"
            :placeholder="`回复 @${c.author_name}…`"
          ></textarea>
          <div class="row between mt1">
            <span class="tiny muted">回复同样需要审核</span>
            <div class="row gap-sm">
              <button class="btn ghost sm" @click="replyTo = null">取消</button>
              <button class="btn primary sm" :disabled="sending" @click="submitReply">回复</button>
            </div>
          </div>
        </div>

        <ul v-if="c.replies?.length" class="replies">
          <li v-for="r in c.replies" :key="r.id" class="cmt reply">
            <div class="cmt-head">
              <span class="avatar kai small-avatar">{{ (r.author_name || '匿').slice(0, 1) }}</span>
              <div class="grow">
                <div class="row wrap gap-xs">
                  <b class="small">{{ r.author_name || '匿名' }}</b>
                  <span class="tiny muted">回复 {{ c.author_name }}</span>
                  <span class="tiny muted">{{ fmtRelative(r.created_at) }}</span>
                </div>
                <p class="cmt-text">{{ r.content }}</p>
                <button class="link-btn" @click="like(r)">♡ {{ r.likes || 0 }}</button>
              </div>
            </div>
          </li>
        </ul>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.gap-sm {
  gap: 8px;
}
.gap-xs {
  gap: 6px;
}
.form {
  margin-top: 14px;
  padding-bottom: 4px;
}
.mini-input {
  max-width: 200px;
  font-size: 0.86rem;
  padding: 6px 10px;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.cmt-head {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.avatar {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  border-radius: 50%;
  background: var(--paper-inset);
  border: 1px solid var(--line-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  color: var(--ink-2);
}
.small-avatar {
  width: 27px;
  height: 27px;
  flex: 0 0 27px;
  font-size: 0.86rem;
}
.cmt-text {
  margin: 4px 0 5px;
  line-height: 1.9;
  font-size: 0.92rem;
  color: var(--ink);
  white-space: pre-wrap;
  word-break: break-word;
}
.link-btn {
  background: none;
  border: 0;
  padding: 0;
  color: var(--ink-3);
  font-size: 0.76rem;
  cursor: pointer;
  transition: color var(--t-fast);
}
.link-btn:hover {
  color: var(--cinnabar);
}
.replies {
  list-style: none;
  margin: 12px 0 0;
  padding: 0 0 0 14px;
  border-left: 2px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.reply-form {
  margin: 12px 0 0 44px;
  padding: 11px;
  background: var(--paper-inset);
  border-radius: var(--r);
}
</style>
