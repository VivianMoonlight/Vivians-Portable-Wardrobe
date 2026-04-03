<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import FileThumbnail from "./FileThumbnail.vue";
import { useFileSystemStore } from '@/stores/fileSystemStore'
import { useStudioDomainStores } from '@/stores/studio'
import { hostWindow, doc } from '@/utils/host-window.js'
import { injectTheme } from '@/services/ThemeService'
import * as DialogService from '@/services/DialogService.js'

const props = defineProps({
  item: Object,
  viewMode: { type: String, default: 'large' }
});
const emit = defineEmits(["open-folder", "remove", "rename", "sent-to-studio"]);

const fsStore = useFileSystemStore();
const { studio } = useStudioDomainStores();

const { t } = useI18n(); // i18n translation function

// Inject theme for teleported context menu
const injectedTheme = injectTheme()
const themeClass = computed(() => injectedTheme.themeClass())

// 根元素引用（用于多层 DOM / 深层嵌套判断）
const rootEl = ref(null)

// 右键菜单状态与处理（将菜单 teleport 到 body 层以避免被父容器 overflow/transform 影响）
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0
});

// menu 元素 id（唯一）
const menuElId = 'vpw-fileitem-context-' + Math.random().toString(36).slice(2, 8);

// 打开菜单：先设置位置为 client coords，然后在 nextTick 中测量实际菜单尺寸并修正位置（避免被裁切）
function openContextMenuAt(clientX, clientY) {
  contextMenu.value.visible = true;

  // 先设置基本位置（相对于 viewport，fixed 定位会使用此坐标）
  contextMenu.value.x = clientX;
  contextMenu.value.y = clientY;

  // 在下一帧或渲染后测量并调整，确保菜单在视口内
  nextTick(() => {
    requestAnimationFrame(() => {
      const menuEl = doc.getElementById(menuElId);
      if (!menuEl) return;

      const rect = menuEl.getBoundingClientRect();
      const vw = hostWindow.innerWidth || doc.documentElement.clientWidth;
      const vh = hostWindow.innerHeight || doc.documentElement.clientHeight;
      const padding = 8;

      let x = contextMenu.value.x;
      let y = contextMenu.value.y;

      // 如果超出右边界，向左移动；如果超出下边界，向上移动
      if (x + rect.width + padding > vw) {
        x = Math.max(padding, vw - rect.width - padding);
      }
      if (y + rect.height + padding > vh) {
        y = Math.max(padding, vh - rect.height - padding);
      }

      // 保证不被推到视口左/上方
      if (x < padding) x = padding;
      if (y < padding) y = padding;

      contextMenu.value.x = x;
      contextMenu.value.y = y;
    });
  });
}

function closeContextMenu() {
  contextMenu.value.visible = false;
}

function onContextMenu(e) {
  // 使用 capture modifier on template + this handler 确保在多层 DOM 中仍能被捕获
  e.preventDefault();
  // 如果需要，可检查 e.button (通常 contextmenu 已是右键)
  openContextMenuAt(e.clientX, e.clientY);
}

// 右键菜单项行为
async function renameItem() {
  closeContextMenu();
  // 使用 i18n 文案
  const newName = await DialogService.prompt(t('fileItem.promptNewName'), props.item?.name ?? '');
  if (newName === null) return;
  const trimmed = (newName || '').trim();
  if (!trimmed) return;
  emit('rename', trimmed);
}

async function deleteItem() {
  closeContextMenu();
  // 使用 i18n 确认提示
  const confirmed = await DialogService.confirm(t('fileItem.confirmDelete'));
  if (!confirmed) return;
  emit('remove');
}

function openItem() {
  closeContextMenu();
  if (props.item && props.item.type === 'folder') emit('open-folder');
}

// 发送到 Studio
function sendToStudio() {
  closeContextMenu();
  if (!props.item || props.item.type === 'folder') {
    return;
  }
  const el = {
    id: 'el_' + Math.random().toString(36).slice(2, 9),
    name: props.item.name || (t('fileItem.elementDefaultName') + ' ' + Math.random().toString(36).slice(2, 6)),
    data: Array.isArray(props.item.data) ? JSON.parse(JSON.stringify(props.item.data)) : (props.item.data ?? []),
    filterList: fsStore.activeFilters || []
  };
  try {
    studio.addElement(el);
  } catch (e) {
    // 错误日志保留为开发者信息（非用户 alert）
    console.warn(t('fileItem.sendError'), e);
  }
  emit('sent-to-studio', el);
}

// Apply the store's active data (activeItem) to the current character
function applyActiveToCharacter() {
  closeContextMenu();

  const data = props.item?.data;
  if (!Array.isArray(data) || data.length === 0) {
    return;
  }

  try {
    fsStore.applyFilteredOutfitToCharacter({ outfitData: toRaw(data) });
  } catch (e) {
    console.error('applyActiveToCharacter failed', e);
  }
}

function exportBCX() {
  closeContextMenu();
  if (!props.item || props.item.type === 'folder') {
    return;
  }
  try {
    ExternalAdapter.exportOutfitAsBCX(props.item.name, Array.isArray(props.item.data) ? toRaw(props.item.data) : []);
  } catch (e) {
    console.error('exportBCX failed', e);
  }
}

// Apply this file item's data directly to the current character (useful if you want the file's outfit)
function applyThisItemToCharacter() {
  closeContextMenu();

  if (!props.item || props.item.type === 'folder') {
    return;
  }
  const data = props.item.data;
  if (!data || !Array.isArray(data) || data.length === 0) {
    console.error('this item data is empty or invalid');
    return;
  }

  try {
    fsStore.applyFilteredOutfitToCharacter({ outfitData: toRaw(data) });
  } catch (e) {
    console.error('applyThisItemToCharacter failed', e);
  }
}

// 全局点击/键盘关闭菜单；使用 composedPath 以适配多层 DOM / Shadow DOM
function onGlobalClick(e) {
  if (!contextMenu.value.visible) return;

  const path = (e.composedPath && e.composedPath()) ||
    (e.path && e.path) ||
    (function () {
      const arr = [];
      let node = e.target;
      while (node) {
        arr.push(node);
        node = node.parentNode;
      }
      return arr;
    })();

  const menuEl = doc.getElementById(menuElId);
  if (menuEl && path.indexOf(menuEl) >= 0) return;

  // 如果点击在同一个 file-item-card 内也不关闭（方便在 card 内操作）
  if (rootEl.value && path.indexOf(rootEl.value) >= 0) return;

  closeContextMenu();
}
function onGlobalKey(e) {
  if (e.key === 'Escape' && contextMenu.value.visible) closeContextMenu();
}

onMounted(() => {
  // 使用捕获 (true) 确保我们能在深层阻止事件之前获得事件
  hostWindow.addEventListener('click', onGlobalClick, true);
  hostWindow.addEventListener('keydown', onGlobalKey, true);
});

onBeforeUnmount(() => {
  hostWindow.removeEventListener('click', onGlobalClick, true);
  hostWindow.removeEventListener('keydown', onGlobalKey, true);
});

// hover 处理：进入时设置 ActiveItem，离开时清理
function onMouseEnter() {
  if (fsStore.lockedItem) return
  if (!canUseHover()) return
  fsStore.setActiveItem(props.item);
}
function onMouseLeave() {
  if (fsStore.lockedItem) return
  if (!canUseHover()) return
  if (fsStore.activeItem && fsStore.activeItem.data && Array.isArray(fsStore.activeItem.data)) {
    fsStore.setActiveItem(-1);
  } else if (fsStore.activeItem === props.item) {
    fsStore.setActiveItem(-1);
  }
}

function canUseHover() {
  return !!(hostWindow.matchMedia && hostWindow.matchMedia('(hover: hover) and (pointer: fine)').matches)
}

function setActiveFromInteraction() {
  fsStore.setActiveItem(props.item)
}

function onFocusIn() {
  if (fsStore.lockedItem) return
  setActiveFromInteraction()
}

function onFocusOut(e) {
  if (fsStore.lockedItem) return
  if (rootEl.value && e?.relatedTarget && rootEl.value.contains(e.relatedTarget)) return
  if (fsStore.activeItem === props.item) {
    fsStore.setActiveItem(-1)
  }
}

// 左键点击行为：文件夹触发展开；文件切换预览锁定
function onClick() {
  if (!props.item) return
  if (props.item.type === 'folder') {
    emit('open-folder')
    return
  }
  fsStore.togglePreviewLock(props.item)
}

// 双击：文件夹打开，文件则把 active 数据应用到角色（按需求，这里应用的是 store.activeItem）
function onDoubleClick() {
  if (props.item && props.item.type === 'folder') {
    emit('open-folder');
    return;
  }
  // 按照需求，双击将把当前 active 数据应用到角色
  applyActiveToCharacter();
}

// -----------------------------
// 拖放相关
// -----------------------------
const isDragOver = ref(false)

function onDragStart(e) {
  if (!props.item) { e.preventDefault(); return }
  const payload = {
    name: props.item.name,
    fromPath: fsStore.currentPath,
    type: props.item.type || 'file'
  }
  try {
    e.dataTransfer.setData('application/json', JSON.stringify(payload))
  } catch (err) {
    e.dataTransfer.setData('text/plain', JSON.stringify(payload))
  }
  e.dataTransfer.effectAllowed = 'move'
  isDragOver.value = false
}
function onDragEnd() { isDragOver.value = false }
function onDragOver(e) {
  if (!props.item || props.item.type !== 'folder') return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  isDragOver.value = true
}
function onDragLeave() { isDragOver.value = false }
function onDrop(e) {
  if (!props.item || props.item.type !== 'folder') return
  e.preventDefault()
  isDragOver.value = false
  let payload = null
  try {
    payload = JSON.parse(e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain'))
  } catch (err) {
    console.warn('invalid drop payload', err)
    return
  }
  if (!payload || !payload.name) return
  const targetPath = [...fsStore.currentPath, props.item.name]
  const fromPath = Array.isArray(payload.fromPath) ? payload.fromPath : fsStore.currentPath
  fsStore.moveFile(payload.name, fromPath, targetPath)
}

const draggable = !!props.item
const isPreviewLocked = computed(() => fsStore.isPreviewLockedOn(props.item))
</script>

<template>
  <div ref="rootEl" class="file-item-card" :class="[themeClass, `view-${viewMode}`, { 'drop-target': isDragOver, 'is-preview-locked': isPreviewLocked }]" @click="onClick"
    @dblclick="onDoubleClick" @contextmenu.capture="onContextMenu" @mouseenter="onMouseEnter" @mouseleave="onMouseLeave"
    @focusin="onFocusIn" @focusout="onFocusOut" tabindex="0"
    :draggable="draggable" @dragstart="onDragStart" @dragend="onDragEnd" @dragover="onDragOver" @dragleave="onDragLeave"
    @drop="onDrop">
    <div class="thumb-wrap">
      <FileThumbnail v-if="viewMode !== 'list'" :item="item" />
      <div v-else class="list-icon" aria-hidden="true">
        <svg v-if="item && item.type === 'folder'" viewBox="0 0 24 24" class="icon-folder">
          <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h4l2 2H18.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
        </svg>
        <svg v-else viewBox="0 0 24 24" class="icon-outfit">
          <rect x="5" y="3" width="14" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.6" />
          <circle cx="12" cy="7" r="1.5" fill="currentColor" />
          <path d="M9 10 L8.5 14 Q8.5 16.5 10 18 L14 18 Q15.5 16.5 15.5 14 L15 10 Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
    </div>
    <div class="file-info">
      <span class="file-name" :title="item.name">{{ item.name }}</span>
    </div>

    <!-- 将菜单 teleport 到 body 可以避免被父容器的 overflow/transform/position 影响 -->
    <teleport to="body">
      <div :class="themeClass">
        <div v-if="contextMenu.visible" :id="menuElId" class="context-menu" :class="themeClass"
          :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" role="menu" aria-hidden="false">
          <ul>
            <li v-if="item && item.type === 'folder'" @click="openItem">{{ t('fileItem.open') }}</li>
            <li @click="renameItem">{{ t('fileItem.rename') }}</li>
            <li @click="deleteItem">{{ t('fileItem.delete') }}</li>

            <!-- 新增：将 store.activeItem 应用到当前角色 >
          <li v-if="item" @click="applyActiveToCharacter">应用当前 Active 到角色</li-->

            <!-- 新增：将此文件的 outfit 应用到角色（仅文件可用） -->
            <li v-if="item && item.type !== 'folder'" @click="applyActiveToCharacter">{{ t('fileItem.apply') }}</li>

            <li v-if="item && item.type !== 'folder'" @click="sendToStudio">{{ t('fileItem.sendToStudio') }}</li>
            <li v-if="item && item.type !== 'folder'" @click="exportBCX">{{ t('fileItem.exportBCX') }}</li>
            <li @click="closeContextMenu">{{ t('fileItem.cancel') }}</li>
          </ul>
        </div>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.file-item-card {
  background: var(--color-bg-surface, #f6f7fa);
  border-radius: var(--radius-lg, 16px);
  box-shadow: var(--shadow-sm, 0 2px 8px #dde1ee33);
  padding: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  min-width: 120px;
  width: 100%;
  height: auto;
  transition: box-shadow var(--transition-fast, 0.15s), transform 0.12s;
  cursor: pointer;
  border: 1px solid var(--color-border-base, #e4e9ee);
  position: relative;
}

.file-item-card:focus-visible {
  border-color: var(--color-primary, #3b82f6);
  box-shadow: 0 0 0 2px var(--color-primary-bg, rgba(59, 130, 246, 0.2));
}

.file-item-card.is-preview-locked {
  border-color: var(--color-accent, #0ea5a4);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent, #0ea5a4) 24%, transparent);
}

@media (hover: hover) and (pointer: fine) {
  .file-item-card:hover {
    box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.1));
    transform: translateY(-2px);
  }
}

.thumb-wrap {
  width: clamp(92px, 26vw, 132px);
  aspect-ratio: 9 / 16;
  background: var(--color-bg-panel, #f0f2f6);
  border-radius: var(--radius-xl, 12px);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.2px solid var(--color-border-light, #e6e8ec);
  margin-bottom: 8px;
  overflow: hidden;
  position: relative;
  align-self: center;
}

.file-info {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  font-weight: var(--font-weight-medium, 500);
  font-size: var(--font-size-md, 14px);
  color: var(--color-text-primary, #343952);
  margin-bottom: 0;
  word-break: break-all;
  min-height: 24px;
}

.file-name {
  font-size: var(--font-size-md, 14px);
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
}

.file-item-card.view-small {
  padding: 8px;
}

.file-item-card.view-small .thumb-wrap {
  width: clamp(76px, 22vw, 108px);
  aspect-ratio: 9 / 16;
  margin-bottom: 6px;
}

.file-item-card.view-small .file-name {
  font-size: var(--font-size-sm, 12px);
}

.file-item-card.view-list {
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  min-height: 72px;
  height: auto;
  padding: 8px 10px;
  border-radius: var(--radius-md, 10px);
  gap: 10px;
}

.file-item-card.view-list .thumb-wrap {
  width: 52px;
  min-width: 52px;
  aspect-ratio: 9 / 16;
  margin-bottom: 0;
}

.file-item-card.view-list .thumb-wrap {
  aspect-ratio: auto;
  height: 52px;
  background: var(--color-bg-panel, #f0f2f6);
}

.file-item-card.view-list .list-icon {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary, #64748b);
}

.file-item-card.view-list .list-icon svg {
  width: 22px;
  height: 22px;
  display: block;
}

.file-item-card.view-list .list-icon .icon-folder {
  background: var(--color-info-bg, rgba(59, 130, 246, 0.12));
  padding: 3px;
  border-radius: 5px;
  color: var(--color-info, #3b82f6);
}

.file-item-card.view-list .list-icon .icon-outfit {
  background: var(--color-accent-purple-bg, rgba(168, 85, 247, 0.12));
  padding: 3px;
  border-radius: 5px;
  color: var(--color-accent-purple, #a855f7);
}

.file-item-card.view-list .file-name {
  line-height: 1.2;
}

.file-item-card.view-list .file-info {
  justify-content: flex-start;
  margin-bottom: 0;
  padding-left: 0;
}

.file-item-card.view-list .file-name {
  max-width: none;
}

/* 右键菜单样式（fixed 定位，基于 left/top） */
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

/* drop visual */
.file-item-card.drop-target {
  outline: 3px dashed var(--color-primary, rgba(100, 140, 200, 0.35));
  box-shadow: var(--shadow-lg, 0 10px 30px rgba(70, 110, 180, 0.05));
}
</style>