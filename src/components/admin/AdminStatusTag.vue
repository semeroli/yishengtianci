<script setup>
import { computed } from 'vue'

/**
 * 状态标签（四色）
 *  🟢 已发布（淡绿底） 🟡 草稿（淡黄底） 🔴 待审核（淡红底） ⚪ 归档（灰）
 */
const props = defineProps({
  status: { type: String, default: '' },
  text: { type: String, default: '' }
})

const MAP = {
  published: { cls: 'pub', label: '已发布', dot: '🟢' },
  draft: { cls: 'draft', label: '草稿', dot: '🟡' },
  pending: { cls: 'pending', label: '待审核', dot: '🔴' },
  approved: { cls: 'pub', label: '已通过', dot: '🟢' },
  spam: { cls: 'pending', label: '垃圾', dot: '🚫' },
  archive: { cls: 'archive', label: '归档', dot: '⚪' },
  archived: { cls: 'archive', label: '归档', dot: '⚪' },
  scheduled: { cls: 'info', label: '定时', dot: '🕒' }
}

const info = computed(() => MAP[props.status] || { cls: 'archive', label: props.status || '—', dot: '' })
</script>

<template>
  <span class="adm-st" :class="info.cls">
    <span aria-hidden="true">{{ info.dot }}</span>
    <span>{{ text || info.label }}</span>
  </span>
</template>
