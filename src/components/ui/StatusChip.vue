<script setup>
defineOptions({
  name: 'StatusChip'
})

defineProps({
  variant: {
    type: String,
    default: 'default',
    validator: (v) => ['default', 'primary', 'success', 'warning', 'danger', 'info'].includes(v)
  },
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md'].includes(v)
  },
  closable: Boolean
})

defineEmits(['close'])
</script>

<template>
  <div 
    :class="[
      'status-chip', 
      `chip-${variant}`, 
      `chip-${size}`,
      { 'chip-closable': closable }
    ]"
  >
    <slot name="icon" />
    <span class="chip-label">
      <slot />
    </span>
    <button 
      v-if="closable"
      class="chip-close"
      @click="$emit('close')"
      aria-label="Close"
    >
      ✕
    </button>
  </div>
</template>

<style scoped>
.status-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs, 4px);
  padding: var(--space-xs, 4px) var(--space-sm, 8px);
  border-radius: var(--radius-full, 9999px);
  font-size: var(--font-size-sm, 12px);
  font-weight: var(--font-weight-medium, 500);
  line-height: 1;
  white-space: nowrap;
  transition: all var(--transition-fast, 0.15s) ease;
}

/* Sizes */
.chip-sm {
  padding: 2px var(--space-xs, 4px);
  font-size: var(--font-size-xs, 11px);
}

.chip-md {
  padding: var(--space-xs, 4px) var(--space-sm, 8px);
  font-size: var(--font-size-sm, 12px);
}

/* Variants */
.chip-default {
  background: var(--color-bg-panel, #f1f5f9);
  color: var(--color-text-secondary, #475569);
  border: 1px solid var(--color-border-base, #e2e8f0);
}

.chip-primary {
  background: var(--color-primary, #2563eb);
  color: var(--color-text-inverse, #fff);
  border: 1px solid var(--color-primary, #2563eb);
}

.chip-success {
  background: var(--color-success, #10b981);
  color: var(--color-text-inverse, #fff);
  border: 1px solid var(--color-success, #10b981);
}

.chip-warning {
  background: var(--color-warning, #f59e0b);
  color: var(--color-text-inverse, #fff);
  border: 1px solid var(--color-warning, #f59e0b);
}

.chip-danger {
  background: var(--color-danger, #dc2626);
  color: var(--color-text-inverse, #fff);
  border: 1px solid var(--color-danger, #dc2626);
}

.chip-info {
  background: var(--color-info, #3b82f6);
  color: var(--color-text-inverse, #fff);
  border: 1px solid var(--color-info, #3b82f6);
}

/* Close button */
.chip-close {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0 -2px 0 2px;
  width: 14px;
  height: 14px;
  background: transparent;
  border: none;
  border-radius: var(--radius-round, 50%);
  color: currentColor;
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
  opacity: 0.7;
  transition: all var(--transition-fast, 0.15s) ease;
}

.chip-close:hover {
  opacity: 1;
  background: rgba(0, 0, 0, 0.1);
}

.chip-close:active {
  transform: scale(0.9);
}

/* Dark theme adjustments */
.theme-dark .chip-default {
  background: var(--color-bg-panel, #334155);
  color: var(--color-text-secondary, #cbd5e1);
  border-color: var(--color-border-base, #475569);
}

.theme-dark .chip-close:hover {
  background: rgba(255, 255, 255, 0.15);
}
</style>
