<script setup>
import { computed } from 'vue'

/**
 * 分页器
 * ─────────────────────────────────────────────────────────────
 * 规格要求的形态：← 上一页 1 … 4 [5] 6 … 12 下一页 →
 * 页码永远显示「首页 + 尾页 + 当前页左右各一」，中间用 … 收起来，
 * 这样总页数上百也不会把一行撑爆。
 */
const props = defineProps({
  page: { type: Number, default: 1 },
  pages: { type: Number, default: 1 },
  total: { type: Number, default: 0 },
  pageSize: { type: Number, default: 20 },
  unit: { type: String, default: '条' }
})
const emit = defineEmits(['update:page'])

const items = computed(() => {
  const p = Math.max(1, props.pages || 1)
  const cur = Math.min(Math.max(1, props.page), p)
  if (p <= 7) return Array.from({ length: p }, (_, i) => i + 1)
  const set = new Set([1, p, cur, cur - 1, cur + 1])
  const nums = [...set].filter((n) => n >= 1 && n <= p).sort((a, b) => a - b)
  const out = []
  let prev = 0
  for (const n of nums) {
    if (prev && n - prev > 1) out.push('…')
    out.push(n)
    prev = n
  }
  return out
})

function go(n) {
  const p = Math.max(1, Math.min(n, props.pages || 1))
  if (p !== props.page) emit('update:page', p)
}
</script>

<template>
  <div v-if="pages > 1 || total > 0" class="adm-pager">
    <span class="total">共 {{ total }} {{ unit }} · 第 {{ page }} / {{ Math.max(1, pages) }} 页</span>
    <span class="sp"></span>
    <button type="button" :disabled="page <= 1" title="上一页" @click="go(page - 1)">← 上一页</button>
    <template v-for="(it, i) in items" :key="i">
      <span v-if="it === '…'" class="gap">…</span>
      <button
        v-else
        type="button"
        :aria-current="it === page ? 'page' : undefined"
        @click="go(it)"
      >
        {{ it }}
      </button>
    </template>
    <button type="button" :disabled="page >= pages" title="下一页" @click="go(page + 1)">下一页 →</button>
  </div>
</template>
