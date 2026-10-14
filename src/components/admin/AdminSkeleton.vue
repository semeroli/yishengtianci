<script setup>
/**
 * 列表骨架屏：等接口回来的那一下不要白屏。
 */
defineProps({
  rows: { type: Number, default: 6 }
})
const widths = [42, 26, 34, 22, 30, 18]
</script>

<template>
  <div aria-busy="true" aria-live="polite">
    <div v-for="i in rows" :key="i" class="adm-skel-row">
      <span class="adm-skel" style="width: 16px; height: 16px"></span>
      <span class="adm-skel bar" :style="{ width: widths[i % widths.length] + '%' }"></span>
      <span style="flex: 1"></span>
      <span class="adm-skel bar" style="width: 54px"></span>
      <span class="adm-skel bar" style="width: 72px"></span>
    </div>
  </div>
</template>
