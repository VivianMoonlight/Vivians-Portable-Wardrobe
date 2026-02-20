<script setup>
defineOptions({
  name: 'BaseCard'
})

defineProps({
  interactive: {
    type: Boolean,
    default: false
  },
  padding: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg'].includes(v)
  }
})
</script>

<template>
  <div :class="['card-base', `card-padding-${padding}`, { 'card-interactive': interactive }]">
    <slot />
  </div>
</template>

<style scoped>
.card-base {
  background: var(--color-bg-base, #fff);
  border: 1px solid var(--color-border-base, #e2e8f0);
  border-radius: var(--radius-md, 8px);
  box-sizing: border-box;
}

.card-padding-sm {
  padding: var(--space-sm, 8px);
}

.card-padding-md {
  padding: var(--space-md, 12px);
}

.card-padding-lg {
  padding: var(--space-lg, 16px);
}

.card-interactive {
  cursor: pointer;
  transition: all var(--transition-fast, 0.15s) var(--transition-easing, ease);
}

.card-interactive:hover {
  background: var(--color-bg-hover, #f1f5f9);
  border-color: var(--color-border-strong, #cbd5e1);
  box-shadow: var(--shadow-sm, 0 1px 2px 0 rgba(0, 0, 0, 0.05));
}

.card-interactive:active {
  background: var(--color-bg-active, #e2e8f0);
  transform: translateY(1px);
}
</style>
