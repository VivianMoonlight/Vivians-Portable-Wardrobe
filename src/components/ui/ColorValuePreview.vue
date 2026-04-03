<template>
  <div class="color-value-preview" :title="fullTooltip">
    <!-- 色块 -->
    <span class="color-swatch" :style="{ background: primaryColor }"></span>

    <!-- 值显示 -->
    <span v-if="isSimple" class="value-simple">{{ simpleValue }}</span>
    <div v-else class="value-complex" @mouseenter="onMouseEnter" @mouseleave="onMouseLeave">
      <span class="complex-label">{{ complexLabel }}</span>
      <span class="detail-icon">ℹ</span>

      <!-- 详情弹窗（Hover） -->
      <div v-if="showDetails" class="color-detail-popup">
        <div class="detail-content">
          <code>{{ JSON.stringify(value, null, 2) }}</code>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { debounce } from '@/utils/performance.js'

const props = defineProps({
  value: [String, Array, Object]
})

// ✅ Debounce show/hide to prevent flickering on rapid hover
const showDetailsImmediate = ref(false)
const showDetailsDebounced = debounce((val) => {
  showDetailsImmediate.value = val
}, 150)  // 150ms debounce delay

const showDetails = computed(() => showDetailsImmediate.value)

function onMouseEnter() {
  // Cancel any pending debounce on leave
  showDetailsDebounced.cancel?.()
  showDetailsDebounced(true)
}

function onMouseLeave() {
  // If mouse leaves quickly, cancel the show and immediately hide
  showDetailsDebounced.cancel?.()
  showDetailsImmediate.value = false
}

const isSimple = computed(() => {
  return typeof props.value === 'string' && /^#[0-9a-f]{6}$/i.test(props.value)
})

const primaryColor = computed(() => {
  if (typeof props.value === 'string') return props.value
  if (Array.isArray(props.value)) return props.value[0] || '#cccccc'
  return '#cccccc'
})

const simpleValue = computed(() => {
  return props.value?.toUpperCase?.() || String(props.value)
})

const complexLabel = computed(() => {
  if (Array.isArray(props.value)) return `[${props.value.length} 色]`
  if (typeof props.value === 'object') return '[自定义]'
  return '[其他]'
})

const fullTooltip = computed(() => {
  if (typeof props.value === 'string') return props.value
  return JSON.stringify(props.value)
})
</script>

<style scoped>
.color-value-preview {
  display: flex;
  align-items: center;
  gap: 6px;
  position: relative;
}

.color-swatch {
  width: 14px;
  height: 14px;
  border-radius: 2px;
  border: 1px solid var(--color-border-base, #e2e8f0);
  flex-shrink: 0;
  display: inline-block;
}

.value-simple {
  font-family: 'Courier New', monospace;
  font-size: 11px;
  color: var(--color-text-secondary, #475569);
  font-weight: 500;
  letter-spacing: 0.5px;
}

.value-complex {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--color-text-tertiary, #64748b);
  cursor: help;
  position: relative;
}

.complex-label {
  font-weight: 500;
  color: var(--color-text-secondary, #475569);
}

.detail-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--color-border-base, #e2e8f0);
  color: var(--color-text-tertiary, #64748b);
  font-size: 8px;
  font-weight: bold;
  flex-shrink: 0;
  transition: all 0.1s;
}

.value-complex:hover .detail-icon {
  background: var(--color-selection-single, #417aed);
  color: white;
}

.color-detail-popup {
  position: absolute;
  bottom: calc(100% + 4px);
  left: -20px;
  background: var(--color-bg-base, #fff);
  border: 1px solid var(--color-border-base, #e2e8f0);
  border-radius: var(--radius-sm, 6px);
  padding: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 100;
  min-width: 180px;
  max-width: 300px;
}

.detail-content {
  overflow-x: auto;
}

.detail-content code {
  font-size: 9px;
  color: var(--color-text-secondary, #475569);
  display: block;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: 'Courier New', monospace;
  line-height: 1.3;
}
</style>
