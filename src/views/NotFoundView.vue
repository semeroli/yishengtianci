<script setup>
/**
 * 水墨风 404 ——「此处无词」
 *
 * 两条路走同一个组件：
 *   · 前台地址打错 → 用前台纸墨令牌（--ink-*）
 *   · /admin/xxx 打错 → 包一层 .adm-scope，借用后台令牌，并给「回后台」的出口
 * 图标是内联 SVG 毛笔，不用 emoji/字符（跨平台字形不一致，且这里只出现一次）。
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const inAdmin = computed(() => route.path.startsWith('/admin'))

onMounted(() => (document.title = '此处无词 · 倚声'))
onBeforeUnmount(() => (document.title = '倚声 · AI填词工坊'))
</script>

<template>
  <div :class="inAdmin ? 'adm-scope nf-wrap' : 'nf-wrap'">
    <div class="nf">
      <svg class="art" viewBox="0 0 64 64" width="84" height="84" aria-hidden="true">
        <g transform="rotate(45 32 32)" fill="currentColor">
          <rect x="29" y="4" width="6" height="30" rx="3" opacity=".8" />
          <rect x="28" y="33" width="8" height="6" rx="2" />
          <path d="M28 39h8l-4 19z" opacity=".92" />
        </g>
      </svg>
      <h1 class="kai">此处无词</h1>
      <p class="sub">你要找的这页，像是被风翻走了——也许它改过名，也许地址敲错了一个字。</p>
      <div class="row">
        <RouterLink v-if="inAdmin" class="btn primary" to="/admin/dashboard">回后台看板</RouterLink>
        <RouterLink v-else class="btn primary" to="/">回填词工作台</RouterLink>
        <RouterLink v-if="!inAdmin" class="btn" to="/blog">去博客看看</RouterLink>
        <RouterLink v-if="!inAdmin" class="btn ghost" to="/rhyme">查韵书</RouterLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nf-wrap {
  min-height: 100vh;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  background: var(--paper, #f8f7f4);
}
.nf {
  text-align: center;
  padding: 14vh 20px 40px;
  max-width: 560px;
}
.art {
  color: var(--ink-4, var(--a-text-3, #8b93a1));
  margin-bottom: 10px;
  animation: inkSpread 900ms var(--ease-ink, cubic-bezier(0.22, 0.61, 0.36, 1)) both;
}
.nf h1 {
  font-size: clamp(1.5rem, 3.8vw, 2rem);
  letter-spacing: 0.18em;
  margin: 0 0 14px;
  color: var(--ink-1, #1e2127);
}
.nf .sub {
  color: var(--ink-2, #4a5160);
  line-height: 2;
  margin: 0 0 28px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
}
</style>
