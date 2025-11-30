<template>
  <div class="palette-panel" role="region" :aria-label="t('palette.ariaLabelPanel')" ref="rootEl">
    <!-- Palette Control (embedded picker) -->
    <div class="picker-area" aria-hidden="false">
      <Chrome v-model="pickerColor" :disable-alpha="true" :aria-label="t('palette.pickerAria')" class="vc-sketch" />
    </div>

    <!-- Saved Colors -->
    <div class="group-card saved-group" :class="{ collapsed: collapsedSaved }">
      <div class="group-header">
        <div class="title" @click="toggleSaved">
          <button class="chev" :aria-expanded="!collapsedSaved">{{ collapsedSaved ? '▸' : '▾' }}</button>
          <span class="gid">{{ t('palette.saved.title') }}</span>
          <span class="count">({{ savedColors.length }})</span>
        </div>

        <div class="group-controls">
          <!-- use symbol for edit toggle -->
          <button class="icon-btn" :class="{ active: workMode === 'saved' }" @click="setMode('saved')"
            :title="t('palette.saved.editTitle')">✎</button>
          <button class="icon-btn" @click="addCurrentToSaved" :disabled="!currentColorText && !currentColorForInput"
            :title="t('palette.saved.saveTitle')">＋</button>
          <button class="icon-btn" @click="handleClearAllSaved" :disabled="savedColors.length === 0"
            :title="t('palette.saved.clearTitle')">
            {{ clearSavedWarning ? '⚠' : '✖' }}
          </button>
        </div>
      </div>

      <transition name="fade">
        <div v-show="!collapsedSaved" class="group-body saved-body scrollable">
          <div v-if="savedColors.length === 0" class="placeholder small">{{ t('palette.saved.none') }}</div>

          <div v-else class="parts-list">
            <div v-for="(c, idx) in savedColors" :key="`saved::${idx}`"
              :class="['part-row', 'saved-item', { focused: selectedSavedIndex === idx }]" @click="onClickSaved(idx)">
              <div class="row-content">
                <div class="left-col">
                  <span class="swatch" :style="savedSwatchStyle(c)"></span>
                  <div class="slot-name saved-text" :title="savedText(c)">{{ savedText(c) }}</div>
                </div>
                <div class="part-controls">
                  <!-- Normal mode: only copy. Saved edit mode: show delete (two-step) + copy -->
                  <button class="tiny" @click.stop="copySaved(idx)" :title="t('palette.actions.copy')">⧉</button>

                  <template v-if="workMode === 'saved'">
                    <button class="tiny" :class="{ warning: deleteSavedWarningIndex === idx }"
                      @click.stop="handleDeleteSaved(idx)" :title="t('palette.saved.delete')">
                      {{ deleteSavedWarningIndex === idx ? '⚠' : '✖' }}
                    </button>
                  </template>
                </div>
              </div>
            </div>
          </div>

        </div>
      </transition>
    </div>

    <!-- Color Tags -->
    <div class="group-card tags-group" :class="{ collapsed: collapsedTags }">
      <div class="group-header">
        <div class="title" @click="toggleTags">
          <button class="chev" :aria-expanded="!collapsedTags">{{ collapsedTags ? '▸' : '▾' }}</button>
          <span class="gid">{{ t('palette.tags.title') }}</span>
          <span class="count">({{ Object.keys(palette).length }})</span>
        </div>

        <div class="group-controls">
          <!-- symbol for edit toggle -->
          <button class="icon-btn" :class="{ active: workMode === 'tags' }" @click="setMode('tags')"
            :title="t('palette.tags.editTitle')">✎</button>
          <button class="icon-btn" @click="createTagFromCurrent" :disabled="!currentColorForInput && !currentColorText"
            :title="t('palette.tags.createFromCurrent')">＋</button>
          <button class="icon-btn" @click="handleClearAll" :disabled="!hasEntries"
            :title="t('palette.tags.clearTitle')">
            {{ clearAllWarning ? '⚠' : '✖' }}
          </button>
        </div>
      </div>

      <transition name="fade">
        <div v-show="!collapsedTags" class="group-body tags-body">
          <div v-if="!hasEntries" class="placeholder">{{ t('palette.tags.none') }}</div>

          <div v-else class="parts-list scrollable">
            <div v-for="(val, tag) in palette" :key="tag"
              :class="['part-row', 'entry', { focused: tag === focusedTag }]" @click="onClickTag(tag)">
              <div class="row-content">
                <div class="left-col">
                  <div class="tag">
                    <!-- If renaming, show input in-place -->
                    <template v-if="renamingTag === tag">
                      <input class="text-input" v-model="renameInput" @keyup.enter="confirmRename(tag)" />
                    </template>
                    <template v-else>
                      {{ tag }}
                      <!-- When in tags edit mode, show a small rename symbol after the tag name -->
                      <button v-if="workMode === 'tags'" class="tiny rename-after" @click.stop="startRename(tag)"
                        :title="t('palette.actions.rename')">✎</button>
                    </template>
                  </div>
                  <div class="val" :title="valText(tag)">
                    <span class="swatch" :style="swatchStyle(tag)"></span>
                    <span class="val-text">{{ valText(tag) }}</span>
                  </div>
                </div>

                <div class="part-controls">
                  <!-- Normal mode: only copy -->
                  <template v-if="workMode !== 'tags'">
                    <button class="tiny" @click.stop="copyTag(tag)" :title="t('palette.actions.copy')">⧉</button>
                  </template>

                  <!-- Tags edit mode -->
                  <template v-else>
                    <!-- If currently renaming this tag, show confirm/cancel only -->
                    <template v-if="renamingTag === tag">
                      <button class="tiny confirm" @click.stop="confirmRename(tag)"
                        :title="t('palette.actions.confirm')">✓</button>
                      <button class="tiny cancel" @click.stop="cancelRename"
                        :title="t('palette.actions.cancel')">✕</button>
                    </template>
                    <!-- Otherwise show delete (two-step) -->
                    <template v-else>
                      <button class="tiny" :class="{ warning: deleteTagWarning === tag }"
                        @click.stop="handleDeleteTag(tag)" :title="t('palette.saved.delete')">
                        {{ deleteTagWarning === tag ? '⚠' : '✖' }}
                      </button>
                    </template>
                  </template>
                </div>
              </div>
            </div>
          </div>

        </div>
      </transition>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStudioStore } from '@/stores/studioStore'
import { Chrome } from '@ckpack/vue-color'
import throttle from 'lodash.throttle'
import { hostWindow, doc, setTimeoutHost } from '@/utils/host-window.js'

const { t } = useI18n()

const store = useStudioStore()

// reactive snapshot of palette for rendering
const palette = computed(() => store.paletteSnapshot || {})
const hasEntries = computed(() => Object.keys(palette.value).length > 0)

// saved colors from store
const savedColors = computed(() => store.savedColors || [])

const storePaletteWorkMode = computed(() => store.paletteWorkMode || 'external')

// work mode: 'external' | 'saved' | 'tags'
const workMode = ref('external')

// which tag is focused (selected) for picking (used in tag editing mode)
const focusedTag = ref(null)

// which saved color is selected (index) for editing in saved mode
const selectedSavedIndex = ref(null)

// current color shown in the color input (string like "#rrggbb")
// and textual input (allows rgb(), named, hex...)
const currentColorForInput = ref('#cccccc')
const currentColorText = ref('')
const pickerColor = ref(currentColorForInput.value) // bound to third-party picker v-model

// keep an internal copy of the original value for revert
const originalValue = ref(null)

let onClickTagFlag = false;
let isResettingPicker = false;

// collapse states for three main sections
const collapsedPalette = ref(false)
const collapsedSaved = ref(false)
const collapsedTags = ref(false)

// root element ref to handle outside clicks if needed in future
const rootEl = ref(null)

// rename related state
const renamingTag = ref(null)
const renameInput = ref('')

// delete warning states (two-step confirmation)
const deleteTagWarning = ref(null)
const deleteSavedWarningIndex = ref(null)
const clearAllWarning = ref(false)
const clearSavedWarning = ref(false)
let deleteTagTimer = null
let deleteSavedTimer = null
let clearAllTimer = null
let clearSavedTimer = null

// helpers to format value as readable text
function valText(tag) {
  const v = palette.value[tag]
  try {
    return typeof v === 'string' ? v : JSON.stringify(v)
  } catch (e) {
    return String(v)
  }
}

// produce a CSS background for the swatch. prefer a single color if possible.
function swatchStyle(tag) {
  const v = palette.value[tag]
  const css = extractPrimaryCssColor(v)
  return css ? { background: css, borderColor: '#e6eef6' } : { background: '#f3f7fb', border: '1px solid rgba(230,238,246,0.9)' }
}

// saved color swatch style
function savedSwatchStyle(v) {
  const css = extractPrimaryCssColor(v)
  return css ? { background: css, borderColor: '#e6eef6' } : { background: '#fff', border: '1px solid #e6eef6' }
}

function savedText(v) {
  if (typeof v === 'string') return v
  try { return JSON.stringify(v) } catch (e) { return String(v) }
}

// When a tag is clicked: behavior depends on mode:
function onClickTag(tag) {
  if (workMode.value === 'external') {
    onClickTagFlag = true
    originalValue.value = deepClone(palette.value[tag])
    syncPickerToTag(tag)
    store.applyTagToActivePaletteTargets(tag)
  } else if (workMode.value === 'tags') {
    if (focusedTag.value === tag) {
      focusedTag.value = null
      originalValue.value = null
      return
    }
    focusedTag.value = tag
    originalValue.value = deepClone(palette.value[tag])
    syncPickerToTag(tag)
  }
}

// When a saved color clicked:
function onClickSaved(idx) {
  if (workMode.value === 'external') {
    const color = savedColors.value[idx]
    store.applyTagToActivePaletteTargets(color)
    currentColorText.value = savedText(color)
    const primary = extractPrimaryCssColor(color)
    currentColorForInput.value = cssColorToHex(primary) || currentColorForInput.value || '#cccccc'
  } else if (workMode.value === 'saved') {
    if (selectedSavedIndex.value === idx) {
      selectedSavedIndex.value = null
      originalValue.value = null
      return
    }
    selectedSavedIndex.value = idx
    originalValue.value = deepClone(savedColors.value[idx])
    syncPickerToSaved(idx)
  }
}

// clear focus/selection
function clearSelection() {
  if (workMode.value === 'saved') selectedSavedIndex.value = null
  if (workMode.value === 'tags') focusedTag.value = null
  originalValue.value = null
  renamingTag.value = null
}

// revert selection to original
function revertSelection() {
  if (!originalValue.value) return
  if (workMode.value === 'saved' && typeof selectedSavedIndex.value === 'number') {
    store.updateSavedColor(selectedSavedIndex.value, deepClone(originalValue.value))
    syncPickerToSaved(selectedSavedIndex.value)
  } else if (workMode.value === 'tags' && focusedTag.value) {
    store.updatePaletteTag(focusedTag.value, deepClone(originalValue.value))
    syncPickerToTag(focusedTag.value)
  }
}

// copy / delete wrappers
async function copyTag(tag) {
  const v = palette.value[tag]
  if (v === undefined) return
  const txt = (typeof v === 'string') ? v : JSON.stringify(v, null, 2)
  try {
    await navigator.clipboard.writeText(txt)
  } catch (e) {
    const ta = doc.createElement('textarea')
    ta.value = txt
    doc.body.appendChild(ta)
    ta.select()
    doc.execCommand('copy')
    ta.remove()
  }
}

// Two-step delete for tags: first click shows warning, second confirms
function handleDeleteTag(tag) {
  if (deleteTagWarning.value === tag) {
    // confirmed: delete tag and expand to actual colors
    const removed = store.deletePaletteTag(tag)
    if (removed) {
      if (focusedTag.value === tag) clearSelection()
      // ensure UI refresh (store.deletePaletteTag already refreshes layer entries & mergedAppearance)
    }
    deleteTagWarning.value = null
    if (deleteTagTimer) { clearTimeout(deleteTagTimer); deleteTagTimer = null }
    return
  }
  // set warning
  deleteTagWarning.value = tag
  if (deleteTagTimer) clearTimeout(deleteTagTimer)
  deleteTagTimer = setTimeoutHost(() => { deleteTagWarning.value = null; deleteTagTimer = null }, 4000)
}

// Saved color copy/delete
async function copySaved(idx) {
  const v = savedColors.value[idx]
  if (!v) return
  const txt = (typeof v === 'string') ? v : JSON.stringify(v, null, 2)
  try {
    await navigator.clipboard.writeText(txt)
  } catch (e) {
    const ta = doc.createElement('textarea')
    ta.value = txt
    doc.body.appendChild(ta)
    ta.select()
    doc.execCommand('copy')
    ta.remove()
  }
}

function handleDeleteSaved(idx) {
  if (deleteSavedWarningIndex.value === idx) {
    // confirmed
    store.deleteSavedColor(idx)
    if (selectedSavedIndex.value === idx) selectedSavedIndex.value = null
    deleteSavedWarningIndex.value = null
    if (deleteSavedTimer) { clearTimeout(deleteSavedTimer); deleteSavedTimer = null }
    return
  }
  deleteSavedWarningIndex.value = idx
  if (deleteSavedTimer) clearTimeout(deleteSavedTimer)
  deleteSavedTimer = setTimeoutHost(() => { deleteSavedWarningIndex.value = null; deleteSavedTimer = null }, 4000)
}

// add current picker value to saved list
function addCurrentToSaved() {
  const toAdd = currentColorForInput.value || currentColorText.value
  if (toAdd === undefined || toAdd === null) return
  store.addSavedColor(toAdd)
}

// clear all saved two-step
function handleClearAllSaved() {
  if (clearSavedWarning.value) {
    // confirmed
    if (store.clearSavedColors) {
      store.clearSavedColors()
    } else {
      for (let i = savedColors.value.length - 1; i >= 0; i--) {
        store.deleteSavedColor(i)
      }
    }
    selectedSavedIndex.value = null
    clearSavedWarning.value = false
    if (clearSavedTimer) { clearTimeout(clearSavedTimer); clearSavedTimer = null }
    return
  }
  clearSavedWarning.value = true
  if (clearSavedTimer) clearTimeout(clearSavedTimer)
  clearSavedTimer = setTimeoutHost(() => { clearSavedWarning.value = false; clearSavedTimer = null }, 4000)
}

// clear all palette tags (two-step)
function handleClearAll() {
  if (clearAllWarning.value) {
    store.clearPalette()
    focusedTag.value = null
    clearAllWarning.value = false
    if (clearAllTimer) { clearTimeout(clearAllTimer); clearAllTimer = null }
    return
  }
  clearAllWarning.value = true
  if (clearAllTimer) clearTimeout(clearAllTimer)
  clearAllTimer = setTimeoutHost(() => { clearAllWarning.value = false; clearAllTimer = null }, 4000)
}

// utility: small deep clone helper
function deepClone(v) {
  try { return JSON.parse(JSON.stringify(v)) } catch (e) { return v }
}

// extract a primary CSS color from stored palette value
function extractPrimaryCssColor(v) {
  if (!v) return null
  if (typeof v === 'string') return v
  if (Array.isArray(v)) {
    for (const el of v) {
      if (typeof el === 'string') return el
      if (typeof el === 'number') return String(el)
    }
    return v.length ? String(v[0]) : null
  }
  return String(v)
}

// Convert CSS color string (named, rgb(), hsl(), hex) to #rrggbb string suitable for <input type=color>
// Returns null if conversion failed.
function cssColorToHex(input) {
  if (!input || typeof hostWindow === 'undefined') return null
  try {
    const ctx = doc.createElement('canvas').getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = input
    const computed = ctx.fillStyle
    if (computed.startsWith('#')) {
      if (computed.length === 4) {
        const r = computed[1], g = computed[2], b = computed[3]
        return '#' + r + r + g + g + b + b
      }
      return computed.length === 7 ? computed : computed
    }
    const m = computed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (!m) return null
    const r = Number(m[1]), g = Number(m[2]), b = Number(m[3])
    return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')
  } catch (e) {
    return null
  }
}


// watch store changes: if the focused tag value changed externally, refresh local inputs
watch(() => palette.value, (nv, ov) => {
  if (workMode.value !== 'tags') return
  if (!focusedTag.value) return
  if (!(focusedTag.value in nv)) {
    focusedTag.value = null
    originalValue.value = null
    return
  }
  const v = nv[focusedTag.value]
  currentColorText.value = typeof v === 'string' ? String(v) : (Array.isArray(v) ? (v.length === 1 ? String(v[0]) : JSON.stringify(v)) : String(v))
  const primary = extractPrimaryCssColor(v)
  currentColorForInput.value = cssColorToHex(primary) || currentColorForInput.value || '#cccccc'
}, { deep: true })

watch(() => storePaletteWorkMode.value, (nv) => {
  if (nv === workMode.value) return
  setMode(nv)
})

watch(() => store.paletteUpdateFlag, (nv, ov) => {
  refreshPickerFromActiveTargets()
})



// helper: 把第三方 picker 的输出统一为 hex/text（兼容 string 或 对象）
function normalizePickerOutput(val) {
  // @ckpack/vue-color 的 v-model 可能返回字符串 '#rrggbb' 或对象 { hex: '#rrggbb', r,g,b,... }
  if (!val) return null
  if (typeof val === 'string') return val
  if (typeof val === 'object') {
    if (val.hex) return val.hex
    // 兜底：尝试构造 hex（若已有 r,g,b）
    if ('r' in val && 'g' in val && 'b' in val) {
      const r = Number(val.r).toString(16).padStart(2, '0')
      const g = Number(val.g).toString(16).padStart(2, '0')
      const b = Number(val.b).toString(16).padStart(2, '0')
      return `#${r}${g}${b}`
    }
  }
  return String(val)
}

const updateFromPicker = throttle((val) => {
  const hex = normalizePickerOutput(val)
  if (!hex) return

  currentColorForInput.value = cssColorToHex(hex) || hex
  currentColorText.value = hex

  // 根据当前 mode 同步到 store
  if (workMode.value === 'external') {
    store.applyTagToActivePaletteTargets(hex)
  } else if (workMode.value === 'saved') {
    if (typeof selectedSavedIndex.value === 'number') {
      store.updateSavedColor(selectedSavedIndex.value, hex)
    }
  } else if (workMode.value === 'tags') {
    if (focusedTag.value) {
      store.updatePaletteTag(focusedTag.value, hex)
    }
  }
}, 25)

// watch pickerColor
watch(pickerColor, (nv) => {
  if (!onClickTagFlag && !isResettingPicker) {
    updateFromPicker(nv)
  } else {
    isResettingPicker = false
    onClickTagFlag = false
  }
})

// 当外部（store / selected tag / saved）改变时，同步回 pickerColor
function syncPickerToTag(tag) {
  const v = palette.value[tag]
  const primary = extractPrimaryCssColor(v)
  const hex = cssColorToHex(primary) || primary || '#cccccc'
  pickerColor.value = hex
  currentColorText.value = typeof v === 'string' ? String(v) : JSON.stringify(v)
  currentColorForInput.value = hex
}
function syncPickerToSaved(idx) {
  const v = savedColors.value[idx]
  const primary = extractPrimaryCssColor(v)
  const hex = cssColorToHex(primary) || primary || '#cccccc'
  pickerColor.value = hex
  currentColorText.value = typeof v === 'string' ? String(v) : JSON.stringify(v)
  currentColorForInput.value = hex
}


// mode setter
function setMode(m) {
  if (m === workMode.value) {
    workMode.value = "external"
    refreshPickerFromActiveTargets()
  }
  else {
    workMode.value = m
  }
  if (workMode.value === 'external') {
    refreshPickerFromActiveTargets()
  }
  // clear selections on mode change
  focusedTag.value = null
  selectedSavedIndex.value = null
  originalValue.value = null
  selectedSavedIndex.value = null
  store.setPaletteWorkMode(m)
}

function refreshPickerFromActiveTargets() {
  const activePaletteTargets = store.activePaletteTargets || []
  if (activePaletteTargets.length === 0) return
  const firstTarget = activePaletteTargets[0]
  const currentColorCss = firstTarget.currentColorCss || null
  if (workMode.value === 'external') {
    const hex = cssColorToHex(currentColorCss) || currentColorForInput.value || '#cccccc'
    if (pickerColor.value !== hex) {
      isResettingPicker = true
      pickerColor.value = hex
      currentColorForInput.value = hex
      currentColorText.value = firstTarget.currentColorText || hex
    }

  }
}

// collapse toggles
function togglePalette() { collapsedPalette.value = !collapsedPalette.value }
function toggleSaved() { collapsedSaved.value = !collapsedSaved.value }
function toggleTags() { collapsedTags.value = !collapsedTags.value }

// keyboard: Esc cancels selection
hostWindow.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    clearSelection()
  }
})

/* ---------------------------
   Add tag & rename helpers
   --------------------------- */

// Create tag from current color/text
// Note: per-request, do not perform conditional checks here and do not switch to edit mode.
// Let store handle creation/fallback behavior.
function createTagFromCurrent() {
  const val = currentColorForInput.value || currentColorText.value
  // call store even if val empty; store will handle behavior
  try {
    store.createTagAndReplaceInStacks(val)
  } catch (e) {
    console.error('create tag failed', e)
    alert(t('palette.messages.createTagFailed'))
  }
}

// Start rename UI for a tag
function startRename(tag) {
  renamingTag.value = tag
  renameInput.value = tag
  // focus will be manual via DOM in future if needed
}

// Cancel rename
function cancelRename() {
  renamingTag.value = null
  renameInput.value = ''
}

// Confirm rename: perform renaming by updating stacks/focusedPart/paletteMap and refreshing UI
function confirmRename(oldTag) {
  const newTag = (renameInput.value || '').trim()
  if (!newTag) {
    alert(t('palette.messages.tagNameEmpty'))
    return
  }
  if (newTag === oldTag) {
    renamingTag.value = null
    renameInput.value = ''
    return
  }
  if (newTag in (store.paletteMap || {})) {
    alert(t('palette.messages.tagNameExists'))
    return
  }

  // perform rename by cloning stacks & focusedPart, replacing occurrences of oldTag with newTag
  try {
    const newStacks = deepClone(store.stacks || [])
    for (const el of newStacks) {
      if (!el || !Array.isArray(el.data)) continue
      for (const p of el.data) {
        if (!p) continue
        if (Array.isArray(p.Color)) {
          for (let i = 0; i < p.Color.length; i++) {
            if (p.Color[i] === oldTag) p.Color[i] = newTag
          }
        } else {
          if (p.Color === oldTag) p.Color = newTag
        }
      }
    }

    const newFocusedPart = deepClone(store.focusedPart)
    if (newFocusedPart) {
      if (Array.isArray(newFocusedPart.Color)) {
        for (let i = 0; i < newFocusedPart.Color.length; i++) {
          if (newFocusedPart.Color[i] === oldTag) newFocusedPart.Color[i] = newTag
        }
      } else {
        if (newFocusedPart.Color === oldTag) newFocusedPart.Color = newTag
      }
    }

    // paletteMap: move value to new key
    const pm = deepClone(store.paletteMap || {})
    pm[newTag] = pm[oldTag]
    delete pm[oldTag]

    // commit to store
    store.stacks = newStacks
    store.focusPart(newFocusedPart)
    store.paletteMap = pm

    // refresh derived fields
    if (typeof store._refreshAllLayerEntriesFromPalette === 'function') {
      store._refreshAllLayerEntriesFromPalette()
    }
    if (typeof store.refreshMergedAppearanceData === 'function') {
      store.refreshMergedAppearanceData()
    }

    // update UI state
    renamingTag.value = null
    renameInput.value = ''
    focusedTag.value = newTag
    // ensure picker synced
    nextTick(() => syncPickerToTag(newTag))

  } catch (e) {
    console.error('rename tag failed', e)
    alert(t('palette.messages.renameFailed'))
  }
}
</script>

<style scoped>
.palette-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px;
  box-sizing: border-box;
  overflow: hidden;
}

/* group-card (reuse PartList visual language) */
.group-card {
  border-radius: 8px;
  background: #fff;
  border: 1px solid rgba(220, 230, 240, 0.7);
  box-shadow: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* collapsed visual */
.group-card.collapsed .group-body {
  display: none;
}

/* group header */
.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid rgba(240, 245, 250, 0.9);
}

.group-header .title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  cursor: pointer;
  user-select: none;
}

.chev {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: transparent;
  border: none;
  font-weight: 700;
  cursor: pointer;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.gid {
  font-weight: 700;
  color: #223047;
  font-size: 13px;
}

.count {
  color: #9aa3b2;
  font-size: 12px;
  margin-left: 6px;
}

/* group-controls: align action buttons */
.group-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* Icon buttons: consistent with PartList styling; square */
.icon-btn {
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 8px;
  border: 1px solid rgba(220, 230, 240, 0.85);
  background: #fff;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon-btn.active {
  background: rgba(255, 165, 0, 0.12);
  border-color: #ffa500;
}

/* group-body */
.group-body {
  padding: 10px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 100%;
  overflow: auto;
}

/* picker area */
.picker-area {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(180deg, #ffffff, #fbfdff);
  background-color: #fbfdff;
  border: 1px solid rgba(220, 230, 240, 0.6);
  box-sizing: border-box;
  padding: 6px;
}

.vc-sketch {
  flex: 1;
  max-width: 100%;
  min-height: max-content;
  height: 100%;
  box-shadow: none;
}

.text-input {
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid #e6eef6;
  min-width: 120px;
  font-size: 13px;
}

/* parts-list / saved-list reusing PartList look */
.parts-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 100%;
  overflow: auto;
}

.part-row {
  display: flex;
  padding: 6px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid rgba(220, 230, 240, 0.7);
  cursor: pointer;
  align-items: center;
}

.part-row.focused {
  border-color: rgba(90, 140, 255, 0.6);
  background: #eef5ff;
}

.row-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.left-col {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}

.slot-name {
  font-weight: 700;
  color: #21314a;
  font-size: 13px;
}

.saved-text {
  font-size: 13px;
  color: #21314a;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.val {
  font-size: 13px;
  color: #21314a;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  gap: 8px;
  align-items: center;
}

.swatch {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  display: inline-block;
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.val-text {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
  vertical-align: middle;
}

/* per-item controls */
.part-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* tiny buttons: make them square and consistent */
.tiny {
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 8px;
  border: 1px solid #e6eef6;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

/* warning style for two-step delete */
.tiny.warning {
  background: #fff6f6;
  border-color: rgba(220, 80, 80, 0.6);
  color: #a00;
}

/* confirm / cancel minimal styles */
.tiny.confirm {
  background: #edf9ef;
  border-color: #7fc27f;
  color: #1a7a2a;
  min-width: 36px;
  padding: 0;
}

.tiny.cancel {
  background: #fff6f6;
  border-color: rgba(220, 80, 80, 0.6);
  color: #a00;
  min-width: 36px;
  padding: 0;
}

/* rename-after: small spacing when the rename icon is after tag name */
.rename-after {
  margin-left: 8px;
  width: 26px;
  height: 26px;
  font-size: 13px;
  padding: 0;
}

/* placeholder */
.placeholder {
  color: #7d8795;
  padding: 12px;
  text-align: center;
}

.placeholder.small {
  padding: 6px;
  font-size: 13px;
}

.entry .tag {
  font-weight: 700;
  color: #21314a;
  font-size: 13px;
  min-width: 56px;
  display: flex;
  align-items: center;
}

/* muted text helper */
.muted {
  color: #9aa3b2;
  font-size: 13px;
}

/* Accessibility: focus without layout shift */
button:focus,
.tiny:focus,
.icon-btn:focus {
  outline: none;
  /*  box-shadow: 0 0 0 4px rgba(96,155,255,0.08); */
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

  .text-input {
    min-width: 110px;
    max-width: 220px;
  }

  .header h4 {
    font-size: 15px;
  }

  .icon-btn {
    width: 34px;
    height: 34px;
  }

  .tiny {
    width: 34px;
    height: 34px;
  }
}
</style>