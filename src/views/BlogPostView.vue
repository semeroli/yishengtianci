<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { Api, visitorId } from '../api.js'
import { renderMarkdown } from '../utils/markdown.js'
import { articleJsonLd, setSeo } from '../utils/seo.js'
import { excerpt, fmtDate, fmtNum } from '../utils/format.js'
import { toast } from '../stores/ui.js'
import CommentSection from '../components/CommentSection.vue'

const route = useRoute()

const post = ref(null)
const loading = ref(true)
const err = ref('')
const liked = ref(false)
const faved = ref(false)
const zoom = ref(null) // 图片查看器当前图片地址
const commentRef = ref(null)

const html = computed(() => (post.value ? renderMarkdown(post.value.content_md || '') : ''))
const dateText = computed(() =>
  post.value ? fmtDate(post.value.published_at || post.value.created_at) : ''
)
const readingMin = computed(() => {
  const n = (post.value?.content_md || '').length
  return Math.max(1, Math.round(n / 400))
})

async function load() {
  loading.value = true
  err.value = ''
  post.value = null
  try {
    const { data } = await Api.post(route.params.slug)
    post.value = data
    liked.value = false
    setSeo({
      type: 'article',
      title: data.title,
      description: data.excerpt || excerpt(data.content_md, 120),
      image: data.cover_image || undefined,
      url: location.origin + route.fullPath,
      jsonLd: articleJsonLd({
        title: data.title,
        description: data.excerpt || excerpt(data.content_md, 120),
        image: data.cover_image,
        url: location.origin + route.fullPath,
        published: data.published_at || data.created_at,
        modified: data.updated_at,
        author: data.author
      })
    })
    await checkFav()
  } catch (e) {
    err.value = e.message || '文章加载失败'
  } finally {
    loading.value = false
  }
}

async function checkFav() {
  if (!post.value) return
  try {
    const { data } = await Api.favorites()
    faved.value = (data.list || []).some(
      (f) => f.target_type === 'post' && Number(f.target_id) === Number(post.value.id)
    )
  } catch {
    faved.value = false
  }
}

async function toggleFav() {
  if (!post.value) return
  try {
    if (faved.value) {
      const { data } = await Api.favorites()
      const hit = (data.list || []).find(
        (f) => f.target_type === 'post' && Number(f.target_id) === Number(post.value.id)
      )
      if (hit) await Api.removeFavorite(hit.id)
      faved.value = false
      toast('已从词笺移出', 'info')
    } else {
      await Api.addFavorite({
        targetType: 'post',
        targetId: post.value.id,
        snapshot: { title: post.value.title, slug: post.value.slug, cover: post.value.cover_image }
      })
      faved.value = true
      toast('已收藏到词笺', 'success')
    }
  } catch (e) {
    toast(e.message || '操作失败', 'error')
  }
}

async function like() {
  if (!post.value || liked.value) return
  liked.value = true
  try {
    const { data } = await Api.likePost(post.value.slug)
    post.value.like_count = data.like_count
    toast('感谢喜欢', 'success')
  } catch {
    liked.value = false
    toast('点赞失败', 'error')
  }
}

async function share() {
  if (!post.value) return
  const url = location.origin + route.fullPath
  try {
    await Api.sharePost(post.value.slug)
    post.value.share_count = (post.value.share_count || 0) + 1
  } catch {}
  const text = `${post.value.title} —— ${post.value.excerpt || ''}`
  if (navigator.share) {
    try {
      await navigator.share({ title: post.value.title, text, url })
      return
    } catch {}
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`)
    toast('链接已复制，去粘贴给朋友吧', 'success')
  } catch {
    toast('复制失败，请手动复制地址栏链接', 'error')
  }
}

function onContentClick(e) {
  const img = e.target.closest?.('img')
  if (img) zoom.value = img.src
}

function onKey(e) {
  if (e.key === 'Escape') zoom.value = null
}

watch(() => route.params.slug, load)

onMounted(() => {
  load()
  window.addEventListener('keydown', onKey)
  // 记录一次收藏用的访客标识，保证与工作台同一身份
  visitorId()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.title = '倚声 · AI填词工坊'
})
</script>

<template>
  <div class="page wrap">
    <div v-if="loading" class="center muted mt3"><span class="spin">◌</span> 展卷……</div>

    <p v-else-if="err" class="empty mt3">
      <span class="glyph">◌</span>
      <span class="line">{{ err }}</span>
      <span class="sub"><RouterLink to="/blog">← 回到博客列表</RouterLink></span>
    </p>

    <template v-else-if="post">
      <nav class="crumbs small muted">
        <RouterLink to="/">填词</RouterLink>
        <span>/</span>
        <RouterLink to="/blog">博客</RouterLink>
        <span>/</span>
        <RouterLink :to="`/blog?category=${encodeURIComponent(post.category || '')}`">
          {{ post.category || '随笔' }}
        </RouterLink>
      </nav>

      <article class="post">
        <header class="post-head reveal">
          <h1>{{ post.title }}</h1>
          <div class="meta row wrap gap-sm small muted">
            <span>{{ post.author || '管理员' }}</span>
            <span>·</span>
            <span>{{ dateText }}</span>
            <span>·</span>
            <span>约 {{ readingMin }} 分钟读完</span>
            <span>·</span>
            <span>👁 {{ fmtNum(post.view_count) }}</span>
          </div>
          <div class="row wrap gap-xs mt1">
            <RouterLink
              v-for="t in post.tags || []"
              :key="t"
              class="tag tiny gold"
              :to="`/blog?q=${encodeURIComponent(t)}`"
            >
              #{{ t }}
            </RouterLink>
          </div>
          <img v-if="post.cover_image" class="cover" :src="post.cover_image" :alt="post.title" />
        </header>

        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="prose" @click="onContentClick" v-html="html"></div>

        <footer class="post-foot">
          <div class="row wrap gap-sm">
            <button class="btn sm" :class="{ on: liked }" :disabled="liked" @click="like">
              ♡ 喜欢 {{ fmtNum(post.like_count) }}
            </button>
            <button class="btn sm" @click="toggleFav">
              {{ faved ? '★ 已收藏' : '☆ 收藏到词笺' }}
            </button>
            <button class="btn sm" @click="share">↗ 分享（{{ fmtNum(post.share_count) }}）</button>
          </div>
          <p class="hint mb0">
            文中如有讹误，欢迎在下面留言指出。格律问题建议附词牌名与句序，便于核对。
          </p>
        </footer>
      </article>

      <nav v-if="post.prev || post.next" class="pn">
        <RouterLink v-if="post.prev" class="pn-item" :to="`/blog/${encodeURIComponent(post.prev.slug)}`">
          <span class="tiny muted">← 上一篇</span>
          <b>{{ post.prev.title }}</b>
        </RouterLink>
        <span v-else></span>
        <RouterLink
          v-if="post.next"
          class="pn-item right"
          :to="`/blog/${encodeURIComponent(post.next.slug)}`"
        >
          <span class="tiny muted">下一篇 →</span>
          <b>{{ post.next.title }}</b>
        </RouterLink>
      </nav>

      <CommentSection ref="commentRef" :post-id="post.id" :initial="post.comments || []" />
    </template>

    <!-- 图片查看器 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="zoom" class="lightbox no-print" @click="zoom = null">
          <img :src="zoom" alt="查看大图" />
          <span class="lightbox-tip tiny">点击任意处关闭</span>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.gap-sm {
  gap: 8px;
}
.gap-xs {
  gap: 6px;
}
.crumbs {
  display: flex;
  gap: 7px;
  align-items: center;
  padding: 6px 0 14px;
}
.crumbs a {
  color: var(--ink-3);
  text-decoration: none;
}
.crumbs a:hover {
  color: var(--cinnabar);
}
.post {
  max-width: 760px;
  margin: 0 auto;
}
.post-head h1 {
  font-family: var(--font-kai);
  font-size: clamp(1.5rem, 3.6vw, 2.2rem);
  line-height: 1.5;
  letter-spacing: 0.06em;
  margin: 0 0 12px;
}
.post-head .meta {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.cover {
  width: 100%;
  border-radius: var(--r);
  margin: 18px 0 4px;
  border: 1px solid var(--line);
}
.post-foot {
  margin-top: 34px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
}
.btn.on {
  border-color: var(--cinnabar);
  color: var(--cinnabar);
}
.pn {
  max-width: 760px;
  margin: 26px auto 30px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.pn-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 13px 15px;
  border: 1px solid var(--line);
  border-radius: var(--r);
  background: var(--paper-2);
  text-decoration: none;
  color: var(--ink);
  transition: all var(--t);
}
.pn-item:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-2);
  border-color: var(--line-strong);
}
.pn-item.right {
  text-align: right;
}
.pn-item b {
  font-weight: 500;
  line-height: 1.6;
  font-size: 0.94rem;
}
.pn-item:hover b {
  color: var(--cinnabar);
}
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: color-mix(in srgb, var(--ink) 88%, transparent);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 3vh 3vw;
  cursor: zoom-out;
}
.lightbox img {
  max-width: 96vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: var(--r);
  box-shadow: var(--shadow-3);
}
.lightbox-tip {
  color: rgba(255, 255, 255, 0.7);
}
@media (max-width: 640px) {
  .pn {
    grid-template-columns: 1fr;
  }
}
</style>

<!--
  正文样式不能用 scoped：内容来自 v-html，没有 scoped 属性可挂。
  用 :deep() 也不行（同样依赖作用域标记），所以单独放一段全局样式。
-->
<style>
.prose {
  margin-top: 26px;
  font-size: 1.03rem;
  line-height: 2.05;
  color: var(--ink);
  word-break: break-word;
}
.prose p {
  margin: 0 0 1.15em;
}
.prose h2 {
  font-family: var(--font-kai);
  font-size: 1.42rem;
  margin: 2em 0 0.7em;
  padding-left: 12px;
  border-left: 3px solid var(--cinnabar);
  letter-spacing: 0.04em;
}
.prose h3 {
  font-size: 1.16rem;
  margin: 1.7em 0 0.6em;
  color: var(--ink);
}
.prose h4 {
  font-size: 1.02rem;
  margin: 1.4em 0 0.5em;
  color: var(--ink-2);
}
.prose a {
  color: var(--azurite);
  text-decoration: none;
  border-bottom: 1px solid var(--azurite-soft);
}
.prose a:hover {
  color: var(--cinnabar);
  border-color: var(--cinnabar-soft);
}
.prose img {
  max-width: 100%;
  border-radius: var(--r);
  border: 1px solid var(--line);
  cursor: zoom-in;
  margin: 0.5em 0;
}
.prose blockquote {
  margin: 1.3em 0;
  padding: 12px 18px;
  background: var(--paper-inset);
  border-left: 3px solid var(--gamboge);
  border-radius: 0 var(--r) var(--r) 0;
  color: var(--ink-2);
}
.prose blockquote p:last-child {
  margin-bottom: 0;
}
.prose ul,
.prose ol {
  margin: 0 0 1.15em;
  padding-left: 1.5em;
}
.prose li {
  margin-bottom: 0.4em;
}
.prose code {
  font-family: var(--font-mono);
  font-size: 0.86em;
  background: var(--paper-inset);
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--line);
}
.prose pre.code-block {
  margin: 1.3em 0;
  padding: 0;
  background: var(--paper-inset);
  border: 1px solid var(--line);
  border-radius: var(--r);
  overflow: hidden;
}
.prose pre.code-block code {
  display: block;
  padding: 15px 17px;
  background: transparent;
  border: 0;
  border-radius: 0;
  overflow-x: auto;
  line-height: 1.75;
  font-size: 0.86rem;
}
.prose table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.3em 0;
  font-size: 0.92rem;
}
.prose th,
.prose td {
  border: 1px solid var(--line);
  padding: 8px 11px;
  text-align: left;
}
.prose th {
  background: var(--paper-inset);
  font-weight: 600;
}
.prose hr {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 2em 0;
}
.prose strong {
  color: var(--ink);
  font-weight: 600;
}

/* ── 代码高亮：跟着主题走，不用现成的亮色主题 ── */
.prose .hljs-comment,
.prose .hljs-quote {
  color: var(--ink-3);
  font-style: italic;
}
.prose .hljs-keyword,
.prose .hljs-selector-tag,
.prose .hljs-literal,
.prose .hljs-doctag {
  color: var(--cinnabar);
}
.prose .hljs-string,
.prose .hljs-regexp,
.prose .hljs-addition {
  color: var(--moss);
}
.prose .hljs-number,
.prose .hljs-built_in,
.prose .hljs-type {
  color: var(--gamboge);
}
.prose .hljs-title,
.prose .hljs-section,
.prose .hljs-name,
.prose .hljs-attr {
  color: var(--azurite);
}
.prose .hljs-variable,
.prose .hljs-template-variable {
  color: var(--ink-2);
}
.prose .hljs-deletion {
  color: var(--cinnabar);
}
</style>
