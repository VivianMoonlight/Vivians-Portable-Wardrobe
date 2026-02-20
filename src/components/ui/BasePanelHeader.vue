<script setup>
/**
 * BasePanelHeader.vue
 * Standardized panel header with title and optional actions
 * Created for P0.2 modernization
 */
defineProps({
  title: {
    type: String,
    default: ''
  }
})
</script>

<template>
  <div class="base-panel-header">
    <div class="header-left">
      <h4 v-if="title" class="header-title">{{ title }}</h4>
      <slot name="left" />
    </div>
    <div v-if="$slots.actions || $slots.default" class="header-actions">
      <slot name="actions" />
      <slot />
    </div>
  </div>
</template>

<style scoped>
.base-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md, 12px);
  padding: var(--space-md, 12px) var(--space-lg, 16px);
  border-bottom: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-surface, #f8fafc);
  min-height: 48px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--space-md, 12px);
  flex: 1;
  min-width: 0;
}

.header-title {
  margin: 0;
  font-size: var(--font-size-md, 15px);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-text-primary, #0f172a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 8px);
  flex-shrink: 0;
}
</style>
