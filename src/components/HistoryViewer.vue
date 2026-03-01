<script setup>
import { computed, ref, onMounted, onBeforeUnmount, nextTick, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFileSystemStore } from '@/stores/fileSystemStore'
import FileThumbnail from './FileThumbnail.vue'
import { injectTheme } from '@/services/ThemeService'
import { ExternalAdapter } from '@/utils/external_adapters.js'
import { hostWindow, doc } from '@/utils/host-window.js'
import * as DialogService from '@/services/DialogService.js'

const { t } = useI18n()

// Inject theme
const injectedTheme = injectTheme()
const themeClass = computed(() => injectedTheme.themeClass())

const props = defineProps({
  embedded: { type: Boolean, default: false }
})

const fsStore = useFileSystemStore()

// Get history records
const historyRecords = computed(() => fsStore.getHistoryRecords())
const searchQuery = ref('')
const timeFilter = ref('all')

const filteredHistoryRecords = computed(() => {
  const q = (searchQuery.value || '').trim().toLowerCase()
  const now = Date.now()

  return (historyRecords.value || []).filter((record) => {
    const ts = record?.name || ''
    const matchesQuery = !q || ts.toLowerCase().includes(q)
    if (!matchesQuery) return false

    if (timeFilter.value === 'all') return true
    const match = ts.match(/Record_(.+)/)
    if (!match) return timeFilter.value === 'all'
    const recordTime = new Date(match[1]).getTime()
    if (Number.isNaN(recordTime)) return false

    if (timeFilter.value === 'today') {
      return now - recordTime <= 24 * 60 * 60 * 1000
    }
    if (timeFilter.value === 'week') {
      return now - recordTime <= 7 * 24 * 60 * 60 * 1000
    }
    return true
  })
})

function clearSearch() {
  searchQuery.value = ''
}

// Format timestamp for display
function formatTimestamp(recordName) {
  try {
    // Extract ISO timestamp from record name (format:Record_2024-01-01T12:00:00.000Z)
    const match = recordName.match(/Record_(.+)/)
    if (!match) return recordName

    const isoString = match[1]
    const date = new Date(isoString)

    // Format: "2024-12-18 10:30 AM"
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    let hours = date.getHours()
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const ampm = hours >= 12 ? 'PM' : 'AM'
    hours = hours % 12 || 12

    return `${year}-${month}-${day} ${hours}:${minutes} ${ampm}`
  } catch (e) {
    return recordName
  }
}

// Context menu state
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  record: null
})

// menu element id (unique)
const menuElId = 'vpw-history-context-' + Math.random().toString(36).slice(2, 8)

// root element reference
const rootEl = ref(null)

// Open context menu at position
function openContextMenuAt(clientX, clientY, record) {
  contextMenu.value.visible = true
  contextMenu.value.record = record

  // Set initial position
  contextMenu.value.x = clientX
  contextMenu.value.y = clientY

  // Adjust position in next frame to ensure menu stays in viewport
  nextTick(() => {
    requestAnimationFrame(() => {
      const menuEl = doc.getElementById(menuElId)
      if (!menuEl) return

      const rect = menuEl.getBoundingClientRect()
      const vw = hostWindow.innerWidth || doc.documentElement.clientWidth
      const vh = hostWindow.innerHeight || doc.documentElement.clientHeight
      const padding = 8

      let x = contextMenu.value.x
      let y = contextMenu.value.y

      // Adjust if overflowing viewport
      if (x + rect.width + padding > vw) {
        x = Math.max(padding, vw - rect.width - padding)
      }
      if (y + rect.height + padding > vh) {
        y = Math.max(padding, vh - rect.height - padding)
      }

      // Ensure not pushed outside viewport
      if (x < padding) x = padding
      if (y < padding) y = padding

      contextMenu.value.x = x
      contextMenu.value.y = y
    })
  })
}

function closeContextMenu() {
  contextMenu.value.visible = false
  contextMenu.value.record = null
}

// Context menu handler
function onContextMenu(e, record) {
  e.preventDefault()
  e.stopPropagation()
  openContextMenuAt(e.clientX, e.clientY, record)
}

// Load record into preview
function loadRecord(record) {
  fsStore.loadHistoryRecord(record)
}

// Apply record to character (for double-click and context menu)
function applyRecordToCharacter(record) {
  if (!record || !record.data || !Array.isArray(record.data) || record.data.length === 0) {
    console.warn('Record data is empty or invalid')
    return
  }

  const target = fsStore.character || hostWindow.CurrentCharacter || hostWindow.Player
  if (!target) {
    console.error('Target character not found')
    return
  }

  try {
    ExternalAdapter.applyOutfitToCharacter(toRaw(target), toRaw(record.data))
    console.log('Applied history record to character:', record.name)
  } catch (e) {
    console.error('Failed to apply record to character', e)
  }
}

// Context menu actions
function applyFromMenu() {
  closeContextMenu()
  if (contextMenu.value.record) {
    applyRecordToCharacter(contextMenu.value.record)
  }
}

function loadFromMenu() {
  closeContextMenu()
  if (contextMenu.value.record) {
    loadRecord(contextMenu.value.record)
  }
}

function deleteFromMenu() {
  closeContextMenu()
  if (contextMenu.value.record) {
    deleteRecord(contextMenu.value.record)
  }
}

// Delete single record with confirmation
async function deleteRecord(record) {
  const confirmed = await DialogService.confirm(t('historyViewer.deleteConfirm'));
  if (confirmed) {
    fsStore.deleteHistoryRecord(record)
  }
}

// Clear all history with confirmation
async function clearAllHistory() {
  const confirmed = await DialogService.confirm(t('historyViewer.clearAllConfirm'));
  if (confirmed) {
    fsStore.clearHistory()
  }
}

// Single click - load record into preview
function onRecordClick(record) {
  fsStore.setActiveItem(record)
  loadRecord(record)
}

// Double click - apply to character
function onRecordDoubleClick(record) {
  applyRecordToCharacter(record)
}

// Mouse hover - set as active item for preview
function onRecordMouseEnter(record) {
  if (!canUseHover()) return
  fsStore.setActiveItem(record)
}

function onRecordMouseLeave(record) {
  if (!canUseHover()) return
  if (fsStore.activeItem === record) {
    fsStore.setActiveItem(-1)
  }
}

function onRecordFocus(record) {
  fsStore.setActiveItem(record)
}

function onRecordBlur(e, record) {
  if (rootEl.value && e?.relatedTarget && rootEl.value.contains(e.relatedTarget)) return
  if (fsStore.activeItem === record) {
    fsStore.setActiveItem(-1)
  }
}

function canUseHover() {
  return !!(hostWindow.matchMedia && hostWindow.matchMedia('(hover: hover) and (pointer: fine)').matches)
}

// Global click/key handlers to close context menu
function onGlobalClick(e) {
  if (!contextMenu.value.visible) return

  const path = (e.composedPath && e.composedPath()) ||
    (e.path && e.path) ||
    (function () {
      const arr = []
      let node = e.target
      while (node) {
        arr.push(node)
        node = node.parentNode
      }
      return arr
    })()

  const menuEl = doc.getElementById(menuElId)
  if (menuEl && path.indexOf(menuEl) >= 0) return

  closeContextMenu()
}

function onGlobalKey(e) {
  if (e.key === 'Escape' && contextMenu.value.visible) closeContextMenu()
}

onMounted(() => {
  hostWindow.addEventListener('click', onGlobalClick, true)
  hostWindow.addEventListener('keydown', onGlobalKey, true)
})

onBeforeUnmount(() => {
  hostWindow.removeEventListener('click', onGlobalClick, true)
  hostWindow.removeEventListener('keydown', onGlobalKey, true)
})

// Calculate container style
const panelStyle = computed(() => {
  if (props.embedded) {
    return {
      width: '100%',
      height: '100%',
      position: 'relative'
    }
  } else {
    return {
      width: '900px',
      height: '600px',
      position: 'fixed',
      zIndex: 2147,
      background: 'transparent'
    }
  }
})
</script>

<template>
  <div ref="rootEl" class="history-viewer-panel" :class="themeClass" :style="panelStyle">
    <div class="panel-inner">
      <div class="panel-top">
        <div class="title">
          <span class="title-text">{{ t('historyViewer.title') }}</span>
          <span class="record-count" v-if="historyRecords.length > 0">
            {{ t('historyViewer.recordCount', { count: filteredHistoryRecords.length }) }}
          </span>
        </div>

        <div class="top-actions">
          <button class="panel-button clear-all-btn" @click.stop="clearAllHistory" :title="t('historyViewer.clearAll')"
            v-if="historyRecords.length > 0">
            🗑️
          </button>
        </div>
      </div>

      <div class="toolbar">
        <div class="search-row">
          <input
            v-model="searchQuery"
            :placeholder="t('historyViewer.searchPlaceholder')"
            class="search-input"
            :aria-label="t('historyViewer.searchPlaceholder')"
          />
          <button v-if="searchQuery" class="chip-btn" @click="clearSearch">{{ t('historyViewer.clearSearch') }}</button>
        </div>
        <div class="chip-group" role="group" :aria-label="t('historyViewer.timeFilter')">
          <button class="chip-btn" :class="{ active: timeFilter === 'all' }" @click="timeFilter = 'all'">{{ t('historyViewer.filterAll') }}</button>
          <button class="chip-btn" :class="{ active: timeFilter === 'today' }" @click="timeFilter = 'today'">{{ t('historyViewer.filterToday') }}</button>
          <button class="chip-btn" :class="{ active: timeFilter === 'week' }" @click="timeFilter = 'week'">{{ t('historyViewer.filterWeek') }}</button>
        </div>
      </div>

      <div class="history-list scrollable">
        <template v-if="filteredHistoryRecords.length > 0">
          <div v-for="(record, index) in filteredHistoryRecords" :key="record.name" class="history-record-card"
            @click="onRecordClick(record)" @dblclick="onRecordDoubleClick(record)"
            @contextmenu.capture="onContextMenu($event, record)" @mouseenter="onRecordMouseEnter(record)"
            @mouseleave="onRecordMouseLeave(record)" @focusin="onRecordFocus(record)"
            @focusout="onRecordBlur($event, record)" tabindex="0">
            <div class="record-thumbnail">
              <FileThumbnail :item="record" />
            </div>
            <div class="record-info">
              <div class="record-timestamp">
                <time :datetime="record.name.replace('Record_', '')">
                  {{ formatTimestamp(record.name) }}
                </time>
              </div>
              <div class="record-meta">
                <span class="record-index">#{{ filteredHistoryRecords.length - index }}</span>
              </div>
            </div>
            <div class="record-actions">
              <button class="action-btn delete-btn" @click.stop="deleteRecord(record)"
                :aria-label="t('historyViewer.deleteRecord')" :title="t('historyViewer.deleteRecord')">
                ✕
              </button>
            </div>
          </div>
        </template>
        <div v-else class="empty-state">
          <div class="empty-icon">🕒</div>
          <div class="empty-text">{{ t('historyViewer.emptyState') }}</div>
        </div>
      </div>
    </div>

    <!-- Context menu teleported to body -->
    <teleport to="body">
      <div :class="themeClass">
        <div v-if="contextMenu.visible" :id="menuElId" class="context-menu" :class="themeClass"
          :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" role="menu" aria-hidden="false">
          <ul>
            <li @click="applyFromMenu">{{ t('historyViewer.apply') }}</li>
            <li @click="deleteFromMenu">{{ t('historyViewer.delete') }}</li>
            <!--li @click="loadFromMenu">{{ t('historyViewer.loadToPreview') }}</li>
            <li @click="closeContextMenu">{{ t('historyViewer.cancel') }}</li-->
          </ul>
        </div>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
/* Panel container */
.history-viewer-panel {
  pointer-events: auto;
  min-width: 200px;
  min-height: 320px;
  max-width: 98vw;
  max-height: 94vh;
  overflow: hidden;
  border-radius: var(--radius-xl, 13px);
  box-shadow: var(--shadow-lg, 0 6px 28px rgba(10, 20, 40, 0.06));
}

/* 嵌入模式：移除固定的最小尺寸 */
:is(.history-viewer-panel)[style*="position: relative"] {
  min-width: auto;
  min-height: auto;
  border-radius: 0;
  box-shadow: none;
  max-width: 100%;
  max-height: 100%;
}

/* Inner panel */
.panel-inner {
  width: 100%;
  height: 100%;
  padding: var(--space-md, 12px);
  box-sizing: border-box;
  background: var(--color-bg-surface, #fbfdff);
  border: 1.5px solid var(--color-border-base, rgba(230, 235, 240, 0.9));
  border-radius: var(--radius-xl, 12px);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Top area with title and actions */
.panel-top {
  display: flex;
  align-items: center;
  gap: var(--space-md, 12px);
  user-select: none;
}

.title {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 8px);
}

.title-text {
  font-size: 1.1em;
  font-weight: var(--font-weight-bold, 700);
  color: var(--color-text-primary, #24303f);
}

.record-count {
  font-size: 0.85em;
  color: var(--color-text-muted, #94a3b8);
  font-weight: var(--font-weight-normal, 400);
}

/* Actions on the right */
.top-actions {
  margin-left: auto;
  display: flex;
  gap: var(--space-sm, 8px);
  align-items: center;
}

.panel-button {
  height: 36px;
  border-radius: var(--radius-md, 8px);
  width: 48px;
  background: var(--color-bg-base, #fff);
  border: 1px solid var(--color-border-base, #ddd);
  color: var(--color-text-primary, #23324a);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background var(--transition-fast, 0.15s);
}

.toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.search-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-input {
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--radius-lg, 10px);
  border: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-base, #fff);
  color: var(--color-text-primary, #0f172a);
  outline: none;
}

.search-input:focus {
  box-shadow: 0 0 0 3px var(--color-border-focus, rgba(59,130,246,0.12));
  border-color: var(--color-primary, #3b82f6);
}

.chip-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.chip-btn {
  border: 1px solid var(--color-border-base, #d6dbe2);
  background: var(--color-bg-base, #fff);
  color: var(--color-text-secondary, #475569);
  border-radius: var(--radius-md, 8px);
  padding: 6px 10px;
  font-size: var(--font-size-sm, 12px);
  cursor: pointer;
}

.chip-btn.active {
  border-color: var(--color-primary, #3b82f6);
  color: var(--color-primary, #3b82f6);
  background: var(--color-primary-bg, rgba(59, 130, 246, 0.1));
}

/* History list - timeline layout */
.history-list {
  padding: var(--space-md, 12px);
  overflow-y: auto;
  min-height: 200px;
  max-height: calc(100% - 80px);
  display: flex;
  flex-direction: column;
  gap: var(--space-md, 12px);
}

/* Individual history record card */
.history-record-card {
  display: flex;
  align-items: center;
  gap: var(--space-md, 12px);
  padding: var(--space-md, 12px);
  background: var(--color-bg-base, #fff);
  border: 1px solid var(--color-border-base, #e2e8f0);
  border-radius: var(--radius-lg, 10px);
  cursor: pointer;
  transition: all var(--transition-fast, 0.15s) ease;
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.05));
  user-select: none;
}

.history-record-card:focus-visible {
  border-color: var(--color-primary, #3b82f6);
  box-shadow: 0 0 0 2px var(--color-primary-bg, rgba(59, 130, 246, 0.2));
}

.history-record-card:active {
  transform: translateY(0);
}

/* Thumbnail area */
.record-thumbnail {
  flex: 0 0 72px;
  width: 72px;
  aspect-ratio: 9 / 16;
  height: auto;
  border-radius: var(--radius-md, 8px);
  overflow: hidden;
  border: 1px solid var(--color-border-light, #e6eef6);
  background: var(--color-bg-panel, #f1f5f9);
  position: relative;
}

/* Record info */
.record-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs, 4px);
}

.record-timestamp {
  font-size: var(--font-size-base, 14px);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-text-primary, #0f172a);
}

.record-meta {
  font-size: var(--font-size-sm, 12px);
  color: var(--color-text-muted, #94a3b8);
}

.record-index {
  font-family: monospace;
}

/* Record actions */
.record-actions {
  display: flex;
  gap: var(--space-xs, 4px);
  align-items: center;
}

.action-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-base, #fff);
  color: var(--color-text-secondary, #64748b);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  transition: all var(--transition-fast, 0.15s);
}

@media (hover: hover) and (pointer: fine) {
  .panel-button:hover {
    background: var(--color-bg-hover, #f0f4f8);
  }

  .clear-all-btn:hover {
    background: var(--color-error-bg, #fee2e2);
    border-color: var(--color-error, #ef4444);
  }

  .history-record-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.1));
    border-color: var(--color-primary, #3b82f6);
  }

  .action-btn:hover {
    background: var(--color-bg-hover, #f0f4f8);
  }

  .delete-btn:hover {
    background: var(--color-error-bg, #fee2e2);
    border-color: var(--color-error, #ef4444);
  }
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  color: var(--color-text-muted, #94a3b8);
  text-align: center;
  padding: var(--space-xl, 24px);
}

.empty-icon {
  font-size: 64px;
  margin-bottom: var(--space-lg, 16px);
  opacity: 0.5;
}

.empty-text {
  font-size: var(--font-size-lg, 17px);
  max-width: 400px;
  line-height: 1.5;
}

/* Context menu */
.context-menu {
  position: fixed;
  z-index: 1000000;
  background: var(--color-bg-base, #fff);
  border: 1px solid var(--color-border-base, rgba(30, 40, 60, 0.08));
  box-shadow: var(--shadow-lg, 0 10px 26px rgba(10, 20, 40, 0.18));
  border-radius: var(--radius-md, 8px);
  overflow: hidden;
  min-width: 160px;
}

.context-menu ul {
  list-style: none;
  margin: 0;
  padding: var(--space-sm, 6px) var(--space-xs, 4px);
}

.context-menu li {
  padding: var(--space-sm, 8px) var(--space-md, 12px);
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  color: var(--color-text-primary, #253247);
  font-weight: var(--font-weight-medium, 500);
  white-space: nowrap;
  transition: background var(--transition-fast, 0.15s) ease;
}

.context-menu li:hover {
  background: var(--color-bg-hover, #f2f6fb);
}

/* Scrollbar styling */
.scrollable {
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-strong, #cbd5e1) transparent;
}

.scrollable::-webkit-scrollbar {
  width: 8px;
}

.scrollable::-webkit-scrollbar-track {
  background: transparent;
}

.scrollable::-webkit-scrollbar-thumb {
  background: var(--color-border-strong, #cbd5e1);
  border-radius: 4px;
}

.scrollable::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-muted, #94a3b8);
}

/* Responsive adjustments */
@media (max-width:640px) {
  .history-record-card {
    flex-direction: column;
    align-items: flex-start;
  }

  .record-thumbnail {
    width: min(44vw, 148px);
    flex-basis: auto;
    aspect-ratio: 9 / 16;
    height: auto;
  }

  .record-actions {
    width: 100%;
    justify-content: flex-end;
  }

  .panel-inner {
    padding: 8px;
  }

  .title-text {
    font-size: 1em;
  }
}
</style>