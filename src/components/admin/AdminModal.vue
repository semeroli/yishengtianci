<script setup>
import { onBeforeUnmount, onMounted } from 'vue'

/**
 * 后台弹窗
 * ─────────────────────────────────────────────────────────────
 * 自带 Esc 关闭（规格里的快捷键要求之一）。点遮罩也关。
 * 用 Teleport 挂到 body，避免被父级 overflow / transform 裁掉。
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  wide: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])

function onKey(e) {
  if (e.key === 'Escape' && props.open) {
    e.stopPropagation()
    emit('close')
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="admFade">
      <div v-if="open" class="adm-modal-mask no-print" @click.self="emit('close')">
        <div class="adm-modal" :class="{ wide }" role="dialog" aria-modal="true">
          <div class="adm-modal-head">
            <h3>{{ title }}</h3>
            <span class="sp"></span>
            <button class="adm-icon-btn" type="button" title="关闭（Esc）" @click="emit('close')">✕</button>
          </div>
          <div class="adm-modal-body">
            <slot />
          </div>
          <div v-if="$slots.foot" class="adm-modal-foot">
            <slot name="foot" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.adm-modal-mask .adm-icon-btn {
  border-color: var(--a-line);
  color: var(--a-text-3);
  width: 26px;
  height: 26px;
}
.adm-modal-mask .adm-icon-btn:hover {
  border-color: var(--a-danger);
  color: var(--a-danger);
}
.admFade-enter-active,
.admFade-leave-active {
  transition: opacity 180ms;
}
.admFade-enter-from,
.admFade-leave-to {
  opacity: 0;
}
</style>
