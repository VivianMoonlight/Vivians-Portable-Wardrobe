<script setup>
defineOptions({
  name: 'BaseButton'
})

defineProps({
  variant: {
    type: String,
    default: 'primary',
    validator: (v) => ['primary', 'secondary', 'ghost'].includes(v)
  },
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg'].includes(v)
  },
  disabled: Boolean,
  type: {
    type: String,
    default: 'button'
  }
})
</script>

<template>
  <button
    :class="['btn-base', `btn-${variant}`, `btn-${size}`]"
    :disabled="disabled"
    :type="type"
  >
    <slot />
  </button>
</template>

<style scoped>
.btn-base {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm, 8px);
  border: 1px solid transparent;
  border-radius: var(--radius-md, 8px);
  font-weight: var(--font-weight-medium, 500);
  cursor: pointer;
  transition: all var(--transition-fast, 0.15s) ease;
  user-select: none;
}

.btn-base:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Sizes */
.btn-sm {
  padding: var(--space-xs, 4px) var(--space-sm, 8px);
  font-size: var(--font-size-sm, 12px);
  min-height: var(--button-height-sm, 28px);
}

.btn-md {
  padding: var(--space-sm, 8px) var(--space-lg, 16px);
  font-size: var(--font-size-base, 13px);
  min-height: var(--button-height-md, 32px);
}

.btn-lg {
  padding: var(--space-md, 12px) var(--space-xl, 24px);
  font-size: var(--font-size-md, 14px);
  min-height: var(--button-height-lg, 36px);
}

/* Primary */
.btn-primary {
  background: var(--color-primary, #2563eb);
  color: var(--color-text-inverse, #fff);
  border-color: var(--color-primary, #2563eb);
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-primary-hover, #1d4ed8);
}

.btn-primary:active:not(:disabled) {
  transform: scale(0.98);
}

/* Secondary */
.btn-secondary {
  background: var(--color-bg-base, #fff);
  color: var(--color-text-primary, #0f172a);
  border-color: var(--color-border-base, #e2e8f0);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--color-bg-hover, #f1f5f9);
  border-color: var(--color-border-strong, #cbd5e1);
}

.btn-secondary:active:not(:disabled) {
  background: var(--color-bg-active, #e2e8f0);
}

/* Ghost */
.btn-ghost {
  background: transparent;
  color: var(--color-text-primary, #0f172a);
  border-color: transparent;
}

.btn-ghost:hover:not(:disabled) {
  background: var(--color-bg-hover, #f1f5f9);
}

.btn-ghost:active:not(:disabled) {
  background: var(--color-bg-active, #e2e8f0);
}
</style>
