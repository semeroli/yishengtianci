<script setup>
import { computed, ref } from 'vue'

/**
 * 后台折线图（纯 SVG，不引图表库）
 * ─────────────────────────────────────────────────────────────
 * 只为「7 / 14 / 30 天一条趋势线」这点需求引 ECharts(≈900KB) 不划算，
 * 而且图表库默认样式和后台的克制风格不搭。
 * 做了：网格、Y 轴刻度、X 轴日期、面积渐变、鼠标悬停十字线与数值点。
 */
const props = defineProps({
  data: { type: Array, default: () => [] }, // [{ date, value }]
  height: { type: Number, default: 210 },
  color: { type: String, default: 'var(--a-primary)' },
  unit: { type: String, default: '' },
  label: { type: String, default: '' }
})

const W = 720
const PAD = { l: 42, r: 14, t: 16, b: 26 }
const hover = ref(-1)

const pts = computed(() => {
  const rows = props.data || []
  const H = props.height
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const max = Math.max(1, ...rows.map((d) => Number(d.value) || 0))
  // 这条线画的永远是**计数**（阅读 / 评论 / 填词 / 分享），刻度必须取整到 1。
  // 不取整的话，数据全为 0 时 max=1 → niceStep(0.25)=0.5，
  // Y 轴就会冒出 0 / 0.5 / 1 / 1.5 / 2 这种没人看得懂的刻度。
  const step = Math.max(1, niceStep(max / 4))
  const top = Math.max(step * 4, Math.ceil(max / step) * step)
  const n = rows.length
  return {
    rows,
    innerW,
    innerH,
    top,
    step,
    ticks: Array.from({ length: 5 }, (_, i) => i * step),
    x: (i) => PAD.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW),
    y: (v) => PAD.t + innerH - (Math.min(v, top) / top) * innerH
  }
})

function niceStep(raw) {
  if (!raw || raw <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return nice * mag
}

const linePath = computed(() => {
  const p = pts.value
  if (!p.rows.length) return ''
  return p.rows.map((d, i) => `${i ? 'L' : 'M'}${p.x(i).toFixed(1)},${p.y(Number(d.value) || 0).toFixed(1)}`).join(' ')
})

const areaPath = computed(() => {
  const p = pts.value
  if (!p.rows.length) return ''
  const base = PAD.t + p.innerH
  return `${linePath.value} L${p.x(p.rows.length - 1).toFixed(1)},${base} L${p.x(0).toFixed(1)},${base} Z`
})

const gid = `admLg${Math.random().toString(36).slice(2, 8)}`

const xLabels = computed(() => {
  const p = pts.value
  const n = p.rows.length
  // 标签太密会糊成一团：最多标 7 个
  const stride = Math.max(1, Math.ceil(n / 7))
  return p.rows.map((d, i) => ({ i, text: String(d.date || '').slice(5), show: i % stride === 0 || i === n - 1 }))
})

const active = computed(() => (hover.value >= 0 ? pts.value.rows[hover.value] : null))

function onMove(e) {
  const p = pts.value
  const n = p.rows.length
  if (!n) return
  const box = e.currentTarget.getBoundingClientRect()
  const x = ((e.clientX - box.left) / box.width) * W
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < n; i++) {
    const d = Math.abs(p.x(i) - x)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  hover.value = best
}
</script>

<template>
  <div class="adm-chart">
    <svg
      :viewBox="`0 0 ${W} ${height}`"
      :style="{ height: height + 'px' }"
      role="img"
      :aria-label="`${label} 趋势图`"
      @mousemove="onMove"
      @mouseleave="hover = -1"
    >
      <defs>
        <linearGradient :id="gid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" :stop-color="color" stop-opacity="0.22" />
          <stop offset="100%" :stop-color="color" stop-opacity="0.01" />
        </linearGradient>
      </defs>

      <!-- 网格 + Y 轴刻度 -->
      <g class="grid">
        <line
          v-for="t in pts.ticks"
          :key="'g' + t"
          :x1="PAD.l"
          :x2="W - PAD.r"
          :y1="pts.y(t)"
          :y2="pts.y(t)"
          class="gl"
        />
        <text v-for="t in pts.ticks" :key="'t' + t" :x="PAD.l - 8" :y="pts.y(t) + 4" class="yl">
          {{ t }}
        </text>
      </g>

      <!-- X 轴日期 -->
      <g>
        <text
          v-for="l in xLabels"
          v-show="l.show"
          :key="l.i"
          :x="pts.x(l.i)"
          :y="height - 8"
          class="xl"
        >
          {{ l.text }}
        </text>
      </g>

      <template v-if="pts.rows.length">
        <path :d="areaPath" :fill="`url(#${gid})`" />
        <path :d="linePath" fill="none" :stroke="color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />

        <!-- 悬停十字线 + 数值点 -->
        <g v-if="hover >= 0">
          <line :x1="pts.x(hover)" :x2="pts.x(hover)" :y1="PAD.t" :y2="PAD.t + pts.innerH" class="cross" />
          <circle :cx="pts.x(hover)" :cy="pts.y(Number(pts.rows[hover].value) || 0)" r="4" :fill="color" class="dot" />
        </g>

        <!-- 数据点：少于 15 个才画，否则太花 -->
        <template v-if="pts.rows.length <= 15">
          <circle
            v-for="(d, i) in pts.rows"
            :key="'p' + i"
            :cx="pts.x(i)"
            :cy="pts.y(Number(d.value) || 0)"
            r="2"
            :fill="color"
          />
        </template>
      </template>

      <text v-else :x="W / 2" :y="height / 2" class="no-data">暂无数据</text>
    </svg>

    <div v-if="active" class="tip">
      <span class="d">{{ active.date }}</span>
      <b>{{ active.value }}</b>
      <span class="u">{{ unit }}</span>
    </div>
  </div>
</template>

<style scoped>
.adm-chart {
  position: relative;
}
svg {
  width: 100%;
  display: block;
  overflow: visible;
}
.gl {
  stroke: var(--a-line-2);
  stroke-width: 1;
}
.yl,
.xl {
  fill: var(--a-text-3);
  font-size: 11px;
  font-family: var(--a-font-mono);
}
.xl {
  text-anchor: middle;
}
.yl {
  text-anchor: end;
}
.cross {
  stroke: var(--a-text-3);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}
.dot {
  stroke: var(--a-card);
  stroke-width: 2;
}
.no-data {
  fill: var(--a-text-3);
  font-size: 13px;
  text-anchor: middle;
}
.tip {
  position: absolute;
  top: 0;
  right: 0;
  background: var(--a-card);
  border: 1px solid var(--a-line);
  border-radius: var(--a-radius);
  padding: 4px 10px;
  font-size: 0.8rem;
  display: flex;
  align-items: baseline;
  gap: 6px;
  box-shadow: var(--a-shadow);
  pointer-events: none;
}
.tip .d {
  color: var(--a-text-3);
  font-family: var(--a-font-mono);
  font-size: 0.74rem;
}
.tip b {
  font-variant-numeric: tabular-nums;
}
.tip .u {
  color: var(--a-text-3);
  font-size: 0.72rem;
}
</style>
