<script setup>
defineOptions({
  name: 'BasePanel'
})

defineProps({
  variant: {
    type: String,
    default: 'default',
    validator: (v) => ['default', 'glassmorphism'].includes(v)
  },
  padding: {
    type: String,
    default: 'md',
    validator: (v) => ['none', 'sm', 'md', 'lg'].includes(v)
  }
})
</script>

<template>
  <div :class="['vpw-panel-base', `vpw-panel-${variant}`, `vpw-panel-padding-${padding}`]">
    <slot />
  </div>
</template>

<style scoped>
.panel-base {
  background: var(--color-bg-base, #fff);
  border: 1px solid var(--color-border-base, #e2e8f0);
  border-radius: var(--radius-lg, 10px);
  box-sizing: border-box;
}

/* Variants */
.panel-default {
  background: var(--color-bg-base, #fff);
}

.panel-glassmorphism {
  background: var(--color-panel-glassmorphism-bg, rgba(255, 255, 255, 0.98));
  border: 1px solid var(--color-panel-glassmorphism-border, rgba(124, 58, 237, 0.15));
  backdrop-filter: blur(8px);
  box-shadow: 0 2px 8px var(--color-panel-glassmorphism-shadow, rgba(124, 58, 237, 0.08));
}

/* Padding */
.panel-padding-none {
  padding: 0;
}

.panel-padding-sm {
  padding: var(--space-sm, 8px);
}

.panel-padding-md {
  padding: var(--space-md, 12px);
}

.panel-padding-lg {
  padding: var(--space-lg, 16px);
}
</style>
