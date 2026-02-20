<template>
  <div class="stacks-list" ref="rootEl" role="region" :aria-label="t('stackList.ariaLabel')">
    <div class="stacks-header">
      <h4>{{ t('stackList.title') }}</h4>
      <div class="stacks-actions">
        <button class="icon-btn" :title="t('stackList.newStackTitle')" @click="addNewStack">
          ＋
        </button>
        <button class="icon-btn" :disabled="!hasSelected" :title="t('stackList.copyFullTitle')"
          @click="copySelectedFull">
          ⧉
        </button>
        <button class="icon-btn" :disabled="!hasSelected" :title="t('stackList.copyFilteredTitle')"
          @click="copySelectedFiltered">
          ⧉✔
        </button>
      </div>
    </div>

    <ul class="stacks-items scrollable" role="list" @dragover.prevent>
      <!-- displayStacks is REVERSED view. Top item = Last Store Index. -->
      <li v-for="entry in displayStacks" :key="entry.item.id || entry.idx"
        class="stack-row"
        :class="{
          active: entry.idx === selectedIndex,
          'drag-over-top': isDropTarget(entry.idx, 'top'),
          'drag-over-bottom': isDropTarget(entry.idx, 'bottom')
        }"
        @click="select(entry.idx)"
        @dragover="onDragOver($event, entry.idx)"
        @drop.prevent="onDrop($event, entry.idx)"
      >
        <!-- Drag Handle -->
        <div class="drag-handle" 
             draggable="true" 
             @dragstart="onDragStart($event, entry.idx)"
             @click.stop
             title="Drag to reorder">
           ⋮⋮
        </div>

        <div class="item-left" :title="t('stackList.clickToSelect')">
          <!-- Inline Renaming -->
          <div v-if="renamingIndex === entry.idx" class="rename-container">
             <input 
               ref="renameInputRef"
               v-model="renamingValue"
               class="rename-input"
               @blur="commitRename(entry.idx)"
               @keydown.enter="commitRename(entry.idx)"
               @keydown.esc="cancelRename"
               @click.stop
             />
          </div>
          <div v-else class="item-info">
             <div class="item-name" :title="entry.item.name">
               {{ entry.item.name || t('stackList.defaultName', { n: entry.position + 1 }) }}
             </div>
             <div class="item-meta">
               {{ t('stackList.meta', { parts: (entry.item.data?.length ?? 0), filters: (entry.item.filterList?.length ?? 0) }) }}
             </div>
          </div>
        </div>

        <div class="item-controls">
          <button class="icon-btn rename-btn" :title="t('stackList.renameTitle')"
            @click.stop="startRename(entry.idx, entry.item.name)">✎</button>

          <button class="icon-btn delete-btn" :class="{ armed: isStackArmed(entry.idx) }"
            @click.stop="toggleArmStackDelete(entry.idx)" :disabled="!stacks.length"
            :title="isStackArmed(entry.idx) ? t('stackList.deleteConfirmTitle') : t('stackList.deleteArmTitle')">
            {{ isStackArmed(entry.idx) ? '⚠' : '✖' }}
          </button>
        </div>
      </li>

      <li v-if="stacks.length === 0" class="empty">{{ t('stackList.empty') }}</li>
    </ul>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStudioStore } from '@/stores/studioStore'
import { doc } from '@/utils/host-window.js'

const { t } = useI18n()
const store = useStudioStore()

const stacks = computed(() => store.stacks)
const selectedIndex = computed(() => store.selectedIndex)
const hasSelected = computed(() => typeof selectedIndex.value === 'number' && selectedIndex.value >= 0)

const rootEl = ref(null)

// --- Deletion Logic ---
const armedStacks = ref(new Set())

function isStackArmed(idx) {
  return armedStacks.value.has(idx)
}

function toggleArmStackDelete(idx) {
  if (armedStacks.value.has(idx)) {
    confirmStackDelete(idx)
    return
  }
  armedStacks.value = new Set([idx])
}

function confirmStackDelete(idx) {
  if (idx < 0 || idx >= stacks.value.length) {
    armedStacks.value.delete(idx)
    return
  }
  store.removeElement(idx)
  armedStacks.value.clear()
}

function onDocumentClick(e) {
  if (!rootEl.value) return
  const clickedInside = rootEl.value.contains(e.target)
  if (!clickedInside) {
    armedStacks.value.clear()
    // Also cancel rename if clicking outside
    if (renamingIndex.value !== -1) {
      commitRename(renamingIndex.value)
    }
  }
}

onMounted(() => {
  doc.addEventListener('click', onDocumentClick, true)
})

onBeforeUnmount(() => {
  doc.removeEventListener('click', onDocumentClick, true)
})

// --- Selection ---
function select(i) { 
  // If renaming, clicking row shouldn't trigger select immediately if it blurs input
  // But usually fine.
  store.select(i) 
}

// --- Creation ---
function addNewStack() {
  const id = 'el_' + Math.random().toString(36).slice(2, 9)
  const name = t('stackList.defaultNewName', { n: stacks.value.length + 1 })
  const elem = { id, name, data: [], filterList: [] }
  store.addElement(elem)
}

// --- Copy ---
function _deepClone(obj) {
  try { return JSON.parse(JSON.stringify(obj)) } catch (e) { return typeof structuredClone === 'function' ? structuredClone(obj) : Object.assign({}, obj) }
}

function copySelectedFull() {
  const idx = selectedIndex.value
  if (typeof idx !== 'number' || idx < 0 || idx >= stacks.value.length) return
  
  const orig = stacks.value[idx]
  if (!orig) return
  const clone = _deepClone(orig)
  clone.id = 'el_' + Math.random().toString(36).slice(2, 9)
  clone.name = (clone.name || t('stackList.defaultBaseName')) + ' ' + t('stackList.copySuffix')
  if (Array.isArray(clone.data)) {
    for (const p of clone.data) {
      try { delete p._uid } catch (e) { }
    }
  }
  store.addElement(clone)
}

function copySelectedFiltered() {
  const idx = selectedIndex.value
  if (typeof idx !== 'number' || idx < 0 || idx >= stacks.value.length) return
  
  const orig = stacks.value[idx]
  const fl = Array.isArray(orig.filterList) ? orig.filterList.slice() : []
  const parts = Array.isArray(orig.data) && fl.length > 0 ? orig.data.filter(p => {
    try {
      const slot = (p && (p.Group || (p.Asset && p.Asset.Group && (p.Asset.Group.Name || p.Asset.Group.name)))) || ''
      return fl.includes(slot)
    } catch (e) {
      return false
    }
  }) : []

  const clone = {
    id: 'el_' + Math.random().toString(36).slice(2, 9),
    name: (orig.name || t('stackList.defaultBaseName')) + ' ' + t('stackList.copyFilteredSuffix'),
    data: _deepClone(parts),
    filterList: _deepClone(fl)
  }
  if (Array.isArray(clone.data)) {
    for (const p of clone.data) {
      try { delete p._uid } catch (e) { }
    }
  }
  store.addElement(clone)
}

// --- Inline Renaming ---
const renamingIndex = ref(-1)
const renamingValue = ref('')
const renameInputRef = ref(null)

function startRename(idx, currentName) {
  renamingIndex.value = idx
  renamingValue.value = currentName || ''
  nextTick(() => {
    if (renameInputRef.value && renameInputRef.value[0]) {
      renameInputRef.value[0].focus()
      renameInputRef.value[0].select()
    }
  })
}

function commitRename(idx) {
  if (renamingIndex.value !== idx) return
  
  const trimmed = String(renamingValue.value).trim()
  renamingIndex.value = -1 // Exit rename mode
  
  if (!trimmed) return // Do nothing if empty

  // Update store
  try {
    // Attempt immutable update pattern
    const copy = [...store.stacks]
    if (copy[idx]) {
      copy[idx] = { ...copy[idx], name: trimmed }
      store.stacks = copy
    }
  } catch (e) {
    // Fallback
     if (store.stacks && store.stacks[idx]) store.stacks[idx].name = trimmed
  }
  
  try { store.refreshMergedAppearanceData && store.refreshMergedAppearanceData() } catch (e) { }
}

function cancelRename() {
  renamingIndex.value = -1
}

// --- Drag & Drop (Improved) ---
const draggedStoreIndex = ref(-1)
const dragOverStoreIndex = ref(-1)
const dropPosition = ref(null) // 'top' | 'bottom'

// Display Logic: Reversed
const displayStacks = computed(() => {
  const arr = Array.isArray(stacks.value) ? stacks.value.map((item, idx) => ({ item, idx })) : []
  // Keep original position logic for default names
  return arr.slice().reverse().map((e, pos) => ({ ...e, position: pos }))
})

function onDragStart(e, storeIdx) {
  draggedStoreIndex.value = storeIdx
  // Firefox requires setData
  try { e.dataTransfer?.setData('text/plain', String(storeIdx)) } catch (err) { }
  // Set drag image/effect if needed
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
}

function onDragOver(e, storeIdx) {
  if (draggedStoreIndex.value === -1 || draggedStoreIndex.value === storeIdx) {
    dragOverStoreIndex.value = -1
    return
  }
  
  // Calculate top/bottom half
  const rect = e.currentTarget.getBoundingClientRect()
  const y = e.clientY - rect.top
  const isTop = y < rect.height / 2
  
  dragOverStoreIndex.value = storeIdx
  dropPosition.value = isTop ? 'top' : 'bottom'
}

function isDropTarget(idx, pos) {
  return dragOverStoreIndex.value === idx && dropPosition.value === pos
}

function onDrop(e, storeIdx) {
  const from = draggedStoreIndex.value
  const hovered = storeIdx
  
  if (from === -1 || from === hovered) {
    resetDrag()
    return
  }
  
  // Determine Insertion Index
  // Visual List is Reversed.
  // Hover Top (Visual) -> Store Index + 1
  // Hover Bottom (Visual) -> Store Index
  
  let toIndex = dropPosition.value === 'top' ? hovered + 1 : hovered
  
  // Correction for standard array move logic where 'to' is the target index *before* removal
  // If we move UP in store (from < to), the indices shift down.
  
  if (from < toIndex) {
     toIndex -= 1
  }
  
  // Clamp
  if (toIndex < 0) toIndex = 0
  if (toIndex >= stacks.value.length) toIndex = stacks.value.length - 1
  
  if (from !== toIndex) {
    store.moveElement(from, toIndex)
  }
  
  resetDrag()
}

function resetDrag() {
  draggedStoreIndex.value = -1
  dragOverStoreIndex.value = -1
  dropPosition.value = null
}
</script>

<style scoped>
.stacks-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm, 8px);
  padding: var(--space-sm, 8px);
  box-sizing: border-box;
  height: 100%;
}

.stacks-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0; /* Prevent header collapse */
}

.stacks-header h4 {
  margin: 0;
  font-size: var(--font-size-md, 14px);
  color: var(--color-text-primary, #21314a);
}

.stacks-actions {
  display: flex;
  gap: var(--space-sm, 8px);
  align-items: center;
}

.icon-btn {
  width: var(--button-height-lg, 36px);
  height: var(--button-height-lg, 36px);
  padding: 0;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-base, rgba(220, 230, 240, 0.85));
  background: var(--color-bg-base, #ffffff);
  cursor: pointer;
  font-size: var(--font-size-lg, 15px);
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  flex-shrink: 0;
  transition: all var(--transition-fast, 0.15s) ease;
  color: var(--color-text-primary, #0f172a);
}

.icon-btn:hover:not(:disabled) {
  background: var(--color-bg-hover, #f1f5f9);
  border-color: var(--color-border-strong, #cbd5e1);
}

.icon-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.icon-btn.armed {
  background: var(--color-error-bg, #fff4f0);
  border-color: var(--color-error, #ffb3a0);
}

/* List Container */
.stacks-items {
  list-style: none;
  padding: var(--space-xs, 4px) 0; /* space for drop indicators */
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm, 8px);
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  flex: 1 1 auto;
}

/* Row Item */
.stack-row {
  display: flex;
  align-items: center;
  padding: var(--space-sm, 6px) var(--space-sm, 8px); /* Slightly tighter padding */
  border-radius: var(--radius-lg, 10px);
  background: var(--color-bg-base, #ffffff);
  border: 1px solid var(--color-border-base, rgba(220, 230, 240, 0.7));
  cursor: pointer;
  transition: all var(--transition-fast, 120ms) ease;
  user-select: none;
  min-height: 50px;
  position: relative;
}

.stack-row:hover {
  background: var(--color-bg-hover, #f1f5f9);
  border-color: var(--color-border-strong, #cbd5e1);
}

.stack-row.active {
  box-shadow: var(--shadow-md, 0 4px 12px rgba(20, 30, 60, 0.08));
  border-color: var(--color-border-focus, rgba(120, 160, 215, 0.6));
  background: var(--color-bg-base, #fdfdfd);
}

/* Drag Feedback Indicators */
.stack-row.drag-over-top {
  border-top: 2px solid var(--color-primary, #2563eb);
  margin-top: -2px; /* prevent layout shift */
}

.stack-row.drag-over-bottom {
  border-bottom: 2px solid var(--color-primary, #2563eb);
  margin-bottom: -2px;
}

/* Drag Handle */
.drag-handle {
  cursor: grab;
  color: var(--color-text-muted, #94a3b8);
  padding: 4px;
  margin-right: 4px;
  font-size: 16px;
  line-height: 1;
  flex-shrink: 0;
}
.drag-handle:active {
  cursor: grabbing;
}

/* Item Content Left */
.item-left {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0; /* Crucial for text truncate in flex child */
  margin-right: 8px;
}

.item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.item-name {
  font-weight: 600;
  color: var(--color-text-primary, #0f172a);
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-meta {
  font-size: 12px;
  color: var(--color-text-tertiary, #64748b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Inline Rename Input */
.rename-container {
  display: flex;
  width: 100%;
}
.rename-input {
  width: 100%;
  font-size: 14px;
  font-weight: 600;
  padding: 4px 6px;
  border: 1px solid var(--color-selection-single, #417aed);
  border-radius: var(--radius-xs, 4px);
  outline: none;
  background: var(--color-bg-base, #fff);
  color: var(--color-text-primary, #0f172a);
  box-sizing: border-box;
}

/* Item Controls */
.item-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0; /* Stop buttons from shrinking */
}

.rename-btn, .delete-btn {
  width: 32px; /* Slightly smaller in list */
  height: 32px;
  font-size: 14px;
}

.empty {
  text-align: center;
  color: var(--color-text-muted);
  padding: 16px;
  border-radius: var(--radius-md, 8px);
  border: 1px dashed var(--color-border-base);
  font-size: 14px;
}
</style>