<template>
  <div class="inspector-panel" role="region" :aria-label="t('partInspector.ariaLabel')">
    <div class="header">
      <h4>{{ t('partInspector.title') }}</h4>
      <div class="actions">
        <!--button @click="copyPart" :disabled="!hasPart" :title="t('partInspector.copyTitle')">复制</button-->
        <!--button @click="downloadPart" :disabled="!hasPart" :title="t('partInspector.downloadTitle')">下载</button-->
        <!--button v-if="hasPart" class="small" @click="clearFocus" :title="t('partInspector.clearFocusTitle')">清除</button-->
      </div>
    </div>

    <div class="body  scrollable">
      <div v-if="!hasPart" class="placeholder">{{ t('partInspector.noPartPlaceholder') }}</div>

      <div v-else class="content">
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

        <!-- Layers: 使用子组件展示每个 main layer（基于 local 副本） -->
        <div class="colorgroup-list">
          <template v-if="layerEntriesLocal && layerEntriesLocal.length">
            <ColorableLayer v-for="(m, mi) in layerEntriesLocal"
              :key="m._key || (m.name || mi)"
              :layer="m"
              :part="part"
              :stackIndex="store.focusedPartIndex?.stackIndex ?? 0"
              :partIndex="store.focusedPartIndex?.partIndex ?? 0"
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
import { hostWindow, setTimeoutHost } from '@/utils/host-window.js'

const { t } = useI18n()

const store = useStudioStore()
const part = computed(() => store.focusedPart)
const updateFlag = computed(() => store.focusedPartUpdateFlag)
const hasPart = computed(() => !!part.value)

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
  const copy = layerEntriesLocal.value.map((m, i) => (i === idx ? JSON.parse(JSON.stringify(newLayer)) : JSON.parse(JSON.stringify(m))))
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

/* ------- copy / download / clear ------- */
/* async function copyPart() {
  if (!part.value) return
  const text = JSON.stringify(part.value, null, 2)
  try {
    await navigator.clipboard.writeText(text)
    console.info('Part JSON copied')
  } catch (e) {
    const ta = doc.createElement('textarea')
    ta.value = text
    doc.body.appendChild(ta)
    ta.select()
    doc.execCommand('copy')
    ta.remove()
  }
}
function downloadPart() {
  if (!part.value) return
  const data = JSON.stringify(part.value, null, 2)
  const blob = new Blob([data], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = doc.createElement('a')
  const name = (part.value?.Description ? part.value.Description.replace(/[^\w\-_.]/g, '_') : 'part') + '.json'
  a.href = url
  a.download = name
  doc.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
function clearFocus() { store.clearFocus() } */

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
</script>

<style scoped>
/* Tokens */
.inspector-panel {
  --bg: #fff;
  --panel-border: rgba(220, 230, 240, 0.6);
  --header-bg: transparent;
  --accent: #417aed;
  --muted: #7d8795;
  --label: #46536b;
  --text: #23324a;
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
  color: #21314a;
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
  border: 1px solid rgba(230, 238, 246, 0.9);
  background: #fff;
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

.header .actions button:hover {
  background: #f5f8fb;
  border-color: #cfe0fb;
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
  background: linear-gradient(180deg, #fff, #fbfdff);
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
}

/* Inputs */
.edit-input {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #cfd9e6;
  font-size: 13px;
  outline: none;
  min-width: 140px;
  max-width: 360px;
  box-sizing: border-box;
  background: #fff;
  transition: border-color 0.08s, box-shadow 0.08s;
}

.edit-input:focus {
  border-color: rgba(96, 155, 255, 0.55);
  background: linear-gradient(180deg, #fff, #fbfdff);
  box-shadow: 0 0 0 4px rgba(96, 155, 255, 0.08);
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
  border: 1px solid rgba(220, 230, 240, 0.9);
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}

.tiny-edit {
  background: linear-gradient(180deg, #fbfdff, #fff);
  color: var(--accent);
  border-color: rgba(65, 122, 237, 0.12);
}

.tiny-save {
  background: #e9fce8;
  color: #138524;
  border-color: rgba(20, 160, 80, 0.12);
}

.tiny-cancel {
  background: #fff6f6;
  color: #c22;
  border-color: rgba(212, 63, 63, 0.10);
}

.tiny-edit:hover {
  background: #f0f6ff;
}

.tiny-save:hover {
  background: #e6f9e6;
}

.tiny-cancel:hover {
  background: #fff2f2;
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
  border-top: 1px dashed rgba(200, 210, 230, 0.6);
}

.prop-title {
  font-weight: 700;
  color: #223047;
  margin-bottom: 8px;
  font-size: 13px;
}

/* KV list */
.prop-sub {
  margin-bottom: 10px;
}

.sub-title {
  font-weight: 600;
  color: #3b4a63;
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
  background: #fafcff;
  border-radius: 8px;
  border: 1px solid rgba(220, 230, 240, 0.6);
  box-sizing: border-box;
}

.k {
  font-weight: 600;
  color: #1f334a;
  width: 120px;
  flex: 0 0 120px;
  font-size: 12px;
}

.v {
  color: #223047;
  font-size: 13px;
  text-align: right;
  flex: 1;
}

/* craft json */
.craft-json {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Courier New", monospace;
  font-size: 12px;
  padding: 10px;
  background: #0f1720;
  color: #dbeafe;
  border-radius: 8px;
  overflow: auto;
  max-height: 240px;
}

/* Muted text */
.muted {
  color: #9aa3b2;
  font-style: italic;
}

/* Accessibility: focus without layout shift */
button:focus,
.tiny-edit:focus,
.tiny-save:focus,
.tiny-cancel:focus,
.header .actions button:focus {
  outline: none;
  box-shadow: 0 0 0 4px rgba(96, 155, 255, 0.08);
  border-color: rgba(96, 155, 255, 0.45);
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