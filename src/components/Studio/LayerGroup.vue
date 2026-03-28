<template>
  <div class="layer-group">
    <div class="group-header" @click="toggleCollapse">
      <button class="fold-toggle" @click.stop="toggleCollapse"
        :title="collapsed ? (t('layerGroup.expand') || 'Expand group') : (t('layerGroup.collapse') || 'Collapse group')">
        <span class="fold-arrow" :class="{ collapsed: collapsed }">{{ collapsed ? "▸" : "▾" }}</span>
      </button>
      
      <span class="group-title">{{ groupName }}</span>
      
      <span class="group-count">{{ layerCount }}</span>

      <button
        v-if="!isMultiMode"
        class="quick-multi-btn"
        @click.stop="enterMultiAndSelectGroup"
        :title="t('layerGroup.quickMultiSelect') || 'Switch to multi-select and select this group'"
      >
        {{ t('layerGroup.multiSelect') || 'Multi' }}
      </button>
      
      <button
        v-if="isMultiMode"
        class="batch-select-toggle"
        :class="groupSelectionState"
        role="checkbox"
        :aria-checked="groupSelectionState === 'partial' ? 'mixed' : (groupSelectionState === 'all' ? 'true' : 'false')"
        @click.stop="toggleGroupSelection"
        :title="groupToggleTitle"
      >
        <span class="tri-check" :class="groupSelectionState" aria-hidden="true">
          <span v-if="groupSelectionState === 'all'">✓</span>
          <span v-else-if="groupSelectionState === 'partial'">−</span>
        </span>
        <span class="tri-text">{{ selectedCountInGroup }}/{{ layerCount }}</span>
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

const selectedLayerKeySet = computed(() => {
  const selected = Array.isArray(store.selectedLayers) ? store.selectedLayers : []
  return new Set(selected.map(s => s?._key).filter(Boolean))
})

const groupLayerKeys = computed(() => {
  if (!Array.isArray(props.layers) || props.layers.length === 0) return []
  return props.layers
    .map((layer) => {
      const layerIndex = Number(layer?.layerIndex)
      if (!Number.isFinite(layerIndex)) return null
      return `${props.stackIndex}-${props.partIndex}-${layerIndex}`
    })
    .filter(Boolean)
})

const selectedCountInGroup = computed(() => {
  const keySet = selectedLayerKeySet.value
  return groupLayerKeys.value.reduce((count, key) => count + (keySet.has(key) ? 1 : 0), 0)
})

const groupSelectionState = computed(() => {
  if (selectedCountInGroup.value <= 0) return 'none'
  if (selectedCountInGroup.value >= layerCount.value) return 'all'
  return 'partial'
})

const groupToggleTitle = computed(() => {
  if (groupSelectionState.value === 'all') {
    return t('layerGroup.deselectAll') || 'Deselect all layers in group'
  }
  if (groupSelectionState.value === 'partial') {
    return t('layerGroup.selectAll') || 'Select all layers in group'
  }
  return t('layerGroup.selectAll') || 'Select all layers in group'
})

function enterMultiAndSelectGroup() {
  if (!isMultiMode.value) {
    store.toggleSelectionMode()
  }
  selectAllInGroup()
}

function selectAllInGroup() {
  props.layers.forEach((layer) => {
    const layerInfo = {
      stackIndex: props.stackIndex,
      partIndex: props.partIndex,
      layerIndex: layer.layerIndex
    }
    if (!store.isLayerSelected(layerInfo)) {
      store.toggleLayerSelection(layerInfo)
    }
  })
}

function clearGroupSelection() {
  props.layers.forEach((layer) => {
    const layerInfo = {
      stackIndex: props.stackIndex,
      partIndex: props.partIndex,
      layerIndex: layer.layerIndex
    }
    if (store.isLayerSelected(layerInfo)) {
      store.toggleLayerSelection(layerInfo)
    }
  })
}

function toggleGroupSelection() {
  if (!isMultiMode.value) return
  if (groupSelectionState.value === 'all') {
    clearGroupSelection()
  } else {
    selectAllInGroup()
  }
}
</script>

<style scoped>
.layer-group {
  margin-bottom: 10px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-base);
  background: var(--color-bg-base);
  overflow: hidden;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--color-border-light);
  cursor: pointer;
  user-select: none;
}

.group-header:hover {
  background: var(--color-bg-hover);
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
  background: var(--color-bg-base);
  padding: 2px 8px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-light);
}

.quick-multi-btn {
  height: 26px;
  min-width: 48px;
  padding: 0 8px;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--color-selection-multi-border);
  background: var(--color-selection-multi-bg);
  color: var(--color-text-primary);
  font-size: 12px;
  cursor: pointer;
}

.quick-multi-btn:hover {
  background: var(--color-selection-multi-hover);
}

.batch-select-toggle {
  height: 28px;
  min-width: 64px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--color-selection-multi-border);
  background: var(--color-bg-base);
  color: var(--color-text-primary);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}

.batch-select-toggle:hover {
  background: var(--color-selection-multi-hover);
  border-color: var(--color-accent-purple);
}

.batch-select-toggle.none {
  border-color: var(--color-border-base);
}

.batch-select-toggle.partial,
.batch-select-toggle.all {
  border-color: var(--color-selection-multi-border);
}

.tri-check {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  border: 1px solid var(--color-border-base);
  background: var(--color-bg-base);
  font-size: 12px;
  line-height: 1;
  font-weight: 700;
}

.tri-check.partial,
.tri-check.all {
  border-color: var(--color-selection-multi-border);
  background: var(--color-selection-multi-bg);
}

.tri-text {
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary);
}

.group-body {
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
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
