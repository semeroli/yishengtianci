<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { toast } from '../stores/ui.js'

/**
 * 书法卡片 / 分享海报生成器
 * ─────────────────────────────────────────────────────────────
 * 全部用 Canvas 画：三种底（宣纸 / 竹简 / 扇面）+ 一枚朱砂印。
 * 选 Canvas 而不是 DOM 截图，是因为要「另存为图片」——
 * DOM 转图片要么引 html2canvas，要么受字体/跨域限制，Canvas 最稳。
 */

const props = defineProps({
  open: { type: Boolean, default: false },
  poem: { type: Object, default: null },
  prompt: { type: String, default: '' },
  vertical: { type: Boolean, default: true }
})
const emit = defineEmits(['close'])

const BG = [
  { id: 'xuan', name: '宣纸', desc: '温润古纸，最宜小令' },
  { id: 'bamboo', name: '竹简', desc: '简牍古意，宜豪放' },
  { id: 'fan', name: '扇面', desc: '团扇宫扇，宜清丽' }
]

const bg = ref('xuan')
const poster = ref(false)
const busy = ref(false)
const canvasRef = ref(null)

/*
 * 竖排 / 横排：`vertical` 是**父组件给的默认值**（按响应式断点决定，
 * 手机上默认横排），但用户可以在卡片面板里手动改。
 * 所以这里要用一份本地副本：prop 是只读的，直接 v-model 到 prop
 * 会被编译器拒绝（本地开发服务器不做这个检查，构建时才报错）。
 */
const verticalLocal = ref(props.vertical)
watch(
  () => props.vertical,
  (v) => {
    verticalLocal.value = v
  }
)

const KAI = '"霞鹜文楷","LXGW WenKai","KaiTi","楷体","STKaiti","Songti SC",serif'
const font = (size, weight = 400) => `${weight} ${size}px ${KAI}`

const lines = computed(() => (props.poem?.lines || []).map((l) => l.text).filter(Boolean))
const title = computed(() => props.poem?.cipaiName || '')

// ── 布局计算 ──────────────────────────────────────────────
function layout() {
  const ls = lines.value
  const n = ls.length || 1
  const maxLen = Math.max(...ls.map((l) => [...l].length), 1)
  const pad = poster.value ? 96 : 78

  if (bg.value === 'fan') {
    // 扇面：先定外径，再从大到小试字号，直到所有列都能塞进扇形里
    const R = 620
    const r0 = R * 0.26
    const rm = (R + r0) / 2
    let cell = 86
    let cw = 96
    for (; cell >= 30; cell -= 2) {
      cw = cell * 1.16
      const h = maxLen * cell
      const xEdge = ((n - 1) / 2) * cw
      // 最外侧那一列，上方到弧边的距离 ≥ 半列高
      const avail = Math.sqrt(Math.max(0, R * R - xEdge * xEdge)) - rm
      if (avail >= h / 2 + 18) break
    }
    const w = Math.ceil(n * cw) + pad * 2 + 40
    const h = Math.ceil(R + rm * 0.1) + pad * 2 + (poster.value ? 240 : 120)
    return { W: Math.max(w, 1000), H: Math.max(h, 1180), cell, cw, R, r0, rm, maxLen, n, pad }
  }

  if (verticalLocal.value) {
    // 竖排：列宽随字号，画布宽度随列数
    let cell = 96
    let cw = 112
    const minW = 1040
    if (n * cw + pad * 2 > 2400) {
      const k = 2400 / (n * cw + pad * 2)
      cell = Math.max(56, Math.floor(cell * k))
      cw = Math.floor(cell * 1.16)
    }
    const W = Math.max(minW, n * cw + pad * 2)
    const H = pad * 2 + maxLen * cell + (poster.value ? 430 : 210)
    return { W, H, cell, cw, maxLen, n, pad }
  }

  // 横排：一种词一段，逐行排
  let cell = 74
  const W = 1280
  const rowGap = cell * 1.62
  const H = pad * 2 + n * rowGap + (poster.value ? 430 : 220)
  return { W, H, cell, cw: 0, maxLen, n, pad, rowGap }
}

// ── 底纹 ──────────────────────────────────────────────────
function noise(ctx, W, H, alpha, color) {
  for (let i = 0; i < Math.floor((W * H) / 3200); i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const r = Math.random() * 1.5 + 0.3
    ctx.globalAlpha = Math.random() * alpha
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawXuan(ctx, W, H, L) {
  const g = ctx.createLinearGradient(0, 0, W * 0.35, H)
  g.addColorStop(0, '#F7F2E8')
  g.addColorStop(0.5, '#F3EDE1')
  g.addColorStop(1, '#EDE6D6')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  noise(ctx, W, H, 0.09, '#7A6A50')
  // 内框（仿栏格）
  ctx.strokeStyle = 'rgba(120,100,72,0.34)'
  ctx.lineWidth = 2
  ctx.strokeRect(L.pad * 0.42, L.pad * 0.42, W - L.pad * 0.84, H - L.pad * 0.84)
  ctx.strokeStyle = 'rgba(120,100,72,0.16)'
  ctx.lineWidth = 1
  ctx.strokeRect(L.pad * 0.42 + 8, L.pad * 0.42 + 8, W - L.pad * 0.84 - 16, H - L.pad * 0.84 - 16)
  return { ink: '#2C2416', sub: '#6B5E4A', seal: '#C43D3D' }
}

function drawBamboo(ctx, W, H, L) {
  ctx.fillStyle = '#8A6E45'
  ctx.fillRect(0, 0, W, H)
  const strips = Math.max(9, Math.round(W / 78))
  const sw = W / strips
  for (let i = 0; i < strips; i++) {
    const x = i * sw
    const g = ctx.createLinearGradient(x, 0, x + sw, 0)
    g.addColorStop(0, '#BFA068')
    g.addColorStop(0.28, '#DCC593')
    g.addColorStop(0.72, '#D2BA85')
    g.addColorStop(1, '#A98A57')
    ctx.fillStyle = g
    ctx.fillRect(x + 1.5, 0, sw - 3, H)
    // 竹节纹
    ctx.strokeStyle = 'rgba(120,92,48,0.18)'
    ctx.lineWidth = 1
    for (let y = 40; y < H; y += 132) {
      ctx.beginPath()
      ctx.moveTo(x + 1.5, y + (i % 3) * 9)
      ctx.lineTo(x + sw - 1.5, y + (i % 3) * 9)
      ctx.stroke()
    }
  }
  noise(ctx, W, H, 0.1, '#6B4F28')
  return { ink: '#2A1C0C', sub: '#5C4322', seal: '#B7332F' }
}

function drawFan(ctx, W, H, L) {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#F6EFE0')
  g.addColorStop(1, '#EDE2CB')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  const cx = W / 2
  const cy = H - L.pad * 0.8 - (poster.value ? 300 : 150)
  const { R, r0 } = L

  // 扇体
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, R, Math.PI, Math.PI * 2)
  ctx.arc(cx, cy, r0, Math.PI * 2, Math.PI, true)
  ctx.closePath()
  ctx.fillStyle = '#F8F2E4'
  ctx.fill()
  ctx.restore()

  // 扇骨（放射细线）
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, R, Math.PI, Math.PI * 2)
  ctx.arc(cx, cy, r0, Math.PI * 2, Math.PI, true)
  ctx.closePath()
  ctx.clip()
  ctx.strokeStyle = 'rgba(150,125,92,0.30)'
  ctx.lineWidth = 1.4
  const spokes = 22
  for (let i = 0; i <= spokes; i++) {
    const a = Math.PI + (Math.PI * i) / spokes
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R)
    ctx.stroke()
  }
  noise(ctx, W, H, 0.05, '#6B5A3E')
  ctx.restore()

  // 扇边（朱红描边）+ 扇柄
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, R, Math.PI, Math.PI * 2)
  ctx.arc(cx, cy, r0, Math.PI * 2, Math.PI, true)
  ctx.closePath()
  ctx.strokeStyle = 'rgba(196,61,61,0.55)'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.restore()

  ctx.beginPath()
  ctx.moveTo(cx - 9, cy)
  ctx.lineTo(cx + 9, cy)
  ctx.lineTo(cx + 5, cy + 46)
  ctx.lineTo(cx - 5, cy + 46)
  ctx.closePath()
  ctx.fillStyle = '#A9834C'
  ctx.fill()

  return { ink: '#2C2416', sub: '#6B5E4A', seal: '#C43D3D', fanGeom: { cx, cy } }
}

// ── 印章 ──────────────────────────────────────────────────
function drawSeal(ctx, x, y, size, text, color) {
  ctx.save()
  ctx.fillStyle = color
  const r = size * 0.13
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + size, y, x + size, y + size, r)
  ctx.arcTo(x + size, y + size, x, y + size, r)
  ctx.arcTo(x, y + size, x, y, r)
  ctx.arcTo(x, y, x + size, y, r)
  ctx.closePath()
  ctx.fill()

  const chars = [...(text || '倚声')].slice(0, 4)
  ctx.fillStyle = '#FBF4EA'
  const per = chars.length > 2 ? 2 : 1
  const cell = size / (per + 0.4) / 1.06
  const cols = Math.ceil(chars.length / per)
  const totalW = cols * cell
  const startX = x + (size - totalW) / 2 + cell / 2
  const startY = y + (size - per * cell) / 2 + cell / 2
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = font(Math.floor(cell * 0.82), 600)
  chars.forEach((c, i) => {
    const col = per === 2 ? Math.floor(i / per) : Math.floor(i / per)
    const row = per === 2 ? i % per : 0
    ctx.fillText(c, startX + col * cell, startY + row * cell)
  })
  ctx.restore()
}

// ── 正文 ──────────────────────────────────────────────────
function drawPoemVertical(ctx, L, C, geom) {
  const { cell, cw, pad } = L
  const ls = lines.value
  const n = ls.length
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const startX = geom?.cx ? geom.cx : L.W / 2
  const topBase = geom?.cy
    ? geom.cy - (L.rm || 0)
    : pad + (poster.value ? 150 : 40)

  ls.forEach((text, i) => {
    // 竖排从右往左：第 0 句在最右
    const off = (n - 1) / 2 - i
    const x = startX + off * cw

    let yTop
    if (geom?.cy) {
      const dist = Math.sqrt(Math.max(0, x - geom.cx > 0 ? x - geom.cx : geom.cx - x))
      void dist
      const dx = Math.abs(x - geom.cx)
      const yCenter = geom.cy - Math.sqrt(Math.max(0, L.rm * L.rm - dx * dx))
      yTop = yCenter - (text.length * cell) / 2
    } else {
      const maxLen = L.maxLen
      yTop = topBase + ((maxLen - text.length) * cell) / 2
    }

    ctx.font = font(cell * 0.94, 500)
    const chars = [...text]
    chars.forEach((ch, j) => {
      const isLast = j === chars.length - 1
      const rhyme = props.poem?.lines?.[i]?.rhyme && isLast
      ctx.fillStyle = rhyme ? '#C43D3D' : C.ink
      ctx.fillText(ch, x, yTop + j * cell + cell / 2)
    })
  })
}

function drawPoemHorizontal(ctx, L, C) {
  const ls = lines.value
  const { cell, rowGap, pad } = L
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const y0 = pad + (poster.value ? 150 : 30)
  ls.forEach((text, i) => {
    const y = y0 + i * rowGap + rowGap / 2
    const chars = [...text]
    ctx.font = font(cell * 0.95, 500)
    chars.forEach((ch, j) => {
      const isLast = j === chars.length - 1
      const rhyme = props.poem?.lines?.[i]?.rhyme && isLast
      ctx.fillStyle = rhyme ? '#C43D3D' : C.ink
      ctx.fillText(ch, pad + 26 + j * cell * 1.14, y)
    })
    // 句末读点
    if (props.poem?.lines?.[i]?.rhyme) {
      ctx.fillStyle = C.sub
      ctx.font = font(cell * 0.5)
      ctx.fillText('。', pad + 26 + chars.length * cell * 1.14, y + cell * 0.22)
    }
  })
}

// ── 主绘制 ────────────────────────────────────────────────
function draw() {
  const cv = canvasRef.value
  if (!cv || !props.poem || !lines.value.length) return
  const L = layout()
  const dpr = 2
  cv.width = Math.floor(L.W * dpr)
  cv.height = Math.floor(L.H * dpr)
  cv.style.width = '100%'
  cv.style.maxWidth = L.W + 'px'
  const ctx = cv.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, L.W, L.H)

  let C
  if (bg.value === 'bamboo') C = drawBamboo(ctx, L.W, L.H, L)
  else if (bg.value === 'fan') C = drawFan(ctx, L.W, L.H, L)
  else C = drawXuan(ctx, L.W, L.H, L)

  ctx.textBaseline = 'middle'

  // 标题（词牌）
  const headY = L.pad * 0.72
  ctx.textAlign = 'center'
  ctx.fillStyle = C.ink
  ctx.font = font(poster.value ? 62 : 54, 700)
  ctx.fillText(title.value, L.W / 2, headY)
  ctx.font = font(24)
  ctx.fillStyle = C.sub
  ctx.fillText('倚声 · AI填词工坊', L.W / 2, headY + 46)

  // 正文
  if (bg.value === 'fan') drawPoemVertical(ctx, L, C, C.fanGeom)
  else if (verticalLocal.value) drawPoemVertical(ctx, L, C, null)
  else drawPoemHorizontal(ctx, L, C)

  // 落款
  const footY =
    bg.value === 'fan'
      ? C.fanGeom.cy + 72
      : verticalLocal.value
        ? L.pad + L.maxLen * L.cell + (poster.value ? 260 : 60)
        : L.pad + L.n * L.rowGap + (poster.value ? 260 : 56)

  ctx.textAlign = 'center'
  if (poster.value) {
    ctx.fillStyle = C.sub
    ctx.font = font(30)
    const p = (props.prompt || '').slice(0, 42)
    if (p) ctx.fillText(`意境：${p}`, L.W / 2, footY - 26)
    ctx.font = font(24)
    ctx.fillText(
      `倚声 · AI填词工坊　|　格律校验通过　|　${new Date().toLocaleDateString('zh-CN')}`,
      L.W / 2,
      footY + 26
    )
  } else {
    ctx.fillStyle = C.sub
    ctx.font = font(26)
    const tone = props.poem.rhyme?.[0]
    ctx.fillText(tone ? `押 ${tone.short}（${tone.tone}）` : '', L.W / 2, footY - 6)
  }

  // 朱砂印
  const sealSize = 66
  const sealTxt = title.value.replace(/[^\u4e00-\u9fa5]/g, '').slice(0, 2) || '倚声'
  const sx = bg.value === 'fan' ? C.fanGeom.cx + L.R * 0.42 : L.pad * 0.42 + 14
  const sy = bg.value === 'fan' ? footY - 46 : footY - sealSize - 6
  drawSeal(ctx, sx, sy, sealSize, sealTxt, C.seal)
}

async function redraw() {
  await nextTick()
  draw()
}

watch(
  () => [props.open, bg.value, poster.value, verticalLocal.value, props.poem],
  () => {
    if (props.open) redraw()
  },
  { immediate: true, deep: false }
)

onBeforeUnmount(() => {})

// ── 导出 ──────────────────────────────────────────────────
function fileName(ext) {
  const t = (title.value || '词作') + '-' + new Date().toISOString().slice(0, 10)
  return `倚声-${t}.${ext}`
}

function download() {
  const cv = canvasRef.value
  if (!cv) return
  busy.value = true
  cv.toBlob((blob) => {
    busy.value = false
    if (!blob) return toast('生成图片失败，请重试', 'error')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = fileName('png')
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    toast('图片已开始下载', 'success')
  }, 'image/png')
}

async function copyImage() {
  const cv = canvasRef.value
  if (!cv) return
  if (!navigator.clipboard || !window.ClipboardItem) {
    toast('当前浏览器不支持复制图片，请用「下载图片」', 'info')
    return
  }
  busy.value = true
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'))
  busy.value = false
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    toast('图片已复制，可直接粘贴', 'success')
  } catch {
    toast('复制失败，请用「下载图片」', 'error')
  }
}

function openInNewTab() {
  const cv = canvasRef.value
  if (!cv) return
  cv.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 20000)
  }, 'image/png')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open && poem" class="mask no-print" @click.self="emit('close')">
        <div class="studio">
          <div class="studio-head row between wrap">
            <div>
              <h3 class="mb0">生成书法卡片</h3>
              <p class="tiny muted mb0 mt0">挑一种底，导出即为图片，可直接发朋友圈</p>
            </div>
            <button class="btn ghost sm" @click="emit('close')">✕ 关闭</button>
          </div>

          <div class="studio-body">
            <div class="opts no-print">
              <div class="opt-group">
                <div class="lbl">底纹</div>
                <button
                  v-for="b in BG"
                  :key="b.id"
                  class="opt"
                  :class="{ on: bg === b.id }"
                  @click="bg = b.id"
                >
                  <b>{{ b.name }}</b>
                  <span class="tiny">{{ b.desc }}</span>
                </button>
              </div>

              <div class="opt-group">
                <div class="lbl">版式</div>
                <label class="switch">
                  <input v-model="poster" type="checkbox" />
                  <span>加"分享海报"信息（意境 + 落款）</span>
                </label>
                <label class="switch">
                  <input v-model="verticalLocal" type="checkbox" />
                  <span>竖排（扇面固定竖排）</span>
                </label>
              </div>

              <div class="opt-group">
                <div class="lbl">导出</div>
                <button class="btn primary sm block" :disabled="busy" @click="download">⬇ 下载图片</button>
                <button class="btn sm block mt1" :disabled="busy" @click="copyImage">⧉ 复制图片</button>
                <button class="btn ghost sm block mt1" @click="openInNewTab">↗ 新窗口打开</button>
                <p class="tiny muted mt2 mb0">
                  导出为 2 倍分辨率 PNG（约 {{ layout().W * 2 }} × {{ layout().H * 2 }} px），可直接打印。
                </p>
              </div>
            </div>

            <div class="preview">
              <canvas ref="canvasRef"></canvas>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--ink) 52%, transparent);
  backdrop-filter: blur(3px);
  z-index: 90;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 3vh 18px;
  overflow: auto;
}
.studio {
  width: min(1200px, 100%);
  background: var(--paper);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-lg, 6px);
  box-shadow: var(--shadow-3);
  padding: 18px 20px 20px;
  animation: pageFade 320ms var(--ease-ink) both;
}
.studio-head {
  border-bottom: 1px solid var(--line);
  padding-bottom: 12px;
  margin-bottom: 14px;
}
.studio-body {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.lbl {
  font-size: var(--fs-sm);
  color: var(--ink-3);
  margin-bottom: 6px;
  letter-spacing: 0.08em;
}
.opt-group {
  margin-bottom: 18px;
}
.opt {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  text-align: left;
  gap: 1px;
  padding: 8px 11px;
  margin-bottom: 6px;
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--r);
  cursor: pointer;
  color: var(--ink-2);
  transition: all var(--t-fast);
}
.opt:hover {
  border-color: var(--line-strong);
  transform: translateX(2px);
}
.opt.on {
  border-color: var(--cinnabar);
  color: var(--cinnabar);
  box-shadow: inset 0 0 0 1px var(--cinnabar-soft);
}
.opt b {
  font-family: var(--font-kai);
  font-size: 1rem;
}
.switch {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 0.82rem;
  color: var(--ink-2);
  margin-bottom: 9px;
  cursor: pointer;
  line-height: 1.5;
}
.switch input {
  margin-top: 3px;
  accent-color: var(--cinnabar);
}
.preview {
  display: flex;
  justify-content: center;
  background: var(--paper-3, var(--paper-2));
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: 16px;
  min-height: 380px;
}
canvas {
  display: block;
  height: auto;
  box-shadow: var(--shadow-2);
  border-radius: 3px;
}
@media (max-width: 900px) {
  .studio-body {
    grid-template-columns: 1fr;
  }
}
</style>
