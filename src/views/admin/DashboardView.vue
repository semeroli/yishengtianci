<script setup>
import { computed, onMounted, ref } from 'vue'
import { Api } from '../../api.js'
import { toast } from '../../stores/ui.js'
import AdminLineChart from '../../components/admin/AdminLineChart.vue'
import AdminSkeleton from '../../components/admin/AdminSkeleton.vue'
import AdminEmpty from '../../components/admin/AdminEmpty.vue'
import AdminStatusTag from '../../components/admin/AdminStatusTag.vue'

/**
 * 数据看板
 * ─────────────────────────────────────────────────────────────
 * 三段：四张统计卡 → 趋势图 + 热门文章 → 最近动态。
 * 环比由后端算好（没有上期数据时返回 null），前端不显示「+100%」这种假增长。
 */

const days = ref(7)
const loading = ref(true)
const data = ref(null)

// 折线图可切指标，默认「阅读」
const METRICS = [
  { key: 'view', label: '阅读', unit: '次', color: 'var(--a-primary)' },
  { key: 'generate', label: '填词', unit: '次', color: 'var(--a-info)' },
  { key: 'comment', label: '评论', unit: '条', color: 'var(--a-warn)' },
  { key: 'share', label: '分享', unit: '次', color: 'var(--a-success)' }
]
const metric = ref('view')
const curMetric = computed(() => METRICS.find((m) => m.key === metric.value) || METRICS[0])

const series = computed(() =>
  (data.value?.series || []).map((d) => ({ date: d.date, value: d[metric.value] || 0 }))
)
const seriesTotal = computed(() => series.value.reduce((s, d) => s + (Number(d.value) || 0), 0))

const cards = computed(() => {
  const c = data.value?.cards || {}
  const fmt = (n) => Number(n || 0).toLocaleString('zh-CN')
  const chg = (v) => (v === null || v === undefined ? '暂无环比数据' : `${v > 0 ? '+' : ''}${v}%`)
  const cls = (v) => (v === null || v === undefined ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '')
  return [
    {
      k: 'k1',
      icon: '📝',
      label: '文章数',
      value: fmt(c.posts?.value),
      lines: [
        { text: `已发布 ${fmt(c.posts?.published)} · 草稿 ${fmt(c.posts?.draft)}` },
        { text: c.posts?.pending ? `待审评论 ${c.posts.pending} 条` : '评论都已处理', cls: c.posts?.pending ? 'pend' : '' }
      ]
    },
    {
      k: 'k2',
      icon: '👁',
      label: '累计阅读',
      value: fmt(c.views?.value),
      lines: [{ text: `${days.value} 天内 ${chg(c.views?.change)}`, cls: cls(c.views?.change) }]
    },
    {
      k: 'k3',
      icon: '💬',
      label: '评论总数',
      value: fmt(c.comments?.value),
      lines: [
        { text: `${days.value} 天内 ${chg(c.comments?.change)}`, cls: cls(c.comments?.change) },
        { text: c.comments?.pending ? `其中待审 ${c.comments.pending} 条` : '', cls: 'pend' }
      ]
    },
    {
      k: 'k4',
      icon: '🖋',
      label: `${days.value} 天填词`,
      value: fmt(c.generate?.value),
      lines: [{ text: `环比上期 ${chg(c.generate?.change)}`, cls: cls(c.generate?.change) }]
    }
  ]
})

const KIND_TEXT = {
  comment: { icon: '💬', verb: '新评论', to: '/admin/comments' },
  publish: { icon: '📄', verb: '文章发布', to: '/admin/posts' },
  update: { icon: '✎', verb: '文章更新', to: '/admin/posts' }
}

function relative(t) {
  if (!t) return ''
  const ts = new Date(String(t).replace(' ', 'T') + (String(t).length <= 10 ? 'T00:00:00' : '')).getTime()
  if (!Number.isFinite(ts)) return String(t).slice(0, 16)
  const diff = Date.now() - ts
  if (diff < 0) return String(t).slice(0, 16)
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  return String(t).slice(0, 10)
}

async function load() {
  loading.value = true
  try {
    const { data: d } = await Api.adminDashboard(days.value)
    data.value = d
  } catch (e) {
    toast('看板数据加载失败：' + (e?.message || ''), 'error', 0, { label: '重试', run: load })
  } finally {
    loading.value = false
  }
}

function setDays(d) {
  days.value = d
  load()
}

onMounted(load)
</script>

<template>
  <div>
    <div class="adm-page-head">
      <h1>数据看板</h1>
      <span class="desc">最近 {{ days }} 天的站点概况</span>
      <span class="sp"></span>
      <div class="adm-seg">
        <button v-for="d in [7, 14, 30]" :key="d" type="button" :class="{ on: days === d }" @click="setDays(d)">
          {{ d }} 天
        </button>
      </div>
      <button class="btn sm" type="button" :disabled="loading" @click="load">↻ 刷新</button>
    </div>

    <!-- ① 四张统计卡 -->
    <div class="adm-stats">
      <div v-for="c in cards" :key="c.label" class="adm-stat" :class="c.k">
        <div class="lb"><span aria-hidden="true">{{ c.icon }}</span>{{ c.label }}</div>
        <div class="vl">
          <span v-if="loading" class="adm-skel" style="display: inline-block; width: 78px; height: 30px"></span>
          <template v-else>{{ c.value }}</template>
        </div>
        <div class="ft">
          <span v-for="(l, i) in c.lines" v-show="l.text" :key="i" :class="l.cls">{{ l.text }}</span>
        </div>
      </div>
    </div>

    <!-- ② 趋势图 + 热门文章 -->
    <div class="sec2">
      <div class="adm-card">
        <div class="adm-card-head">
          <h3>📈 趋势</h3>
          <span class="sp"></span>
          <div class="adm-seg">
            <button
              v-for="m in METRICS"
              :key="m.key"
              type="button"
              :class="{ on: metric === m.key }"
              @click="metric = m.key"
            >
              {{ m.label }}
            </button>
          </div>
        </div>
        <div class="adm-card-body">
          <p class="sum tiny">
            近 {{ days }} 天共 <b>{{ seriesTotal.toLocaleString('zh-CN') }}</b> {{ curMetric.unit }}{{ curMetric.label === '填词' ? '' : '' }}
          </p>
          <AdminSkeleton v-if="loading" :rows="4" />
          <AdminLineChart
            v-else
            :data="series"
            :color="curMetric.color"
            :unit="curMetric.unit"
            :label="curMetric.label"
          />
        </div>
      </div>

      <div class="adm-card">
        <div class="adm-card-head">
          <h3>🔥 热门文章 TOP5</h3>
          <span class="sp"></span>
          <RouterLink class="adm-act" to="/admin/posts">全部 →</RouterLink>
        </div>
        <AdminSkeleton v-if="loading" :rows="5" />
        <AdminEmpty v-else-if="!(data?.topPosts || []).length" line="还没有已发布的文章" sub="发布第一篇之后，这里会按阅读量排序" />
        <ul v-else class="top-list">
          <li v-for="(p, i) in data.topPosts" :key="p.id">
            <span class="rk" :class="{ top3: i < 3 }">{{ i + 1 }}</span>
            <RouterLink class="ti" :to="`/admin/posts/edit/${p.id}`">{{ p.title }}</RouterLink>
            <span class="nm" :title="`阅读 ${p.view_count}`">👁 {{ p.view_count }}</span>
            <span class="nm" :title="`评论 ${p.comment_count}`">💬 {{ p.comment_count }}</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- ③ 最近动态 -->
    <div class="adm-card mt2">
      <div class="adm-card-head">
        <h3>🕒 最近动态</h3>
        <span class="sp"></span>
        <span class="tiny" style="color: var(--a-text-3)">新评论 · 文章发布 · 文章更新</span>
      </div>
      <AdminSkeleton v-if="loading" :rows="5" />
      <AdminEmpty v-else-if="!(data?.recent || []).length" line="还没有动静" sub="有人评论或你发布文章后，这里会留下痕迹" />
      <ul v-else class="feed">
        <li v-for="(x, i) in data.recent" :key="x.kind + '-' + x.ref + '-' + i">
          <span class="ic" aria-hidden="true">{{ (KIND_TEXT[x.kind] || {}).icon || '•' }}</span>
          <span class="vb">{{ (KIND_TEXT[x.kind] || {}).verb || x.kind }}</span>
          <span class="tx">
            <template v-if="x.kind === 'comment'">
              <b>{{ x.who }}</b> 在《{{ x.post_title || '已删除的文章' }}》留言：{{ x.text }}
            </template>
            <template v-else>
              《{{ x.text || x.post_title }}》
            </template>
          </span>
          <span class="sp"></span>
          <AdminStatusTag v-if="x.kind === 'comment'" :status="x.is_spam ? 'spam' : x.is_approved ? 'approved' : 'pending'" />
          <span class="at tiny">{{ relative(x.at) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.sec2 {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 16px;
  margin-top: 16px;
  align-items: start;
}
.sum {
  color: var(--a-text-3);
  margin: 0 0 10px;
}
.sum b {
  color: var(--a-text);
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
}
.top-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.top-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 16px;
  border-bottom: 1px solid var(--a-line-2);
}
.top-list li:last-child {
  border-bottom: 0;
}
.top-list li:hover {
  background: color-mix(in srgb, #d4a853 5%, var(--a-card));
}
.rk {
  width: 20px;
  height: 20px;
  border-radius: 3px;
  background: var(--a-line-2);
  color: var(--a-text-3);
  font-size: var(--fs-xs);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.rk.top3 {
  background: color-mix(in srgb, var(--a-primary) 16%, transparent);
  color: var(--a-primary);
  font-weight: 600;
}
.ti {
  flex: 1;
  min-width: 0;
  color: var(--a-text);
  text-decoration: none;
  font-size: 0.88rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ti:hover {
  color: var(--a-primary);
}
.nm {
  color: var(--a-text-3);
  font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.feed {
  list-style: none;
  margin: 0;
  padding: 0;
}
.feed li {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--a-line-2);
  font-size: 0.86rem;
}
.feed li:last-child {
  border-bottom: 0;
}
.feed .vb {
  color: var(--a-text-3);
  font-size: var(--fs-sm);
  white-space: nowrap;
}
.feed .tx {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--a-text-2);
}
.feed .tx b {
  color: var(--a-text);
}
.feed .sp {
  flex: 1;
}
.feed .at {
  color: var(--a-text-3);
  white-space: nowrap;
}
@media (max-width: 1100px) {
  .sec2 {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
