<template>
  <div class="inspector-panel" role="region" :aria-label="t('partInspector.ariaLabel')" @keydown="handleKeydown">
    <div class="header">
      <h4>{{ t('partInspector.title') }}</h4>
      <div class="actions">
        <!-- Preview tool toggle >
        <button 
          v-if="hasPart"
          class="mode-toggle-btn" 
          :class="{ active: isMoveTool }"
          @click="togglePreviewTool" 
          :disabled="!canUseMoveTool"
          :title="isMoveTool ? t('partInspector.viewMode') : t('partInspector.moveMode')"
        >
          <span v-if="isMoveTool">✥</span>
          <span v-else>✋</span>
        </button>
        
        <!-- Multi-selection mode toggle -->
        <button 
          v-if="hasPart"
          class="mode-toggle-btn" 
          :class="{ active: isMultiMode }"
          @click="toggleSelectionMode" 
          :title="isMultiMode ? (t('partInspector.singleMode') || 'Single mode') : (t('partInspector.multiMode') || 'Multi-select mode')"
        >
          <span v-if="isMultiMode">☑</span>
          <span v-else>☐</span>
        </button>
        
        <!-- Multi-mode actions -->
        <template v-if="isMultiMode && hasPart">
          <button 
            class="small" 
            @click="selectAll" 
            :title="t('partInspector.selectAll') || 'Select All (Ctrl+A)'"
          >
            {{ t('partInspector.selectAllBtn') || 'All' }}
          </button>
          <button 
            class="small" 
            @click="clearSelection" 
            :title="t('partInspector.clearSelection') || 'Clear Selection (Ctrl+D)'"
            :disabled="!hasSelections"
          >
            {{ t('partInspector.clearBtn') || 'Clear' }}
          </button>
        </template>
      </div>
    </div>

    <div class="body  scrollable">
      <div v-if="!hasPart" class="placeholder">{{ t('partInspector.noPartPlaceholder') }}</div>

      <div v-else class="content">
        <!-- Batch Edit Panel (shown when multiple layers selected) -->
        <BatchEditPanel v-if="isMultiMode" />
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
        <template v-if="modularOptions && modularOptions.length > 0">
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
        <div v-if="typedOptions.length > 0" class="row">
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

        <!-- Layers: 使用子组件展示每个 main layer（基于 local 副本） -->
        <div class="colorgroup-list">
          <template v-if="layerEntriesLocal && layerEntriesLocal.length">
            <ColorableLayer v-for="(m, mi) in layerEntriesLocal"
              :key="m._key || (m.name || mi)"
              :layer="m"
              :part="part"
              :stackIndex="store.focusedPartIndex?.stackIndex ?? 0"
              :partIndex="store.focusedPartIndex?.partIndex ?? 0"
              :selectionMode="store.selectionMode"
              @save-layer="onSaveLayer" />
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

        <!-- Properties 与 Craft 保持展示（只读） -->
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
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStudioStore } from '@/stores/studioStore'
import ColorableLayer from './ColorableLayer.vue'
import BatchEditPanel from './BatchEditPanel.vue'
import { hostWindow, setTimeoutHost, doc } from '@/utils/host-window.js'
import { AssetApi } from '@/utils/AssetApi'

const { t } = useI18n()

const store = useStudioStore()
const part = computed(() => store.focusedPart)
const updateFlag = computed(() => store.focusedPartUpdateFlag)
const hasPart = computed(() => !!part.value)

// Multi-selection state
const isMultiMode = computed(() => store.selectionMode === 'multiple')
const hasSelections = computed(() => store.selectedLayers && store.selectedLayers.length > 0)

// Preview tool state
const isMoveTool = computed(() => store.previewTool === 'move')
const canUseMoveTool = computed(() => store.canUseMoveTool)

function togglePreviewTool() {
  store.togglePreviewTool()
}

/*
  Key fix:
  - maintain layerEntriesLocal per focusedPart snapshot
  - each save checks focusedPart hasn't changed (by comparing a partKey)
*/
const layerEntriesLocal = ref([])            // local deep-cloned copy used by children
const focusedPartKey = ref(null)             // snapshot key for current focusedPart

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

  // Prefer part.layerEntries attached in stacks if present and non-empty.
  let entries = null
  try {
    if (Array.isArray(p.layerEntries) && p.layerEntries.length) {
      // deep clone to avoid prop mutation
      entries = JSON.parse(JSON.stringify(p.layerEntries))
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
  refreshFunction(part.value)
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

  // Use the store's property update method which handles refresh
  store._updateFocusedPartProperty('Property', newProp)
  
  // Force a full update cycle to ensure layers and preview catch up
  store.RebuildAllStacksLayerEntriesFromParts()
  store.refreshMergedAppearanceData()
}

/* ------- Modular Asset Logic (New) ------- */
const modularOptions = ref(null)

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
  
  // Update store and trigger refresh
  store._updateFocusedPartProperty('Property', newProp)
  store.RebuildAllStacksLayerEntriesFromParts()
  store.refreshMergedAppearanceData()
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
  const updated = { ...part.value, Description: desc }
  if (updated.Asset && typeof updated.Asset === 'object') {
    updated.Asset = { ...updated.Asset, Description: desc }
  }
  store.focusPart(updated)
  try { store.translateFocusedPartToLayers() } catch (e) { }
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
  const updated = { ...part.value, Group: g }
  if (updated.Asset && typeof updated.Asset === 'object') {
    updated.Asset = { ...updated.Asset, Group: { ...(updated.Asset.Group || {}), Name: g } }
  }
  store.focusPart(updated)
  try { store.translateFocusedPartToLayers() } catch (e) { }
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
  // persist via store; updatePartFromLayerEntries will reconstruct part & update stacks/focusedPart
  try {
    store.updatePartFromLayerEntries(copy)
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
  border-radius: 8px;
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

/* Body */
.body {
  flex: 1;
  overflow: auto;
  padding: 10px;
  border-radius: 8px;
  background: linear-gradient(180deg, var(--color-bg-base), var(--color-bg-surface));
  border: 1px solid var(--panel-border);
  box-sizing: border-box;
}

.placeholder {
  color: var(--muted);
  padding: 12px;
  text-align: center;
  font-size: 14px;
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
  border-radius: 8px;
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
  background: linear-gradient(180deg, var(--color-bg-base), var(--color-bg-surface));
  box-shadow: 0 0 0 4px var(--color-selection-single-bg);
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
  border-radius: 8px;
  border: 1px solid var(--color-border-base);
  background: var(--color-bg-base);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}

.tiny-edit {
  background: linear-gradient(180deg, var(--color-bg-surface), var(--color-bg-base));
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
  border-top: 1px dashed var(--color-border-base);
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
  background: var(--color-bg-surface);
  border-radius: 8px;
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
  border-radius: 8px;
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