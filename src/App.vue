<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppHeader from './components/AppHeader.vue'
import AppFooter from './components/AppFooter.vue'
import ToastHost from './components/ToastHost.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'

const route = useRoute()
// 后台自带完整外壳（顶栏 + 侧栏 + TabBar），**不能**再套前台的顶栏和页脚，
// 否则一个页面上会出现两套导航、两套页脚。所以 /admin/* 一律走裸壳。
const bare = computed(() => !!route.meta?.bare || route.path.startsWith('/admin'))
</script>

<template>
  <AppHeader v-if="!bare" />
  <main>
    <RouterView v-slot="{ Component }">
      <Transition name="view" mode="out-in">
        <component :is="Component" />
      </Transition>
    </RouterView>
  </main>
  <AppFooter v-if="!bare" />
  <ToastHost />
  <ConfirmDialog />
</template>

<style>
.view-enter-active {
  transition: opacity 320ms var(--ease-ink), transform 320ms var(--ease-ink);
}
.view-leave-active {
  transition: opacity 140ms ease-in;
}
.view-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.view-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .view-enter-active,
  .view-leave-active {
    transition: none;
  }
}
</style>
