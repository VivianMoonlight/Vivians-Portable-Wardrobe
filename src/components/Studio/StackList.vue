<template>
  <div class="stacks-list" ref="rootEl" role="region" :aria-label="t('stackList.ariaLabel')">
    <div class="stacks-header">
      <div class="header-main">
        <h4>{{ t('stackList.title') }}</h4>
        <p class="header-meta">
          {{ t('stackList.statsVisible', { visible: filteredDisplayStacks.length, total: stacks.length }) }}
          <span v-if="hasSelectedName" class="selected-pill">{{ t('stackList.statsSelected', { name: selectedStackName }) }}</span>
        </p>
      </div>

      <div class="stacks-actions">
        <BaseButton
          variant="ghost"
          icon-only
          size="sm"
          :title="t('stackList.newStackTitle')"
          :aria-label="t('stackList.newStackTitle')"
          @click="addNewStack"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </BaseButton>

        <BaseButton
          variant="ghost"
          icon-only
          size="sm"
          :disabled="!hasSelected"
          :title="t('stackList.copyFullTitle')"
          :aria-label="t('stackList.copyFullTitle')"
          @click="copySelectedFull"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        </BaseButton>

        <BaseButton
          variant="ghost"
          icon-only
          size="sm"
          :disabled="!hasSelected"
          :title="t('stackList.copyFilteredTitle')"
          :aria-label="t('stackList.copyFilteredTitle')"
          @click="copySelectedFiltered"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="4" rx="1"></rect>
            <path d="M8 8v10l4 2 4-2V8"></path>
          </svg>
        </BaseButton>
      </div>
    </div>

    <div class="search-row">
      <input
        v-model="searchQuery"
        class="search-input"
        type="text"
        :placeholder="t('stackList.searchPlaceholder')"
        :aria-label="t('stackList.searchAria')"
      />
      <BaseButton
        v-if="searchQuery"
        variant="ghost"
        icon-only
        size="sm"
        class="clear-search-btn"
        :title="t('stackList.clearSearch')"
        :aria-label="t('stackList.clearSearch')"
        @click="clearSearch"
      >
        <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
          <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </BaseButton>
    </div>

    <ul class="stacks-items" role="list" @dragover.prevent>
      <li
        v-for="entry in filteredDisplayStacks"
        :key="entry.item.id || entry.idx"
        class="stack-row"
        :class="{
          active: entry.idx === selectedIndex,
          'drag-over-top': isDropTarget(entry.idx, 'top'),
          'drag-over-bottom': isDropTarget(entry.idx, 'bottom')
        }"
        role="listitem"
        tabindex="0"
        :aria-selected="entry.idx === selectedIndex"
        :title="t('stackList.clickToSelect')"
        @click="select(entry.idx)"
        @keydown.enter.prevent="select(entry.idx)"
        @keydown.space.prevent="select(entry.idx)"
        @keydown.alt.up.prevent="moveVisual(entry.idx, 'up')"
        @keydown.alt.down.prevent="moveVisual(entry.idx, 'down')"
        @keydown.f2.prevent="startRename(entry.idx, entry.item.name)"
        @dragover="onDragOver($event, entry.idx)"
        @drop.prevent="onDrop($event, entry.idx)"
      >
        <div
          class="drag-handle"
          :class="{ disabled: reorderLocked }"
          draggable="true"
          :title="reorderLocked ? t('stackList.reorderDisabledWhileSearch') : t('stackList.dragHandleTitle')"
          @dragstart="onDragStart($event, entry.idx)"
          @click.stop
        >
          ⋮⋮
        </div>

        <div class="item-left">
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
              {{ getStackDisplayName(entry) }}
            </div>
            <div class="item-meta">
              {{ t('stackList.meta', { parts: entry.parts, filters: entry.filters }) }}
            </div>
          </div>
        </div>

        <div class="item-controls">
          <BaseButton
            variant="ghost"
            icon-only
            size="sm"
            class="row-action-btn"
            :disabled="reorderLocked || !canMoveVisual(entry.idx, 'up')"
            :title="reorderLocked ? t('stackList.reorderDisabledWhileSearch') : t('stackList.moveUpTitle')"
            :aria-label="t('stackList.moveUpTitle')"
            @click.stop="moveVisual(entry.idx, 'up')"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="18 15 12 9 6 15"></polyline>
            </svg>
          </BaseButton>

          <BaseButton
            variant="ghost"
            icon-only
            size="sm"
            class="row-action-btn"
            :disabled="reorderLocked || !canMoveVisual(entry.idx, 'down')"
            :title="reorderLocked ? t('stackList.reorderDisabledWhileSearch') : t('stackList.moveDownTitle')"
            :aria-label="t('stackList.moveDownTitle')"
            @click.stop="moveVisual(entry.idx, 'down')"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </BaseButton>

          <BaseButton
            variant="ghost"
            icon-only
            size="sm"
            class="row-action-btn"
            :title="t('stackList.renameTitle')"
            :aria-label="t('stackList.renameTitle')"
            @click.stop="startRename(entry.idx, entry.item.name)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
            </svg>
          </BaseButton>

          <BaseButton
            variant="ghost"
            icon-only
            size="sm"
            class="row-action-btn delete-btn"
            :class="{ armed: isStackArmed(entry.idx) }"
            :disabled="!stacks.length"
            :title="isStackArmed(entry.idx) ? t('stackList.deleteConfirmTitle') : t('stackList.deleteArmTitle')"
            :aria-label="isStackArmed(entry.idx) ? t('stackList.deleteConfirmTitle') : t('stackList.deleteArmTitle')"
            @click.stop="toggleArmStackDelete(entry.idx)"
          >
            <svg v-if="isStackArmed(entry.idx)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </BaseButton>
        </div>
      </li>

      <li v-if="filteredDisplayStacks.length === 0" class="empty">
        <p>{{ emptyStateText }}</p>
        <BaseButton
          v-if="searchQuery"
          variant="ghost"
          size="sm"
          @click="clearSearch"
        >
          {{ t('stackList.clearSearch') }}
        </BaseButton>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseButton from '../ui/BaseButton.vue'
import { useStudioDomainStores } from '@/stores/studio'
import { doc } from '@/utils/host-window.js'

const { t } = useI18n()
const { studio: store } = useStudioDomainStores()
const emit = defineEmits(['stack-selected'])

const rootEl = ref(null)
const renameInputRef = ref(null)
const searchQuery = ref('')

const stacks = computed(() => store.stacks)
const selectedIndex = computed(() => store.selectedIndex)
const hasSelected = computed(() => typeof selectedIndex.value === 'number' && selectedIndex.value >= 0)
const hasSearchQuery = computed(() => searchQuery.value.trim().length > 0)
const reorderLocked = computed(() => hasSearchQuery.value)

const selectedStackName = computed(() => {
  const idx = selectedIndex.value
  if (typeof idx !== 'number' || idx < 0 || idx >= stacks.value.length) return ''
  const raw = stacks.value[idx]?.name
  return typeof raw === 'string' ? raw.trim() : ''
})
const hasSelectedName = computed(() => !!selectedStackName.value)

const displayStacks = computed(() => {
  const arr = Array.isArray(stacks.value)
    ? stacks.value.map((item, idx) => ({
      item,
      idx,
      parts: Array.isArray(item?.data) ? item.data.length : 0,
      filters: Array.isArray(item?.filterList) ? item.filterList.length : 0
    }))
    : []

  return arr.slice().reverse().map((entry, position) => ({ ...entry, position }))
})

const filteredDisplayStacks = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return displayStacks.value
  return displayStacks.value.filter(entry => {
    const name = getStackDisplayName(entry).toLowerCase()
    return name.includes(q)
  })
})

const emptyStateText = computed(() => {
  if (stacks.value.length === 0) return t('stackList.empty')
  return t('stackList.emptySearch')
})

function getStackDisplayName(entry) {
  const rawName = entry?.item?.name
  if (typeof rawName === 'string' && rawName.trim()) return rawName.trim()
  return t('stackList.defaultName', { n: entry.position + 1 })
}

function clearSearch() {
  searchQuery.value = ''
}

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

  if (renamingIndex.value === idx) {
    cancelRename()
  }

  store.removeElement(idx)
  armedStacks.value.clear()
}

function onDocumentClick(e) {
  if (!rootEl.value) return
  const clickedInside = rootEl.value.contains(e.target)
  if (clickedInside) return

  armedStacks.value.clear()
  if (renamingIndex.value !== -1) {
    commitRename(renamingIndex.value)
  }
}

onMounted(() => {
  doc.addEventListener('click', onDocumentClick, true)
})

onBeforeUnmount(() => {
  doc.removeEventListener('click', onDocumentClick, true)
})

function select(idx) {
  store.select(idx)
  emit('stack-selected')
  armedStacks.value.clear()
}

function addNewStack() {
  const id = 'el_' + Math.random().toString(36).slice(2, 9)
  const name = t('stackList.defaultNewName', { n: stacks.value.length + 1 })
  const element = { id, name, data: [], filterList: [] }
  store.addElement(element)
}

function _deepClone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj))
  } catch (e) {
    if (typeof structuredClone === 'function') return structuredClone(obj)
    return Object.assign({}, obj)
  }
}

function copySelectedFull() {
  const idx = selectedIndex.value
  if (typeof idx !== 'number' || idx < 0 || idx >= stacks.value.length) return

  const original = stacks.value[idx]
  if (!original) return

  const clone = _deepClone(original)
  clone.id = 'el_' + Math.random().toString(36).slice(2, 9)
  clone.name = (clone.name || t('stackList.defaultBaseName')) + ' ' + t('stackList.copySuffix')

  if (Array.isArray(clone.data)) {
    for (const part of clone.data) {
      try { delete part._uid } catch (e) { }
    }
  }

  store.addElement(clone)
}

function copySelectedFiltered() {
  const idx = selectedIndex.value
  if (typeof idx !== 'number' || idx < 0 || idx >= stacks.value.length) return

  const original = stacks.value[idx]
  if (!original) return

  const filterList = Array.isArray(original.filterList) ? original.filterList.slice() : []
  const filteredParts = Array.isArray(original.data) && filterList.length > 0
    ? original.data.filter(part => {
      try {
        const slot = (part && (part.Group || (part.Asset && part.Asset.Group && (part.Asset.Group.Name || part.Asset.Group.name)))) || ''
        return filterList.includes(slot)
      } catch (e) {
        return false
      }
    })
    : []

  const clone = {
    id: 'el_' + Math.random().toString(36).slice(2, 9),
    name: (original.name || t('stackList.defaultBaseName')) + ' ' + t('stackList.copyFilteredSuffix'),
    data: _deepClone(filteredParts),
    filterList: _deepClone(filterList)
  }

  if (Array.isArray(clone.data)) {
    for (const part of clone.data) {
      try { delete part._uid } catch (e) { }
    }
  }

  store.addElement(clone)
}

const renamingIndex = ref(-1)
const renamingValue = ref('')

function _getRenameInputEl() {
  if (Array.isArray(renameInputRef.value)) return renameInputRef.value[0] || null
  return renameInputRef.value || null
}

function startRename(idx, currentName) {
  renamingIndex.value = idx
  renamingValue.value = currentName || ''
  armedStacks.value.clear()

  nextTick(() => {
    const inputEl = _getRenameInputEl()
    inputEl?.focus()
    inputEl?.select()
  })
}

function commitRename(idx) {
  if (renamingIndex.value !== idx) return

  const nextName = String(renamingValue.value || '').trim()
  renamingIndex.value = -1

  if (!nextName || !store.stacks[idx]) return
  if (String(store.stacks[idx].name || '').trim() === nextName) return

  store.execute({
    type: 'stack.rename',
    payload: { stackIndex: idx, newName: nextName }
  })
}

function cancelRename() {
  renamingIndex.value = -1
}

const draggedStoreIndex = ref(-1)
const dragOverStoreIndex = ref(-1)
const dropPosition = ref(null)

function onDragStart(e, storeIdx) {
  if (reorderLocked.value) {
    e.preventDefault()
    return
  }

  draggedStoreIndex.value = storeIdx
  try { e.dataTransfer?.setData('text/plain', String(storeIdx)) } catch (err) { }
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(e, storeIdx) {
  if (reorderLocked.value || draggedStoreIndex.value === -1 || draggedStoreIndex.value === storeIdx) {
    dragOverStoreIndex.value = -1
    dropPosition.value = null
    return
  }

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
  if (reorderLocked.value) {
    resetDrag()
    return
  }

  const from = draggedStoreIndex.value
  const hovered = storeIdx

  if (from === -1 || from === hovered) {
    resetDrag()
    return
  }

  let toIndex = dropPosition.value === 'top' ? hovered + 1 : hovered

  if (from < toIndex) toIndex -= 1

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

function canMoveVisual(storeIdx, dir) {
  if (dir === 'up') return storeIdx < stacks.value.length - 1
  if (dir === 'down') return storeIdx > 0
  return false
}

function moveVisual(storeIdx, dir) {
  if (reorderLocked.value || !canMoveVisual(storeIdx, dir)) return
  const targetIdx = dir === 'up' ? storeIdx + 1 : storeIdx - 1
  store.moveElement(storeIdx, targetIdx)
}
</script>

<style scoped>
.stacks-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm, 8px);
  padding: var(--space-sm, 8px);
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
}

.stacks-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-sm, 8px);
  flex-shrink: 0;
}

.header-main {
  min-width: 0;
}

.stacks-header h4 {
  margin: 0;
  font-size: var(--font-size-md, 14px);
  color: var(--color-text-primary, #1e293b);
}

.header-meta {
  margin: 2px 0 0;
  font-size: var(--font-size-xs, 12px);
  color: var(--color-text-tertiary, #64748b);
  display: flex;
  align-items: center;
  gap: var(--space-sm, 8px);
  flex-wrap: wrap;
}

.selected-pill {
  display: inline-flex;
  align-items: center;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 8px;
  border-radius: var(--radius-xl, 999px);
  border: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-surface, #f8fafc);
}

.stacks-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.search-row {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--color-border-base, #e2e8f0);
  border-radius: var(--radius-md, 8px);
  padding: 2px 4px 2px 8px;
  background: var(--color-bg-base, #ffffff);
  flex-shrink: 0;
}

.search-row:focus-within {
  border-color: var(--color-border-focus, #93c5fd);
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.06));
}

.search-input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-text-primary, #0f172a);
  font-size: var(--font-size-sm, 12px);
}

.search-input::placeholder {
  color: var(--color-text-tertiary, #94a3b8);
}

.clear-search-btn {
  flex-shrink: 0;
}

.stacks-items {
  list-style: none;
  padding: var(--space-xs, 4px) 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm, 8px);
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  flex: 1 1 auto;
}

.stack-row {
  display: flex;
  align-items: center;
  min-height: 54px;
  padding: 6px 8px;
  border-radius: var(--radius-lg, 10px);
  border: 1px solid var(--color-border-base, rgba(220, 230, 240, 0.7));
  background: var(--color-bg-base, #ffffff);
  cursor: pointer;
  user-select: none;
  position: relative;
  transition: all var(--transition-fast, 0.15s) ease;
  outline: none;
}

.stack-row::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  opacity: 0;
  background: var(--color-primary, #2563eb);
  transition: opacity var(--transition-fast, 0.15s) ease;
}

.stack-row:hover {
  background: var(--color-bg-hover, #f1f5f9);
  border-color: var(--color-border-strong, #cbd5e1);
}

.stack-row:focus-visible {
  border-color: var(--color-border-focus, rgba(120, 160, 215, 0.6));
  box-shadow: var(--shadow-sm, 0 0 0 2px rgba(59, 130, 246, 0.12));
}

.stack-row.active {
  box-shadow: var(--shadow-md, 0 4px 12px rgba(20, 30, 60, 0.08));
  border-color: var(--color-border-focus, rgba(120, 160, 215, 0.6));
  background: var(--color-bg-base, #fdfdfd);
}

.stack-row.active::before {
  opacity: 1;
}

.stack-row.drag-over-top {
  border-top: 2px solid var(--color-primary, #2563eb);
  margin-top: -2px;
}

.stack-row.drag-over-bottom {
  border-bottom: 2px solid var(--color-primary, #2563eb);
  margin-bottom: -2px;
}

.drag-handle {
  width: 20px;
  text-align: center;
  cursor: grab;
  color: var(--color-text-muted, #94a3b8);
  padding: 4px;
  margin-right: 4px;
  font-size: 15px;
  line-height: 1;
  flex-shrink: 0;
}

.drag-handle:active {
  cursor: grabbing;
}

.drag-handle.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.item-left {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  margin-right: 8px;
}

.item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.item-name {
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-text-primary, #0f172a);
  font-size: var(--font-size-sm, 13px);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-meta {
  font-size: var(--font-size-xs, 12px);
  color: var(--color-text-tertiary, #64748b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rename-container {
  width: 100%;
}

.rename-input {
  width: 100%;
  font-size: var(--font-size-sm, 13px);
  font-weight: var(--font-weight-semibold, 600);
  padding: 4px 6px;
  border: 1px solid var(--color-selection-single, #417aed);
  border-radius: var(--radius-xs, 4px);
  outline: none;
  background: var(--color-bg-base, #fff);
  color: var(--color-text-primary, #0f172a);
  box-sizing: border-box;
}

.item-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.row-action-btn {
  color: var(--color-text-secondary, #64748b);
}

.delete-btn.armed {
  color: var(--color-danger, #dc2626);
  background: var(--color-error-bg, #fee2e2);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm, 8px);
  text-align: center;
  color: var(--color-text-muted, #94a3b8);
  padding: 20px 12px;
  border-radius: var(--radius-md, 8px);
  border: 1px dashed var(--color-border-base, #e2e8f0);
  font-size: var(--font-size-sm, 13px);
}

.empty p {
  margin: 0;
}
</style>
