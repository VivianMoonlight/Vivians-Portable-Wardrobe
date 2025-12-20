<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div v-if="state.visible" class="dialog-overlay" @click="handleOverlayClick">
        <div class="dialog-container" @click.stop role="dialog" :aria-labelledby="dialogId" aria-modal="true">
          <div class="dialog-content">
            <div :id="dialogId" class="dialog-message">{{ state.message }}</div>
            
            <input
              v-if="state.type === 'prompt'"
              ref="promptInput"
              v-model="inputValue"
              type="text"
              class="dialog-input"
              @keydown.enter="handleOk"
              @keydown.esc="handleCancel"
            />
            
            <div class="dialog-buttons">
              <button 
                v-if="state.type !== 'alert'"
                class="dialog-btn dialog-btn-cancel" 
                @click="handleCancel"
                type="button"
              >
                {{ t('dialog.cancel') }}
              </button>
              <button 
                class="dialog-btn dialog-btn-ok" 
                @click="handleOk"
                type="button"
                ref="okButton"
              >
                {{ t('dialog.ok') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, watch, nextTick, computed } from 'vue'
import { hostWindow } from '@/utils/host-window.js'

const props = defineProps({
  state: {
    type: Object,
    required: true
  }
})

// Try to use i18n, with fallback to English text
let t
try {
  const i18n = hostWindow.__APP_I18N__
  if (i18n && typeof i18n.t === 'function') {
    t = i18n.t
  } else {
    // Fallback translation function
    t = (key) => {
      const translations = {
        'dialog.ok': 'OK',
        'dialog.cancel': 'Cancel'
      }
      return translations[key] || key
    }
  }
} catch (e) {
  // Fallback translation function
  t = (key) => {
    const translations = {
      'dialog.ok': 'OK',
      'dialog.cancel': 'Cancel'
    }
    return translations[key] || key
  }
}

const inputValue = ref('')
const promptInput = ref(null)
const okButton = ref(null)
const dialogId = 'vpw-dialog-' + Math.random().toString(36).slice(2, 8)

// Watch for dialog visibility changes
watch(() => props.state.visible, (visible) => {
  if (visible) {
    // Reset input value
    inputValue.value = props.state.defaultValue || ''
    
    // Focus appropriate element after dialog appears
    nextTick(() => {
      if (props.state.type === 'prompt' && promptInput.value) {
        promptInput.value.focus()
        promptInput.value.select()
      } else if (okButton.value) {
        okButton.value.focus()
      }
    })
  }
})

function handleOk() {
  const { type, resolve } = props.state
  
  if (type === 'alert') {
    resolve()
  } else if (type === 'confirm') {
    resolve(true)
  } else if (type === 'prompt') {
    resolve(inputValue.value)
  }
  
  closeDialog()
}

function handleCancel() {
  const { type, resolve } = props.state
  
  if (type === 'confirm') {
    resolve(false)
  } else if (type === 'prompt') {
    resolve(null)
  }
  
  closeDialog()
}

function handleOverlayClick() {
  // Clicking overlay is like clicking cancel
  handleCancel()
}

function closeDialog() {
  props.state.visible = false
  inputValue.value = ''
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999999999;
  padding: 20px;
}

.dialog-container {
  background: var(--bg-primary, #ffffff);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  max-width: 500px;
  width: 100%;
  min-width: 300px;
  overflow: hidden;
}

.dialog-content {
  padding: 24px;
}

.dialog-message {
  font-size: 16px;
  line-height: 1.5;
  color: var(--text-primary, #333333);
  margin-bottom: 20px;
  word-wrap: break-word;
  white-space: pre-wrap;
}

.dialog-input {
  width: 100%;
  padding: 10px 12px;
  font-size: 14px;
  border: 1px solid var(--border-color, #d0d0d0);
  border-radius: 4px;
  margin-bottom: 20px;
  background: var(--bg-secondary, #ffffff);
  color: var(--text-primary, #333333);
  box-sizing: border-box;
}

.dialog-input:focus {
  outline: none;
  border-color: var(--primary-color, #4a90e2);
  box-shadow: 0 0 0 3px rgba(74, 144, 226, 0.1);
}

.dialog-buttons {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.dialog-btn {
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 80px;
}

.dialog-btn-ok {
  background: var(--primary-color, #4a90e2);
  color: white;
}

.dialog-btn-ok:hover {
  background: var(--primary-hover, #357abd);
}

.dialog-btn-ok:active {
  transform: scale(0.98);
}

.dialog-btn-cancel {
  background: var(--bg-tertiary, #f0f0f0);
  color: var(--text-primary, #333333);
}

.dialog-btn-cancel:hover {
  background: var(--bg-hover, #e0e0e0);
}

.dialog-btn-cancel:active {
  transform: scale(0.98);
}

/* Transition animations */
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.2s ease;
}

.dialog-fade-enter-active .dialog-container,
.dialog-fade-leave-active .dialog-container {
  transition: transform 0.2s ease;
}

.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}

.dialog-fade-enter-from .dialog-container {
  transform: scale(0.9);
}

.dialog-fade-leave-to .dialog-container {
  transform: scale(0.95);
}

/* Dark theme support */
.theme-dark .dialog-container {
  background: var(--bg-primary, #2a2a2a);
}

.theme-dark .dialog-message {
  color: var(--text-primary, #e0e0e0);
}

.theme-dark .dialog-input {
  background: var(--bg-secondary, #1a1a1a);
  color: var(--text-primary, #e0e0e0);
  border-color: var(--border-color, #404040);
}

.theme-dark .dialog-btn-cancel {
  background: var(--bg-tertiary, #3a3a3a);
  color: var(--text-primary, #e0e0e0);
}

.theme-dark .dialog-btn-cancel:hover {
  background: var(--bg-hover, #4a4a4a);
}
</style>
