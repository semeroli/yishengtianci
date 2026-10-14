<script setup>
/**
 * 空状态：毛笔图标 + 一句文案 + 一个按钮
 * 图标用内联 SVG 而不是 emoji —— emoji 在 Windows / macOS / Android 上
 * 长得完全不一样，空状态又只出现一次，画一支笔更稳。
 *
 * 笔是**几何拼出来**的（圆角笔杆 + 笔箍 + 三角笔头，整体旋转 45°），
 * 不用手绘贝塞尔：手绘路径缩放后经常退化成一条看不出是什么的细线。
 */
defineProps({
  line: { type: String, default: '此处尚无一字' },
  sub: { type: String, default: '' },
  action: { type: String, default: '' }
})
defineEmits(['action'])
</script>

<template>
  <div class="adm-empty">
    <svg class="brush" viewBox="0 0 64 64" width="60" height="60" aria-hidden="true">
      <g transform="rotate(45 32 32)" fill="currentColor">
        <rect x="29" y="4" width="6" height="30" rx="3" opacity=".8" />
        <rect x="28" y="33" width="8" height="6" rx="2" />
        <path d="M28 39h8l-4 19z" opacity=".92" />
      </g>
    </svg>
    <p class="line">{{ line }}</p>
    <p v-if="sub" class="sub">{{ sub }}</p>
    <button v-if="action" class="btn primary sm" type="button" @click="$emit('action')">{{ action }}</button>
  </div>
</template>

<style scoped>
.brush {
  color: var(--a-text-3);
  margin-bottom: 12px;
}
</style>
