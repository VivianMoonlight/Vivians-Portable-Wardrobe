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

    <ul class="stacks-items scrollable" role="list">
      <!-- use displayStacks (reversed view) but keep store indices for actions -->
      <li v-for="entry in displayStacks" :key="entry.item.id || entry.idx"
        :class="['stack-row', { active: entry.idx === selectedIndex, dragging: entry.idx === dragOverStoreIndex }]"
        @click="select(entry.idx)" draggable="true" @dragstart="onDragStart($event, entry.idx)"
        @dragover.prevent="onDragOver($event, entry.idx)" @drop.prevent="onDrop($event, entry.idx)">
        <div class="item-left" :title="t('stackList.clickToSelect')">
          <div class="item-name">{{ entry.item.name || t('stackList.defaultName', { n: entry.position + 1 }) }}</div>
          <div class="item-meta">{{ t('stackList.meta', {
            parts: (entry.item.data?.length ?? 0), filters:
              (entry.item.filterList?.length ?? 0) }) }}</div>
        </div>

        <div class="item-controls">
          <button class="icon-btn rename-btn" :title="t('stackList.renameTitle')"
            @click.stop="renameStack(entry.idx)">✎</button>

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
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStudioStore } from '@/stores/studioStore'
import { hostWindow, doc } from '@/utils/host-window.js'

const { t } = useI18n()
const store = useStudioStore()

const stacks = computed(() => store.stacks)
const selectedIndex = computed(() => store.selectedIndex)
const hasSelected = computed(() => typeof selectedIndex.value === 'number' && selectedIndex.value >= 0)

const rootEl = ref(null)

// armed delete states (per-stack)
const armedStacks = ref(new Set())

function isStackArmed(idx) {
  return armedStacks.value.has(idx)
}

function toggleArmStackDelete(idx) {
  if (armedStacks.value.has(idx)) {
    // confirm delete
    confirmStackDelete(idx)
    return
  }
  // arm this and clear others
  armedStacks.value = new Set([idx])
}

function confirmStackDelete(idx) {
  if (idx < 0 || idx >= stacks.value.length) {
    armedStacks.value.delete(idx)
    return
  }
  store.removeElement(idx)
  // clear armed set after delete
  armedStacks.value.clear()
}

// clear armed when clicking elsewhere
function onDocumentClick(e) {
  if (!rootEl.value) return
  const clickedInside = rootEl.value.contains(e.target)
  if (!clickedInside) {
    armedStacks.value.clear()
  }
}

onMounted(() => {
  doc.addEventListener('click', onDocumentClick, true)
})

onBeforeUnmount(() => {
  doc.removeEventListener('click', onDocumentClick, true)
})

// selection
function select(i) { store.select(i) }

// helpers
function moveUp(i) { if (i > 0) store.moveElement(i, i - 1) }
function moveDown(i) { if (i < stacks.value.length - 1) store.moveElement(i, i + 1) }
function clearAll() { store.clear() }

// Simple sample generator for demonstration
function addSample() {
  const id = 'el_' + Math.random().toString(36).slice(2, 9)
  const name = t('stackList.defaultNewName', { n: stacks.value.length + 1 })
  const data = [{ Name: 'SampleGroup', IsItem: false }]
  store.addElement({ id, name, data })
}

// New: add an empty new stack (minimal shape)
function addNewStack() {
  const id = 'el_' + Math.random().toString(36).slice(2, 9)
  const name = t('stackList.defaultNewName', { n: stacks.value.length + 1 })
  const elem = { id, name, data: [], filterList: [] }
  store.addElement(elem)
}

// Copy utilities
function _deepClone(obj) {
  try { return JSON.parse(JSON.stringify(obj)) } catch (e) { return typeof structuredClone === 'function' ? structuredClone(obj) : Object.assign({}, obj) }
}

// copy full selected stack
function copySelectedFull() {
  const idx = selectedIndex.value
  if (typeof idx !== 'number' || idx < 0 || idx >= stacks.value.length) return
  copyStackFull(idx)
}

// copy selected stack but only parts included in its filterList
function copySelectedFiltered() {
  const idx = selectedIndex.value
  if (typeof idx !== 'number' || idx < 0 || idx >= stacks.value.length) return
  copyStackFiltered(idx)
}

// copy full stack by index
function copyStackFull(idx) {
  const orig = stacks.value[idx]
  if (!orig) return
  const clone = _deepClone(orig)
  // new id and name
  clone.id = 'el_' + Math.random().toString(36).slice(2, 9)
  clone.name = (clone.name || t('stackList.defaultBaseName')) + ' ' + t('stackList.copySuffix')
  // ensure parts have new uids (so focusedPart matching won't confuse)
  if (Array.isArray(clone.data)) {
    for (const p of clone.data) {
      try { delete p._uid } catch (e) { }
    }
  }
  store.addElement(clone)
}

// copy only parts that appear in filterList (if filterList is empty -> nothing)
function copyStackFiltered(idx) {
  const orig = stacks.value[idx]
  if (!orig) return
  const fl = Array.isArray(orig.filterList) ? orig.filterList.slice() : []
  // if no filters or empty, produce empty part list
  const parts = Array.isArray(orig.data) && fl.length > 0 ? orig.data.filter(p => {
    try {
      // determine part's slot name (Group/Asset group detection)
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

  // remove _uid from copied parts so store will reassign new ones when needed
  if (Array.isArray(clone.data)) {
    for (const p of clone.data) {
      try { delete p._uid } catch (e) { }
    }
  }

  store.addElement(clone)
}

// Rename stack: prompt and update store in an immutable-friendly way
function renameStack(idx) {
  if (idx < 0 || idx >= stacks.value.length) return
  const current = stacks.value[idx]
  const currentName = current?.name || ''
  const newName = hostWindow.prompt(t('stackList.promptRename'), currentName)
  if (newName === null) return // cancelled
  const trimmed = String(newName).trim()
  if (!trimmed) return

  try {
    const copy = JSON.parse(JSON.stringify(store.stacks || []))
    if (copy[idx]) copy[idx].name = trimmed
    store.stacks = copy
  } catch (e) {
    // fallback to reactive splice/assign
    try {
      const updated = Object.assign({}, store.stacks[idx] || {}, { name: trimmed })
      store.stacks.splice(idx, 1, updated)
    } catch (ee) {
      // last resort: mutate directly
      if (store.stacks && store.stacks[idx]) store.stacks[idx].name = trimmed
    }
  }

  try { store.refreshMergedAppearanceData && store.refreshMergedAppearanceData() } catch (e) { /* ignore */ }
}

/* ---------------------------
   Drag & Drop reorder (reversed UI)
   - we operate on store indices (entry.idx) while displaying reversed order
----------------------------*/
const draggedStoreIndex = ref(-1)
const dragOverStoreIndex = ref(-1)

// displayStacks: reversed view, but keep original store index with each item
const displayStacks = computed(() => {
  const arr = Array.isArray(stacks.value) ? stacks.value.map((item, idx) => ({ item, idx })) : []
  // add position for naming in reversed order (optional)
  return arr.slice().reverse().map((e, pos) => ({ ...e, position: pos }))
})

function onDragStart(e, storeIdx) {
  draggedStoreIndex.value = storeIdx
  try { e.dataTransfer?.setData('text/plain', String(storeIdx)) } catch (err) { /* ignore */ }
}
function onDragOver(e, storeIdx) {
  // highlight potential drop target (store index)
  dragOverStoreIndex.value = storeIdx
}
function onDrop(e, storeIdx) {
  const from = draggedStoreIndex.value
  const to = storeIdx
  if (from >= 0 && to >= 0 && from !== to) {
    store.moveElement(from, to)
  }
  draggedStoreIndex.value = -1
  dragOverStoreIndex.value = -1
}
</script>

<style scoped>
.stacks-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  box-sizing: border-box;
  height: 100%;
}

/* header */
.stacks-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stacks-header h4 {
  margin: 0;
  font-size: 14px;
  color: #21314a;
}

/* action buttons */
.stacks-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* icon buttons */
.icon-btn {
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 8px;
  border: 1px solid rgba(220, 230, 240, 0.85);
  background: #ffffff;
  /* 纯色背景，已取消渐变 */
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.icon-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.icon-btn.armed {
  background: #fff4f0;
  border-color: #ffb3a0;
}

/* rename button specific */
.rename-btn {
  width: 36px;
  height: 36px;
  font-size: 14px;
}

/* control buttons for less-frequently used actions */
.control-btn {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid #e6eef6;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}

/* list */
.stacks-items {
  list-style: none;
  padding: 8px 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  min-height: 0;
  flex: 1 1 auto;
}

/* row */
.stack-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 10px;
  background: #ffffff;
  /* 已取消渐变 */
  border: 1px solid rgba(220, 230, 240, 0.7);
  cursor: pointer;
  transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
  user-select: none;
  min-height: 56px;
}

.stack-row.dragging {
  outline: 2px dashed rgba(96, 155, 255, 0.25);
  background: #f7fbff;
  /* 轻微单色强调，无渐变 */
}

.stack-row.active {
  box-shadow: 0 8px 26px rgba(20, 30, 60, 0.06);
  border-color: rgba(120, 160, 215, 0.45);
}

/* left */
.item-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.item-name {
  font-weight: 600;
  color: #21314a;
}

.item-meta {
  font-size: 12px;
  color: #6e7a8d;
}

/* controls */
.item-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* empty */
.empty {
  text-align: center;
  color: #8f95a3;
  padding: 16px;
  border-radius: 8px;
  border: 1px dashed rgba(200, 210, 230, 0.6);
}

/* small responsive tweaks */
@media (max-width: 600px) {
  .stacks-header h4 {
    font-size: 13px;
  }

  .icon-btn {
    width: 32px;
    height: 32px;
    font-size: 14px;
  }

  .control-btn {
    padding: 6px 8px;
    font-size: 12px;
  }

  .stack-row {
    padding: 8px 10px;
    min-height: 52px;
  }
}
</style>