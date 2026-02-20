<script setup>
/**
 * BasePanelBody.vue
 * Standardized panel body with scrollable content area
 * Created for P0.2 modernization
 */
defineProps({
  padding: {
    type: String,
    default: 'md',
    validator: (v) => ['none', 'sm', 'md', 'lg'].includes(v)
  },
  scrollable: {
    type: Boolean,
    default: true
  }
})
</script>

<template>
  <div 
    class="base-panel-body"
    :class="[
      `padding-${padding}`,
      { 'scrollable': scrollable }
    ]">
    <slot />
  </div>
</template>

<style scoped>
.base-panel-body {
  flex: 1;
  min-height: 0;
  background: var(--color-bg-base, #ffffff);
}

.base-panel-body.scrollable {
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}

.base-panel-body.padding-none {
  padding: 0;
}

.base-panel-body.padding-sm {
  padding: var(--space-sm, 8px);
}

.base-panel-body.padding-md {
  padding: var(--space-md, 12px);
}

.base-panel-body.padding-lg {
  padding: var(--space-lg, 16px);
}
</style>
