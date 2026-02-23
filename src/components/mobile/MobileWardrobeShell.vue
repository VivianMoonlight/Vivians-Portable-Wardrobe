<template>
  <div class="mobile-shell" role="dialog" :aria-label="t('fileManagerPanel.ariaLabel')">
    <header class="mobile-header">
      <div class="mobile-title">{{ t('fileManagerPanel.title') }}</div>
      <button class="mobile-close" @click="emit('close')" aria-label="关闭">&times;</button>
    </header>

    <nav class="mobile-main-tabs" role="tablist" :aria-label="t('fileManagerPanel.tabAriaLabel')">
      <button
        v-for="tab in mainTabs"
        :key="tab.id"
        class="mobile-main-tab"
        :class="{ active: activeMainTab === tab.id }"
        role="tab"
        :aria-selected="activeMainTab === tab.id"
        @click="setMainTab(tab.id)">
        {{ tab.label }}
      </button>
    </nav>

    <section v-if="activeMainTab === 'settings'" class="mobile-settings" role="region" :aria-label="t('fileManagerPanel.tabSettings')">
      <div class="settings-content">
        <h3 class="settings-title">{{ t('fileManagerPanel.themeSettings') }}</h3>
        <div class="theme-selector">
          <button
            class="theme-option"
            :class="{ active: currentTheme === 'themed' }"
            @click="setTheme('themed')">
            <span class="theme-icon">🎨</span>
            <span class="theme-label">{{ t('fileManagerPanel.themedMode') }}</span>
            <span v-if="!themedAvailable && currentTheme === 'themed'" class="theme-warning">
              {{ t('fileManagerPanel.themedNotAvailable') }}
            </span>
          </button>
          <button
            class="theme-option"
            :class="{ active: currentTheme === 'light' }"
            @click="setTheme('light')">
            <span class="theme-icon">☀️</span>
            <span class="theme-label">{{ t('fileManagerPanel.lightMode') }}</span>
          </button>
          <button
            class="theme-option"
            :class="{ active: currentTheme === 'dark' }"
            @click="setTheme('dark')">
            <span class="theme-icon">🌙</span>
            <span class="theme-label">{{ t('fileManagerPanel.darkMode') }}</span>
          </button>
        </div>
      </div>
    </section>

    <section
      v-else
      class="mobile-workspace"
      @pointerdown="onSwipeStart"
      @pointermove="onSwipeMove"
      @pointerup="onSwipeEnd"
      @pointercancel="onSwipeEnd">
      <div class="mobile-pager-viewport">
        <div class="mobile-pager-track" :style="pagerStyle">
          <div class="mobile-pane" :class="{ active: activePane === 'preview' }">
            <div class="mobile-preview-shell">
              <SidePreview />
              <div v-if="activeMainTab === 'wardrobe'" class="mobile-preview-actions" role="group" aria-label="预览操作">
                <button class="mobile-preview-btn" @click="onPreviewSave">Save</button>
                <button class="mobile-preview-btn" @click="onPreviewImportBCX">从BCX导入</button>
                <button class="mobile-preview-btn primary" @click="onPreviewApplyToCurrent">应用到当前角色</button>
              </div>
            </div>
          </div>
          <div class="mobile-pane mobile-pane-main" :class="{ active: activePane === 'wardrobe' }">
            <FileManager
              v-if="activeMainTab === 'wardrobe'"
              :embedded="true"
              :on-import-player-wardrobe="props.onImportPlayerWardrobe"
              :on-save-backup="props.onSaveBackup"
              :on-import-backup="props.onImportBackup"
            />
            <HistoryViewer v-else :embedded="true" />
          </div>
          <div class="mobile-pane" :class="{ active: activePane === 'filter' }">
            <FilterManager />
          </div>
        </div>
      </div>

      <nav class="mobile-sub-tabs" role="tablist" :aria-label="'Workspace panes'">
        <button
          v-for="pane in subTabs"
          :key="pane.id"
          class="mobile-sub-tab"
          :class="{ active: activePane === pane.id }"
          role="tab"
          :aria-selected="activePane === pane.id"
          @click="setPane(pane.id)">
          {{ pane.label }}
        </button>
      </nav>
    </section>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FileManager from '@/components/FileManager.vue'
import HistoryViewer from '@/components/HistoryViewer.vue'
import SidePreview from '@/components/SidePreview.vue'
import FilterManager from '@/components/FilterManager.vue'
import { useWorkbenchStore } from '@/stores/workbenchStore'
import { useFileSystemStore } from '@/stores/fileSystemStore'
import { useTheme } from '@/services/ThemeService'
import { hostWindow } from '@/utils/host-window.js'

const props = defineProps({
  onImportPlayerWardrobe: { type: Function, default: null },
  onSaveBackup: { type: Function, default: null },
  onImportBackup: { type: Function, default: null },
  onImportBCX: { type: Function, default: null },
  onSaveCharacter: { type: Function, default: null },
  onApplyToCurrent: { type: Function, default: null }
})

const emit = defineEmits(['close'])
const { t } = useI18n()
const workbenchStore = useWorkbenchStore()
const fsStore = useFileSystemStore()

const theme = useTheme()
const { setTheme, currentTheme } = theme

// 调试模式
const debugMode = ref(false)

// 初始化文件系统（当 MobileWardrobeShell 挂载时）
onMounted(() => {
  console.log('[MobileWardrobeShell] Mounted, initializing filesystem...')
  const target = hostWindow.CurrentCharacter || hostWindow.Player || null
  if (target) {
    fsStore.initialize(target)
    console.log('[MobileWardrobeShell] Filesystem initialized')
    console.log('[FileSystem] currentNode:', fsStore.currentNode)
    console.log('[FileSystem] items:', fsStore.currentNode?.children?.length || 0)
  } else {
    console.warn('[MobileWardrobeShell] No character/player found')
  }
})

const themedAvailable = computed(() => {
  if (!theme.getThemedStatus) return false
  const status = theme.getThemedStatus()
  return status && (status.detected || status.enabled)
})

const mainTabs = computed(() => [
  { id: 'wardrobe', label: t('fileManagerPanel.tabWardrobe') },
  { id: 'history', label: t('fileManagerPanel.tabHistory') },
  { id: 'settings', label: t('fileManagerPanel.tabSettings') }
])

const activeMainTab = computed(() => {
  const tab = workbenchStore.mobileUi?.mainTab || workbenchStore.activeTab
  return ['wardrobe', 'history', 'settings'].includes(tab) ? tab : 'wardrobe'
})

const activePane = computed(() => {
  const pane = workbenchStore.mobileUi?.panes?.[activeMainTab.value]
  return ['preview', 'wardrobe', 'filter'].includes(pane) ? pane : 'wardrobe'
})

const subTabs = computed(() => [
  { id: 'preview', label: '预览' },
  { id: 'wardrobe', label: activeMainTab.value === 'history' ? '历史' : '衣柜' },
  { id: 'filter', label: 'Filter' }
])

const paneOrder = ['preview', 'wardrobe', 'filter']
const paneCount = paneOrder.length
const activePaneIndex = computed(() => {
  const index = paneOrder.indexOf(activePane.value)
  return index >= 0 ? index : 0
})
const pagerStyle = computed(() => {
  const step = 100 / paneCount
  return {
    transform: `translateX(-${activePaneIndex.value * step}%)`
  }
})

// 监听 activePane 变化，调试用（必须在 activePane 定义后）
watch(() => activePane.value, (newPane, oldPane) => {
  console.log(`[MobileWardrobeShell] activePane changed from ${oldPane} to ${newPane}`)
  console.log(`[MobileWardrobeShell] activeMainTab: ${activeMainTab.value}`)
  if (newPane === 'wardrobe' || newPane === 'preview') {
    console.log(`[FileSystem] currentNode:`, fsStore.currentNode)
    console.log(`[FileSystem] items count:`, fsStore.currentNode?.children?.length || 0)
  }
})

function setMainTab(tab) {
  workbenchStore.setMobileMainTab(tab)
}

function setPane(pane) {
  workbenchStore.setMobilePane(activeMainTab.value, pane)
}

const pointerState = ref({
  tracking: false,
  startX: 0,
  startY: 0,
  lock: null
})

function onSwipeStart(e) {
  if (activeMainTab.value === 'settings') return
  pointerState.value = {
    tracking: true,
    startX: e.clientX,
    startY: e.clientY,
    lock: null
  }
}

function onSwipeMove(e) {
  if (!pointerState.value.tracking) return

  const dx = e.clientX - pointerState.value.startX
  const dy = e.clientY - pointerState.value.startY

  if (!pointerState.value.lock) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
    pointerState.value.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
  }

  if (pointerState.value.lock !== 'x') return

  if (Math.abs(dx) >= 56 && Math.abs(dx) > Math.abs(dy) * 1.2) {
    if (dx < 0) {
      shiftPane(1)
    } else {
      shiftPane(-1)
    }
    pointerState.value.tracking = false
  }
}

function onSwipeEnd() {
  pointerState.value.tracking = false
}

function shiftPane(delta) {
  const currentIndex = Math.max(0, paneOrder.indexOf(activePane.value))
  const nextIndex = Math.max(0, Math.min(paneOrder.length - 1, currentIndex + delta))
  const nextPane = paneOrder[nextIndex]
  if (nextPane && nextPane !== activePane.value) {
    setPane(nextPane)
  }
}

async function onPreviewSave() {
  if (typeof props.onSaveCharacter === 'function') {
    await props.onSaveCharacter()
    return
  }
  if (typeof props.onSaveBackup === 'function') {
    await props.onSaveBackup()
  }
}

async function onPreviewImportBCX() {
  if (typeof props.onImportBCX === 'function') {
    await props.onImportBCX()
    return
  }
  if (typeof props.onImportPlayerWardrobe === 'function') {
    await props.onImportPlayerWardrobe()
  }
}

async function onPreviewApplyToCurrent() {
  if (typeof props.onApplyToCurrent === 'function') {
    await props.onApplyToCurrent()
    return
  }
  fsStore.applyFilteredOutfitToCharacter()
}
</script>

<style scoped>
.mobile-shell {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100dvh;
  background: var(--color-bg-base, #fff);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 10060;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.mobile-header {
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-base, #fff);
  padding: 0 12px;
  flex-shrink: 0;
}

.mobile-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary, #1f2937);
}

.mobile-close {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-base, #fff);
  font-size: 20px;
  line-height: 1;
  color: var(--color-text-primary, #1f2937);
}

.mobile-main-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-surface, #f8fafc);
  flex-shrink: 0;
}

.mobile-main-tab {
  min-height: 44px;
  border-radius: 10px;
  border: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-base, #fff);
  color: var(--color-text-secondary, #64748b);
  font-size: 13px;
  font-weight: 600;
}

.mobile-main-tab.active {
  border-color: var(--color-primary, #3b82f6);
  color: var(--color-primary, #3b82f6);
  background: var(--color-info-bg, #eff6ff);
}

.mobile-workspace {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.mobile-pager-viewport {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  display: flex;
  position: relative;
}

.mobile-pager-track {
  width: 300%;
  display: flex;
  transition: transform 0.2s ease;
  height: 100%;
  min-height: 0;
  flex-shrink: 0;
}

.mobile-pane {
  flex: 0 0 calc(100% / 3);
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.mobile-preview-shell {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.mobile-preview-actions {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 8px;
  border-top: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-base, #fff);
}

.mobile-preview-btn {
  min-height: 38px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-base, #fff);
  color: var(--color-text-primary, #1f2937);
  font-size: var(--font-size-sm, 12px);
  font-weight: var(--font-weight-semibold, 600);
  padding: 0 6px;
}

.mobile-preview-btn.primary {
  border-color: var(--color-primary, #3b82f6);
  color: var(--color-primary, #3b82f6);
  background: var(--color-info-bg, #eff6ff);
}

.mobile-pane > * {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.mobile-pane :deep(*) {
  min-height: 0;
}

/* === SidePreview（预览窗格专用） === */
.mobile-pane :deep(.side-preview) {
  display: flex !important;
  flex-direction: column !important;
  height: 100% !important;
  width: 100% !important;
  min-height: 0 !important;
  min-width: 0 !important;
  overflow: hidden !important;
}

.mobile-pane :deep(.side-preview .preview-inner) {
  flex: 1 1 auto;
  height: 100% !important;
  width: 100% !important;
  min-height: 0 !important;
  min-width: 0 !important;
  overflow: hidden !important;
}

.mobile-pane :deep(.side-preview canvas) {
  max-width: 100% !important;
  max-height: 100% !important;
  min-height: 0 !important;
  min-width: 0 !important;
  width: 100% !important;
  height: 100% !important;
  display: block !important;
}

/* === FileManager（衣柜窗格专用） === */
.mobile-pane :deep(.file-manager-panel) {
  display: flex !important;
  flex-direction: column !important;
  height: 100% !important;
  width: 100% !important;
  min-height: auto !important;
  min-width: auto !important;
  max-height: 100% !important;
  max-width: 100% !important;
  position: relative !important;
  border: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
}

.mobile-pane :deep(.panel-inner) {
  display: flex !important;
  flex-direction: column !important;
  height: 100% !important;
  width: 100% !important;
  flex: 1 1 auto;
  min-height: 0 !important;
  min-width: 0 !important;
  border: none !important;
  border-radius: 0 !important;
  padding: 0 !important;
  background: var(--color-bg-base, #fff) !important;
  overflow: hidden !important;
}

.mobile-pane :deep(.panel-top) {
  flex-shrink: 0;
  padding: 8px;
  background: var(--color-bg-surface, #f8fafc) !important;
  border-bottom: 1px solid var(--color-border-base, #e2e8f0) !important;
}

.mobile-pane :deep(.breadcrumb) {
  flex-shrink: 0;
  padding: 8px;
  background: var(--color-bg-surface, #f8fafc) !important;
  border-bottom: 1px solid var(--color-border-base, #e2e8f0) !important;
}

.mobile-pane :deep(.toolbar) {
  flex-shrink: 0;
  padding: 8px;
  background: var(--color-bg-surface, #f8fafc) !important;
  border-bottom: 1px solid var(--color-border-base, #e2e8f0) !important;
}

.mobile-pane :deep(.file-list) {
  flex: 1 1 auto !important;
  height: 100% !important;
  width: 100% !important;
  min-height: 0 !important;
  max-height: 100% !important;
  overflow-y: auto !important;
  overflow-x: hidden !important;
  scrollbar-width: thin;
  padding: 12px !important;
  display: grid !important;
}

.mobile-pane :deep(.file-list.view-large) {
  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  gap: 10px !important;
}

.mobile-pane :deep(.file-list.view-small) {
  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  gap: 8px !important;
}

.mobile-pane :deep(.file-list.view-list) {
  display: flex !important;
  flex-direction: column !important;
  gap: 6px !important;
  padding: 8px !important;
}

.mobile-pane :deep(.file-list.view-large .file-item-card),
.mobile-pane :deep(.file-list.view-small .file-item-card) {
  min-width: 0 !important;
  width: 100% !important;
  padding: 8px 6px !important;
  border-radius: var(--radius-md, 10px) !important;
}

.mobile-pane :deep(.file-list.view-large .file-item-card) {
  min-height: clamp(246px, 100vw, 320px) !important;
}

.mobile-pane :deep(.file-list.view-large .thumb-wrap),
.mobile-pane :deep(.file-list.view-small .thumb-wrap) {
  width: 88% !important;
  max-width: none !important;
  min-width: 0 !important;
  margin-bottom: 6px !important;
}

.mobile-pane :deep(.file-list.view-small .thumb-wrap) {
  width: 92% !important;
}

.mobile-pane :deep(.file-list.view-large .file-info),
.mobile-pane :deep(.file-list.view-small .file-info) {
  min-height: 18px !important;
}

.mobile-pane :deep(.file-list.view-large .file-name),
.mobile-pane :deep(.file-list.view-small .file-name) {
  max-width: 100% !important;
  font-size: var(--font-size-sm, 12px) !important;
}

.mobile-pane :deep(.file-list.view-list .file-item-card) {
  min-width: 0 !important;
  width: 100% !important;
  min-height: 56px !important;
  padding: 6px 8px !important;
  border-radius: var(--radius-sm, 8px) !important;
  gap: 8px !important;
}

.mobile-pane :deep(.file-list.view-list .thumb-wrap) {
  width: 40px !important;
  min-width: 40px !important;
  height: 40px !important;
  margin-bottom: 0 !important;
}

.mobile-pane :deep(.file-list.view-list .file-info) {
  min-height: 0 !important;
}

.mobile-pane :deep(.file-list.view-list .file-name) {
  font-size: var(--font-size-sm, 12px) !important;
  line-height: 1.2 !important;
}

/* === HistoryViewer（历史窗格专用） === */
.mobile-pane :deep(.history-viewer-panel) {
  display: flex !important;
  flex-direction: column !important;
  height: 100% !important;
  width: 100% !important;
  min-height: auto !important;
  min-width: auto !important;
  max-height: 100% !important;
  position: relative !important;
}

/* === FilterManager（过滤器窗格专用） === */
.mobile-pane :deep(.filter-panel) {
  display: flex !important;
  flex-direction: column !important;
  height: 100% !important;
  width: 100% !important;
  flex: 1 1 auto;
  min-height: 0 !important;
  overflow-y: auto !important;
  overflow-x: hidden !important;
}

.mobile-sub-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 10px;
  border-top: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-base, #fff);
  flex-shrink: 0;
}

.mobile-sub-tab {
  min-height: 44px;
  border-radius: 10px;
  border: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-base, #fff);
  color: var(--color-text-secondary, #64748b);
  font-size: 13px;
  font-weight: 600;
}

.mobile-sub-tab.active {
  border-color: var(--color-primary, #3b82f6);
  color: var(--color-primary, #3b82f6);
  background: var(--color-info-bg, #eff6ff);
}

.mobile-settings {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
}

.settings-content {
  width: 100%;
}

.settings-title {
  font-size: 16px;
  margin: 0 0 14px;
}

.theme-selector {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 10px;
}

.theme-option {
  min-height: 56px;
  border: 1px solid var(--color-border-base, rgba(200, 210, 230, 0.6));
  border-radius: 10px;
  background: var(--color-bg-base, #fff);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  position: relative;
}

.theme-option.active {
  border-color: var(--color-primary, #3b82f6);
  background: var(--color-primary-bg, rgba(59, 130, 246, 0.08));
}

.theme-icon {
  font-size: 22px;
}

.theme-label {
  font-size: 14px;
  font-weight: 500;
}

.theme-warning {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-warning, #f59e0b);
}
</style>
