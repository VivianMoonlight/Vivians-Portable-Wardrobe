<script setup>
defineOptions({
  name: 'BaseButton'
})

defineProps({
  variant: {
    type: String,
    default: 'primary',
    validator: (v) => ['primary', 'secondary', 'ghost', 'danger'].includes(v)
  },
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg'].includes(v)
  },
  disabled: Boolean,
  loading: Boolean,
  iconOnly: Boolean,
  type: {
    type: String,
    default: 'button'
  }
})
</script>

<template>
  <button
    :class="[
      'vpw-btn-base', 
      `vpw-btn-${variant}`, 
      `vpw-btn-${size}`,
      { 'vpw-btn-icon-only': iconOnly, 'vpw-btn-loading': loading }
    ]"
    :disabled="disabled || loading"
    :type="type"
  >
    <slot />
  </button>
</template>

<style scoped>
.vpw-btn-base {
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
.vpw-btn-sm {
  padding: var(--space-xs, 4px) var(--space-sm, 8px);
  font-size: var(--font-size-sm, 12px);
  min-height: var(--button-height-sm, 28px);
}

.vpw-btn-md {
  padding: var(--space-sm, 8px) var(--space-lg, 16px);
  font-size: var(--font-size-base, 13px);
  min-height: var(--button-height-md, 32px);
}

.vpw-btn-lg {
  padding: var(--space-md, 12px) var(--space-xl, 24px);
  font-size: var(--font-size-md, 14px);
  min-height: var(--button-height-lg, 36px);
}

/* Primary */
.vpw-btn-primary {
  background: var(--color-primary, #2563eb);
  color: var(--color-text-inverse, #fff);
  border-color: var(--color-primary, #2563eb);
}

.vpw-btn-primary:hover:not(:disabled) {
  background: var(--color-primary-hover, #1d4ed8);
}

.vpw-btn-primary:active:not(:disabled) {
  transform: scale(0.98);
}

/* Secondary */
.vpw-btn-secondary {
  background: var(--color-bg-base, #fff);
  color: var(--color-text-primary, #0f172a);
  border-color: var(--color-border-base, #e2e8f0);
}

.vpw-btn-secondary:hover:not(:disabled) {
  background: var(--color-bg-hover, #f1f5f9);
  border-color: var(--color-border-strong, #cbd5e1);
}

.vpw-btn-secondary:active:not(:disabled) {
  background: var(--color-bg-active, #e2e8f0);
}

/* Ghost */
.vpw-btn-ghost {
  background: transparent;
  color: var(--color-text-primary, #0f172a);
  border-color: transparent;
}

.vpw-btn-ghost:hover:not(:disabled) {
  background: var(--color-bg-hover, #f1f5f9);
}

.vpw-btn-ghost:active:not(:disabled) {
  background: var(--color-bg-active, #e2e8f0);
}

/* Danger */
.vpw-btn-danger {
  background: var(--color-danger, #dc2626);
  color: var(--color-text-inverse, #fff);
  border-color: var(--color-danger, #dc2626);
}

.vpw-btn-danger:hover:not(:disabled) {
  background: var(--color-danger-hover, #b91c1c);
}

.vpw-btn-danger:active:not(:disabled) {
  transform: scale(0.98);
}

/* Icon-only modifier - square buttons for toolbars */
.vpw-btn-icon-only.vpw-btn-sm {
  padding: var(--space-xs, 4px);
  width: var(--button-height-sm, 28px);
  min-width: var(--button-height-sm, 28px);
}

.vpw-btn-icon-only.vpw-btn-md {
  padding: var(--space-sm, 8px);
  width: var(--button-height-md, 32px);
  min-width: var(--button-height-md, 32px);
}

.vpw-btn-icon-only.vpw-btn-lg {
  padding: var(--space-md, 12px);
  width: var(--button-height-lg, 36px);
  min-width: var(--button-height-lg, 36px);
}

/* Loading state */
.vpw-btn-loading {
  position: relative;
  opacity: 0.7;
  pointer-events: none;
}
</style>
