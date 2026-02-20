<script setup>
/**
 * BasePanelFooter.vue
 * Standardized panel footer for actions and controls
 * Created for P0.2 modernization
 */
defineProps({
  align: {
    type: String,
    default: 'right',
    validator: (v) => ['left', 'center', 'right', 'between'].includes(v)
  }
})
</script>

<template>
  <div class="base-panel-footer" :class="`align-${align}`">
    <slot />
  </div>
</template>

<style scoped>
.base-panel-footer {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 8px);
  padding: var(--space-md, 12px) var(--space-lg, 16px);
  border-top: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-surface, #f8fafc);
  min-height: 48px;
}

.base-panel-footer.align-left {
  justify-content: flex-start;
}

.base-panel-footer.align-center {
  justify-content: center;
}

.base-panel-footer.align-right {
  justify-content: flex-end;
}

.base-panel-footer.align-between {
  justify-content: space-between;
}
</style>
