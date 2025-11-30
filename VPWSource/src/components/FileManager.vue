<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFileSystemStore } from '@/stores/fileSystemStore'
import FileItem from './FileItem.vue'
import { hostWindow, doc, } from '@/utils/host-window.js'

const { t } = useI18n()

const props = defineProps({
  embedded: { type: Boolean, default: false } // 嵌入模式：外层面板负责布局与关闭
})
const emit = defineEmits(['close'])
const fsStore = useFileSystemStore()

// local search state
const searchQuery = ref('')
const searchScope = ref('current') // 'current' | 'all'

// items in current folder (raw)
const items = computed(() => fsStore.currentNode?.children ?? [])

// Build display list: array of { item, path } so UI can handle both current-folder view and global search results uniformly
const displayList = computed(() => {
  const q = (searchQuery.value || '').trim()
  // empty query => show current folder items
  if (!q) {
    return (items.value || []).map(it => ({ item: it, path: fsStore.currentPath }))
  }

  // case-insensitive match helper
  const ql = q.toLowerCase()

  if (searchScope.value === 'current') {
    return (items.value || [])
      .filter(it => (it.name || '').toLowerCase().includes(ql))
      .map(it => ({ item: it, path: fsStore.currentPath }))
  } else {
    // global search via store wrapper (returns array of { item, path })
    try {
      return fsStore.searchFiles(q)
    } catch (e) {
      console.warn('search failed', e)
      return []
    }
  }
})

// helper: clear search
function clearSearch() {
  searchQuery.value = ''
}

// helper: toggle scope
function toggleScope() {
  searchScope.value = searchScope.value === 'current' ? 'all' : 'current'
}

// existing methods
function onAddFolder() {
  const name = prompt(t('fileManager.promptNewFolderName'))
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
  <div class="file-manager-panel" :style="panelStyle">
    <div class="panel-inner">
      <div class="panel-top">
        <div class="title">
          <span class="title-text">{{ t('fileManager.title') }}</span>
        </div>

        <div class="top-actions">
          <button class="panel-button" @click.stop="onAddFolder" :title="t('fileManager.newFolderTitle')">📁+</button>
          <!--button class="batch" @click.stop="fsStore.saveAll" title="保存">💾 保存</button>
          <button class="batch" @click.stop="fsStore.loadAll" :title="t('fileManager.restoreTitle')">🔄</button-->

          <!-- 新增：刷新当前显示的缩略图 -->
          <button class="panel-button" @click.stop="onRefreshThumbnails" :title="t('fileManager.refreshThumbnails')">🔄</button>

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
            <button class="header-btn" @click="clearSearch" :title="t('fileManager.clearSearch')" v-if="searchQuery">✕</button>
            <button class="header-btn" @click="toggleScope" :title="searchScope === 'current' ? t('fileManager.switchToGlobalSearch') : t('fileManager.switchToCurrentSearch')">
              {{ searchScope === 'current' ? '🔍' : '🌐' }}
            </button>
          </div>
        </div>
      </div>

      <div class="file-list scrollable">
        <template v-if="displayList.length > 0">
          <FileItem
            v-for="entry in displayList"
            :key="(entry.path ? entry.path.join('/') : '') + '/' + entry.item.name"
            :item="entry.item"
            @open-folder="() => { if (entry.item.type === 'folder') fsStore.moveTo([...entry.path, entry.item.name]) }"
            @remove="() => fsStore.removeFile(entry.item, entry.path)"
            @rename="newName => (entry.item.name = newName, fsStore.saveAll())"
          />
        </template>
        <div v-else class="empty-tip">{{ t('fileManager.emptyTip') }}</div>
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
  border-radius: 13px;
  box-shadow: 0 6px 28px rgba(10,20,40,0.06);
}

/* inner panel adopts consistent background / padding similar to FilterManager */
.panel-inner {
  width: 100%;
  height: 100%;
  padding: 12px;
  box-sizing: border-box;
  background: linear-gradient(180deg, #fbfdff, #f7fbff);
  border: 1.5px solid rgba(230,235,240,0.9);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Top area with title and actions */
.panel-top {
  display: flex;
  align-items: center;
  gap: 12px;
  user-select: none;
}

.title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.title-text {
  font-size: 1.1em;
  font-weight: 700;
  color: #24303f;
}

/* Actions on the right */
.top-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
  align-items: center;
}

/* reuse filter-manager styles for buttons to keep consistent UI */
.batch {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid #d6dbe2;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s ease;
}
.batch:hover {
  background: #f0f4f8;
  border-color: #b0bcc8;
}

.small {
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid #e6eef6;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s ease;
}
.small:hover {
  background: #f0f4f8;
  border-color: #c0ccd8;
}

/* Close button styled to sit on the right of the top-actions */
.panel-button {
  height: 36px;
  border-radius: 8px;
  width: 48px;
  background: #fff;
  border: 1px solid #ddd;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
} 
.panel-close {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #ddd;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.panel-close:hover { background: #f6f6f6; }

/* Breadcrumb */
.breadcrumb { display:flex; gap:6px; align-items:center; font-size:14px; user-select:none; margin:0 2px; }
.breadcrumb-seg { background:#f1f1f4; color:#5b6172; padding:4px 12px; border-radius:8px; cursor:pointer; }
.breadcrumb-seg.active { background:#b6bac5; color:#fff; font-weight:600; cursor:default; }
.breadcrumb-seg.drag-over { box-shadow: inset 0 -3px 0 rgba(60,130,200,0.18); border: 1px solid rgba(60,130,200,0.18); }
.divider { margin:0 2px; color:#cacbd1; font-size:17px; }

/* toolbar and search */
.toolbar { margin-top: 6px; }
.search-row { display:flex; gap:12px; align-items:center; width:100%; }
.search-box { display:flex; align-items:center; gap:8px; flex:1; }
.search-input {
  width: 100%;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid #e5e7eb;
  background: #fff;
  outline: none;
}
.search-input:focus { box-shadow: 0 0 0 3px rgba(90,150,220,0.08); border-color: rgba(90,150,220,0.18); }
.header-btn { background:#f3f4f7; border:1px solid #e5e7eb; padding:6px 10px; border-radius:10px; cursor:pointer; }

/* file list grid */
.file-list {
  padding: 18px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px,1fr));
  gap: 16px;
  overflow-y:auto;
  min-height: 200px;
  max-height: calc(100% - 220px);
}
.empty-tip { color:#aeb1b7; text-align:center; font-size:17px; grid-column:1/-1; margin:42px 0 24px 0; }

/* resize handle */
.resize-handle {
  width: 19px;
  height: 19px;
  background: #dadada;
  border-radius: 11px;
  position: absolute;
  right: 6px;
  bottom: 6px;
  cursor: nwse-resize;
  z-index: 3;
  box-shadow: 0 0 7px #0001;
  transition: background 0.14s;
}
.resize-handle:hover { background: #bad4e7; }

/* keep existing deep styles for FileItem components */
:deep(.file-item-card) {
  transition: transform .14s cubic-bezier(.2,.9,.3,1), box-shadow .14s, border-color .12s;
  will-change: transform;
  transform-origin: center;
  background: linear-gradient(180deg,#ffffff,#fbfdff);
}
:deep(.file-item-card):hover {
  transform: translateY(-6px) scale(1.01);
  box-shadow: 0 12px 30px rgba(30,45,80,0.08);
  border-color: rgba(200,210,230,0.95);
}
:deep(.thumb-wrap) {
  transition: box-shadow .12s, transform .12s;
  background: linear-gradient(180deg,#fbfdff,#f7fbff);
  border: 1px solid rgba(220,230,240,0.85);
  box-shadow: inset 0 -10px 20px rgba(10,20,40,0.01);
}
:deep(.file-item-card:active .thumb-wrap) { transform: translateY(1px); }
:deep(.actions .action) {
  padding: 6px 10px;
  font-size: 13px;
  border-radius: 8px;
}
:deep(.file-item-card) { opacity: 0; transform: translateY(6px); animation: itemIn .22s ease forwards; }
@keyframes itemIn { to { opacity: 1; transform: translateY(0); } }

/* small responsive tweak for narrow screens */
@media (max-width: 640px) {
  .file-list { grid-template-columns: repeat(auto-fill, minmax(160px,1fr)); }
  .panel-inner { padding: 8px; }
  .title-text { font-size: 1em; }
}
</style>