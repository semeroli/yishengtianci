<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useToast } from '../stores/ui.js'

/**
 * 轻提示
 * ─────────────────────────────────────────────────────────────
 * 前台走顶部居中（不挡阅读区），后台走右上角滑入（规格要求，
 * 后台页面内容密，右上角最不容易盖住正在操作的东西）。
 */
const { toasts, dismissToast } = useToast()
const route = useRoute()
const isAdmin = computed(() => String(route.path || '').startsWith('/admin'))
</script>

<template>
  <div class="toast-host no-print" :class="{ 'to-right': isAdmin }" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">
        <span class="dot"></span>
        <span class="msg">{{ t.message }}</span>
        <button
          v-if="t.action"
          class="act"
          type="button"
          @click="
            () => {
              t.action.run()
              dismissToast(t.id)
            }
          "
        >
          {{ t.action.label }}
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: 78px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 300;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  pointer-events: none;
  width: min(92vw, 520px);
}
/* 后台：右上角 */
.toast-host.to-right {
  top: 68px;
  left: auto;
  right: 18px;
  transform: none;
  align-items: flex-end;
  width: min(92vw, 380px);
}
.toast {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 16px;
  border-radius: var(--r);
  background: var(--paper-2);
  border: 1px solid var(--line-strong);
  box-shadow: var(--shadow-3);
  font-size: 0.92rem;
  color: var(--ink);
  max-width: 100%;
  pointer-events: auto;
}
.toast .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--azurite);
  flex-shrink: 0;
}
.toast.success .dot {
  background: var(--moss);
}
.toast.error .dot {
  background: var(--cinnabar);
}
.toast.info .dot {
  background: var(--gamboge);
}
.toast .msg {
  line-height: 1.6;
}
.toast .act {
  margin-left: 6px;
  border: 1px solid currentColor;
  background: transparent;
  color: var(--cinnabar);
  border-radius: var(--r);
  padding: 2px 9px;
  font-size: 0.82rem;
  cursor: pointer;
  white-space: nowrap;
}
.toast .act:hover {
  background: var(--cinnabar);
  color: #fff;
}
.toast-enter-active,
.toast-leave-active {
  transition: all 320ms var(--ease-ink);
}
.toast-host.to-right .toast-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.toast-host:not(.to-right) .toast-enter-from {
  opacity: 0;
  transform: translateY(-12px) scale(0.97);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
@media (max-width: 640px) {
  .toast-host.to-right {
    right: 10px;
    left: 10px;
    width: auto;
  }
}
</style>
