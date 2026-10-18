<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useConfirm, resolveConfirm } from '../stores/ui.js'

/**
 * 确认弹窗
 * ─────────────────────────────────────────────────────────────
 * 危险操作（删除）走「手打确认词」那一路：只有一字不差输入「删除」，
 * 确认按钮才会亮。这比「点两下」更能防误操作——点两下是肌肉记忆，
 * 打字需要真的看清提示。
 */
const { confirmState } = useConfirm()

const typed = ref('')
const inputEl = ref(null)
const dialogEl = ref(null)
let opener = null

/* 焦点管理：打开时把焦点移进弹窗，关闭后还给「当初点开它的那个按钮」。
   少了这一步，键盘 / 读屏用户关掉弹窗会掉回页面顶部，找不着北。 */
watch(
  () => confirmState.value,
  (s, prev) => {
    if (s && !prev) {
      typed.value = ''
      opener = document.activeElement
      nextTick(() => (s.requireText ? inputEl.value?.focus() : dialogEl.value?.focus()))
    } else if (!s && prev) {
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus()
      opener = null
    }
  }
)

/* Esc 关闭：role="dialog" 的弹窗，键盘用户理应能按 Esc 退出。 */
function onKey(e) {
  if (e.key === 'Escape' && confirmState.value) {
    e.preventDefault()
    resolveConfirm(false)
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const needText = computed(() => !!confirmState.value?.requireText)
const matched = computed(() => !needText.value || typed.value.trim() === confirmState.value.requireText)

function confirm() {
  if (!matched.value) return
  resolveConfirm(true)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="confirmState" class="mask no-print" @click.self="resolveConfirm(false)">
        <div
          ref="dialogEl"
          class="dlg panel"
          :class="{ danger: confirmState.danger }"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cfm-title"
          tabindex="-1"
        >
          <h3 id="cfm-title" class="mb0 title">
            <span v-if="confirmState.danger" class="warn-mark">!</span>
            {{ confirmState.title }}
          </h3>
          <p class="mt1 body-text">{{ confirmState.message }}</p>

          <div v-if="needText" class="confirm-input mt2">
            <label class="tiny muted">{{ confirmState.hint || `请输入「${confirmState.requireText}」以确认` }}</label>
            <input
              ref="inputEl"
              v-model="typed"
              class="input"
              type="text"
              autocomplete="off"
              :placeholder="confirmState.requireText"
              @keydown.enter="confirm"
            />
          </div>

          <div class="row center mt2">
            <button class="btn" @click="resolveConfirm(false)">取消</button>
            <button
              class="btn"
              :class="confirmState.danger ? 'cinnabar' : 'primary'"
              :disabled="!matched"
              @click="confirm"
            >
              {{ confirmState.confirmText }}
            </button>
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
  z-index: 400;
  background: rgba(30, 32, 34, 0.42);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.dlg {
  width: min(440px, 100%);
  animation: pageFade 240ms var(--ease-ink) both;
  border-top: 3px solid transparent;
}
.dlg.danger {
  border-top-color: var(--cinnabar-solid);
}
.title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.warn-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--cinnabar-solid);
  color: #fff;
  font-size: var(--fs-sm);
  font-weight: 700;
  flex-shrink: 0;
}
.body-text {
  white-space: pre-wrap;
  color: var(--ink-2);
  line-height: 1.8;
}
.confirm-input label {
  display: block;
  margin-bottom: 8px;
}
.confirm-input .input {
  font-family: var(--font-mono);
  letter-spacing: 0.2em;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 200ms;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
