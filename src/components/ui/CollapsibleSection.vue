<script setup>
import { ref } from 'vue'

defineOptions({
  name: 'CollapsibleSection'
})

const props = defineProps({
  title: {
    type: String,
    required: true
  },
  defaultCollapsed: {
    type: Boolean,
    default: false
  },
  variant: {
    type: String,
    default: 'default',
    validator: (v) => ['default', 'subtle'].includes(v)
  }
})

const collapsed = ref(props.defaultCollapsed)

function toggle() {
  collapsed.value = !collapsed.value
}
</script>

<template>
  <div class="collapsible-section" :class="[`section-${variant}`, { collapsed }]">
    <button 
      class="section-header"
      @click="toggle"
      :aria-expanded="!collapsed"
      :aria-label="`${collapsed ? 'Expand' : 'Collapse'} ${title}`"
    >
      <span class="section-title">{{ title }}</span>
      <span class="collapse-icon">
        {{ collapsed ? '▶' : '▼' }}
      </span>
    </button>
    
    <transition name="section-collapse">
      <div v-show="!collapsed" class="section-body">
        <slot />
      </div>
    </transition>
  </div>
</template>

<style scoped>
.collapsible-section {
  border: 1px solid var(--color-border-base, #e2e8f0);
  border-radius: var(--radius-md, 8px);
  margin-bottom: var(--space-md, 12px);
  overflow: hidden;
  background: var(--color-bg-base, #fff);
}

.section-subtle {
  border-color: var(--color-border-light, #f1f5f9);
  background: var(--color-bg-surface, #f8fafc);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--space-md, 12px) var(--space-lg, 16px);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background var(--transition-fast, 0.15s) ease;
  text-align: left;
}

.section-header:hover {
  background: var(--color-bg-hover, #f1f5f9);
}

.section-header:active {
  background: var(--color-bg-active, #e2e8f0);
}

.section-title {
  font-size: var(--font-size-base, 13px);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-text-primary, #0f172a);
}

.collapse-icon {
  font-size: var(--font-size-sm, 12px);
  color: var(--color-text-secondary, #475569);
  transition: transform var(--transition-fast, 0.15s) ease;
  flex-shrink: 0;
}

.collapsed .collapse-icon {
  transform: rotate(0deg);
}

.section-body {
  padding: 0 var(--space-lg, 16px) var(--space-md, 12px);
}

/* Transition animation */
.section-collapse-enter-active,
.section-collapse-leave-active {
  transition: all var(--transition-base, 0.2s) ease;
  overflow: hidden;
}

.section-collapse-enter-from,
.section-collapse-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.section-collapse-enter-to,
.section-collapse-leave-from {
  opacity: 1;
  max-height: 2000px;
}

/* Dark theme */
.theme-dark .collapsible-section {
  background: var(--color-bg-base, #1e293b);
  border-color: var(--color-border-base, #475569);
}

.theme-dark .section-subtle {
  background: var(--color-bg-surface, #334155);
  border-color: var(--color-border-light, #334155);
}

.theme-dark .section-header:hover {
  background: var(--color-bg-hover, #334155);
}

.theme-dark .section-header:active {
  background: var(--color-bg-active, #475569);
}

.theme-dark .section-title {
  color: var(--color-text-primary, #f1f5f9);
}

.theme-dark .collapse-icon {
  color: var(--color-text-secondary, #cbd5e1);
}
</style>
