<script setup>
defineOptions({
  name: 'BaseInput'
})

defineProps({
  modelValue: [String, Number],
  type: {
    type: String,
    default: 'text'
  },
  placeholder: String,
  disabled: Boolean,
  error: Boolean,
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg'].includes(v)
  }
})

const emit = defineEmits(['update:modelValue'])

function onInput(event) {
  emit('update:modelValue', event.target.value)
}
</script>

<template>
  <input
    :class="['input-base', `input-${size}`, { 'input-error': error }]"
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    @input="onInput"
  />
</template>

<style scoped>
.input-base {
  width: 100%;
  border: 1px solid var(--color-border-base, #e2e8f0);
  border-radius: var(--radius-md, 8px);
  background: var(--color-bg-base, #fff);
  color: var(--color-text-primary, #0f172a);
  font-size: var(--font-size-base, 13px);
  outline: none;
  transition: border-color var(--transition-fast, 0.15s) ease,
              box-shadow var(--transition-fast, 0.15s) ease;
  box-sizing: border-box;
}

.input-base:focus {
  border-color: var(--color-selection-single, #3b82f6);
  box-shadow: 0 0 0 3px var(--color-selection-single-bg, rgba(65, 122, 237, 0.08));
}

.input-base:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--color-bg-surface, #f8fafc);
}

.input-base::placeholder {
  color: var(--color-text-tertiary, #64748b);
}

/* Sizes */
.input-sm {
  padding: var(--space-xs, 4px) var(--space-sm, 8px);
  font-size: var(--font-size-sm, 12px);
}

.input-md {
  padding: var(--space-sm, 8px) var(--space-md, 12px);
}

.input-lg {
  padding: var(--space-md, 12px) var(--space-lg, 16px);
  font-size: var(--font-size-md, 14px);
}

/* Error state */
.input-error {
  border-color: var(--color-error, #ef4444);
}

.input-error:focus {
  border-color: var(--color-error, #ef4444);
  box-shadow: 0 0 0 3px var(--color-error-bg, rgba(239, 68, 68, 0.1));
}
</style>
