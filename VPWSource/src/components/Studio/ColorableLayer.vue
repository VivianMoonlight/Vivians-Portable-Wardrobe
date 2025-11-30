<template>
  <div class="color-main-block" :data-focused="isFocused ? '1' : '0'">
    <div class="color-main-header" @click="toggleCollapse">
      <span class="color-main-title" :title="layerLocal.name">
        {{ layerLocal.displayName || layerLocal.name || ("#" + (displayIndex + 1)) }}
      </span>
      <span class="fold-arrow" :class="{ collapsed: collapsed }" v-if="hasSublayers">
        {{ collapsed ? "▸" : "▾" }}
      </span>
    </div>

    <div class="color-main-body">
      <!-- Color (editable if colorable) -->
      <div class="color-row edit-box" @mousedown.stop="selectProperty('color')">
        <label>{{ t('colorableLayer.color') }}</label>
        <div class="val">
          <template v-if="layerLocal.isColorable">

            <span v-if="layerLocal.colorCss" class="color-chip" :style="{ background: layerLocal.colorCss }">{{
              layerLocal.colorText }}</span>
            <span v-else-if="layerLocal.colorText" class="color-text">{{ layerLocal.colorText }}</span>
            <span v-else class="muted">{{ t('colorableLayer.default') }}</span>

            <button
              class="tiny-palette right-action"
              :class="{ active: isPaletteSelected }"
              @mousedown.stop.prevent="togglePaletteForEntry"
              :title="t('colorableLayer.paletteTitle')"
            >
              🎨
            </button>

          </template>
          <template v-else>
            <span class="muted">{{ t('colorableLayer.default') }}</span>
          </template>
        </div>
      </div>

      <!-- Opacity (click anywhere to edit) -->
      <div class="color-row edit-box" @mousedown.stop="selectProperty('opacity')">
        <label>{{ t('colorableLayer.opacity') }}</label>
        <div class="val" @click.stop="startEditOpacity">
          <template v-if="editingOpacity">
            <input v-model.number="tmpOpacity" @keydown.enter="saveOpacity" @keydown.esc="cancelOpacity"
              @blur="saveOpacity" class="edit-input" type="number" min="0" max="100" step="1" style="width:90px" />
            <button class="tiny-save" @mousedown.stop.prevent="saveOpacity" :title="t('colorableLayer.opacity')">✓</button>
            <button class="tiny-cancel" @mousedown.stop.prevent="cancelOpacity" :title="t('colorableLayer.default')">✗</button>
            <button v-if="hasSublayers" class="tiny-link right-action" :class="{ active: linkedOpacity }"
              :title="t('colorableLayer.linkedOpacityTitle')" @mousedown.stop.prevent="toggleLinkedOpacity"
              @click.stop.prevent>⛓</button>
          </template>
          <template v-else>
            <span v-if="layerLocal.opacity !== null && layerLocal.opacity !== undefined">{{
              formatOpacity(layerLocal.opacity) }}</span>
            <span v-else class="muted">—</span>
            <button v-if="hasSublayers" class="tiny-link right-action" :class="{ active: linkedOpacity }"
              :title="t('colorableLayer.linkedOpacityTitle')" @mousedown.stop.prevent="toggleLinkedOpacity"
              @click.stop.prevent>⛓</button>
          </template>
        </div>
      </div>

      <!-- Offset combined row: Drawing Left & Top merged; click to edit -->
      <div class="color-row">
        <label>{{ t('colorableLayer.offset') }}</label>
        <div class="val" @click.stop="startEditDrawing">
          <template v-if="editingDrawing">
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
              <div style="display:flex; gap:6px; align-items:center;">
                <span class="offset-item">{{ t('colorableLayer.offsetX') }}</span>
                <input v-model="tmpDrawingLeft" @keydown.enter="saveDrawing" @keydown.esc="cancelDrawing"
                  class="edit-input" type="number" style="width:110px" />
              </div>
              <div style="display:flex; gap:6px; align-items:center;">
                <span class="offset-item">{{ t('colorableLayer.offsetY') }}</span>
                <input v-model="tmpDrawingTop" @keydown.enter="saveDrawing" @keydown.esc="cancelDrawing"
                  class="edit-input" type="number" style="width:110px" />
              </div>
              <button class="tiny-save" @mousedown.stop.prevent="saveDrawing" :title="t('colorableLayer.offset')">✓</button>
              <button class="tiny-cancel" @mousedown.stop.prevent="cancelDrawing" :title="t('colorableLayer.default')">✗</button>
              <button v-if="hasSublayers" class="tiny-link right-action" :class="{ active: linkedOffset }"
                :title="t('colorableLayer.linkedOffsetTitle')" @mousedown.stop.prevent="toggleLinkedOffset"
                @click.stop.prevent>⛓</button>
            </div>
          </template>
          <template v-else>
            <template
              v-if="(layerLocal.drawingLeft !== undefined && layerLocal.drawingLeft !== null) || (layerLocal.drawingTop !== undefined && layerLocal.drawingTop !== null)">
              <span class="offset-item">{{ t('colorableLayer.offsetX') }} <strong>{{ layerLocal.drawingLeft !== undefined && layerLocal.drawingLeft !==
                null ? layerLocal.drawingLeft : '—' }}</strong></span>
              <span class="offset-item">{{ t('colorableLayer.offsetY') }} <strong>{{ layerLocal.drawingTop !== undefined && layerLocal.drawingTop !==
                null ? layerLocal.drawingTop : '—' }}</strong></span>
            </template>
            <template v-else>
              <span class="muted">—</span>
            </template>
            <button v-if="hasSublayers" class="tiny-link right-action" :class="{ active: linkedOffset }"
              :title="t('colorableLayer.linkedOffsetTitle')" @mousedown.stop.prevent="toggleLinkedOffset"
              @click.stop.prevent>⛓</button>
          </template>
        </div>
      </div>

      <!-- Priority (click to edit, keep Reset) -->
      <div class="color-row">
        <label>{{ t('colorableLayer.priority') }}</label>
        <div class="val">
          <template v-if="editingPriority">
            <input v-model="tmpPriority" @keydown.enter="savePriority" @keydown.esc="cancelPriority"
              @blur="savePriority" class="edit-input" type="number" style="width:90px" />
            <button class="tiny-save" @mousedown.stop.prevent="savePriority" :title="t('colorableLayer.priority')">✓</button>
            <button class="tiny-cancel" @mousedown.stop.prevent="cancelPriority" :title="t('colorableLayer.default')">✗</button>
          </template>
          <template v-else>
            <template
              v-if="(layerLocal.overridePriority !== undefined && layerLocal.overridePriority !== null) || (layerLocal.defaultPriority !== undefined && layerLocal.defaultPriority !== null)">
              <span class="priority-badge" :class="{ blue: priorityIsBlue, yellow: !priorityIsBlue }"
                @click.stop="startEditPriority" :title="priorityTitle">
                {{ displayPriority }}
              </span>
              <button class="tiny-reset" v-if="canResetPriority" @mousedown.stop.prevent="resetPriority" :title="t('colorableLayer.resetPriorityTitle')">↺</button>
            </template>
            <template v-else>
              <span class="muted">—</span>
            </template>
          </template>
        </div>
      </div>
    </div>

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
              <span
                v-if="(s.drawingLeft !== undefined && s.drawingLeft !== null) || (s.drawingTop !== undefined && s.drawingTop !== null)">
                <span class="offset-item">{{ t('colorableLayer.offsetX') }} <strong>{{ s.drawingLeft !== undefined && s.drawingLeft !== null ?
                  s.drawingLeft : '—' }}</strong></span>
                <span class="offset-item">{{ t('colorableLayer.offsetY') }} <strong>{{ s.drawingTop !== undefined && s.drawingTop !== null ?
                  s.drawingTop :
                  '—' }}</strong></span>
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

const { t } = useI18n()

const props = defineProps({
  // Backwards compatible: accept a precomputed layer entry
  layer: { type: Object, required: true },
  // New interface: accept a part reference (object returned from store.focusedPart or stack part)
  part: { type: Object, required: false },
  // partIndex / stackIndex optional metadata (helps store tracking)
  partIndex: { type: Number, required: true },
  stackIndex: { type: Number, required: true }
})
const emit = defineEmits(['save-layer'])

const store = useStudioStore()

// UI state; do NOT mutate props directly
const collapsed = ref(true)
const editingColor = ref(false)
const editingOpacity = ref(false)
const editingDrawing = ref(false)
const editingPriority = ref(false)

const tmpColor = ref('')
const tmpOpacity = ref('')
const tmpDrawingLeft = ref('')
const tmpDrawingTop = ref('')
const tmpPriority = ref('')

const linkedOpacity = ref(false)
const linkedOffset = ref(false)

const displayIndex = computed(() => {
  return layerLocal.value.layerIndex
})

/**
 * Compute layerLocal:
 * - if props.layer is provided (legacy) use it
 * - else if props.part exists and layerIndex provided -> build entries via store and pick
 */
const layerLocal = computed(() => {
  if (props.layer && typeof props.layer === 'object') {
    return props.layer
  }
  throw new Error('[ColorableLayer] layer prop is required when part-based props are not provided')
})

const hasSublayers = computed(() => Array.isArray(layerLocal.value.subLayers) && layerLocal.value.subLayers.length > 0)

watch(() => layerLocal.value, (nv) => {
  tmpColor.value = nv.colorText ?? ''
  // convert stored opacity (0..1 or 0..100) to integer percent for editing
  if (nv.opacity !== undefined && nv.opacity !== null) {
    const num = parseFloat(nv.opacity)
    if (!isFinite(num)) {
      tmpOpacity.value = ''
    } else if (num <= 1) {
      tmpOpacity.value = Math.round(num * 100)
    } else {
      tmpOpacity.value = Math.round(num)
    }
  } else {
    tmpOpacity.value = ''
  }

  tmpDrawingLeft.value = (nv.drawingLeft !== undefined && nv.drawingLeft !== null) ? nv.drawingLeft : ''
  tmpDrawingTop.value = (nv.drawingTop !== undefined && nv.drawingTop !== null) ? nv.drawingTop : ''

  // priority editable field: prefer overridePriority if exist else default
  if (nv.overridePriority !== undefined && nv.overridePriority !== null) {
    tmpPriority.value = nv.overridePriority
  } else if (nv.defaultPriority !== undefined && nv.defaultPriority !== null) {
    tmpPriority.value = nv.defaultPriority
  } else {
    tmpPriority.value = ''
  }
}, { immediate: true, deep: true })

// determine whether this layer is currently focused in store
const isFocused = computed(() => {
  const fp = store.focusedProperty
  if (!fp) return false
  // if we have uid and part reference, compare uid
  if (props.part && fp.uid && props.part._uid) return fp.uid === props.part._uid && fp.layerIndex === layerLocal.value.layerIndex
  // fallback compare layerIndex and property-less
  return fp.layerIndex === layerLocal.value.layerIndex
})

/* ------------------- editing actions ------------------- */
function toggleCollapse() { collapsed.value = !collapsed.value }

function startEditOpacity() {
  editingOpacity.value = true
  // tmpOpacity already kept in percent by watcher; ensure it's current
  if (layerLocal.value.opacity !== undefined && layerLocal.value.opacity !== null) {
    const num = parseFloat(layerLocal.value.opacity)
    tmpOpacity.value = isFinite(num) ? (num <= 1 ? Math.round(num * 100) : Math.round(num)) : ''
  } else {
    tmpOpacity.value = ''
  }
  store.setFocusedProperty({
    part: props.part || store.focusedPart,
    layerIndex: layerLocal.value.layerIndex,
    property: 'opacity'
  })
}
function saveOpacity() {
  editingOpacity.value = false
  let v = tmpOpacity.value
  if (v !== '' && v !== null && v !== undefined) {
    let num = parseInt(v, 10)
    if (!isFinite(num)) num = 100
    num = Math.max(0, Math.min(100, num))
    // convert percent to normalized 0..1 value for storage
    v = num / 100
  } else {
    v = 1
  }

  // Build new layer; if linkedOpacity, also update subLayers
  const newLayer = Object.assign({}, layerLocal.value)
  newLayer.opacity = v
  if (linkedOpacity.value && Array.isArray(newLayer.subLayers)) {
    newLayer.subLayers = newLayer.subLayers.map(s => {
      const sCopy = Object.assign({}, s)
      sCopy.opacity = v
      return sCopy
    })
  }
  emit('save-layer', { index: displayIndex.value, layer: newLayer })
  store.setFocusedProperty({
    part: props.part || store.focusedPart,
    layerIndex: layerLocal.value.layerIndex,
    property: 'opacity'
  })
}
function cancelOpacity() {
  editingOpacity.value = false
  // restore percent representation
  if (layerLocal.value.opacity !== undefined && layerLocal.value.opacity !== null) {
    const num = parseFloat(layerLocal.value.opacity)
    tmpOpacity.value = isFinite(num) ? (num <= 1 ? Math.round(num * 100) : Math.round(num)) : ''
  } else {
    tmpOpacity.value = ''
  }
}

/* Drawing (Offset) editing */
function startEditDrawing() {
  editingDrawing.value = true
  tmpDrawingLeft.value = (layerLocal.value.drawingLeft !== undefined && layerLocal.value.drawingLeft !== null) ? layerLocal.value.drawingLeft : ''
  tmpDrawingTop.value = (layerLocal.value.drawingTop !== undefined && layerLocal.value.drawingTop !== null) ? layerLocal.value.drawingTop : ''
  store.setFocusedProperty({
    part: props.part || store.focusedPart,
    layerIndex: layerLocal.value.layerIndex,
    property: 'drawing'
  })
}

function saveDrawing() {
  editingDrawing.value = false
  // convert to numbers when possible, else null
  let left = tmpDrawingLeft.value
  let top = tmpDrawingTop.value
  left = (left === '' || left === null || left === undefined) ? null : Number(left)
  top = (top === '' || top === null || top === undefined) ? null : Number(top)

  const newLayer = Object.assign({}, layerLocal.value)
  newLayer.drawingLeft = left
  newLayer.drawingTop = top
  if (linkedOffset.value && Array.isArray(newLayer.subLayers)) {
    newLayer.subLayers = newLayer.subLayers.map(s => {
      const sCopy = Object.assign({}, s)
      sCopy.drawingLeft = left
      sCopy.drawingTop = top
      return sCopy
    })
  }
  emit('save-layer', { index: displayIndex.value, layer: newLayer })
  store.setFocusedProperty({
    part: props.part || store.focusedPart,
    layerIndex: layerLocal.value.layerIndex,
    property: 'drawing'
  })
}

function cancelDrawing() {
  editingDrawing.value = false
  tmpDrawingLeft.value = (layerLocal.value.drawingLeft !== undefined && layerLocal.value.drawingLeft !== null) ? layerLocal.value.drawingLeft : ''
  tmpDrawingTop.value = (layerLocal.value.drawingTop !== undefined && layerLocal.value.drawingTop !== null) ? layerLocal.value.drawingTop : ''
}

/* Priority editing */
function startEditPriority() {
  editingPriority.value = true
  if (layerLocal.value.overridePriority !== undefined && layerLocal.value.overridePriority !== null) {
    tmpPriority.value = layerLocal.value.overridePriority
  } else if (layerLocal.value.defaultPriority !== undefined && layerLocal.value.defaultPriority !== null) {
    tmpPriority.value = layerLocal.value.defaultPriority
  } else {
    tmpPriority.value = ''
  }
  store.setFocusedProperty({
    part: props.part || store.focusedPart,
    layerIndex: layerLocal.value.layerIndex,
    property: 'priority'
  })
}

function savePriority() {
  editingPriority.value = false
  // If empty, clear override (fallback to default)
  let val = tmpPriority.value
  if (val === '' || val === null || val === undefined) {
    val = null
  } else {
    val = Number(val)
    if (!isFinite(val)) val = null
  }
  const newLayer = Object.assign({}, layerLocal.value)
  if (val === null) {
    // clear override: keep defaultPriority untouched but remove override fields
    newLayer.overridePriority = newLayer.defaultPriority || 0
    newLayer.isOverridePriority = false
  } else {
    newLayer.overridePriority = val
    newLayer.isOverridePriority = true
  }
  emit('save-layer', { index: displayIndex.value, layer: newLayer })
  store.setFocusedProperty({
    part: props.part || store.focusedPart,
    layerIndex: layerLocal.value.layerIndex,
    property: 'priority'
  })
}

function cancelPriority() {
  editingPriority.value = false
  if (layerLocal.value.overridePriority !== undefined && layerLocal.value.overridePriority !== null) {
    tmpPriority.value = layerLocal.value.overridePriority
  } else if (layerLocal.value.defaultPriority !== undefined && layerLocal.value.defaultPriority !== null) {
    tmpPriority.value = layerLocal.value.defaultPriority
  } else {
    tmpPriority.value = ''
  }
}

/* Formatting */
function formatOpacity(v) {
  let n = null
  if (typeof v === 'number') n = v
  else if (typeof v === 'string') n = parseFloat(v)
  if (Number.isNaN(n) || n === null) return ''
  if (n <= 1) n = n * 100
  n = Math.max(0, Math.min(100, n))
  return Math.round(n) + '%'
}

// select property (sets focusedProperty); used when user clicks a row
function selectProperty(propName) {
  store.setFocusedProperty({
    part: props.part || store.focusedPart,
    partIndex: props.partIndex,
    stackIndex: props.stackIndex,
    layerIndex: layerLocal.value.layerIndex,
    property: propName
  })
}

// select a sublayer property (subdrawing etc)
function selectSubProperty(subIndex, propName) {
  store.setFocusedProperty({
    part: props.part || store.focusedPart,
    layerIndex: layerLocal.value.layerIndex,
    subLayerIndex: subIndex,
    property: propName
  })
}

/* ------- Palette integration (unchanged except build function fixed) ------- */

function buildPaletteTargetList() {
  const targets = []
  try {
    const li = layerLocal.value.colorableIndex
    // prefer explicit part passed in props, otherwise try store.focusedPart
    const partObj = props.part || store.focusedPart
    const uid = partObj && partObj._uid ? partObj._uid : null
    const t = {
      uid: uid,
      stackIndex: (typeof props.stackIndex === 'number' ? props.stackIndex : null),
      partIndex: (typeof props.partIndex === 'number' ? props.partIndex : null),
      layerIndex: (typeof li === 'number' ? li : layerLocal.value.layerIndex)
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
  // If this entry is already selected in palette mode, close the panel and clear mode
  if (isPaletteSelected.value && store.paletteModeActive) {
    store.closePalettePanel()
    return
  }
  // enter palette panel and register targets
  store.openPalettePanel(targets)
}

/* ------- Priority helpers (unchanged reset logic) ------- */
const displayPriority = computed(() => {
  if (layerLocal.value.overridePriority !== undefined && layerLocal.value.overridePriority !== null) return layerLocal.value.overridePriority
  if (layerLocal.value.defaultPriority !== undefined && layerLocal.value.defaultPriority !== null) return layerLocal.value.defaultPriority
  return ''
})

const priorityIsBlue = computed(() => {
  const op = layerLocal.value.overridePriority
  const dp = layerLocal.value.defaultPriority
  if (op === undefined || op === null) {
    return true
  }
  if (dp === undefined || dp === null) {
    return true
  }
  return op === dp
})

const priorityTitle = computed(() => {
  if (layerLocal.value.overridePriority !== undefined && layerLocal.value.overridePriority !== null && layerLocal.value.defaultPriority !== undefined && layerLocal.value.defaultPriority !== null) {
    if (layerLocal.value.overridePriority === layerLocal.value.defaultPriority) return t('colorableLayer.priorityDefault')
    return t('colorableLayer.priorityOverridden')
  }
  return t('colorableLayer.priority')
})

const canResetPriority = computed(() => {
  return (layerLocal.value.defaultPriority !== undefined && layerLocal.value.defaultPriority !== null)
})

function resetPriority() {
  // build new layer where override is cleared and priority is reset to default
  const newLayer = Object.assign({}, layerLocal.value, {
    isOverridePriority: false,
    overridePriority: layerLocal.value.defaultPriority
  })
  emit('save-layer', { index: displayIndex.value, layer: newLayer })
  // keep focus on priority
  store.setFocusedProperty({
    part: props.part || store.focusedPart,
    layerIndex: layerLocal.value.layerIndex,
    property: 'priority'
  })
}

/* ------- Link toggles for batch edits ------- */
function toggleLinkedOpacity() {
  linkedOpacity.value = !linkedOpacity.value
}
function toggleLinkedOffset() {
  linkedOffset.value = !linkedOffset.value
}
</script>

<style scoped>
/* Design tokens (scoped to this component) */
.color-main-block {
  --bg: #ffffff;
  --panel-border: rgba(220, 230, 240, 0.40);
  --header-bg-a: #f4f7f9;
  --header-bg-b: #fafdff;
  --muted: #9aa3b2;
  --label: #47546d;
  --text: #23324a;
  --accent: #417aed;
  --success: #138524;
  --danger: #d43f3f;
  --chip-border: rgba(0, 0, 0, 0.06);
  border-radius: 10px;
  border: 1px solid var(--panel-border);
  background: var(--bg);
  display: flex;
  flex-direction: column;
  transition: box-shadow 0.12s ease;
  box-sizing: border-box;
}

/* Header */
.color-main-header {
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
  font-size: 14px;
  padding: 8px 12px;
  border-radius: 9px 9px 0 0;
  border-bottom: 1px dashed rgba(240, 238, 251, 0.9);
  background: linear-gradient(90deg, var(--header-bg-a) 60%, var(--header-bg-b) 100%);
}

.color-main-title {
  flex: 1;
  color: #21314a;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fold-arrow {
  font-size: 13px;
  color: #8f9aa8;
  transition: transform 0.18s ease, color 0.12s;
}

.fold-arrow.collapsed {
  transform: rotate(-90deg);
}

/* Body */
.color-main-body {
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
}

/* Row layout */
.color-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 2px;
}

.color-row label {
  width: 78px;
  flex: 0 0 78px;
  font-weight: 600;
  color: var(--label);
  font-size: 12px;
  margin-right: 4px;
  box-sizing: border-box;
}

.color-row .val {
  flex: 1;
  font-size: 13px;
  color: var(--text);
  word-break: break-word;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
}

/* Right action helper - push actions to the far right */
.right-action {
  margin-left: auto;
}

/* Offset items */
.offset-item {
  margin-right: 12px;
  color: #21314a;
  font-size: 13px;
}

/* Color chip and text */
.color-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-radius: 8px;
  color: #fff;
  font-weight: 600;
  font-size: 13px;
  border: 1px solid var(--chip-border);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-sizing: border-box;
}

/* If color chip text may become unreadable on very light backgrounds, add subtle inner shadow */
.color-chip[style*="background: #ffffff"],
.color-chip[style*="background: rgb(255, 255, 255)"] {
  color: #21314a;
  border-color: rgba(0, 0, 0, 0.06);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
}

.color-text {
  font-size: 13px;
  color: #21314a;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Palette button next to edit */



/* Input & edit controls: normalized sizes and box-sizing to avoid layout shifts */
.edit-input {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid #cfd9e6;
  font-size: 13px;
  outline: none;
  min-width: 10px;
  max-width: 70px;
  box-sizing: border-box;
  background: #fff;
  transition: background-color 0.08s, border-color 0.08s;
  color: #292929
}

.edit-input:focus {
  border-color: rgba(96, 155, 255, 0.55);
  background: linear-gradient(180deg, #fff, #fbfdff);
  box-shadow: 0 0 0 4px rgba(96, 155, 255, 0.08);
}

/* Tiny action buttons (edit/save/cancel/reset) — consistent size and spacing */
.tiny-link,
.tiny-palette,
.tiny-edit,
.tiny-save,
.tiny-cancel,
.tiny-reset {
  box-sizing: border-box;
  height: 36px;
  width: 36px;
  padding: 6px 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid rgba(222, 223, 224, 0.9);
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  user-select: none;
  transition: background 0.08s, border-color 0.08s, color 0.08s;
}


.tiny-palette.active {
  background: #ededed;
}

.tiny-edit {
  background: linear-gradient(180deg, #fbfdff, #fff);
  color: var(--accent);
  border-color: rgba(65, 122, 237, 0.12);
}

.tiny-save {
  background: #e9fce8;
  color: var(--success);
  border-color: rgba(20, 160, 80, 0.12);
}

.tiny-cancel {
  background: #fff6f6;
  color: var(--danger);
  border-color: rgba(212, 63, 63, 0.10);
}

.tiny-reset {
  background: linear-gradient(180deg, #fffaf0, #fff);
  color: #a67c00;
  border-color: rgba(200, 160, 60, 0.12);
}

/* Link toggle button used for batch apply to sublayers */
.tiny-link_old {
  box-sizing: border-box;
  height: 34px;
  min-width: 40px;
  padding: 6px 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid rgba(220, 230, 240, 0.9);
  background: #fff;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  user-select: none;
  transition: background 0.08s, border-color 0.08s, color 0.08s, box-shadow 0.08s;
}

.tiny-link.active {
  background: #ededed;
  /* border-color: rgba(131, 142, 197, 0.18); */
  /*  box-shadow: 0 4px 14px rgba(170, 140, 40, 0.06); */
}

/* Hover states: subtle, non-layout-shifting */
.tiny-edit:hover {
  background: #f0f6ff;
}

.tiny-save:hover {
  background: #e6f9e6;
}

.tiny-cancel:hover {
  background: #fff2f2;
}

.tiny-reset:hover {
  background: #fff6e6;
}

/* Disabled look */
.tiny-edit:disabled,
.tiny-save:disabled,
.tiny-cancel:disabled,
.tiny-reset:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* Muted text */
.muted {
  color: var(--muted);
  font-style: italic;
}

/* Sublayer area: slightly separated and better collapse animation */
.sublayer-list {
  padding: 10px 16px 12px 24px;
  background: #fbfdff;
  border-top: 1px dashed rgba(226, 229, 234, 0.9);
  border-bottom-left-radius: 8px;
  border-bottom-right-radius: 8px;
  margin-top: -2px;
  box-sizing: border-box;
  overflow: hidden;
}

.sub-block {
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px dotted rgba(234, 234, 242, 0.9);
}

/* sl-row uses similar layout to color-row but with slightly smaller labels */
.sl-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
}

.sl-row label {
  width: 70px;
  color: #5e6275;
  font-size: 12px;
  font-weight: 500;
}

.sl-row .val {
  flex: 1;
  font-size: 13px;
  color: var(--text);
}

/* Badges */
.priority-badge {
  font-size: 13px;
  color: #16325c;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid rgba(78, 120, 200, 0.12);
  display: inline-block;
  min-width: 48px;
  text-align: center;
  font-weight: 700;
}

.priority-badge.blue {
  background: rgba(220, 230, 250, 0.95);
  color: #26406e;
  border-color: rgba(78, 120, 200, 0.12);
}

.priority-badge.yellow {
  background: rgba(255, 250, 230, 0.98);
  color: #6b4a00;
  border-color: rgba(220, 190, 70, 0.12);
}

.pri-label {
  color: #9aa3b2;
  font-size: 11px;
  margin-left: 6px;
}

/* Highlight when focused */
[color-focused="1"],
[data-focused="1"] {
  box-shadow: 0 0 0 3px rgba(65, 122, 237, 0.08);
  border-color: rgba(65, 122, 237, 0.12);
}

/* Collapse animation: animate max-height + opacity to avoid layout jitter */
.collapse-fast-enter-active,
.collapse-fast-leave-active {
  transition: max-height 0.18s ease, opacity 0.12s ease, transform 0.12s ease;
  overflow: hidden;
}

.collapse-fast-enter-from,
.collapse-fast-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-4px);
}

.collapse-fast-enter-to,
.collapse-fast-leave-from {
  max-height: 800px;
  /* plenty for content */
  opacity: 1;
  transform: translateY(0);
}

/* Accessibility: visible focus for keyboard users without layout shift */
button:focus,
.tiny-edit:focus,
.tiny-save:focus,
.tiny-cancel:focus {
  outline: none;
  box-shadow: 0 0 0 4px rgba(96, 155, 255, 0.08);
  border-color: rgba(96, 155, 255, 0.45);
}

/* Small responsive tweaks */
@media (max-width: 520px) {

  .color-row label,
  .sl-row label {
    width: 64px;
    flex-basis: 64px;
  }

  .edit-input {
    min-width: 100px;
    max-width: 180px;
  }

  .tiny-edit,
  .tiny-save,
  .tiny-cancel,
  .tiny-reset {
    min-width: 48px;
    height: 32px;
    font-size: 12px;
    padding: 5px 8px;
  }

  .tiny-palette {
    min-width: 40px;
    height: 32px;
    padding: 5px 8px;
  }

  .tiny-link {
    min-width: 36px;
    height: 32px;
    padding: 5px 6px;
    font-size: 13px;
  }
}
</style>