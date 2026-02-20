<template>
  <div class="batch-edit-panel" v-if="true||hasSelections">
    <div class="panel-header" @click="toggleCollapse">
      <div class="title-section">
        <span class="title">{{ t('batchEdit.title') || 'Batch Edit' }}</span>
        <span class="selected-count">{{ selectedCount }} {{ t('batchEdit.layersSelected') || 'layers selected' }}</span>
      </div>
      <span class="collapse-icon" :class="{ collapsed }">{{ collapsed ? '▼' : '▲' }}</span>
    </div>

    <transition name="panel-collapse">
      <div v-show="!collapsed" class="panel-body">
        <!-- Opacity Control -->
        <div class="control-section">
          <div class="section-header">
            <label>{{ t('batchEdit.opacity') || 'Opacity' }}</label>
            <div class="mode-toggle">
              <button 
                class="mode-btn" 
                :class="{ active: opacityMode === 'absolute' }"
                @click="opacityMode = 'absolute'"
                :title="t('batchEdit.absoluteMode') || 'Set to exact value'"
              >
                =
              </button>
              <button 
                class="mode-btn" 
                :class="{ active: opacityMode === 'relative' }"
                @click="opacityMode = 'relative'"
                :title="t('batchEdit.relativeMode') || 'Adjust by amount'"
              >
                ±
              </button>
            </div>
          </div>
          <div class="control-group">
            <input
              type="range"
              class="slider-input"
              v-model.number="opacityValue"
              :min="opacityMode === 'relative' ? -100 : 0"
              :max="100"
            />
            <input
              v-model.number="opacityValue"
              class="num-input"
              type="number"
              :min="opacityMode === 'relative' ? -100 : 0"
              :max="100"
              step="1"
            />
            <span class="unit">%</span>
            <button class="apply-btn" @click="applyOpacity" :title="t('batchEdit.apply') || 'Apply'">
              {{ t('batchEdit.apply') || 'Apply' }}
            </button>
          </div>
        </div>

        <!-- Offset Control -->
        <div class="control-section">
          <div class="section-header">
            <label>{{ t('batchEdit.offset') || 'Offset' }}</label>
            <div class="mode-toggle">
              <button 
                class="mode-btn" 
                :class="{ active: offsetMode === 'absolute' }"
                @click="offsetMode = 'absolute'"
                :title="t('batchEdit.absoluteMode') || 'Set to exact value'"
              >
                =
              </button>
              <button 
                class="mode-btn" 
                :class="{ active: offsetMode === 'relative' }"
                @click="offsetMode = 'relative'"
                :title="t('batchEdit.relativeMode') || 'Adjust by amount'"
              >
                ±
              </button>
            </div>
          </div>
          
          <!-- Visual Move Toggle -->
          <div class="visual-move-section">
            <button 
              class="visual-move-toggle" 
              :class="{ active: visualMoveEnabled }"
              @click="toggleVisualMove"
              :title="t('batchEdit.visualMove') || 'Visual Move'"
            >
              <span class="icon">✥</span>
              <span class="label">{{ t('batchEdit.visualMove') || 'Visual Move' }}</span>
            </button>
            <span class="info-text" v-if="visualMoveEnabled">
              {{ selectedCount === 1 ? t('batchEdit.visualMoveSingle') : t('batchEdit.visualMoveMultiple', { count: selectedCount }) }}
            </span>
          </div>

          <div class="control-group">
            <div class="offset-input-group">
              <span class="input-label">X</span>
              <input
                v-model.number="offsetX"
                class="num-input"
                type="number"
                step="1"
                :placeholder="offsetMode === 'relative' ? '0' : 'X'"
              />
            </div>
            <div class="offset-input-group">
              <span class="input-label">Y</span>
              <input
                v-model.number="offsetY"
                class="num-input"
                type="number"
                step="1"
                :placeholder="offsetMode === 'relative' ? '0' : 'Y'"
              />
            </div>
            <button class="apply-btn" @click="applyOffset" :title="t('batchEdit.apply') || 'Apply'">
              {{ t('batchEdit.apply') || 'Apply' }}
            </button>
          </div>
        </div>

        <!-- Priority Control -->
        <div class="control-section">
          <div class="section-header">
            <label>{{ t('batchEdit.priority') || 'Priority' }}</label>
            <div class="mode-toggle">
              <button 
                class="mode-btn" 
                :class="{ active: priorityMode === 'absolute' }"
                @click="priorityMode = 'absolute'"
                :title="t('batchEdit.absoluteMode') || 'Set to exact value'"
              >
                =
              </button>
              <button 
                class="mode-btn" 
                :class="{ active: priorityMode === 'relative' }"
                @click="priorityMode = 'relative'"
                :title="t('batchEdit.relativeMode') || 'Adjust by amount'"
              >
                ±
              </button>
            </div>
          </div>
          <div class="control-group">
            <input
              v-model.number="priorityValue"
              class="num-input"
              type="number"
              step="1"
              :placeholder="priorityMode === 'relative' ? '0' : 'Priority'"
            />
            <button class="apply-btn" @click="applyPriority" :title="t('batchEdit.apply') || 'Apply'">
              {{ t('batchEdit.apply') || 'Apply' }}
            </button>
          </div>
        </div>

        <!-- Color Control -->
        <div class="control-section">
          <div class="section-header">
            <label>{{ t('batchEdit.color') || 'Color' }}</label>
            <span class="info-text" v-if="colorableCount < selectedCount">
              {{ colorableCount }} {{ t('batchEdit.colorable') || 'colorable' }}
            </span>
          </div>
          <div class="control-group">
            <button class="palette-btn" @click="openPaletteForBatch" :title="t('batchEdit.openPalette') || 'Open palette to select color'">
              🎨 {{ t('batchEdit.selectColor') || 'Select Color' }}
            </button>
          </div>
        </div>

        <!-- Actions -->
        <div class="actions-section">
          <button class="clear-btn" @click="clearSelection">
            {{ t('batchEdit.clearSelection') || 'Clear Selection' }}
          </button>
        </div>

        <!-- Feedback Message -->
        <div v-if="feedbackMessage" class="feedback-message" :class="feedbackType">
          {{ feedbackMessage }}
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStudioStore } from '@/stores/studioStore.js'

const { t } = useI18n()
const store = useStudioStore()

// UI State
const collapsed = ref(false)
const feedbackMessage = ref('')
const feedbackType = ref('success') // 'success' | 'warning' | 'error'

// Opacity
const opacityMode = ref('absolute')
const opacityValue = ref(100)

// Offset
const offsetMode = ref('absolute')
const offsetX = ref(0)
const offsetY = ref(0)

// Priority
const priorityMode = ref('absolute')
const priorityValue = ref(0)

// Visual Move
const visualMoveEnabled = ref(false)

// Computed
const hasSelections = computed(() => store.selectedLayers && store.selectedLayers.length > 0)
const selectedCount = computed(() => store.selectedLayers ? store.selectedLayers.length : 0)

const colorableCount = computed(() => {
  const data = store.getSelectedLayersData()
  return data.filter(d => d.layer && d.layer.isColorable).length
})

// Methods
function toggleCollapse() {
  collapsed.value = !collapsed.value
}

function showFeedback(message, type = 'success') {
  feedbackMessage.value = message
  feedbackType.value = type
  setTimeout(() => {
    feedbackMessage.value = ''
  }, 3000)
}

function applyOpacity() {
  try {
    const result = store.batchUpdateOpacity(opacityValue.value, opacityMode.value)
    if (result.success) {
      showFeedback(`${t('batchEdit.updated') || 'Updated'} ${result.updatedCount} ${t('batchEdit.layers') || 'layers'}`, 'success')
    } else {
      showFeedback(result.reason || t('batchEdit.failed') || 'Operation failed', 'error')
    }
  } catch (e) {
    console.error('[BatchEditPanel] applyOpacity error:', e)
    showFeedback(t('batchEdit.error') || 'An error occurred', 'error')
  }
}

function applyOffset() {
  try {
    const x = offsetX.value || 0
    const y = offsetY.value || 0
    const result = store.batchUpdateOffset(x, y, offsetMode.value)
    if (result.success) {
      showFeedback(`${t('batchEdit.updated') || 'Updated'} ${result.updatedCount} ${t('batchEdit.layers') || 'layers'}`, 'success')
    } else {
      showFeedback(result.reason || t('batchEdit.failed') || 'Operation failed', 'error')
    }
  } catch (e) {
    console.error('[BatchEditPanel] applyOffset error:', e)
    showFeedback(t('batchEdit.error') || 'An error occurred', 'error')
  }
}

function applyPriority() {
  try {
    const result = store.batchUpdatePriority(priorityValue.value, priorityMode.value)
    if (result.success) {
      showFeedback(`${t('batchEdit.updated') || 'Updated'} ${result.updatedCount} ${t('batchEdit.layers') || 'layers'}`, 'success')
    } else {
      showFeedback(result.reason || t('batchEdit.failed') || 'Operation failed', 'error')
    }
  } catch (e) {
    console.error('[BatchEditPanel] applyPriority error:', e)
    showFeedback(t('batchEdit.error') || 'An error occurred', 'error')
  }
}

function openPaletteForBatch() {
  try {
    const data = store.getSelectedLayersData()
    const colorableTargets = data
      .filter(d => d.layer && d.layer.isColorable)
      .map(d => ({
        uid: d.part._uid,
        stackIndex: d.selection.stackIndex,
        partIndex: d.selection.partIndex,
        layerIndex: d.layer.colorableIndex !== undefined ? d.layer.colorableIndex : d.selection.layerIndex,
        currentColorText: d.layer.colorText || null
      }))
    
    if (colorableTargets.length === 0) {
      showFeedback(t('batchEdit.noColorableLayers') || 'No colorable layers selected', 'warning')
      return
    }
    
    store.openPalettePanel(colorableTargets)
  } catch (e) {
    console.error('[BatchEditPanel] openPaletteForBatch error:', e)
    showFeedback(t('batchEdit.error') || 'An error occurred', 'error')
  }
}

function clearSelection() {
  store.clearLayerSelection()
}

function toggleVisualMove() {
  visualMoveEnabled.value = !visualMoveEnabled.value
  if (visualMoveEnabled.value) {
    store.setPreviewTool('move')
  } else {
    store.setPreviewTool('view')
  }
}

// Watch for selection changes to reset values
watch(() => store.selectedLayers.length, (newCount, oldCount) => {
  if (newCount === 0 && oldCount > 0) {
    // Reset to defaults when selection is cleared
    opacityValue.value = 100
    opacityMode.value = 'absolute'
    offsetX.value = 0
    offsetY.value = 0
    offsetMode.value = 'absolute'
    priorityValue.value = 0
    priorityMode.value = 'absolute'
    feedbackMessage.value = ''
    visualMoveEnabled.value = false
  }
})

// Sync visual move state with store preview tool
watch(() => store.previewTool, (newTool) => {
  visualMoveEnabled.value = newTool === 'move'
})
</script>

<style scoped>
.batch-edit-panel {
  background: var(--color-panel-glassmorphism-bg);
  border: 1px solid var(--color-panel-glassmorphism-border);
  border-radius: var(--radius-lg, 10px);
  margin-bottom: 12px;
  backdrop-filter: blur(8px);
  box-shadow: 0 2px 8px var(--color-panel-glassmorphism-shadow);
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: linear-gradient(135deg, var(--color-panel-glassmorphism-gradient-start), var(--color-panel-glassmorphism-gradient-end));
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid var(--color-panel-glassmorphism-border);
}

.panel-header:hover {
  background: linear-gradient(135deg, var(--color-selection-multi-hover), var(--color-panel-glassmorphism-gradient-end));
}

.title-section {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.title {
  font-weight: 700;
  color: var(--color-accent-purple-dark);
  font-size: 14px;
}

.selected-count {
  font-size: 12px;
  color: var(--color-accent-purple);
  background: var(--color-accent-purple-bg-light);
  padding: 2px 8px;
  border-radius: var(--radius-xl, 12px);
  font-weight: 600;
}

.collapse-icon {
  font-size: 11px;
  color: var(--color-accent-purple-light);
  transition: transform 0.2s;
}

.collapse-icon.collapsed {
  transform: rotate(180deg);
}

.panel-body {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.control-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.section-header label {
  font-weight: 600;
  color: var(--color-accent-purple-dark);
  font-size: 13px;
}

.info-text {
  font-size: 11px;
  color: var(--color-accent-purple-light);
  font-style: italic;
}

.mode-toggle {
  display: flex;
  gap: 2px;
  background: var(--color-accent-purple-bg-subtle);
  padding: 2px;
  border-radius: var(--radius-sm, 6px);
}

.mode-btn {
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: var(--color-accent-purple);
  font-size: 12px;
  font-weight: 600;
  border-radius: var(--radius-xs, 4px);
  cursor: pointer;
  transition: all 0.15s;
}

.mode-btn:hover {
  background: var(--color-accent-purple-bg-light);
}

.mode-btn.active {
  background: var(--color-accent-purple);
  color: var(--color-text-inverse);
  box-shadow: 0 1px 3px var(--color-panel-glassmorphism-shadow);
}

.control-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.slider-input {
  flex: 1;
  min-width: 100px;
  cursor: pointer;
}

.num-input {
  width: 60px;
  padding: 6px 8px;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--color-accent-purple-light);
  font-size: 13px;
  outline: none;
  background: var(--color-bg-base);
  color: var(--color-accent-purple-dark);
  text-align: center;
}

.num-input:focus {
  border-color: var(--color-accent-purple);
  box-shadow: 0 0 0 3px var(--color-accent-purple-bg-light);
}

.unit {
  font-size: 12px;
  color: var(--color-accent-purple-light);
  font-weight: 600;
}

.offset-input-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.input-label {
  font-size: 11px;
  color: var(--color-accent-purple-light);
  font-weight: 700;
}

.apply-btn {
  padding: 6px 14px;
  border: 1px solid var(--color-accent-purple);
  background: linear-gradient(135deg, var(--color-accent-purple), var(--color-primary));
  color: var(--color-text-inverse);
  border-radius: var(--radius-sm, 6px);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  margin-left: auto;
}

.apply-btn:hover {
  background: linear-gradient(135deg, var(--color-accent-purple-hover), var(--color-primary-hover));
  box-shadow: 0 2px 6px var(--color-panel-glassmorphism-shadow);
}

.apply-btn:active {
  transform: translateY(1px);
}

.palette-btn {
  padding: 8px 16px;
  border: 1px solid var(--color-accent-purple-light);
  background: var(--color-bg-base);
  color: var(--color-accent-purple);
  border-radius: var(--radius-sm, 6px);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  width: 100%;
}

.palette-btn:hover {
  background: var(--color-accent-purple-bg-subtle);
  border-color: var(--color-accent-purple);
}

.visual-move-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
}

.visual-move-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px solid var(--color-accent-purple-light);
  background: var(--color-panel-glassmorphism-bg);
  backdrop-filter: blur(4px);
  color: var(--color-accent-purple);
  border-radius: var(--radius-sm, 6px);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.visual-move-toggle:hover {
  background: var(--color-accent-purple-bg-subtle);
  border-color: var(--color-accent-purple);
}

.visual-move-toggle.active {
  background: var(--color-accent-purple);
  color: var(--color-text-inverse);
  border-color: var(--color-accent-purple);
  box-shadow: 0 2px 6px var(--color-panel-glassmorphism-shadow);
}

.visual-move-toggle .icon {
  font-size: 16px;
  line-height: 1;
}

.visual-move-toggle .label {
  font-size: 12px;
}

.info-text {
  font-size: 11px;
  color: var(--color-text-tertiary);
  text-align: center;
  padding: 0 4px;
}

.actions-section {
  display: flex;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--color-panel-glassmorphism-border);
}

.clear-btn {
  padding: 7px 14px;
  border: 1px solid var(--color-border-light);
  background: var(--color-bg-base);
  color: var(--color-primary);
  border-radius: var(--radius-sm, 6px);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  flex: 1;
}

.clear-btn:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-accent-purple-light);
}

.feedback-message {
  padding: 8px 12px;
  border-radius: var(--radius-sm, 6px);
  font-size: 12px;
  font-weight: 600;
  text-align: center;
}

.feedback-message.success {
  background: var(--color-success-bg, rgba(16, 185, 129, 0.15));
  color: var(--color-success);
  border: 1px solid var(--color-success);
}

.feedback-message.warning {
  background: var(--color-warning-bg, rgba(245, 158, 11, 0.15));
  color: var(--color-warning);
  border: 1px solid var(--color-warning);
}

.feedback-message.error {
  background: var(--color-error-bg);
  color: var(--color-error);
  border: 1px solid var(--color-error);
}

/* Transitions */
.panel-collapse-enter-active,
.panel-collapse-leave-active {
  transition: all 0.3s ease;
  max-height: 600px;
  overflow: hidden;
}

.panel-collapse-enter-from,
.panel-collapse-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>
