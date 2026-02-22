<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFileSystemStore } from '@/stores/fileSystemStore'
import { useWorkbenchStore } from '@/stores/workbenchStore'
import FileItem from './FileItem.vue'
import BaseButton from './ui/BaseButton.vue'
import { hostWindow, doc, } from '@/utils/host-window.js'
import { injectTheme } from '@/services/ThemeService'
import * as DialogService from '@/services/DialogService.js'

const { t } = useI18n()

// Inject theme
const injectedTheme = injectTheme()
const themeClass = computed(() => injectedTheme.themeClass())

const props = defineProps({
  embedded: { type: Boolean, default: false }, // 嵌入模式：外层面板负责布局与关闭
  onImportPlayerWardrobe: { type: Function, default: null },
  onSaveBackup: { type: Function, default: null },
  onImportBackup: { type: Function, default: null }
})
const emit = defineEmits(['close'])
const fsStore = useFileSystemStore()
const workbenchStore = useWorkbenchStore()

// local search state
const searchQuery = ref('')
const searchScope = computed({
  get: () => workbenchStore.wardrobeUi.searchScope || 'current',
  set: (value) => workbenchStore.setWardrobeUi({ searchScope: value })
})
const sortBy = computed({
  get: () => workbenchStore.wardrobeUi.sortBy || 'recent',
  set: (value) => workbenchStore.setWardrobeUi({ sortBy: value })
})
const fileViewMode = computed({
  get: () => workbenchStore.wardrobeUi.fileViewMode || 'large',
  set: (value) => workbenchStore.setWardrobeUi({ fileViewMode: value })
})

const sortLabel = computed(() => {
  const map = {
    recent: t('fileManager.sortRecent'),
    name: t('fileManager.sortName'),
    type: t('fileManager.sortType')
  }
  return map[sortBy.value] || t('fileManager.sortRecent')
})

// items in current folder (raw)
const items = computed(() => fsStore.currentNode?.children ?? [])

// Build display list: array of { item, path } so UI can handle both current-folder view and global search results uniformly
const displayList = computed(() => {
  const q = (searchQuery.value || '').trim()
  const ql = q.toLowerCase()
  let baseList = []
  if (!q) {
    baseList = (items.value || []).map(it => ({ item: it, path: fsStore.currentPath }))
  } else if (searchScope.value === 'current') {
    baseList = (items.value || [])
      .filter(it => (it.name || '').toLowerCase().includes(ql))
      .map(it => ({ item: it, path: fsStore.currentPath }))
  } else {
    // global search via store wrapper (returns array of { item, path })
    try {
      baseList = fsStore.searchFiles(q)
    } catch (e) {
      console.warn('search failed', e)
      baseList = []
    }
  }

  const list = [...baseList]
  if (sortBy.value === 'name') {
    return list.sort((a, b) => (a.item?.name || '').localeCompare(b.item?.name || ''))
  }
  if (sortBy.value === 'type') {
    return list.sort((a, b) => {
      const typeDiff = (a.item?.type || '').localeCompare(b.item?.type || '')
      if (typeDiff !== 0) return typeDiff
      return (a.item?.name || '').localeCompare(b.item?.name || '')
    })
  }
  return list.reverse()
})

// helper: clear search
function clearSearch() {
  searchQuery.value = ''
}

// helper: toggle scope
function toggleScope() {
  searchScope.value = searchScope.value === 'current' ? 'all' : 'current'
}

function setSort(value) {
  sortBy.value = value
}

function cycleSort() {
  const order = ['recent', 'name', 'type']
  const idx = order.indexOf(sortBy.value)
  const next = order[(idx + 1) % order.length]
  setSort(next)
}

function setFileViewMode(value) {
  fileViewMode.value = value
}

function switchToGlobalSearch() {
  searchScope.value = 'all'
}

function onImportPlayerWardrobeClick() {
  if (typeof props.onImportPlayerWardrobe === 'function') {
    props.onImportPlayerWardrobe()
  }
}

function onSaveBackupClick() {
  if (typeof props.onSaveBackup === 'function') {
    props.onSaveBackup()
  }
}

function onImportBackupClick() {
  if (typeof props.onImportBackup === 'function') {
    props.onImportBackup()
  }
}

// existing methods
async function onAddFolder() {
  const name = await DialogService.prompt(t('fileManager.promptNewFolderName'))
  if (name) fsStore.addFile({ name, type: 'folder', children: [] })
}

// 新：刷新缩略图（对显示列表内的每个文件触发重新生成）
function onRefreshThumbnails() {
  try {
    const list = displayList.value || []
    list.forEach(({ item }) => {
      if (!item || item.type === 'folder') return
      try {
        // stop any existing generation for this item (compatible method names)
        if (fsStore.renderer && typeof fsStore.renderer.stopFor === 'function') {
          fsStore.renderer.stopFor(item)
        } else if (fsStore.renderer && typeof fsStore.renderer.removeCanvas === 'function') {
          fsStore.renderer.removeCanvas(item)
        }
      } catch (e) {
        // ignore
      }
      // restart generation
      try {
        fsStore.startThumbnailGeneration(item)
      } catch (e) {
        // ignore
      }
      // bump a lightweight marker on the item so FileThumbnail's deep watcher notices change
      try {
        item.__thumbRefresh = Date.now()
      } catch (e) {
        // ignore
      }
    })
  } catch (e) {
    console.warn('onRefreshThumbnails failed', e)
  }
}

// 拖拽相关（仅在非嵌入模式启用）
const dragging = ref(false)
const resizing = ref(false)
const dragOffset = ref({ x: 0, y: 0 })
const size = ref({ w: 900, h: 600 })
const position = ref({ x: 80, y: 80 })

function startDrag(e) {
  if (props.embedded) return;
  if (e.button !== undefined && e.button !== 0) return;
  dragging.value = true;
  dragOffset.value = {
    x: e.clientX - position.value.x,
    y: e.clientY - position.value.y,
  }
  doc.body.style.userSelect = 'none';
}
function onDrag(e) {
  if (!dragging.value) return;
  position.value.x = e.clientX - dragOffset.value.x
  position.value.y = e.clientY - dragOffset.value.y
}
function endDrag() {
  dragging.value = false;
  doc.body.style.userSelect = '';
}

// 缩放相关
function startResize(e) {
  if (props.embedded) return;
  if (e.button !== undefined && e.button !== 0) return;
  resizing.value = true
  dragOffset.value = {
    x: e.clientX - size.value.w,
    y: e.clientY - size.value.h,
  }
  doc.body.style.userSelect = 'none';
}
function onResize(e) {
  if (!resizing.value) return;
  size.value.w = Math.max(450, e.clientX - dragOffset.value.x)
  size.value.h = Math.max(320, e.clientY - dragOffset.value.y)
}
function endResize() {
  resizing.value = false
  doc.body.style.userSelect = '';
}

// 计算容器样式：embedded 时不设置 fixed/left/top/background（让外层 panel 控制）
const panelStyle = computed(() => {
  if (props.embedded) {
    return {
      width: '100%',
      height: '100%',
      zIndex: 2147,
      position: 'relative'
    }
  } else {
    return {
      width: size.value.w + 'px',
      height: size.value.h + 'px',
      left: position.value.x + 'px',
      top: position.value.y + 'px',
      position: 'fixed',
      zIndex: 2147,
      background: 'transparent'
    }
  }
})

// 全局监听 - 仅在非嵌入模式下注册（嵌入时外层 modal 负责）
onMounted(() => {
  if (!props.embedded) {
    hostWindow.addEventListener('mousemove', onDrag)
    hostWindow.addEventListener('mouseup', endDrag)
    hostWindow.addEventListener('mousemove', onResize)
    hostWindow.addEventListener('mouseup', endResize)
  }
})

onBeforeUnmount(() => {
  if (!props.embedded) {
    hostWindow.removeEventListener('mousemove', onDrag)
    hostWindow.removeEventListener('mouseup', endDrag)
    hostWindow.removeEventListener('mousemove', onResize)
    hostWindow.removeEventListener('mouseup', endResize)
  }
})

// Breadcrumb drop helpers: allow moving dropped item into any breadcrumb segment path
const breadcrumbDragOver = ref(null) // index of hovered breadcrumb

function onBreadcrumbDragOver(e, idx) {
  e.preventDefault()
  breadcrumbDragOver.value = idx
  e.dataTransfer.dropEffect = 'move'
}

function onBreadcrumbDragLeave(/*e*/) {
  breadcrumbDragOver.value = null
}

function onBreadcrumbDrop(e, idx) {
  e.preventDefault()
  breadcrumbDragOver.value = null
  let payload = null
  try {
    payload = JSON.parse(e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain'))
  } catch (err) {
    console.warn('invalid drop payload on breadcrumb', err)
    return
  }
  if (!payload || !payload.name) return
  // target path is slice up to idx (inclusive)
  const targetPath = fsStore.currentPath.slice(0, idx + 1)
  const fromPath = Array.isArray(payload.fromPath) ? payload.fromPath : fsStore.currentPath
  fsStore.moveFile(payload.name, fromPath, targetPath)
}
</script>

<template>
  <!-- 使用更统一的视觉风格，参考 FilterManager 的配色与按钮样式 -->
  <div class="file-manager-panel" :class="themeClass" :style="panelStyle">
    <div class="panel-inner">
      <div class="panel-top">
        <div class="title">
          <span class="title-text">{{ t('fileManager.title') }}</span>
        </div>

        <div class="top-actions">
          <button class="text-btn" @click.stop="onImportPlayerWardrobeClick">
            {{ t('fileManagerPanel.importPlayerWardrobe') }}
          </button>
          <button class="text-btn" @click.stop="onSaveBackupClick">
            {{ t('fileManagerPanel.saveBackup') }}
          </button>
          <button class="text-btn" @click.stop="onImportBackupClick">
            {{ t('fileManagerPanel.importBackup') }}
          </button>
          <button class="text-btn" @click.stop="onRefreshThumbnails">
            {{ t('fileManager.refreshThumbnails') }}
          </button>

          <!--button class="panel-close" @click="$emit('close')" :aria-label="t('fileManager.closePanel')">×</button-->
        </div>
      </div>

      <nav class="breadcrumb">
        <template v-for="(seg, idx) in fsStore.currentPath" :key="seg+idx">
          <span
            class="breadcrumb-seg"
            :class="{ active: idx === fsStore.currentPath.length - 1, 'drag-over': breadcrumbDragOver === idx }"
            @click="fsStore.moveTo(fsStore.currentPath.slice(0, idx+1))"
            @dragover.prevent="onBreadcrumbDragOver($event, idx)"
            @dragleave.prevent="onBreadcrumbDragLeave"
            @drop.prevent="onBreadcrumbDrop($event, idx)"
          >
            {{ seg }}
          </span>
          <span v-if="idx<fsStore.currentPath.length-1" class="divider">›</span>
        </template>
      </nav>

      <div class="toolbar">
        <div class="search-row">
          <div class="search-box">
            <input
              v-model="searchQuery"
              @keydown.enter.prevent=""
              :placeholder="searchScope === 'current' ? t('fileManager.searchPlaceholderCurrent') : t('fileManager.searchPlaceholderAll')"
              class="search-input"
              :aria-label="t('fileManager.searchAria')"
            />
            <BaseButton 
              v-if="searchQuery"
              variant="ghost" 
              icon-only 
              size="sm"
              @click="clearSearch" 
              :title="t('fileManager.clearSearch')"
              :aria-label="t('fileManager.clearSearch')"
              class="search-box-btn"
            >
              ✕
            </BaseButton>
            <BaseButton 
              variant="ghost" 
              icon-only 
              size="sm"
              @click="toggleScope" 
              :title="searchScope === 'current' ? t('fileManager.switchToGlobalSearch') : t('fileManager.switchToCurrentSearch')"
              :aria-label="searchScope === 'current' ? t('fileManager.switchToGlobalSearch') : t('fileManager.switchToCurrentSearch')"
              class="search-box-btn"
            >
              {{ searchScope === 'current' ? '🔍' : '🌐' }}
            </BaseButton>
            <span class="scope-chip">{{ searchScope === 'current' ? t('fileManager.scopeCurrent') : t('fileManager.scopeAll') }}</span>
          </div>
          <button class="text-btn" @click.stop="onAddFolder">
            {{ t('fileManager.newFolderTitle') }}
          </button>
        </div>

        <div class="toolbar-row split">
          <button class="sort-toggle" @click="cycleSort" :aria-label="t('fileManager.sortToggleAria')">
            <span class="sort-label">{{ t('fileManager.sortToggle') }}</span>
            <span class="sort-value">{{ sortLabel }}</span>
          </button>
          <div class="view-toggle" role="group" :aria-label="t('fileManager.viewMode')">
            <button class="view-btn" :class="{ active: fileViewMode === 'large' }" @click="setFileViewMode('large')" :aria-label="t('fileManager.viewLarge')">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.5" />
                <rect x="6" y="7" width="12" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.5" />
              </svg>
            </button>
            <button class="view-btn" :class="{ active: fileViewMode === 'small' }" @click="setFileViewMode('small')" :aria-label="t('fileManager.viewSmall')">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="5" width="7" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5" />
                <rect x="13" y="5" width="7" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5" />
                <rect x="4" y="13" width="7" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5" />
                <rect x="13" y="13" width="7" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5" />
              </svg>
            </button>
            <button class="view-btn" :class="{ active: fileViewMode === 'list' }" @click="setFileViewMode('list')" :aria-label="t('fileManager.viewList')">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <line x1="6" y1="7" x2="19" y2="7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                <line x1="6" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                <line x1="6" y1="17" x2="19" y2="17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                <circle cx="4" cy="7" r="1" fill="currentColor" />
                <circle cx="4" cy="12" r="1" fill="currentColor" />
                <circle cx="4" cy="17" r="1" fill="currentColor" />
              </svg>
            </button>
            <span class="view-slider" :class="`pos-${fileViewMode}`"></span>
          </div>
        </div>
      </div>

      <div class="file-list scrollable" :class="[`view-${fileViewMode}`]">
        <template v-if="displayList.length > 0">
          <FileItem
            v-for="entry in displayList"
            :key="(entry.path ? entry.path.join('/') : '') + '/' + entry.item.name"
            :item="entry.item"
            :view-mode="fileViewMode"
            @open-folder="() => { if (entry.item.type === 'folder') fsStore.moveTo([...entry.path, entry.item.name]) }"
            @remove="() => fsStore.removeFile(entry.item, entry.path)"
            @rename="newName => (entry.item.name = newName, fsStore.saveAll())"
          />
        </template>
        <div v-else class="empty-tip-wrap">
          <div class="empty-tip">{{ t('fileManager.emptyTip') }}</div>
          <div class="empty-actions" v-if="searchQuery">
            <button class="chip-btn" @click="clearSearch">{{ t('fileManager.clearSearch') }}</button>
            <button v-if="searchScope === 'current'" class="chip-btn" @click="switchToGlobalSearch">{{ t('fileManager.switchToGlobalSearch') }}</button>
          </div>
          <div class="empty-actions" v-else>
            <button class="chip-btn" @click="onAddFolder">{{ t('fileManager.newFolderTitle') }}</button>
          </div>
        </div>
      </div>

      <!-- 嵌入模式下隐藏 resize handle -->
      <span v-if="!props.embedded" class="resize-handle" @mousedown.stop="startResize"></span>
    </div>
  </div>
</template>

<style scoped>
/* Panel container: keep floating behaviour but inner panel uses FilterManager-like visual style */
.file-manager-panel {
  pointer-events: auto;
  min-width: 450px;
  min-height: 320px;
  max-width: 98vw;
  max-height: 94vh;
  overflow: hidden;
  border-radius: var(--radius-xl, 12px);
  box-shadow: var(--shadow-lg, 0 6px 28px rgba(10,20,40,0.06));
}

/* inner panel adopts consistent background / padding similar to FilterManager */
.panel-inner {
  width: 100%;
  height: 100%;
  padding: var(--panel-inline-padding, 12px);
  box-sizing: border-box;
  background: var(--color-bg-surface, #f8fafc);
  border: 1.5px solid var(--color-border-base, rgba(230,235,240,0.9));
  border-radius: var(--radius-xl, 12px);
  display: flex;
  flex-direction: column;
  gap: var(--space-fluid-sm, 10px);
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

/* Actions on the right */
.top-actions {
  margin-left: auto;
  display: flex;
  gap: var(--space-sm, 8px);
  align-items: center;
}

/* reuse filter-manager styles for buttons to keep consistent UI */
.batch {
  padding: var(--space-sm, 6px) 10px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-base, #d6dbe2);
  background: var(--color-bg-base, #fff);
  cursor: pointer;
  font-size: var(--font-size-base, 13px);
  transition: all var(--transition-fast, 0.15s) ease;
}
.batch:hover {
  background: var(--color-bg-hover, #f0f4f8);
  border-color: var(--color-border-strong, #b0bcc8);
}

.small {
  padding: var(--space-xs, 4px) var(--space-sm, 8px);
  border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--color-border-light, #e6eef6);
  background: var(--color-bg-base, #fff);
  cursor: pointer;
  font-size: var(--font-size-sm, 12px);
  transition: all var(--transition-fast, 0.15s) ease;
}
.small:hover {
  background: var(--color-bg-hover, #f0f4f8);
  border-color: var(--color-border-strong, #c0ccd8);
}

/* Close button styled to sit on the right of the top-actions */
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
.panel-button:hover {
  background: var(--color-bg-hover, #f0f4f8);
}
.panel-close {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md, 8px);
  background: var(--color-bg-base, #fff);
  border: 1px solid var(--color-border-base, #ddd);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background var(--transition-fast, 0.15s);
}
.panel-close:hover { background: var(--color-bg-hover, #f0f4f8); }

/* Breadcrumb */
.breadcrumb { display:flex; gap:var(--space-sm, 6px); align-items:center; font-size:var(--font-size-md, 14px); user-select:none; margin:0 2px; }
.breadcrumb-seg { 
  background: var(--color-bg-panel, #f1f5f9); 
  color: var(--color-text-secondary, #64748b); 
  padding: var(--space-xs, 4px) var(--space-md, 12px); 
  border-radius: var(--radius-md, 8px); 
  cursor: pointer;
  transition: background var(--transition-fast, 0.15s);
}
.breadcrumb-seg:hover {
  background: var(--color-bg-hover, #e2e8f0);
}
.breadcrumb-seg.active { 
  background: var(--color-primary, #2563eb); 
  font-weight: var(--font-weight-semibold, 600); 
  cursor: default; 
}
.breadcrumb-seg.drag-over { 
  box-shadow: inset 0 -3px 0 var(--color-primary, rgba(60,130,200,0.18)); 
  border: 1px solid var(--color-primary, rgba(60,130,200,0.18)); 
}
.divider { margin:0 2px; color: var(--color-text-muted, #94a3b8); font-size:17px; }

/* toolbar and search */
.toolbar { margin-top: var(--space-sm, 6px); }
.search-row { display:flex; gap: var(--space-md, 12px); align-items:center; width:100%; }
.search-box { display:flex; align-items:center; gap: var(--space-sm, 8px); flex:1; }
.scope-chip {
  padding: var(--space-xs, 4px) var(--space-sm, 8px);
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-panel, #f1f5f9);
  color: var(--color-text-secondary, #475569);
  font-size: var(--font-size-sm, 12px);
  white-space: nowrap;
}
.search-input {
  width: 100%;
  padding: var(--space-sm, 8px) 10px;
  border-radius: var(--radius-lg, 10px);
  border: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-base, #fff);
  color: var(--color-text-primary, #0f172a);
  outline: none;
  transition: border-color var(--transition-fast, 0.15s), box-shadow var(--transition-fast, 0.15s);
}
.search-input:focus { 
  box-shadow: 0 0 0 3px var(--color-border-focus, rgba(59,130,246,0.12)); 
  border-color: var(--color-primary, #3b82f6); 
}
.header-btn { 
  background: var(--color-bg-panel, #f1f5f9); 
  border: 1px solid var(--color-border-base, #e2e8f0); 
  padding: var(--space-sm, 6px) 10px; 
  border-radius: var(--radius-lg, 10px); 
  cursor: pointer;
  color: var(--color-text-primary, #0f172a);
  transition: background var(--transition-fast, 0.15s);
}
.header-btn:hover {
  background: var(--color-bg-hover, #e2e8f0);
}

.toolbar-row {
  margin-top: var(--space-sm, 8px);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm, 8px);
}

.toolbar-row.split {
  align-items: center;
  justify-content: space-between;
  flex-wrap: nowrap;
}

.chip-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-xs, 6px);
}

.text-btn {
  height: 32px;
  padding: 0 12px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-base, #fff);
  color: var(--color-text-primary, #23324a);
  font-size: var(--font-size-sm, 12px);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--transition-fast, 0.15s);
}

.text-btn:hover {
  background: var(--color-bg-hover, #f0f4f8);
}

.sort-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-base, #d6dbe2);
  background: var(--color-bg-base, #fff);
  color: var(--color-text-primary, #23324a);
  cursor: pointer;
}

.sort-label {
  color: var(--color-text-muted, #94a3b8);
  font-size: var(--font-size-sm, 12px);
}

.sort-value {
  font-size: var(--font-size-sm, 12px);
  font-weight: var(--font-weight-semibold, 600);
}

.view-toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--color-border-base, #d6dbe2);
  border-radius: var(--radius-md, 8px);
  background: var(--color-bg-base, #fff);
  padding: 2px;
  gap: 2px;
}

.view-btn {
  width: 32px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary, #64748b);
  cursor: pointer;
  border-radius: var(--radius-sm, 6px);
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.view-btn svg {
  width: 18px;
  height: 18px;
  display: block;
}

.view-btn.active {
  color: var(--color-text-primary, #23324a);
}

.view-slider {
  position: absolute;
  bottom: 2px;
  left: 2px;
  width: 32px;
  height: 2px;
  background: var(--color-primary, #3b82f6);
  border-radius: 2px;
  transition: transform var(--transition-fast, 0.15s) ease;
}

.view-slider.pos-large {
  transform: translateX(0);
}

.view-slider.pos-small {
  transform: translateX(34px);
}

.view-slider.pos-list {
  transform: translateX(68px);
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

/* file list grid */
.file-list {
  padding: var(--space-fluid-md, 12px);
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px,1fr));
  gap: 12px;
  overflow-y:auto;
  min-height: 200px;
  max-height: var(--panel-max-height-safe, calc(100dvh - 140px));
  -webkit-overflow-scrolling: touch;
}

.file-list.view-large {
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
}

.file-list.view-small {
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}

.file-list.view-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.empty-tip { 
  color: var(--color-text-muted, #94a3b8); 
  text-align:center; 
  font-size: var(--font-size-lg, 17px); 
  grid-column:1/-1; 
  margin: 42px 0 24px 0; 
}

.empty-tip-wrap {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.empty-actions {
  display: flex;
  gap: var(--space-sm, 8px);
  margin-bottom: 16px;
}

/* resize handle */
.resize-handle {
  width: 19px;
  height: 19px;
  background: var(--color-border-strong, #cbd5e1);
  border-radius: var(--radius-xl, 12px);
  position: absolute;
  right: 6px;
  bottom: 6px;
  cursor: nwse-resize;
  z-index: 3;
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.05));
  transition: background var(--transition-fast, 0.15s);
}
.resize-handle:hover { background: var(--color-primary, #3b82f6); }

/* keep existing deep styles for FileItem components */
:deep(.file-item-card) {
  transition: transform .14s cubic-bezier(.2,.9,.3,1), box-shadow .14s, border-color .12s;
  will-change: transform;
  transform-origin: center;
}
:deep(.file-item-card):hover {
  transform: translateY(-6px) scale(1.01);
  box-shadow: var(--shadow-lg, 0 10px 15px -3px rgba(0,0,0,0.1));
}
:deep(.thumb-wrap) {
  transition: box-shadow .12s, transform .12s;
}
:deep(.file-item-card:active .thumb-wrap) { transform: translateY(1px); }
:deep(.actions .action) {
  padding: var(--space-sm, 6px) 10px;
  font-size: var(--font-size-base, 13px);
  border-radius: var(--radius-md, 8px);
}
:deep(.file-item-card) { opacity: 0; transform: translateY(6px); animation: itemIn .22s ease forwards; }
@keyframes itemIn { to { opacity: 1; transform: translateY(0); } }

/* responsive adjustments */
@media (min-width: 768px) {
  .file-list {
    grid-template-columns: repeat(auto-fill, minmax(200px,1fr));
    gap: var(--space-lg, 16px);
  }
}

@media (min-width: 1024px) {
  .file-list {
    grid-template-columns: repeat(auto-fill, minmax(220px,1fr));
  }
}
</style>