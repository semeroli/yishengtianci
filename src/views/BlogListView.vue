<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Api } from '../api.js'
import { excerpt, fmtDate, fmtNum } from '../utils/format.js'

/**
 * 填词博客 · 列表页
 * ─────────────────────────────────────────────────────────────
 * 分类 / 关键词 / 页码全部同步到地址栏（?category=&q=&page=），
 * 这样分享出去的链接是可复现的，也方便浏览器前进后退。
 */

const route = useRoute()
const router = useRouter()

const CATS = ['全部', '填词教程', '词人轶事', '名作赏析', '创作心得', '格律知识']

const loading = ref(true)
const list = ref([])
const total = ref(0)
const pages = ref(1)
const cats = ref([])
const err = ref('')

const keyword = ref(route.query.q || '')
const activeCat = computed(() => (route.query.category || '全部'))
const page = computed(() => Math.max(1, parseInt(route.query.page || '1', 10) || 1))

async function load() {
  loading.value = true
  err.value = ''
  try {
    const { data } = await Api.posts({
      page: page.value,
      pageSize: 9,
      category: activeCat.value === '全部' ? '' : activeCat.value,
      q: keyword.value.trim()
    })
    list.value = data.list || []
    total.value = data.total || 0
    pages.value = data.pages || 1
    cats.value = data.categories || []
  } catch (e) {
    err.value = e.message || '文章加载失败'
    list.value = []
  } finally {
    loading.value = false
  }
}

function pushQuery(patch) {
  const q = { ...route.query, ...patch }
  Object.keys(q).forEach((k) => {
    if (q[k] === '' || q[k] === undefined || q[k] === null || q[k] === '全部') delete q[k]
    if (k === 'page' && q[k] === '1') delete q[k]
  })
  router.push({ name: 'blog', query: q })
}

function pickCat(name) {
  pushQuery({ category: name === '全部' ? '' : name, page: '1' })
}

function search() {
  pushQuery({ q: keyword.value.trim(), page: '1' })
}

function clearSearch() {
  keyword.value = ''
  pushQuery({ q: '', page: '1' })
}

function goto(p) {
  if (p < 1 || p > pages.value) return
  pushQuery({ page: String(p) })
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function catCount(name) {
  if (name === '全部') return cats.value.reduce((a, c) => a + c.count, 0)
  return cats.value.find((c) => c.name === name)?.count || 0
}

const allCats = computed(() => {
  const names = new Set([...CATS, ...cats.value.map((c) => c.name)])
  return [...names]
})

watch(() => route.fullPath, load)
onMounted(load)
</script>

<template>
  <div class="page wrap">
    <section class="blog-head reveal">
      <h1>填词博客</h1>
      <p class="sub">
        格律怎么认、古人怎么写、意象怎么挑 —— 都写在这里。
        <span class="muted">共 {{ total }} 篇</span>
      </p>

      <div class="search-row">
        <input
          v-model="keyword"
          class="input search-input"
          type="search"
          placeholder="搜标题、摘要或正文关键词…"
          @keyup.enter="search"
        />
        <button class="btn primary" @click="search">搜索</button>
        <button v-if="route.query.q" class="btn ghost" @click="clearSearch">清空</button>
      </div>

      <div class="cats">
        <button
          v-for="c in allCats"
          :key="c"
          class="chip"
          :class="{ active: activeCat === c }"
          @click="pickCat(c)"
        >
          {{ c }}
          <span v-if="catCount(c)" class="n">{{ catCount(c) }}</span>
        </button>
      </div>
    </section>

    <div v-if="loading" class="center muted mt3">
      <span class="spin">◌</span> 翻检旧稿……
    </div>

    <p v-else-if="err" class="hint err mt3">{{ err }}</p>

    <p v-else-if="!list.length" class="empty mt3">
      <span class="glyph">◌</span>
      <span class="line">此处无声胜有声</span>
      <span class="sub">换个关键词试试？</span>
    </p>

    <template v-else>
      <div class="waterfall mt3">
        <article
          v-for="(p, i) in list"
          :key="p.id"
          class="card post-card"
          :style="{ animationDelay: i * 60 + 'ms' }"
        >
          <RouterLink class="cover" :to="`/blog/${encodeURIComponent(p.slug)}`">
            <img v-if="p.cover_image" :src="p.cover_image" :alt="p.title" loading="lazy" />
            <span v-else class="cover-ph">
              <em class="kai">{{ (p.title || '倚声').slice(0, 1) }}</em>
            </span>
          </RouterLink>
          <div class="body">
            <div class="row wrap tiny muted gap-xs">
              <span class="tag plain">{{ p.category || '随笔' }}</span>
              <span>{{ fmtDate(p.published_at || p.created_at) }}</span>
            </div>
            <h3 class="title">
              <RouterLink :to="`/blog/${encodeURIComponent(p.slug)}`">{{ p.title }}</RouterLink>
            </h3>
            <p class="excerpt">{{ p.excerpt || excerpt(p.preview || '', 90) }}</p>
            <div class="row wrap gap-xs mt1">
              <span v-for="t in (p.tags || []).slice(0, 4)" :key="t" class="tag tiny gold">#{{ t }}</span>
            </div>
            <div class="foot row between">
              <span class="tiny muted">{{ p.author || '管理员' }}</span>
              <span class="tiny muted">
                👁 {{ fmtNum(p.view_count) }} · ♡ {{ fmtNum(p.like_count) }}
              </span>
            </div>
          </div>
        </article>
      </div>

      <nav v-if="pages > 1" class="pager">
        <button class="btn sm" :disabled="page <= 1" @click="goto(page - 1)">← 上一页</button>
        <span class="small muted">第 {{ page }} / {{ pages }} 页</span>
        <button class="btn sm" :disabled="page >= pages" @click="goto(page + 1)">下一页 →</button>
      </nav>
    </template>
  </div>
</template>

<style scoped>
.blog-head {
  padding: 14px 0 8px;
}
.blog-head h1 {
  font-family: var(--font-kai);
  font-size: clamp(1.6rem, 3.4vw, 2.1rem);
  letter-spacing: 0.12em;
  margin: 0 0 8px;
}
.blog-head .sub {
  color: var(--ink-2);
  margin: 0 0 18px;
  line-height: 1.8;
}
.search-row {
  display: flex;
  gap: 9px;
  margin-bottom: 14px;
}
.search-input {
  flex: 1;
  max-width: 460px;
}
.cats {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.cats .n {
  font-size: 0.68rem;
  opacity: 0.7;
  margin-left: 3px;
}
.gap-xs {
  gap: 6px;
}
.gap {
  gap: 8px;
}

/* 瀑布流：用 CSS 多栏，卡片高矮不齐时自动错落 */
.waterfall {
  column-count: 3;
  column-gap: 18px;
}
.waterfall > * {
  break-inside: avoid;
  margin-bottom: 18px;
}
.post-card {
  animation: pageFade 520ms var(--ease-ink) both;
}
.cover {
  display: block;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: var(--paper-inset);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 620ms var(--ease-ink);
}
.post-card:hover .cover img {
  transform: scale(1.04);
}
.cover-ph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    var(--noise),
    linear-gradient(140deg, var(--paper-inset), var(--paper-3));
}
.cover-ph em {
  font-size: 2.4rem;
  font-style: normal;
  color: var(--ink-4);
  letter-spacing: 0.1em;
}
.body {
  padding: 14px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  flex: 1;
}
.title {
  margin: 0;
  font-size: 1.08rem;
  line-height: 1.6;
}
.title a {
  color: var(--ink);
  text-decoration: none;
}
.title a:hover {
  color: var(--cinnabar);
}
.excerpt {
  margin: 0;
  color: var(--ink-2);
  font-size: 0.86rem;
  line-height: 1.85;
}
.foot {
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin-top: 30px;
}
.hint.err {
  color: var(--cinnabar);
}
@media (max-width: 1024px) {
  .waterfall {
    column-count: 2;
  }
}
@media (max-width: 640px) {
  .waterfall {
    column-count: 1;
  }
  .search-row {
    flex-wrap: wrap;
  }
  .search-input {
    max-width: none;
  }
}
</style>
