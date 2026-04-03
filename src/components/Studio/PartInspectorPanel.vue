<template>
  <div class="inspector-panel" role="region" :aria-label="t('partInspector.ariaLabel')" @keydown="handleKeydown">
    <div class="header">
      <h4>{{ t('partInspector.title') }}</h4>
    </div>

    <div class="mode-bar" v-if="hasPart">
      <button class="mode-chip" :class="{ active: !isMultiMode }" @click="toggleSelectionMode" :disabled="isMultiMode === false"
        :title="t('partInspector.singleMode') || 'Single selection mode'">
        {{ t('partInspector.singleMode') || 'Single' }}
      </button>
      <button class="mode-chip" :class="{ active: isMultiMode }" @click="toggleSelectionMode" :disabled="isMultiMode === true"
        :title="t('partInspector.multiMode') || 'Multi-select mode'">
        {{ t('partInspector.multiMode') || 'Multi' }}
      </button>
      <button class="mode-chip" :class="{ active: isMoveTool }" @click="togglePreviewTool" :disabled="!canUseMoveTool"
        :title="isMoveTool ? (t('partInspector.viewMode') || 'Switch to View mode') : (t('partInspector.moveMode') || 'Switch to Move mode')">
        {{ isMoveTool ? (t('partInspector.moveMode') || 'Move') : (t('partInspector.viewMode') || 'View') }}
      </button>
      <div class="mode-chip scope">
        {{ scopeLabel }}
      </div>
    </div>

    <div class="body  scrollable">
      <div v-if="!hasPart" class="placeholder">{{ t('partInspector.noPartPlaceholder') }}</div>

      <div v-else class="content">
        <div v-if="false" class="stage-hint stage-hint-replace">
          <div class="stage-hint-title">{{ t('partInspector.replaceStageTitle') || '当前处于替换阶段' }}</div>
          <div class="stage-hint-text">{{ t('partInspector.replaceStageDesc') || '请在 Asset 面板选择并应用资源，应用后会自动回到精修。' }}</div>
          <button class="stage-hint-btn" @click="goToAssetPanel">{{ t('partInspector.goToAsset') || '前往替换面板' }}</button>
        </div>

        <template v-else>
          <!-- Batch Edit Panel (shown when multiple layers selected) -->
          <BatchEditPanel v-if="isMultiMode && hasSelections" />
        
        <!-- Core Properties Section -->
        <CollapsibleSection 
          :title="t('partInspector.corePropertiesTitle') || 'Core Properties'"
          :default-collapsed="false"
        >
          <!-- Description 编辑 -->
          <div class="row">
            <label>{{ t('partInspector.descriptionLabel') }}</label>
            <div class="val edit-box">
              <span>{{ partDescription }}</span>
            </div>
          </div>

          <!-- Group 编辑 -->
          <div class="row">
            <label>{{ t('partInspector.groupLabel') }}</label>
            <div class="val edit-box">
              <span>{{ groupDescription }}</span>
            </div>
          </div>

          <!-- Modular Asset Logic (New) -->
          <template v-if="showStructureFields && modularOptions && modularOptions.length > 0">
            <div v-for="mod in modularOptions" :key="mod.Key" class="row">
              <label>{{ mod.Description || mod.Name }}</label>
              <div class="val edit-box">
                <select class="edit-input" :value="getModularValue(mod.Key)" @change="(e) => onModularChange(mod.Key, e)">
                  <option class="edit-option" v-for="opt in mod.Options" :key="opt.Index" :value="opt.Index">
                    {{ opt.Description || opt.Name }}
                  </option>
                </select>
              </div>
            </div>
          </template>

          <!-- Typed Asset Type Selector (Standard Typed) -->
          <div v-if="showStructureFields && typedOptions.length > 0" class="row">
            <label>{{ t('partInspector.typeRecordLabel') || 'Type' }}</label>
            <div class="val edit-box">
              <select class="edit-input" :value="currentTypeIndex" @change="onTypeChange">
                <option class="edit-option" v-if="currentTypeIndex === -1" :value="-1" disabled>{{ t('partInspector.selectType') || 'Select...' }}</option>
                <option class="edit-option" v-for="(opt, idx) in typedOptions" :key="idx" :value="idx">
                  {{ opt.Description || opt.Name }}
                </option>
              </select>
            </div>
          </div>

          <!-- Vibrating Item Mode Selector -->
          <div v-if="showStructureFields && vibratingOptions.length > 0" class="row">
            <label>{{ t('partInspector.vibratorModeLabel') || 'Vibrator Mode' }}</label>
            <div class="val edit-box">
              <select class="edit-input" :value="currentVibratorModeIndex" @change="onVibratorModeChange">
                <option class="edit-option" v-if="currentVibratorModeIndex === -1" :value="-1" disabled>{{ t('partInspector.selectVibratorMode') || 'Select...' }}</option>
                <option class="edit-option" v-for="(opt, idx) in vibratingOptions" :key="idx" :value="idx">
                  {{ opt.Description || opt.Name }}
                </option>
              </select>
            </div>
          </div>

          <template v-if="showStructureFields && textFields.length > 0">
            <div v-for="field in textFields" :key="field.key" class="row">
              <label>{{ field.key }}</label>
              <div class="val edit-box">
                <input
                  class="edit-input"
                  type="text"
                  :value="getTextFieldValue(field.key)"
                  :maxlength="field.maxLength"
                  @input="(e) => onTextFieldInput(field.key, field.maxLength, e)"
                />
                <span class="text-limit">{{ getTextFieldValue(field.key).length }}/{{ field.maxLength }}</span>
              </div>
            </div>
          </template>
        </CollapsibleSection>

        <!-- Layers: 支持分组展示 -->
        <div class="colorgroup-list">
          <template v-if="organizedLayers && organizedLayers.length">
            <template v-for="item in organizedLayers" :key="item.type === 'group' ? `group-${item.groupName}` : `layer-${item.layer._key || item.layer.name}`">
              <!-- Group Container -->
              <div v-if="item.type === 'group'" class="layer-hover-wrap"
                @mouseenter="onLayerGroupMouseEnter(item.layers)" @mouseleave="onLayerHoverLeave">
                <LayerGroup
                  :groupName="item.groupName"
                  :layers="item.layers"
                  :part="part"
                  :stackIndex="focusedPartIndex?.stackIndex ?? 0"
                  :partIndex="focusedPartIndex?.partIndex ?? 0"
                  :selectionMode="selectionMode"
                  @save-layer="onSaveLayer" />
              </div>
              
              <!-- Individual Layer -->
              <div v-else-if="item.type === 'layer'" class="layer-hover-wrap"
                @mouseenter="onSingleLayerMouseEnter(item.layer)" @mouseleave="onLayerHoverLeave">
                <ColorableLayer
                  :layer="item.layer"
                  :part="part"
                  :stackIndex="focusedPartIndex?.stackIndex ?? 0"
                  :partIndex="focusedPartIndex?.partIndex ?? 0"
                  :selectionMode="selectionMode"
                  @save-layer="onSaveLayer" />
              </div>
            </template>
          </template>

          <!-- fallback: 没有 layerEntries 时原色展示 -->
          <template v-else>
            <div class="row">
              <label>{{ t('partInspector.colorLabel') }}</label>
              <div class="val">
                <template v-if="Array.isArray(part.Color) && part.Color.length">
                  <div class="color-list">
                    <div v-for="(c, i) in part.Color" :key="i" class="color-item">{{ c }}</div>
                  </div>
                </template>
                <template v-else-if="part.Color">
                  <div class="color-item">{{ part.Color }}</div>
                </template>
                <template v-else><span class="muted">—</span></template>
              </div>
            </div>
          </template>
        </div>

        <!-- Advanced Properties Section (collapsed by default) -->
        <CollapsibleSection 
          v-if="showAdvancedSection && (part.Property || part.Craft)"
          :title="t('partInspector.advancedPropertiesTitle') || 'Advanced Properties'"
          :default-collapsed="true"
          variant="subtle"
        >
          <div v-if="part.Property" class="prop-block">
            <div class="prop-title">{{ t('partInspector.propertyLabel') }}</div>

            <div v-if="part.Property.TypeRecord" class="prop-sub">
              <div class="sub-title">{{ t('partInspector.typeRecordLabel') }}</div>
              <div class="kv-list">
                <div v-for="(v, k) in part.Property.TypeRecord" :key="k" class="kv">
                  <span class="k">{{ k }}</span><span class="v">{{ v }}</span>
                </div>
              </div>
            </div>
          </div>

          <div v-if="part.Craft" class="prop-block">
            <div class="prop-title">{{ t('partInspector.craftLabel') }}</div>
            <pre class="craft-json">{{ shortJson(part.Craft) }}</pre>
          </div>
        </CollapsibleSection>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStudioDomainStores } from '@/stores/studio'
import { createStudioSelectionBridge } from '@/stores/studio/selectionBridge'
import ColorableLayer from './ColorableLayer.vue'
import LayerGroup from './LayerGroup.vue'
import BatchEditPanel from './BatchEditPanel.vue'
import CollapsibleSection from '../ui/CollapsibleSection.vue'
import { hostWindow, setTimeoutHost, doc } from '@/utils/host-window.js'
import { AssetApi } from '@/utils/AssetApi'
import * as Palette from '@/services/PaletteService'
import { applyLayerDeltasToPart } from '@/services/PartPatchApplier'

const { t } = useI18n()

const { studio: store, selection } = useStudioDomainStores()
const selectionBridge = createStudioSelectionBridge(store, selection)
const part = computed(() => store.focusedPart)
const updateFlag = computed(() => store.focusedPartUpdateFlag)
const hasPart = computed(() => !!part.value)
const selectionMode = computed(() => selectionBridge.selectionMode)
const selectedLayers = computed(() => selectionBridge.selectedLayers)
const selectedLayersCount = computed(() => selectionBridge.selectedLayersCount)
const focusedPartIndex = computed(() => selectionBridge.focusedPartIndex)

// Multi-selection state
const isMultiMode = computed(() => selectionMode.value === 'multiple')
const hasSelections = computed(() => selectedLayersCount.value > 0)
// taskStage is deprecated. Keep inspector fields visible for debugging regardless of legacy stages.
const showStructureFields = computed(() => true)
const showAdvancedSection = computed(() => true)
const scopeLabel = computed(() => {
  if (!hasPart.value) return ''
  if (isMultiMode.value) {
    const count = selectedLayersCount.value
    return `${t('partInspector.applyTo') || 'Apply to'} ${count} ${t('partInspector.layers') || 'layers'}`
  }
  return t('partInspector.applyToCurrentLayer') || 'Apply to current layer'
})

// Preview tool state
const isMoveTool = computed(() => selectionBridge.previewTool === 'move')
const canUseMoveTool = computed(() => store.canUseMoveTool)

function togglePreviewTool() {
  store.togglePreviewTool()
}

function goToAssetPanel() {
  // Deprecated: taskStage flow removed.
  // store.setTaskStage('replace')
  store.openContextPanel('asset', 'inspector-goto-asset')
}

/*
  Key fix:
  - maintain layerEntriesLocal per focusedPart snapshot
  - each save checks focusedPart hasn't changed (by comparing a partKey)
*/
const layerEntriesLocal = ref([])            // local deep-cloned copy used by children
const focusedPartKey = ref(null)             // snapshot key for current focusedPart
const layerHoverBlinkTimerId = ref(null)
const layerHoverBlinkState = ref(null)
const DISABLE_LAYER_HOVER_BLINK = true
const layerEditInteractionActive = ref(false)
const layerEditCommitTimerId = ref(null)

function beginLayerEditInteraction() {
  if (layerEditInteractionActive.value) return
  try {
    store.beginInteraction('layer-edit', { source: 'PartInspectorPanel' })
    layerEditInteractionActive.value = true
  } catch (e) {
    layerEditInteractionActive.value = false
  }
}

function clearLayerEditCommitTimer() {
  const timerId = layerEditCommitTimerId.value
  if (timerId !== null) {
    hostWindow.clearTimeout(timerId)
    layerEditCommitTimerId.value = null
  }
}

function commitLayerEditInteraction() {
  if (!layerEditInteractionActive.value) return false
  clearLayerEditCommitTimer()
  layerEditInteractionActive.value = false

  let committed = false
  try {
    committed = !!store.commitInteraction()
  } catch (e) {
    committed = false
  }

  if (!committed) {
    try {
      committed = !!store.forceEndRealtimeScope?.('editor', {
        commit: true,
        interactionKind: 'layer-edit'
      })
    } catch (e) {
      committed = false
    }
  }

  return committed
}

function scheduleLayerEditInteractionCommit(delayMs = 160) {
  clearLayerEditCommitTimer()
  layerEditCommitTimerId.value = hostWindow.setTimeout(() => {
    layerEditCommitTimerId.value = null
    commitLayerEditInteraction()
  }, Math.max(0, Number(delayMs) || 0))
}

// helper to build a stable key for focusedPart snapshot
function buildPartKey(p) {
  if (!p) return null
  // Prefer stable uid if present
  if (p._uid) return p._uid
  try { return JSON.stringify(p) } catch (e) {
    // fallback to shallow identification if JSON fails
    return String(p?.Asset?.Name || p?.Name || p?.Description || Math.random())
  }
}

const refreshFunction = async (p) => {
  if (!p) {
    layerEntriesLocal.value = []
    focusedPartKey.value = null
    return
  }

  // Resolve entries from store source-of-truth first.
  let entries = null
  try {
    if (typeof store.getLayerEntriesForPart === 'function') {
      const resolved = store.getLayerEntriesForPart(p, { forceRebuild: false, clone: true })
      entries = Array.isArray(resolved) ? resolved : []
    } else {
      // build from translator (store.buildLayerEntriesForPart will set store.translatedLayerEntries as side-effect)
      const built = store.buildLayerEntriesForPart(p) || []
      entries = JSON.parse(JSON.stringify(built))
    }
  } catch (e) {
    // fallback defensive copy
    try { entries = (p.layerEntries || []).map(e => Object.assign({}, e)) } catch { entries = [] }
  }

  layerEntriesLocal.value = entries || []
  focusedPartKey.value = buildPartKey(p)

  // ensure UI focuses first edit if needed
  await nextTick()
}
// initialize local entries when focusedPart changes
watch(part, refreshFunction, { immediate: true, deep: true })
watch(updateFlag, () => {
  stopLayerHoverBlink()
  refreshFunction(part.value)
})

watch(part, () => {
  stopLayerHoverBlink()
})

watch(() => `${focusedPartIndex.value?.stackIndex ?? 'n'}:${focusedPartIndex.value?.partIndex ?? 'n'}`, () => {
  stopLayerHoverBlink()
})

watch(() => (selectedLayers.value || []).map(s => `${s.stackIndex}:${s.partIndex}:${s.layerIndex}`).join('|'), () => {
  stopLayerHoverBlink()
})

// Organize layers by group
const organizedLayers = computed(() => {
  const layers = layerEntriesLocal.value || []
  if (!layers.length) return []

  // Group layers by groupDisplayName
  const groupMap = new Map()
  const ungrouped = []

  for (const layer of layers) {
    const groupName = layer.groupDisplayName
    if (groupName) {
      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, [])
      }
      groupMap.get(groupName).push(layer)
    } else {
      ungrouped.push(layer)
    }
  }

  // Build organized array: groups first, then ungrouped layers
  const result = []
  
  // Add groups (with >1 layer in each group)
  for (const [groupName, groupLayers] of groupMap.entries()) {
    if (groupLayers.length > 1) {
      result.push({ type: 'group', groupName, layers: groupLayers })
    } else {
      // Single-layer groups are treated as ungrouped
      ungrouped.push(groupLayers[0])
    }
  }
  
  // Add ungrouped layers
  for (const layer of ungrouped) {
    result.push({ type: 'layer', layer })
  }

  return result
})

/* ------- Typed Asset Logic (Standard) ------- */
const typedOptions = ref([])

function refreshTypedOptions() {
  typedOptions.value = []
  const p = part.value
  if (!p) return

  // Resolve Group and Name
  const groupName = p.Group || p.Asset?.Group?.Name
  const assetName = p.Name || p.Asset?.Name

  if (groupName && assetName) {
    const opts = AssetApi.getTypedAssetOptions(groupName, assetName)
    if (Array.isArray(opts)) {
      typedOptions.value = opts
    }
  }
}

watch(part, refreshTypedOptions, { immediate: true })

const currentTypeIndex = computed(() => {
  if (!typedOptions.value.length) return -1
  const currentTR = part.value?.Property?.TypeRecord
  
  return typedOptions.value.findIndex(opt => {
    const optTR = opt.Property?.TypeRecord
    // Compare TypeRecord structure
    return JSON.stringify(optTR) === JSON.stringify(currentTR || null)
  })
})

function onTypeChange(e) {
  const idx = Number(e.target.value)
  if (idx < 0 || idx >= typedOptions.value.length) return
  const opt = typedOptions.value[idx]

  // Clone existing properties
  const newProp = { ...(part.value.Property || {}) }

  // Update TypeRecord
  if (opt.Property?.TypeRecord) {
    newProp.TypeRecord = JSON.parse(JSON.stringify(opt.Property.TypeRecord))
  } else {
    delete newProp.TypeRecord
  }

  store.execute({
    type: 'part.updateProperty',
    payload: {
      property: newProp,
      rebuildLayers: true,
      refresh: true
    }
  })
}

/* ------- Vibrating Item Logic ------- */
const vibratingOptions = ref([])

function refreshVibratingOptions() {
  vibratingOptions.value = []
  const p = part.value
  if (!p) return

  // Resolve Group and Name
  const groupName = p.Group || p.Asset?.Group?.Name
  const assetName = p.Name || p.Asset?.Name

  if (groupName && assetName) {
    const opts = AssetApi.getVibratingAssetOptions(groupName, assetName)
    if (Array.isArray(opts)) {
      vibratingOptions.value = opts
    }
  }
}

watch(part, refreshVibratingOptions, { immediate: true })

const currentVibratorModeIndex = computed(() => {
  if (!vibratingOptions.value.length) return -1
  const currentMode = part.value?.Property?.Mode
  
  return vibratingOptions.value.findIndex(opt => {
    return opt.Property?.Mode === currentMode
  })
})

function onVibratorModeChange(e) {
  const idx = Number(e.target.value)
  if (idx < 0 || idx >= vibratingOptions.value.length) return
  const opt = vibratingOptions.value[idx]

  // Clone existing properties
  const newProp = { ...(part.value.Property || {}) }

  // Update vibrating-related properties (Mode, Intensity, Effect, etc.)
  if (opt.Property) {
    if (opt.Property.Mode !== undefined) newProp.Mode = opt.Property.Mode
    if (opt.Property.Intensity !== undefined) newProp.Intensity = opt.Property.Intensity
    if (opt.Property.Effect !== undefined) newProp.Effect = JSON.parse(JSON.stringify(opt.Property.Effect))
    if (opt.Property.TypeRecord !== undefined) {
      newProp.TypeRecord = JSON.parse(JSON.stringify(opt.Property.TypeRecord))
    }
  }

  store.execute({
    type: 'part.updateProperty',
    payload: {
      property: newProp,
      rebuildLayers: true,
      refresh: true
    }
  })
}

/* ------- Modular Asset Logic (New) ------- */
const modularOptions = ref(null)
const textDefinitions = ref([])

function refreshModularOptions() {
  modularOptions.value = null
  const p = part.value
  if (!p) return

  const group = p.Group || p.Asset?.Group?.Name
  const name = p.Name || p.Asset?.Name

  if (group && name) {
    const data = AssetApi.getModularAssetData(group, name)
    if (data && data.length > 0) {
      modularOptions.value = data
    }
  }
}

watch(part, refreshModularOptions, { immediate: true })

function getModularValue(key) {
  // Safe access to Property.TypeRecord[key]
  // Default to 0 if undefined, assuming index 0 is valid default
  return part.value?.Property?.TypeRecord?.[key] ?? 0
}

function onModularChange(moduleKey, e) {
  const val = Number(e.target.value)
  if (isNaN(val)) return

  // Logic to update TypeRecord specific key
  const newProp = { ...(part.value.Property || {}) }
  const newTR = { ...(newProp.TypeRecord || {}) }
  
  newTR[moduleKey] = val
  newProp.TypeRecord = newTR
  
  store.execute({
    type: 'part.updateProperty',
    payload: {
      property: newProp,
      rebuildLayers: true,
      refresh: true
    }
  })
}

/* ------- Text Item Logic ------- */
function refreshTextDefinitions() {
  textDefinitions.value = []
  const p = part.value
  if (!p) return

  const group = p.Group || p.Asset?.Group?.Name
  const name = p.Name || p.Asset?.Name
  if (!group || !name) return

  const data = AssetApi.getTextItemDefinitionsForPart(group, name, p.Property || {})
  if (Array.isArray(data)) {
    textDefinitions.value = data
  }
}

watch(part, refreshTextDefinitions, { immediate: true })
watch(updateFlag, refreshTextDefinitions)

const textFields = computed(() => {
  const merged = []
  const indexByKey = new Map()

  for (const def of (textDefinitions.value || [])) {
    for (const field of (def?.textFields || [])) {
      const key = field?.key
      if (!key) continue
      const maxLengthRaw = Number(field?.maxLength)
      const maxLength = Number.isFinite(maxLengthRaw) && maxLengthRaw > 0 ? maxLengthRaw : 255

      if (!indexByKey.has(key)) {
        indexByKey.set(key, merged.length)
        merged.push({ key, maxLength })
      } else {
        const idx = indexByKey.get(key)
        merged[idx].maxLength = Math.min(merged[idx].maxLength, maxLength)
      }
    }
  }

  return merged
})

function getTextFieldValue(fieldKey) {
  if (!fieldKey) return ''
  const val = part.value?.Property?.[fieldKey]
  if (val === undefined || val === null) return ''
  return String(val)
}

function onTextFieldInput(fieldKey, maxLength, e) {
  if (!fieldKey || !part.value) return

  const raw = typeof e?.target?.value === 'string' ? e.target.value : ''
  const limitRaw = Number(maxLength)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 255
  const nextVal = raw.slice(0, limit)

  if (e?.target && e.target.value !== nextVal) {
    e.target.value = nextVal
  }

  const oldVal = getTextFieldValue(fieldKey)
  if (oldVal === nextVal) return

  const newProp = { ...(part.value.Property || {}) }
  newProp[fieldKey] = nextVal
  store.execute({
    type: 'part.updateProperty',
    payload: {
      property: newProp,
      rebuildLayers: false,
      refresh: true
    }
  })
}

/* ------- Description / Group 编辑（简化） ------- */
const editingDescription = ref(false)
const editDescription = ref('')

const editingGroup = ref(false)
const editGroup = ref('')

const canEditDescription = computed(() => true)
const canEditGroup = computed(() => true)

function startEditDescription() {
  if (!hasPart.value) return
  editDescription.value = partDescription.value || ''
  editingDescription.value = true
  nextTick(() => focusFirstEditInput())
}
function saveDescription() {
  if (!hasPart.value) { editingDescription.value = false; return }
  const desc = (editDescription.value ?? '').trim()
  if (!desc || desc === partDescription.value) { editingDescription.value = false; return }
  store.applyFocusedPartMetadata?.({
    Description: desc,
    Asset: { Description: desc }
  })
  editingDescription.value = false
}
function cancelDescription() { editingDescription.value = false }

function startEditGroup() {
  if (!hasPart.value) return
  editGroup.value = part.value?.Group || ''
  editingGroup.value = true
  nextTick(() => focusFirstEditInput())
}
function saveGroup() {
  if (!hasPart.value) { editingGroup.value = false; return }
  const g = (editGroup.value ?? '').trim()
  const old = part.value?.Group || ''
  if (!g || g === old) { editingGroup.value = false; return }
  store.applyFocusedPartMetadata?.({
    Group: g,
    Asset: { Group: { Name: g } }
  })
  editingGroup.value = false
}
function cancelGroup() { editingGroup.value = false }

function focusFirstEditInput() {
  setTimeoutHost(() => {
    try {
      const el = doc.querySelector('.edit-input:focus, .edit-input')
      el && el.focus()
    } catch (e) { }
  }, 12)
}

function _buildLayerDeltaForSave(previousLayer, nextLayer) {
  const nextIndex = Number(nextLayer?.layerIndex)
  const previousIndex = Number(previousLayer?.layerIndex)
  const layerIndex = Number.isFinite(nextIndex) ? nextIndex : previousIndex
  if (!Number.isFinite(layerIndex)) return null

  const delta = { layerIndex }
  let changed = false

  if ((previousLayer?.colorText ?? '') !== (nextLayer?.colorText ?? '')) {
    delta.colorText = nextLayer?.colorText ?? ''
    changed = true
  }

  if ((previousLayer?.opacity ?? 1) !== (nextLayer?.opacity ?? 1)) {
    delta.opacity = nextLayer?.opacity ?? 1
    changed = true
  }

  if ((previousLayer?.drawingLeft ?? null) !== (nextLayer?.drawingLeft ?? null)) {
    delta.drawingLeft = nextLayer?.drawingLeft ?? null
    changed = true
  }

  if ((previousLayer?.drawingTop ?? null) !== (nextLayer?.drawingTop ?? null)) {
    delta.drawingTop = nextLayer?.drawingTop ?? null
    changed = true
  }

  if (
    (previousLayer?.isOverridePriority ?? false) !== (nextLayer?.isOverridePriority ?? false) ||
    (previousLayer?.overridePriority ?? null) !== (nextLayer?.overridePriority ?? null)
  ) {
    delta.isOverridePriority = !!nextLayer?.isOverridePriority
    delta.overridePriority = nextLayer?.overridePriority ?? null
    changed = true
  }

  const previousSubLayers = Array.isArray(previousLayer?.subLayers) ? previousLayer.subLayers : []
  const nextSubLayers = Array.isArray(nextLayer?.subLayers) ? nextLayer.subLayers : []
  if (nextSubLayers.length > 0) {
    const subLayerDeltas = []
    for (const subLayer of nextSubLayers) {
      const subIndex = Number(subLayer?.layerIndex)
      if (!Number.isFinite(subIndex)) continue

      const previousSub = previousSubLayers.find(item => Number(item?.layerIndex) === subIndex)
      if (!previousSub) continue

      const subDelta = { layerIndex: subIndex }
      let subChanged = false

      if ((previousSub?.opacity ?? 1) !== (subLayer?.opacity ?? 1)) {
        subDelta.opacity = subLayer?.opacity ?? 1
        subChanged = true
      }
      if ((previousSub?.drawingLeft ?? null) !== (subLayer?.drawingLeft ?? null)) {
        subDelta.drawingLeft = subLayer?.drawingLeft ?? null
        subChanged = true
      }
      if ((previousSub?.drawingTop ?? null) !== (subLayer?.drawingTop ?? null)) {
        subDelta.drawingTop = subLayer?.drawingTop ?? null
        subChanged = true
      }

      if (subChanged) {
        subLayerDeltas.push(subDelta)
      }
    }

    if (subLayerDeltas.length > 0) {
      delta.subLayers = subLayerDeltas
      changed = true
    }
  }

  return changed ? delta : null
}

/* ------- Child save handler: validate snapshot then persist ------- */
function onSaveLayer(payload) {
  // payload: { index, layer }
  if (!payload || typeof payload.index !== 'number') return
  const idx = payload.index
  const newLayer = payload.layer
  // ensure we still have a focusedPart and the snapshot hasn't changed
  if (!part.value) {
    console.warn('[PartInspectorPanel] no focusedPart when saving layer')
    return
  }
  const currentKey = buildPartKey(part.value)
  if (currentKey !== focusedPartKey.value) {
    console.warn('[PartInspectorPanel] focusedPart changed during edit — discard or re-open editor')
    // Optionally: refresh local entries from store and notify user.
    // For now, resync local snapshot to current focusedPart.
    try {
      const latest = store.translateFocusedPartToLayers() || []
      layerEntriesLocal.value = JSON.parse(JSON.stringify(latest))
      focusedPartKey.value = buildPartKey(part.value)
    } catch (e) { }
    return
  }

  // Defensive clone of local entries, replace index
  const copy = layerEntriesLocal.value.map((m) => (m.layerIndex === idx ? JSON.parse(JSON.stringify(newLayer)) : JSON.parse(JSON.stringify(m))))
  try {
    const previousLayer = layerEntriesLocal.value.find((entry) => Number(entry?.layerIndex) === Number(idx)) || null
    const semanticDelta = _buildLayerDeltaForSave(previousLayer, newLayer)
    const hasLayerChanged = JSON.stringify(previousLayer || {}) !== JSON.stringify(newLayer || {})

    beginLayerEditInteraction()

    if (semanticDelta) {
      store.execute({
        type: 'part.applyLayerDeltas',
        payload: { part: part.value, deltas: [semanticDelta] },
        meta: { deferCommit: true }
      })
    } else if (hasLayerChanged) {
      // Fallback bridge for unsupported edits during migration.
      store.updatePartFromLayerEntries(copy, {
        deferCommit: true,
        _fromFacade: true
      })
    }

    scheduleLayerEditInteractionCommit()

    // after update, re-sync local entries to canonical translated entries
    try {
      const latest = Array.isArray(store.translatedLayerEntries) ? store.translatedLayerEntries : []
      layerEntriesLocal.value = JSON.parse(JSON.stringify(latest))
      focusedPartKey.value = buildPartKey(store.focusedPart)
    } catch (e) { }
  } catch (e) {
    console.error('[PartInspectorPanel] save layer failed', e)
  }
}

/* ------- Layer hover blink (non-focused only) ------- */
function _cloneLayerEntries(entries) {
  try { return JSON.parse(JSON.stringify(entries || [])) } catch (e) { return [] }
}

function _collectLayerIndices(layers) {
  if (!Array.isArray(layers)) return []
  const out = []
  for (const layer of layers) {
    const idx = Number(layer?.layerIndex)
    if (Number.isFinite(idx)) out.push(idx)
  }
  return Array.from(new Set(out))
}

function _isAnyLayerFocused(layerIndices, stackIndex, partIndex) {
  for (const idx of layerIndices) {
    if (store.isLayerFocused({ stackIndex, partIndex, layerIndex: idx })) {
      return true
    }
  }
  return false
}

function _collectBlinkOpacityDeltas(context, visible) {
  if (!context) return []

  const indicesSet = new Set(context.layerIndices || [])
  if (indicesSet.size === 0) return []

  const sourceEntries = Array.isArray(context.sourceLayerEntries) ? context.sourceLayerEntries : []
  const opacityMap = context.originalOpacityMap instanceof Map ? context.originalOpacityMap : new Map()
  const deltasByLayer = new Map()

  const upsert = (layerIndex, sourceOpacity) => {
    const numericLayerIndex = Number(layerIndex)
    if (!Number.isFinite(numericLayerIndex) || !indicesSet.has(numericLayerIndex)) return

    if (!opacityMap.has(numericLayerIndex)) {
      opacityMap.set(numericLayerIndex, sourceOpacity ?? 1)
    }

    const targetOpacity = visible ? (opacityMap.get(numericLayerIndex) ?? 1) : 0
    deltasByLayer.set(numericLayerIndex, {
      layerIndex: numericLayerIndex,
      opacity: targetOpacity
    })
  }

  for (const entry of sourceEntries) {
    upsert(entry?.layerIndex, entry?.opacity)
    if (Array.isArray(entry?.subLayers)) {
      for (const sub of entry.subLayers) {
        upsert(sub?.layerIndex, sub?.opacity)
      }
    }
  }

  return Array.from(deltasByLayer.values())
}

function _buildLayerHoverBlinkAppearance(context, visible) {
  if (!context) return null
  const { stackIndex, partIndex, layerIndices } = context
  if (!Number.isFinite(stackIndex) || !Number.isFinite(partIndex)) return null
  const indicesSet = new Set(layerIndices || [])
  if (indicesSet.size === 0) return null

  const blinkDeltas = _collectBlinkOpacityDeltas(context, visible)
  if (!blinkDeltas.length) return null

  const renderStacks = (store.stacks || []).map((el, si) => {
    const data = Array.isArray(el?.data) ? el.data : []
    const nextData = data.map((p, pi) => {
      if (si !== stackIndex || pi !== partIndex) return p
      const asset = (typeof store.resolveAssetForPart === 'function') ? store.resolveAssetForPart(p) : null
      const patched = applyLayerDeltasToPart(p, blinkDeltas, { asset })
      return patched?.changed && patched?.part ? patched.part : p
    })
    return { data: nextData, filterList: Array.isArray(el?.filterList) ? el.filterList : [] }
  })

  const unexpanded = {
    data: AssetApi.stackOutfitData(renderStacks),
    type: 'outfit'
  }
  return Palette.expandedAppearanceForRendering(unexpanded, store.paletteMap)
}

function _applyLayerHoverBlinkFrame(context, visible) {
  const appearance = _buildLayerHoverBlinkAppearance(context, visible)
  if (!appearance) return
  
  // Update the layer blink preview on the stack (priority 1: lower than asset hover to avoid interrupting asset selection)
  const previewId = `layer-blink-${context.stackIndex}-${context.partIndex}`
  store.pushPreview(previewId, 1, appearance, 'layer-blink')
}

function startLayerHoverBlink(layerIndices) {
  if (DISABLE_LAYER_HOVER_BLINK) {
    stopLayerHoverBlink()
    return
  }
  if (!hasPart.value || !Array.isArray(layerIndices) || layerIndices.length === 0) return
  const stackIndex = Number(focusedPartIndex.value?.stackIndex)
  const partIndex = Number(focusedPartIndex.value?.partIndex)
  if (!Number.isFinite(stackIndex) || !Number.isFinite(partIndex)) return

  const uniqueIndices = Array.from(new Set(layerIndices.filter(v => Number.isFinite(Number(v))).map(Number)))
  if (uniqueIndices.length === 0) return
  if (_isAnyLayerFocused(uniqueIndices, stackIndex, partIndex)) return

  const current = layerHoverBlinkState.value
  if (current && current.stackIndex === stackIndex && current.partIndex === partIndex) {
    const same = (current.layerIndices || []).length === uniqueIndices.length &&
      (current.layerIndices || []).every((v, i) => v === uniqueIndices[i])
    if (same) return
  }

  stopLayerHoverBlink()

  const sourceEntries = Array.isArray(layerEntriesLocal.value) ? layerEntriesLocal.value : []
  const context = {
    stackIndex,
    partIndex,
    layerIndices: uniqueIndices,
    sourceLayerEntries: _cloneLayerEntries(sourceEntries),
    originalOpacityMap: new Map(),
    visible: true
  }
  layerHoverBlinkState.value = context

  context.visible = false
  _applyLayerHoverBlinkFrame(context, context.visible)

  layerHoverBlinkTimerId.value = hostWindow.setInterval(() => {
    const latest = layerHoverBlinkState.value
    if (!latest) return
    
    // Stop blinking if a higher priority preview (asset-hover) becomes active
    if (store.isPreviewActive && store.isPreviewActive('asset-hover')) {
      stopLayerHoverBlink()
      return
    }
    
    latest.visible = !latest.visible
    _applyLayerHoverBlinkFrame(latest, latest.visible)
  }, 260)
}

function stopLayerHoverBlink() {
  const timerId = layerHoverBlinkTimerId.value
  if (timerId !== null) {
    hostWindow.clearInterval(timerId)
    layerHoverBlinkTimerId.value = null
  }
  const context = layerHoverBlinkState.value
  layerHoverBlinkState.value = null
  if (!context) return
  
  // Remove layer blink preview from stack
  const previewId = `layer-blink-${context.stackIndex}-${context.partIndex}`
  store.popPreview(previewId)
}

function onSingleLayerMouseEnter(layer) {
  const idx = Number(layer?.layerIndex)
  if (!Number.isFinite(idx)) return
  const stackIndex = Number(focusedPartIndex.value?.stackIndex)
  const partIndex = Number(focusedPartIndex.value?.partIndex)
  if (Number.isFinite(stackIndex) && Number.isFinite(partIndex) &&
      store.isLayerFocused({ stackIndex, partIndex, layerIndex: idx })) {
    stopLayerHoverBlink()
    return
  }
  startLayerHoverBlink([idx])
}

function onLayerGroupMouseEnter(layers) {
  const indices = _collectLayerIndices(layers)
  if (!indices.length) return
  const stackIndex = Number(focusedPartIndex.value?.stackIndex)
  const partIndex = Number(focusedPartIndex.value?.partIndex)
  if (Number.isFinite(stackIndex) && Number.isFinite(partIndex) && _isAnyLayerFocused(indices, stackIndex, partIndex)) {
    stopLayerHoverBlink()
    return
  }
  startLayerHoverBlink(indices)
}

function onLayerHoverLeave() {
  stopLayerHoverBlink()
}

/* ------- Utilities / misc actions ------- */
function ensureArray(v) { if (v === undefined || v === null) return []; return Array.isArray(v) ? v : [v] }
function shortJson(obj) { try { return JSON.stringify(obj, null, 2) } catch (e) { return String(obj) } }

function formatOpacityPercent(v) {
  let n = null
  if (typeof v === 'number') n = v
  else if (typeof v === 'string') n = parseFloat(v)
  if (Number.isNaN(n) || n === null) return ''
  if (n <= 1) n = n * 100
  n = Math.max(0, Math.min(100, n))
  return Math.round(n) + '%'
}

/* ------- computed descriptions ------- */
const partDescription = computed(() => {
  if (!part.value) return t('partInspector.unnamed')
  const asset = (typeof store.resolveAssetForPart === 'function') ? store.resolveAssetForPart(part.value) : null
  if (asset) return asset.Description || asset.Desc || asset.description || t('partInspector.unnamed')
  const groupDesc = (typeof store.getGroupDescriptionForPart === 'function') ? store.getGroupDescriptionForPart(part.value) : null
  return part.value.Asset?.Description || groupDesc || t('partInspector.unnamed')
})
const groupDescription = computed(() => {
  if (!part.value) return t('partInspector.noGroup')
  const groupDesc = (typeof store.getGroupDescriptionForPart === 'function') ? store.getGroupDescriptionForPart(part.value) : null
  return groupDesc || part.value.Asset?.Group?.Description || t('partInspector.noGroup')
})

/* ------- Multi-selection methods ------- */
function toggleSelectionMode() {
  store.toggleSelectionMode()
}

function selectAll() {
  store.selectAllLayers()
}

function clearSelection() {
  store.clearLayerSelection()
}

/* ------- Keyboard shortcuts ------- */
function handleKeydown(e) {
  // Ctrl/Cmd + A: Select all
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
    if (isMultiMode.value && hasPart.value) {
      e.preventDefault()
      selectAll()
    }
  }
  
  // Ctrl/Cmd + D: Clear selection
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
    if (isMultiMode.value && hasSelections.value) {
      e.preventDefault()
      clearSelection()
    }
  }
  
  // Escape: Exit multi-selection mode or clear selection
  if (e.key === 'Escape') {
    if (hasSelections.value) {
      clearSelection()
    } else if (isMultiMode.value) {
      store.toggleSelectionMode()
    }
  }
}

onBeforeUnmount(() => {
  clearLayerEditCommitTimer()
  const committed = commitLayerEditInteraction()
  if (!committed) {
    store.forceEndRealtimeScope?.('editor', {
      commit: true,
      interactionKind: 'layer-edit'
    })
  }
  stopLayerHoverBlink()
})
</script>

<style scoped>
/* Tokens */
.inspector-panel {
  --bg: var(--color-bg-base);
  --panel-border: var(--color-border-base);
  --header-bg: transparent;
  --accent: var(--color-selection-single);
  --muted: var(--color-text-muted);
  --label: var(--color-text-secondary);
  --text: var(--color-text-primary);
  padding-left: 8px;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
}

/* Header */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-right: 8px;
}

.header h4 {
  margin: 0;
  font-size: 16px;
  color: var(--color-text-primary);
  font-weight: 700;
}

.header .actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header .actions button {
  box-sizing: border-box;
  padding: 8px 12px;
  height: 36px;
  min-width: 64px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-light);
  background: var(--color-bg-base);
  cursor: pointer;
  font-size: 13px;
  color: var(--text);
  transition: background 0.08s, border-color 0.08s;
}

.header .actions button.small {
  min-width: 56px;
  padding: 6px 10px;
  font-size: 13px;
}

.header .actions button.mode-toggle-btn {
  padding: 6px 10px;
  font-size: 16px;
  min-width: 40px;
  background: linear-gradient(180deg, var(--color-bg-surface), var(--color-bg-base));
  border-color: var(--color-panel-glassmorphism-border);
}

.header .actions button.mode-toggle-btn.active {
  background: linear-gradient(135deg, var(--color-panel-glassmorphism-gradient-start), var(--color-panel-glassmorphism-gradient-end));
  border-color: var(--color-selection-multi-border);
  color: var(--color-accent-purple);
}

.header .actions button:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-border-focus);
}

.header .actions button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.mode-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-right: 8px;
}

.mode-chip {
  padding: 4px 10px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md, 8px);
  font-size: 12px;
  color: var(--color-text-secondary);
  background: var(--color-bg-base);
  cursor: pointer;
  transition: all 0.15s ease;
}

.mode-chip:not(.scope):hover:not(:disabled) {
  background: var(--color-bg-hover);
  border-color: var(--color-border-base);
}

.mode-chip:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.mode-chip.active {
  color: var(--color-text-primary);
  border-color: var(--color-border-focus);
  background: var(--color-bg-surface);
}

.mode-chip.scope {
  margin-left: auto;
  color: var(--color-text-primary);
  border-color: var(--color-selection-multi-border);
  background: var(--color-selection-multi-bg);
  cursor: default;
}

/* Body */
.body {
  flex: 1;
  overflow: auto;
  padding: 10px;
  border-radius: var(--radius-md, 8px);
  background: var(--color-bg-base);
  border: 1px solid var(--panel-border);
  box-sizing: border-box;
}

.placeholder {
  color: var(--muted);
  padding: 12px;
  text-align: center;
  font-size: 14px;
}

.stage-hint {
  margin-bottom: 12px;
  border: 1px solid var(--color-border-base, #e2e8f0);
  border-radius: var(--radius-md, 8px);
  padding: 10px;
  background: var(--color-bg-surface, #f8fafc);
}

.stage-hint-replace {
  border-color: var(--color-selection-single, #417aed);
  background: var(--color-selection-single-bg, #edf4ff);
}

.stage-hint-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-primary, #0f172a);
}

.stage-hint-text {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-text-secondary, #475569);
}

.stage-hint-btn {
  margin-top: 8px;
  height: 30px;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--color-selection-single, #417aed);
  background: var(--color-bg-base, #fff);
  color: var(--color-selection-single, #417aed);
  padding: 0 10px;
  font-size: 12px;
  cursor: pointer;
}

.stage-hint-btn:hover {
  background: var(--color-bg-hover, #f1f5f9);
}

/* Rows */
.row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.row label {
  width: 96px;
  flex: 0 0 96px;
  font-weight: 600;
  color: var(--label);
  font-size: 12px;
  box-sizing: border-box;
}

.row .val {
  flex: 1;
  font-size: 13px;
  color: var(--text);
  word-break: break-word;
}

/* Edit box: align input + action buttons */
.edit-box {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  color: var(--color-text-primary);
}

/* Inputs */
.edit-input {
  padding: 8px 10px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-base);
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;
  min-width: 140px;
  max-width: 360px;
  box-sizing: border-box;
  background: var(--color-bg-base);
  transition: border-color 0.08s, box-shadow 0.08s;
}

.edit-option {
  font-size: 13px;
  color: var(--color-text-primary);
  background: var(--color-bg-base);
}

.edit-input:focus {
  border-color: var(--color-border-focus);
  background: var(--color-bg-base);
  box-shadow: 0 0 0 2px var(--color-selection-single-bg);
}

.text-limit {
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1;
}

/* tiny action buttons: consistent with ColorableLayer */
.tiny-edit,
.tiny-save,
.tiny-cancel {
  box-sizing: border-box;
  height: 34px;
  min-width: 56px;
  padding: 6px 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-base);
  background: var(--color-bg-base);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}

.tiny-edit {
  background: var(--color-bg-surface);
  color: var(--accent);
  border-color: var(--color-selection-single-border);
}

.tiny-save {
  background: rgba(16, 185, 129, 0.1);
  color: var(--color-success);
  border-color: var(--color-success);
}

.tiny-cancel {
  background: var(--color-error-bg);
  color: var(--color-error);
  border-color: var(--color-error);
}

.tiny-edit:hover {
  background: var(--color-interactive-hover);
}

.tiny-save:hover {
  background: rgba(16, 185, 129, 0.2);
}

.tiny-cancel:hover {
  background: rgba(239, 68, 68, 0.2);
}

/* Colorgroup list spacing */
.colorgroup-list {
  margin: 8px 0 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Property blocks */
.prop-block {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border-base);
}

.prop-title {
  font-weight: 700;
  color: var(--color-text-primary);
  margin-bottom: 8px;
  font-size: 13px;
}

/* KV list */
.prop-sub {
  margin-bottom: 10px;
}

.sub-title {
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
  font-size: 12px;
}

.kv-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.kv {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 8px;
  background: var(--color-bg-base);
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-base);
  box-sizing: border-box;
}

.k {
  font-weight: 600;
  color: var(--color-text-primary);
  width: 120px;
  flex: 0 0 120px;
  font-size: 12px;
}

.v {
  color: var(--color-text-primary);
  font-size: 13px;
  text-align: right;
  flex: 1;
}

/* craft json */
.craft-json {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Courier New", monospace;
  font-size: 12px;
  padding: 10px;
  background: var(--color-bg-panel);
  color: var(--color-text-primary);
  border-radius: var(--radius-md, 8px);
  overflow: auto;
  max-height: 240px;
}

/* Muted text */
.muted {
  color: var(--color-text-muted);
  font-style: italic;
}

/* Accessibility: focus without layout shift */
button:focus,
.tiny-edit:focus,
.tiny-save:focus,
.tiny-cancel:focus,
.header .actions button:focus {
  outline: none;
  box-shadow: 0 0 0 4px var(--color-selection-single-bg);
  border-color: var(--color-border-focus);
}

/* Responsive tweaks */
@media (max-width: 640px) {
  .row label {
    width: 72px;
    flex-basis: 72px;
  }

  .k {
    width: 96px;
    flex-basis: 96px;
  }

  .edit-input {
    min-width: 110px;
    max-width: 220px;
  }

  .header h4 {
    font-size: 15px;
  }

  .header .actions button {
    min-width: 52px;
    padding: 6px 8px;
    height: 34px;
    font-size: 13px;
  }
}
</style>