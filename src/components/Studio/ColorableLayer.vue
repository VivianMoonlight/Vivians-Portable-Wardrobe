<template>
  <div class="color-main-block" :data-focused="isFocused ? '1' : '0'" :data-selected="isSelected ? '1' : '0'">
    <!-- Header: Collapse Toggle -->
    <div class="color-main-header" @click="handleHeaderClick">
      <!-- Checkbox for multi-selection mode -->
      <input v-if="isMultiMode" type="checkbox" class="layer-checkbox" :checked="isSelected"
        @click.stop="toggleSelection" @change.stop :title="t('colorableLayer.selectLayer') || 'Select layer'" />

      <span class="color-main-title" :title="layerLocal.name">
        {{ layerLocal.displayName || layerLocal.name || ("#" + (displayIndex + 1)) }}
      </span>
      <span class="fold-arrow" :class="{ collapsed: collapsed }" v-if="hasSublayers">
        {{ collapsed ? "▸" : "▾" }}
      </span>
    </div>

    <div class="color-main-body">
      <!-- 1. Color Row -->
      <div class="color-row" @mousedown.stop="selectProperty('color')">
        <label>{{ t('colorableLayer.color') }}</label>
        <div class="val">
          <template v-if="layerLocal.isColorable">
            <span v-if="layerLocal.colorCss" class="color-chip" :style="{
              background: layerLocal.colorCss,
              color: setChipTextColor(layerLocal.colorCss)
            }">
              {{ layerLocal.colorText }}
            </span>
            <span v-else-if="layerLocal.colorText" class="color-text">
              {{ layerLocal.colorText }}
            </span>
            <span v-else class="muted">{{ t('colorableLayer.default') }}</span>



            <button class="tiny-reset right-action" v-if="colorIsCustomized" @mousedown.stop.prevent="resetColor"
              :title="t('colorableLayer.resetColorTitle')">
              ↺
            </button>

            <button class="tiny-palette"
              :class="[{ active: isPaletteSelected }, colorIsCustomized ? '' : 'right-action']"
              @mousedown.stop.prevent="togglePaletteForEntry" :title="t('colorableLayer.paletteTitle')">
              🎨
            </button>
          </template>
          <template v-else>
            <span class="muted">{{ t('colorableLayer.default') }}</span>
          </template>
        </div>
      </div>

      <!-- 2. Opacity Row (Slider + Input) -->
      <div class="color-row" @mousedown.stop="selectProperty('opacity')">
        <label>{{ t('colorableLayer.opacity') }}</label>
        <div class="val control-group">
          <!-- Slider for quick adjustment -->
          <input type="range" class="slider-input" v-model.number="localOpacity" :min="0" :max="100"
            @input="onOpacityInput" />
          <!-- Number input for precision -->
          <input v-model.number="localOpacity" class="edit-input num-input" type="number" min="0" max="100" step="1"
            @input="onOpacityInput" />
          <span class="unit">%</span>

          <button v-if="hasSublayers" class="tiny-link right-action" :class="{ active: linkedOpacity }"
            :title="t('colorableLayer.linkedOpacityTitle')" @mousedown.stop.prevent="toggleLinkedOpacity"
            @click.stop.prevent>
            ⛓
          </button>
        </div>
      </div>

      <!-- 3. Offset Row (Direct X / Y Inputs) -->
      <div class="color-row" @mousedown.stop="selectProperty('drawing')">
        <label>{{ t('colorableLayer.offset') }}</label>
        <div class="val control-group">
          <div class="compact-input-wrapper">
            <span class="input-label">X</span>
            <input v-model.number="localDrawingLeft" class="edit-input compact-input" type="number"
              @input="onDrawingInput" />
          </div>
          <div class="compact-input-wrapper">
            <span class="input-label">Y</span>
            <input v-model.number="localDrawingTop" class="edit-input compact-input" type="number"
              @input="onDrawingInput" />
          </div>



          <button class="tiny-reset right-action" v-if="offsetIsOverridden" @mousedown.stop.prevent="resetOffset"
            :title="t('colorableLayer.resetOffsetTitle')">
            ↺
          </button>

          <button v-if="hasSublayers" class="tiny-link"
            :class="[{ active: linkedOffset }, offsetIsOverridden ? '' : 'right-action']"
            :title="t('colorableLayer.linkedOffsetTitle')" @mousedown.stop.prevent="toggleLinkedOffset"
            @click.stop.prevent>
            ⛓
          </button>
          <button class="tiny-link"
            :class="[{ active: isThisLayerMoving }, offsetIsOverridden || hasSublayers ? '' : 'right-action']"
            :title="t('colorableLayer.visualMoveTitle')" @mousedown.stop.prevent="activateVisualMove"
            @click.stop.prevent>
            ✥
          </button>
        </div>
      </div>

      <!-- 4. Priority Row -->
      <div class="color-row" @mousedown.stop="selectProperty('priority')">
        <label>{{ t('colorableLayer.priority') }}</label>
        <div class="val control-group">
          <input v-model.number="localPriority" class="edit-input" type="number" style="width: 70px"
            @input="onPriorityInput" placeholder="Auto" />

          <span v-if="priorityIsOverridden" class="priority-badge blue" :title="t('colorableLayer.priorityOverridden')">
            Custom
          </span>
          <span v-else class="muted text-sm">
            (Default: {{ layerLocal.defaultPriority }})
          </span>

          <button class="tiny-reset right-action" v-if="priorityIsOverridden" @mousedown.stop.prevent="resetPriority"
            :title="t('colorableLayer.resetPriorityTitle')">
            ↺
          </button>
        </div>
      </div>
    </div>

    <!-- Sublayers List (Read/Select Only) -->
    <transition name="collapse-fast">
      <div v-show="!collapsed" v-if="hasSublayers" class="sublayer-list">
        <div v-for="(s, si) in layerLocal.subLayers" :key="s._key || (s.name || si)" class="sub-block">
          <div class="sl-row sl-title" @mousedown.stop="selectSubProperty(si, 'subdrawing')">
            <label>{{ t('colorableLayer.subLayer') }}</label>
            <div class="val">{{ s.displayName || s.name || ("sub#" + (si + 1)) }}</div>
          </div>
          <div class="sl-row">
            <label>{{ t('colorableLayer.opacity') }}</label>
            <div class="val">
              <span v-if="s.opacity !== null && s.opacity !== undefined">{{ formatOpacity(s.opacity) }}</span>
              <span v-else class="muted">—</span>
            </div>
          </div>
          <div class="sl-row">
            <label>{{ t('colorableLayer.offset') }}</label>
            <div class="val">
              <span v-if="(s.drawingLeft != null) || (s.drawingTop != null)">
                <span class="offset-item">X <strong>{{ s.drawingLeft ?? '—' }}</strong></span>
                <span class="offset-item">Y <strong>{{ s.drawingTop ?? '—' }}</strong></span>
              </span>
              <span v-else class="muted">—</span>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStudioStore } from '@/stores/studioStore'
import { throttle } from '@/utils/performance.js'
//import { cursorTo } from 'readline'

const { t } = useI18n()

const props = defineProps({
  layer: { type: Object, required: true },
  part: { type: Object, required: false },
  partIndex: { type: Number, required: true },
  stackIndex: { type: Number, required: true },
  selectionMode: { type: String, default: 'single' }
})

const emit = defineEmits(['save-layer'])
const store = useStudioStore()

// UI state
const collapsed = ref(true)
const linkedOpacity = ref(true)
const linkedOffset = ref(true)

// Multi-selection state
const isMultiMode = computed(() => props.selectionMode === 'multiple')
const isSelected = computed(() => {
  if (!isMultiMode.value) return false
  return store.isLayerSelected({
    stackIndex: props.stackIndex,
    partIndex: props.partIndex,
    layerIndex: layerLocal.value.layerIndex
  })
})

// Local Editable State (synced from props)
const localOpacity = ref(100)
const localDrawingLeft = ref(0)
const localDrawingTop = ref(0)
const localPriority = ref(0)

const displayIndex = computed(() => layerLocal.value.layerIndex)

// 1. Computed Layer Helper
const layerLocal = computed(() => {
  if (props.layer && typeof props.layer === 'object') {
    return props.layer
  }
  throw new Error('[ColorableLayer] layer prop is required')
})

const hasSublayers = computed(() => Array.isArray(layerLocal.value.subLayers) && layerLocal.value.subLayers.length > 0)

function setChipTextColor(bgColor) {
  // Simple luminance check for light/dark background
  if (!bgColor) return ''
  const c = bgColor.replace('#', '')
  const r = parseInt(c.substr(0, 2), 16)
  const g = parseInt(c.substr(2, 2), 16)
  const b = parseInt(c.substr(4, 2), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#000000' : '#FFFFFF'
}

// 2. Sync Props to Local State
watch(() => layerLocal.value, (nv) => {
  // Opacity: store as 0..1, edit as 0..100
  if (nv.opacity !== undefined && nv.opacity !== null) {
    const num = parseFloat(nv.opacity)
    localOpacity.value = isFinite(num) ? Math.round((num <= 1 ? num * 100 : num)) : 100
  } else {
    localOpacity.value = 100
  }

  // Offset
  localDrawingLeft.value = (nv.drawingLeft != null) ? nv.drawingLeft : 0
  localDrawingTop.value = (nv.drawingTop != null) ? nv.drawingTop : 0

  // Priority
  if (nv.overridePriority != null) {
    localPriority.value = nv.overridePriority
  } else if (nv.defaultPriority != null) {
    localPriority.value = nv.defaultPriority
  } else {
    localPriority.value = 0
  }
}, { immediate: true, deep: true })

// 3. Focus Logic
const isFocused = computed(() => {
  const fp = store.focusedProperty
  if (!fp) return false
  if (props.part && fp.uid && props.part._uid) {
    return fp.uid === props.part._uid && fp.layerIndex === layerLocal.value.layerIndex
  }
  return fp.layerIndex === layerLocal.value.layerIndex
})

// Visual move state
const isThisLayerMoving = computed(() => {
  if (store.previewTool !== 'move') return false
  const fp = store.focusedProperty
  if (!fp) return false
  return fp.layerIndex === layerLocal.value.layerIndex
})

function activateVisualMove() {
  // Focus this layer by selecting the drawing property
  selectProperty('drawing')
  // Enable move mode
  store.setPreviewTool('move')
}

// 4. Throttled Saver
// We use throttle to ensure the UI is responsive but we don't spam the store/API
const throttledEmitSave = throttle((newLayerData) => {
  emit('save-layer', { index: displayIndex.value, layer: newLayerData })
}, 100, { leading: true, trailing: true })

/* ------------------- Input Handlers ------------------- */

function toggleCollapse() {
  if (!isMultiMode.value) {
    collapsed.value = !collapsed.value
  }
}

// Track the last clicked layer index for range selection
const lastClickedLayerIndex = ref(null)

function handleHeaderClick(e) {
  // In multi-mode, clicking header toggles selection
  if (isMultiMode.value) {
    // Check if Ctrl/Cmd or Shift key is pressed
    if (e.ctrlKey || e.metaKey) {
      toggleSelection()
      lastClickedLayerIndex.value = layerLocal.value.layerIndex
    } else if (e.shiftKey) {
      // Handle shift-click range selection
      handleRangeSelection()
    } else {
      toggleSelection()
      lastClickedLayerIndex.value = layerLocal.value.layerIndex
    }
  } else {
    // In single mode, Ctrl/Cmd + Click toggles selection temporarily
    if (e.ctrlKey || e.metaKey) {
      toggleSelection()
    } else {
      toggleCollapse()
    }
  }
}

function toggleSelection() {
  store.toggleLayerSelection({
    stackIndex: props.stackIndex,
    partIndex: props.partIndex,
    layerIndex: layerLocal.value.layerIndex
  })
}

function handleRangeSelection() {
  // If we have a previous selection and we're in the same part, do range selection
  if (lastClickedLayerIndex.value !== null &&
    store.focusedPartIndex.stackIndex === props.stackIndex &&
    store.focusedPartIndex.partIndex === props.partIndex) {

    // Use store's selectLayerRange method
    store.selectLayerRange(lastClickedLayerIndex.value, layerLocal.value.layerIndex)
    lastClickedLayerIndex.value = layerLocal.value.layerIndex
  } else {
    // No previous selection, just toggle this one
    toggleSelection()
    lastClickedLayerIndex.value = layerLocal.value.layerIndex
  }
}

// --- Opacity ---
function onOpacityInput() {
  let v = localOpacity.value
  if (v === '' || v === null) v = 100
  // Clamp 0-100
  v = Math.max(0, Math.min(100, parseInt(v, 10) || 0))

  // Normalize to 0..1 for storage
  const normalized = v / 100

  const newLayer = { ...layerLocal.value }
  newLayer.opacity = normalized

  if (linkedOpacity.value && Array.isArray(newLayer.subLayers)) {
    newLayer.subLayers = newLayer.subLayers.map(s => ({ ...s, opacity: normalized }))
  }

  throttledEmitSave(newLayer)
}

// --- Drawing (Offset) ---
function onDrawingInput() {
  const left = (localDrawingLeft.value === '' || localDrawingLeft.value == null) ? null : Number(localDrawingLeft.value)
  const top = (localDrawingTop.value === '' || localDrawingTop.value == null) ? null : Number(localDrawingTop.value)

  const newLayer = { ...layerLocal.value }
  newLayer.drawingLeft = left
  newLayer.drawingTop = top

  if (linkedOffset.value && Array.isArray(newLayer.subLayers)) {
    newLayer.subLayers = newLayer.subLayers.map(s => ({
      ...s,
      drawingLeft: left,
      drawingTop: top
    }))
  }

  throttledEmitSave(newLayer)
}

// --- Priority ---
function onPriorityInput() {
  const val = (localPriority.value === '' || localPriority.value == null) ? null : Number(localPriority.value)

  const newLayer = { ...layerLocal.value }

  // If user clears input or matches default, you could argue for resetting, 
  // but here we explicit set override unless it is null
  if (val === null) {
    // If input cleared, reset to default behavior
    newLayer.overridePriority = newLayer.defaultPriority || 0
    newLayer.isOverridePriority = false
  } else {
    newLayer.overridePriority = val
    newLayer.isOverridePriority = true
  }

  throttledEmitSave(newLayer)
}

function resetPriority() {
  const def = layerLocal.value.defaultPriority || 0
  localPriority.value = def

  const newLayer = { ...layerLocal.value }
  newLayer.overridePriority = def
  newLayer.isOverridePriority = false

  // Reset immediately (no throttle needed for button click usually, but consistency is fine)
  emit('save-layer', { index: displayIndex.value, layer: newLayer })
}

const priorityIsOverridden = computed(() => {
  return layerLocal.value.isOverridePriority || (
    layerLocal.value.overridePriority != null &&
    layerLocal.value.overridePriority !== layerLocal.value.defaultPriority
  )
})

/* ------------------- Helper Functions for Reset Buttons ------------------- */

// Helper function to extract drawing value from object or primitive (same logic as LayerTranslator)
function extractDrawingValue(val, layerName) {
  if (val === undefined || val === null) return null
  if (typeof val === 'object') {
    if ('' in val) return val['']
    if (layerName && layerName in val) return val[layerName]
    const vs = Object.values(val)
    return vs.length ? vs[0] : null
  }
  return val
}

// Get asset default offset for current layer
function getAssetDefaultOffset() {
  try {
    // Get asset from part or store
    let asset = null
    if (props.part && props.part.Asset) {
      asset = props.part.Asset
    } else {
      // Try to resolve asset from store
      asset = store.resolveAssetForPart(props.part)
    }

    if (!asset || !Array.isArray(asset.Layer)) {
      return { left: null, top: null }
    }

    const layerIndex = layerLocal.value.layerIndex
    if (layerIndex < 0 || layerIndex >= asset.Layer.length) {
      return { left: null, top: null }
    }

    const assetLayer = asset.Layer[layerIndex]
    if (!assetLayer || typeof assetLayer !== 'object') {
      return { left: null, top: null }
    }

    const layerName = layerLocal.value.name || ''
    let left = null
    let top = null

    if ('DrawingLeft' in assetLayer) {
      left = extractDrawingValue(assetLayer.DrawingLeft, layerName)
    }
    if ('DrawingTop' in assetLayer) {
      top = extractDrawingValue(assetLayer.DrawingTop, layerName)
    }

    return { left, top }
  } catch (e) {
    console.warn('[ColorableLayer] Error getting asset default offset:', e)
    return { left: null, top: null }
  }
}

// Computed property to check if offset is overridden from asset defaults
const offsetIsOverridden = computed(() => {
  // Only show for main layers (layers that have a subLayers property, even if empty)
  // Sublayers don't have this property and shouldn't show reset buttons
  if (!('subLayers' in layerLocal.value)) {
    return false
  }

  const defaults = getAssetDefaultOffset()
  const currentLeft = layerLocal.value.drawingLeft ?? 0
  const currentTop = layerLocal.value.drawingTop ?? 0
  const defaultLeft = defaults.left ?? 0
  const defaultTop = defaults.top ?? 0

  // Show reset if either value differs from default
  return currentLeft !== defaultLeft || currentTop !== defaultTop
})

// Computed property to check if color is customized
const colorIsCustomized = computed(() => {
  return layerLocal.value.isColorable &&
    layerLocal.value.colorText !== null &&
    layerLocal.value.colorText !== undefined &&
    layerLocal.value.colorText !== ''
})

/* ------------------- Reset Methods ------------------- */

function resetOffset() {
  const defaults = getAssetDefaultOffset()
  const defaultLeft = defaults.left ?? 0
  const defaultTop = defaults.top ?? 0

  localDrawingLeft.value = defaultLeft
  localDrawingTop.value = defaultTop

  const newLayer = { ...layerLocal.value }
  newLayer.drawingLeft = defaultLeft
  newLayer.drawingTop = defaultTop

  emit('save-layer', { index: displayIndex.value, layer: newLayer })
}

function resetColor() {
  const newLayer = { ...layerLocal.value }
  newLayer.colorText = null
  newLayer.colorCss = null

  emit('save-layer', { index: displayIndex.value, layer: newLayer })
}

/* ------------------- Formatting & Helpers ------------------- */

function formatOpacity(v) {
  if (v == null) return ''
  let n = parseFloat(v)
  if (Number.isNaN(n)) return ''
  if (n <= 1) n = n * 100
  return Math.round(n) + '%'
}

function selectProperty(propName) {
  store.setFocusedProperty({
    part: props.part || store.focusedPart,
    partIndex: props.partIndex,
    stackIndex: props.stackIndex,
    layerIndex: layerLocal.value.layerIndex,
    property: propName
  })
}

function selectSubProperty(subIndex, propName) {
  store.setFocusedProperty({
    part: props.part || store.focusedPart,
    layerIndex: layerLocal.value.layerIndex,
    subLayerIndex: subIndex,
    property: propName
  })
}

// --- Link Toggles ---
function toggleLinkedOpacity() {
  linkedOpacity.value = !linkedOpacity.value
  // If turning ON, sync immediately
  if (linkedOpacity.value) onOpacityInput()
}
function toggleLinkedOffset() {
  linkedOffset.value = !linkedOffset.value
  if (linkedOffset.value) onDrawingInput()
}

// --- Palette (Unchanged logic) ---
function buildPaletteTargetList() {
  const targets = []
  try {
    const li = layerLocal.value.colorableIndex
    const partObj = props.part || store.focusedPart
    const uid = partObj && partObj._uid ? partObj._uid : null
    const t = {
      uid: uid,
      stackIndex: (typeof props.stackIndex === 'number' ? props.stackIndex : null),
      partIndex: (typeof props.partIndex === 'number' ? props.partIndex : null),
      layerIndex: (typeof li === 'number' ? li : layerLocal.value.layerIndex),
      currentColorText: layerLocal.value.colorText || null
    }
    targets.push(t)
  } catch (e) { /* ignore */ }
  return targets
}

const isPaletteSelected = computed(() => {
  if (!store.paletteModeActive) return false
  const targets = store.activePaletteTargets || []
  try {
    const li = layerLocal.value.colorableIndex
    const partObj = props.part || store.focusedPart
    const uid = partObj && partObj._uid ? partObj._uid : null
    return targets.some(t => (t.layerIndex === li) && (t.uid && uid ? t.uid === uid : true) && (t.partIndex === props.partIndex || t.partIndex === null))
  } catch (e) {
    return false
  }
})

function togglePaletteForEntry() {
  const targets = buildPaletteTargetList()
  if (!targets || targets.length === 0) return
  if (isPaletteSelected.value && store.paletteModeActive) {
    store.clearPaletteMode()

    return
  }
  store.openPalettePanel(targets)
}
</script>

<style scoped>
/* Base Theme */
.color-main-block {
  --bg: var(--color-bg-base);
  --panel-border: var(--color-border-base);
  --header-bg-a: var(--color-bg-surface);
  --header-bg-b: var(--color-bg-base);
  --muted: var(--color-text-muted);
  --label: var(--color-text-secondary);
  --text: var(--color-text-primary);
  --accent: var(--color-selection-single);
  --chip-border: var(--color-border-light);
  border-radius: var(--radius-lg, 10px);
  border: 1px solid var(--panel-border);
  background: var(--bg);
  display: flex;
  flex-direction: column;
  transition: box-shadow 0.12s ease;
  box-sizing: border-box;
}

[data-focused="1"] {
  box-shadow: 0 0 0 3px var(--color-selection-single-bg);
  border-color: var(--color-selection-single-border);
}

[data-selected="1"] {
  background: var(--color-selection-multi-bg);
  border-color: var(--color-selection-multi-border);
  box-shadow: 0 0 0 2px var(--color-selection-multi-bg);
}

[data-selected="1"][data-focused="1"] {
  box-shadow: 0 0 0 3px var(--color-selection-multi-border);
}

/* Header */
.color-main-header {
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-lg, 9px) var(--radius-lg, 9px) 0 0;
  border-bottom: 1px dashed rgba(240, 238, 251, 0.9);
  background: linear-gradient(90deg, var(--header-bg-a) 60%, var(--header-bg-b) 100%);
  font-size: 14px;
}

/* Checkbox */
.layer-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: var(--color-accent-purple);
  flex-shrink: 0;
}

.color-main-title {
  flex: 1;
  color: var(--color-text-primary);
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fold-arrow {
  font-size: 13px;
  color: var(--color-text-tertiary);
  width: 12px;
  text-align: center;
}

.fold-arrow.collapsed {
  transform: rotate(-90deg);
}

/* Body */
.color-main-body {
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.color-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 32px;
}

.color-row label {
  flex: 0 0 70px;
  font-weight: 600;
  color: var(--label);
  font-size: 12px;
}

.val {
  flex: 1;
  font-size: 13px;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Controls */
.control-group {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.edit-input {
  padding: 4px 8px;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--color-border-base);
  font-size: 13px;
  outline: none;
  background: var(--color-bg-base);
  transition: all 0.15s;
  color: var(--color-text-primary);
}

.edit-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--color-selection-single-bg);
}

/* Specific inputs */
.num-input {
  width: 50px;
  text-align: center;
}

.slider-input {
  flex: 1;
  cursor: pointer;
  max-width: 100px;
}

.compact-input-wrapper {
  display: flex;
  align-items: center;
  gap: 4px;
}

.input-label {
  font-size: 11px;
  color: var(--muted);
  font-weight: 600;
}

.compact-input {
  width: 50px;
}

.unit {
  font-size: 12px;
  color: var(--muted);
}

/* Buttons */
.tiny-palette,
.tiny-link,
.tiny-reset {
  height: 28px;
  width: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--color-border-base);
  background: var(--color-bg-base);
  cursor: pointer;
  color: var(--color-text-secondary);
  transition: all 0.1s;
}

.tiny-palette:hover,
.tiny-link:hover,
.tiny-reset:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-border-strong);
}

.tiny-link.active {
  background: var(--color-interactive-hover);
  border-color: var(--color-selection-single-border);
  color: var(--accent);
}

.tiny-palette.active {
  background: var(--color-interactive-hover);
  border-color: var(--color-selection-single-border);
}

.right-action {
  margin-left: auto;
}

/* Color Chip */
.color-chip {
  padding: 4px 8px;
  border-radius: var(--radius-sm, 6px);
  font-weight: 600;
  font-size: 12px;
  border: 1px solid var(--color-border-light);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
}


/* Priority Badges */
.priority-badge {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: var(--radius-xs, 4px);
  font-weight: 700;
  background: var(--color-badge-blue-bg);
  color: var(--color-badge-blue-text);
  border: 1px solid var(--color-badge-blue-border);
}

.text-sm {
  font-size: 11px;
}

/* Sublayers */
.sublayer-list {
  padding: 8px 14px 12px 24px;
  background: var(--color-bg-surface);
  border-top: 1px dashed var(--color-border-light);
  border-radius: 0 0 9px 9px;
}

.sub-block {
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px dotted var(--color-border-light);
}

.sl-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 4px;
}

.sl-row label {
  width: 60px;
  color: var(--color-text-tertiary);
  font-size: 11px;
}

.offset-item {
  margin-right: 8px;
  font-size: 12px;
}

.muted {
  color: var(--muted);
  font-style: italic;
}

/* Transitions */
.collapse-fast-enter-active,
.collapse-fast-leave-active {
  transition: max-height 0.2s ease, opacity 0.15s ease;
  overflow: hidden;
}

.collapse-fast-enter-from,
.collapse-fast-leave-to {
  max-height: 0;
  opacity: 0;
}

.collapse-fast-enter-to,
.collapse-fast-leave-from {
  max-height: 500px;
  opacity: 1;
}
</style>