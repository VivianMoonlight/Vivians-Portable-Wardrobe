<template>
  <div class="palette-panel" @keydown.esc="exitTagEditMode">

    <!-- 1. Picker Area (Fixed at top) -->
    <div class="picker-section" :class="{ 'editing-tag-mode': !!editingTagId }">
      <div v-if="editingTagId" class="edit-banner">
        <span class="edit-label">{{ t('palette.tags.editTitle') }}: <strong>{{ editingTagId }}</strong></span>
        <button class="done-btn" @click="exitTagEditMode">Done</button>
      </div>

      <div class="picker-wrapper">
        <Chrome v-model="pickerColor" :disable-alpha="true" class="vc-sketch-custom" />
      </div>

      <!-- Quick Actions Bar -->
      <div class="quick-actions">
        <!-- Add to Saved -->
        <button class="action-btn" @click="addCurrentToSaved" :title="t('palette.saved.saveTitle')">
          <span>+</span> {{ t('palette.saved.title') }}
        </button>
        <!-- Create Tag -->
        <button class="action-btn" @click="createTagFromCurrent" :title="t('palette.tags.createFromCurrent')">
          <span>+</span> {{ t('palette.tags.title') }}
        </button>
      </div>
    </div>

    <!-- Scrollable Content -->
    <div class="palette-content scrollable">

      <!-- 2. Saved Colors (Grid) -->
      <div class="section-block">
        <div class="section-header" @click="toggleSaved">
          <span class="arrow">{{ collapsedSaved ? '▸' : '▾' }}</span>
          <span class="sec-title">{{ t('palette.saved.title') }}</span>
          <span class="count" v-if="savedColors.length">({{ savedColors.length }})</span>
          <button v-if="savedColors.length" class="clear-btn" @click.stop="handleClearAllSaved"
            :title="t('palette.saved.clearTitle')">
            {{ clearSavedWarning ? 'Confirm?' : 'Clear' }}
          </button>
        </div>

        <transition name="fade">
          <div v-show="!collapsedSaved" class="saved-grid">
            <div v-if="savedColors.length === 0" class="empty-msg">{{ t('palette.saved.none') }}</div>

            <div v-for="(c, idx) in savedColors" :key="`saved-${idx}`" class="saved-swatch-item"
              @click="applySavedColor(idx)" :title="savedText(c)">
              <div class="delete-overlay" @click.stop="deleteSavedColor(idx)">X</div>
              <span class="swatch-bg" :style="savedSwatchStyle(c)"></span>
              <!-- Delete Overlay -->
              
            </div>
          </div>
        </transition>
      </div>

      <!-- 3. Tags (List) -->
      <div class="section-block">
        <div class="section-header" @click="toggleTags">
          <span class="arrow">{{ collapsedTags ? '▸' : '▾' }}</span>
          <span class="sec-title">{{ t('palette.tags.title') }}</span>
          <span class="count" v-if="tagKeys.length">({{ tagKeys.length }})</span>
        </div>

        <transition name="fade">
          <div v-show="!collapsedTags" class="tags-list">
            <div v-if="tagKeys.length === 0" class="empty-msg">{{ t('palette.tags.none') }}</div>

            <div v-for="tag in tagKeys" :key="tag" class="tag-row" :class="{ 'is-editing': editingTagId === tag }">
              <!-- Color Swatch (Click to apply) -->
              <div class="tag-swatch-col" @click="applyTag(tag)" :title="t('palette.actions.apply')">
                <span class="tag-swatch" :style="swatchStyle(tag)"></span>
              </div>

              <!-- Name Input (Auto-save) -->
              <div class="tag-name-col">
                <input class="tag-name-input" :value="tag" @change="e => onTagRename(tag, e.target.value)"
                  @keydown.enter="e => e.target.blur()" />
              </div>

              <!-- Value Display (Read-onlyish) -->
              <div class="tag-val-col" :title="valText(tag)">
                {{ valText(tag) }}
              </div>

              <!-- Actions -->
              <div class="tag-actions">
                <!-- Edit Color Mode Toggle -->
                <button class="icon-action" :class="{ active: editingTagId === tag }"
                  @click.stop="toggleEditTagMode(tag)" :title="t('palette.tags.editTitle')">
                  ✎
                </button>
                <!-- Delete -->
                <button class="icon-action danger" @click.stop="handleDeleteTag(tag)"
                  :title="t('palette.saved.delete')">
                  {{ deleteTagWarning === tag ? '?' : '×' }}
                </button>
              </div>
            </div>
          </div>
        </transition>
      </div>

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
import * as DialogService from '@/services/DialogService.js'

const { t } = useI18n()
const store = useStudioStore()

/* ---------------- State ---------------- */

// Display State
const collapsedSaved = ref(false)
const collapsedTags = ref(false)

// Picker State
// pickerColor binds to the visual picker component.
// It syncs FROM store when selection changes, and syncs TO store when user drags it.
const pickerColor = ref('#cccccc')

// "Editing Tag" Mode
// If null, picker updates the Active Selection (Store.activePaletteTargets)
// If set (string), picker updates the Store.paletteMap[tag]
const editingTagId = ref(null)

// Warnings
const deleteTagWarning = ref(null)
const clearSavedWarning = ref(false)
let deleteTagTimer = null
let clearSavedTimer = null
let pickerSyncflag = false

/* ---------------- Computeds ---------------- */

const palette = computed(() => store.paletteSnapshot || {})
const tagKeys = computed(() => Object.keys(palette.value))
const savedColors = computed(() => store.savedColors || [])

// Determine what the picker should show
const activeTargets = computed(() => store.activePaletteTargets || [])

/* ---------------- Picker Logic ---------------- */

// 1. Sync Picker -> Store (Throttled)
const updateStoreFromPicker = throttle((val) => {
  const hex = normalizePickerOutput(val)
  if (!hex) return
  if (pickerSyncflag) return // Prevent loop

  if (editingTagId.value) {
    // Mode A: Editing a Tag Definition
    store.updatePaletteTag(editingTagId.value, hex)
  } else {
    // Mode B: Editing the Active Selection(s)
    // Note: If the active selection is currently using a Tag, 
    // this will override the tag with a raw color (breaking the link),
    // which is usually expected behavior in "Direct" mode.
    store.applyColorToActivePaletteTargets(hex)
  }
}, 100)

// Watch the visual picker component
watch(pickerColor, (nv) => {
  // Only trigger update if we are interacting.
  // We need to distinguish between "Store changed picker" vs "User changed picker".
  // The simplest way is to let the update flow, but throttle it.
  updateStoreFromPicker(nv)
})

// 2. Sync Store -> Picker
// We need to update the picker color when:
// A. The user selects a different layer (and we are NOT editing a tag).
// B. The user selects a different tag to edit.
// C. The value of the edited tag changes externally.

watch(() => store.paletteUpdateFlag, () => {
  if (!editingTagId.value) {
    syncPickerToActiveSelection()
  }
})

watch(() => editingTagId.value, (newTag) => {
  if (newTag) {
    // Sync picker to this tag's color
    const v = palette.value[newTag]
    syncPickerToColorValue(v)
  } else {
    // Revert picker to active selection
    syncPickerToActiveSelection()
  }
})

// Also watch the palette itself in case the tag being edited changes value elsewhere
watch(palette, (newPalette) => {
  if (editingTagId.value && newPalette[editingTagId.value]) {
    // If the tag we are editing changed (e.g. undo/redo), update picker
    // Check for difference to avoid loop
    const v = newPalette[editingTagId.value]
    const hex = extractPrimaryCssColor(v)
    if (hex && normalizePickerOutput(pickerColor.value) !== normalizePickerOutput(hex)) {
      syncPickerToColorValue(v)
    }
  }
}, { deep: true })

function syncPickerToActiveSelection() {
  if (activeTargets.value.length === 0) return
  const first = activeTargets.value[0]
  // activeTargets contains resolved colors
  const css = first.currentColorCss
  pickerSyncflag = true
  if (css) pickerColor.value = css
  nextTick(() => { pickerSyncflag = false })
}

function syncPickerToColorValue(v) {
  const hex = extractPrimaryCssColor(v)
  pickerSyncflag = true
  if (hex) pickerColor.value = hex
  nextTick(() => { pickerSyncflag = false })
}

/* ---------------- Actions ---------------- */

// Toggle "Edit Mode" for a tag
function toggleEditTagMode(tag) {
  if (editingTagId.value === tag) {
    exitTagEditMode()
  } else {
    editingTagId.value = tag
  }
}

function exitTagEditMode() {
  editingTagId.value = null
}

// Apply Tag to Selection
function applyTag(tag) {
  // If we were editing a tag, maybe we should stop?
  // Let's assume clicking a swatch means "I want to use this on my layer"
  if (editingTagId.value) exitTagEditMode()

  store.applyTagToActivePaletteTargets(tag)
  // Force picker sync visually to show the resolved color
  const v = palette.value[tag]
  syncPickerToColorValue(v)
}

// Rename Tag (Direct Input)
async function onTagRename(oldTag, newNameRaw) {
  const newName = (newNameRaw || '').trim()
  if (!newName || newName === oldTag) {
    // Revert input visual if needed? Vue :value binding handles it on re-render usually,
    // but forcing a refresh might be needed if strictly equal.
    return
  }

  if (palette.value[newName]) {
    await DialogService.alert(t('palette.messages.tagNameExists') || 'Tag name exists')
    // Force UI revert
    return
  }

  // Perform expensive rename (search and replace in all stacks)
  performRename(oldTag, newName)
}

function performRename(oldTag, newTag) {
  // This logic mimics the original confirmRename but simplified
  try {
    const newStacks = deepClone(store.stacks || [])

    // Helper to replace in a structure
    const replaceInPart = (p) => {
      if (!p) return
      if (Array.isArray(p.Color)) {
        for (let i = 0; i < p.Color.length; i++) {
          if (p.Color[i] === oldTag) p.Color[i] = newTag
        }
      } else {
        if (p.Color === oldTag) p.Color = newTag
      }
    }

    // 1. Stacks
    for (const el of newStacks) {
      if (el.data) el.data.forEach(replaceInPart)
    }

    // 2. Focused Part
    const newFocused = deepClone(store.focusedPart)
    if (newFocused) replaceInPart(newFocused)

    // 3. Palette Map Key Swap
    const pm = deepClone(store.paletteMap || {})
    pm[newTag] = pm[oldTag]
    delete pm[oldTag]

    // Commit
    store.stacks = newStacks
    if (newFocused) store._updateFocusedPartInPlace(newFocused)
    store.paletteMap = pm

    // If we were editing this tag, update pointer
    if (editingTagId.value === oldTag) {
      editingTagId.value = newTag
    }

    // Refresh
    store._refreshAllLayerEntriesFromPalette()
    store.refreshMergedAppearanceData()

  } catch (e) {
    console.error('Rename failed', e)
  }
}

// Delete Tag
function handleDeleteTag(tag) {
  if (deleteTagWarning.value === tag) {
    store.deletePaletteTag(tag)
    if (editingTagId.value === tag) exitTagEditMode()
    deleteTagWarning.value = null
    return
  }
  deleteTagWarning.value = tag
  if (deleteTagTimer) clearTimeout(deleteTagTimer)
  deleteTagTimer = setTimeoutHost(() => { deleteTagWarning.value = null }, 3000)
}

/* ---------------- Saved Colors Logic ---------------- */

function applySavedColor(idx) {
  const color = savedColors.value[idx]
  store.applyColorToActivePaletteTargets(color)
  syncPickerToColorValue(color)
}

function addCurrentToSaved() {
  // Add whatever is in the picker
  const hex = normalizePickerOutput(pickerColor.value)
  if (hex) store.addSavedColor(hex)
}

function deleteSavedColor(idx) {
  store.deleteSavedColor(idx)
}

function handleClearAllSaved() {
  if (clearSavedWarning.value) {
    if (store.clearSavedColors) store.clearSavedColors()
    else {
      // fallback if store method missing
      for (let i = savedColors.value.length - 1; i >= 0; i--) store.deleteSavedColor(i)
    }
    clearSavedWarning.value = false
    return
  }
  clearSavedWarning.value = true
  if (clearSavedTimer) clearTimeout(clearSavedTimer)
  clearSavedTimer = setTimeoutHost(() => { clearSavedWarning.value = false }, 3000)
}

function createTagFromCurrent() {
  const hex = normalizePickerOutput(pickerColor.value)
  if (hex) store.createTagAndReplaceInStacks(hex)
}

function toggleSaved() { collapsedSaved.value = !collapsedSaved.value }
function toggleTags() { collapsedTags.value = !collapsedTags.value }

/* ---------------- Helpers ---------------- */

function normalizePickerOutput(val) {
  if (!val) return null
  if (typeof val === 'string') return val
  if (val.hex) return val.hex
  return String(val)
}

function extractPrimaryCssColor(v) {
  if (!v) return null
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.length ? String(v[0]) : null
  return String(v)
}

function deepClone(v) {
  try { return JSON.parse(JSON.stringify(v)) } catch (e) { return v }
}

function savedSwatchStyle(v) {
  const c = extractPrimaryCssColor(v)
  return c ? { background: c } : { background: 'var(--color-bg-base, #fff)' }
}

function swatchStyle(tag) {
  const v = palette.value[tag]
  const c = extractPrimaryCssColor(v)
  return c ? { background: c } : { background: 'transparent', border: '1px solid var(--color-border-base, #e2e8f0)' }
}

function valText(tag) {
  const v = palette.value[tag]
  return typeof v === 'string' ? v : JSON.stringify(v)
}

function savedText(v) {
  return typeof v === 'string' ? v : JSON.stringify(v)
}

</script>

<style scoped>
.palette-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-base, #fff);
  font-family: 'Segoe UI', sans-serif;
  color: var(--color-text-primary, #0f172a);
}

/* --- Picker Section --- */
.picker-section {
  flex: 0 0 auto;
  border-bottom: 1px solid var(--color-border-light, #f1f5f9);
  padding-bottom: 10px;
  background: var(--color-bg-surface, #f8fafc);
  position: relative;
  transition: background 0.3s;
}

.picker-section.editing-tag-mode {
  background: var(--color-warning-bg, rgba(245, 158, 11, 0.15));
  /* Subtle warning color */
  border-bottom: 2px solid var(--color-warning, #f59e0b);
}

.edit-banner {
  background: var(--color-warning, #f59e0b);
  color: var(--color-text-inverse, #fff);
  padding: 6px 12px;
  font-size: 13px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.edit-label {
  font-weight: 600;
}

.done-btn {
  background: var(--color-bg-base, #fff);
  color: var(--color-warning, #f59e0b);
  border: none;
  border-radius: 4px;
  padding: 2px 8px;
  font-weight: 700;
  cursor: pointer;
  font-size: 11px;
}

.picker-wrapper {
  padding: 10px;
  display: flex;
  justify-content: center;
}

/* Vue Color override */
.vc-sketch-custom {
  box-shadow: none !important;
  border: 1px solid var(--color-border-base, #e2e8f0);
  border-radius: 6px;
  background: var(--color-bg-base, #fff);
}

.quick-actions {
  display: flex;
  gap: 8px;
  padding: 0 12px;
}

.action-btn {
  flex: 1;
  padding: 6px;
  border: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-base, #fff);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--color-text-secondary, #475569);
  transition: all 0.1s;
}

.action-btn:hover {
  background: var(--color-bg-hover, #f1f5f9);
  border-color: var(--color-border-strong, #cbd5e1);
}

.action-btn span {
  font-weight: bold;
  color: var(--color-selection-single, #417aed);
}

/* --- Content --- */
.palette-content {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.section-block {
  margin-bottom: 16px;
}

.section-header {
  display: flex;
  align-items: center;
  padding: 6px 0;
  cursor: pointer;
  user-select: none;
  color: var(--color-text-secondary, #475569);
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid var(--color-border-light, #f1f5f9);
  margin-bottom: 8px;
}

.arrow {
  width: 16px;
}

.sec-title {
  flex: 1;
  color: var(--color-text-primary, #0f172a);
}

.count {
  color: var(--color-text-tertiary, #64748b);
  font-weight: 400;
  font-size: 12px;
  margin-right: 8px;
}

.clear-btn {
  font-size: 11px;
  color: var(--color-error, #ef4444);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
}

.clear-btn:hover {
  background: var(--color-error-bg, #fee2e2);
  border-radius: 4px;
}

/* --- Saved Colors Grid --- */
.saved-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.saved-swatch-item {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  border: 1px solid var(--color-border-base, #e2e8f0);
  cursor: pointer;
  position: relative;
  overflow: hidden;
}

.saved-swatch-item:hover {
  transform: scale(1.05);
  box-shadow: var(--shadow-md);
  z-index: 1;
}

.swatch-bg {
  display: block;
  width: 100%;
  height: 100%;
}

.delete-overlay {
  position: absolute;
  top: 0px;
  right: 2px;
  left: auto;
  bottom: auto;

  color: var(--color-error, #ef4444);

 
  display: flex;
  align-items: center;
  justify-content: top;

  font-size: 12px;
  line-height: 1;

  cursor: pointer;

  opacity: 0;
  transition: opacity 0.1s, background 0.1s;
}


.saved-swatch-item:hover .delete-overlay {
  opacity: 1;
}

/* --- Tags List --- */
.tags-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tag-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: var(--color-bg-base, #fff);
  transition: all 0.1s;
}

.tag-row:hover {
  background: var(--color-bg-surface, #f8fafc);
  border-color: var(--color-border-light, #f1f5f9);
}

.tag-row.is-editing {
  background: var(--color-warning-bg, rgba(245, 158, 11, 0.15));
  border-color: var(--color-warning, #f59e0b);
}

.tag-swatch-col {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  cursor: pointer;
}

.tag-swatch {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 4px;
  border: 1px solid var(--color-border-base, #e2e8f0);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
}

.tag-name-col {
  flex: 1;
  min-width: 0;
}

.tag-name-input {
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  font-size: 13px;
  color: var(--color-text-primary, #0f172a);
  padding: 2px 4px;
  border-radius: 4px;
  font-weight: 600;
}

.tag-name-input:focus {
  border-color: var(--color-selection-single, #417aed);
  background: var(--color-bg-base, #fff);
  outline: none;
}

/* If editing, make input dimmer to show it's not the focus? No, keep it editable. */

.tag-val-col {
  font-size: 11px;
  color: var(--color-text-tertiary, #64748b);
  max-width: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
  text-align: right;
}

.tag-actions {
  display: flex;
  gap: 4px;
  opacity: 0.2;
  /* Hide by default to reduce clutter */
  transition: opacity 0.2s;
}

.tag-row:hover .tag-actions,
.tag-row.is-editing .tag-actions {
  opacity: 1;
}

.icon-action {
  width: 24px;
  height: 24px;
  border: 1px solid var(--color-border-light, #f1f5f9);
  background: var(--color-bg-base, #fff);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--color-text-secondary, #475569);
  font-size: 12px;
}

.icon-action:hover {
  background: var(--color-bg-hover, #f1f5f9);
  color: var(--color-text-primary, #0f172a);
}

.icon-action.active {
  background: var(--color-warning, #f59e0b);
  color: var(--color-text-inverse, #fff);
  border-color: var(--color-warning, #f59e0b);
}

.icon-action.danger:hover {
  background: var(--color-error-bg, #fee2e2);
  color: var(--color-error, #ef4444);
  border-color: var(--color-error, #ef4444);
}

.empty-msg {
  font-size: 12px;
  color: var(--color-text-muted, #94a3b8);
  font-style: italic;
  padding: 8px;
  text-align: center;
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>