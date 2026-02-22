<template>
  <div class="layer-group">
    <div class="group-header" @click="toggleCollapse">
      <button class="fold-toggle" @click.stop="toggleCollapse"
        :title="collapsed ? (t('layerGroup.expand') || 'Expand group') : (t('layerGroup.collapse') || 'Collapse group')">
        <span class="fold-arrow" :class="{ collapsed: collapsed }">{{ collapsed ? "▸" : "▾" }}</span>
      </button>
      
      <span class="group-title">{{ groupName }}</span>
      
      <span class="group-count">{{ layerCount }}</span>
      
      <button v-if="isMultiMode" class="batch-select-btn" @click.stop="selectAllInGroup"
        :title="t('layerGroup.selectAll') || 'Select all layers in group'">
        ☑
      </button>
    </div>
    
    <transition name="group-collapse">
      <div v-show="!collapsed" class="group-body">
        <ColorableLayer 
          v-for="(layer, index) in layers"
          :key="layer._key || (layer.name || index)"
          :layer="layer"
          :part="part"
          :stackIndex="stackIndex"
          :partIndex="partIndex"
          :selectionMode="selectionMode"
          @save-layer="$emit('save-layer', $event)" />
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStudioStore } from '@/stores/studioStore'
import ColorableLayer from './ColorableLayer.vue'

const { t } = useI18n()
const store = useStudioStore()

const props = defineProps({
  groupName: { type: String, required: true },
  layers: { type: Array, required: true },
  part: { type: Object, required: false },
  stackIndex: { type: Number, required: true },
  partIndex: { type: Number, required: true },
  selectionMode: { type: String, default: 'single' }
})

const emit = defineEmits(['save-layer'])

const collapsed = ref(true)

const layerCount = computed(() => props.layers.length)
const isMultiMode = computed(() => props.selectionMode === 'multiple')

function toggleCollapse() {
  collapsed.value = !collapsed.value
}

function selectAllInGroup() {
  if (!isMultiMode.value) return
  
  // Select all layers in this group
  props.layers.forEach(layer => {
    const layerInfo = {
      stackIndex: props.stackIndex,
      partIndex: props.partIndex,
      layerIndex: layer.layerIndex
    }
    
    // Check if already selected
    if (!store.isLayerSelected(layerInfo)) {
      store.toggleLayerSelection(layerInfo)
    }
  })
}
</script>

<style scoped>
.layer-group {
  margin-bottom: 12px;
  border-radius: var(--radius-lg, 10px);
  border: 2px solid var(--color-border-light);
  background: var(--color-bg-base);
  overflow: hidden;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: linear-gradient(90deg, var(--color-bg-surface) 60%, var(--color-bg-base) 100%);
  border-bottom: 1px dashed var(--color-border-light);
  cursor: pointer;
  user-select: none;
}

.group-header:hover {
  background: linear-gradient(90deg, var(--color-bg-hover) 60%, var(--color-bg-surface) 100%);
}

.fold-toggle {
  border: 1px solid var(--color-border-base);
  background: var(--color-bg-base);
  color: var(--color-text-tertiary);
  border-radius: var(--radius-xs, 4px);
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}

.fold-toggle:hover {
  background: var(--color-bg-hover);
}

.fold-arrow {
  font-size: 13px;
  color: var(--color-text-tertiary);
  width: 12px;
  text-align: center;
  transition: transform 0.15s;
}

.fold-arrow.collapsed {
  transform: rotate(-90deg);
}

.group-title {
  flex: 1;
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.group-count {
  font-size: 12px;
  color: var(--color-text-secondary);
  background: var(--color-bg-surface);
  padding: 2px 8px;
  border-radius: var(--radius-xl, 12px);
  border: 1px solid var(--color-border-light);
}

.batch-select-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--color-selection-multi-border);
  background: var(--color-selection-multi-bg);
  color: var(--color-accent-purple);
  cursor: pointer;
  font-size: 14px;
  transition: all 0.15s;
}

.batch-select-btn:hover {
  background: var(--color-selection-multi-hover);
  border-color: var(--color-accent-purple);
  box-shadow: 0 2px 4px var(--color-panel-glassmorphism-shadow);
}

.group-body {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Transitions */
.group-collapse-enter-active,
.group-collapse-leave-active {
  transition: max-height 0.25s ease, opacity 0.2s ease;
  overflow: hidden;
}

.group-collapse-enter-from,
.group-collapse-leave-to {
  max-height: 0;
  opacity: 0;
}

.group-collapse-enter-to,
.group-collapse-leave-from {
  max-height: 2000px;
  opacity: 1;
}
</style>
