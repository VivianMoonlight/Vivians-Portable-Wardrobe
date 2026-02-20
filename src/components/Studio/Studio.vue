<template>
  <teleport to="body">
    <div v-if="visible" class="studio-container">
      <div :class="themeClass">
        <div class="studio-window" role="dialog" :aria-label="t('studio.ariaLabel')" :style="panelStyle">
          <!-- Resize handles -->
          <div class="resize-handle top" @pointerdown.stop.prevent="startResize('top', $event)"></div>
          <div class="resize-handle right" @pointerdown.stop.prevent="startResize('right', $event)"></div>
          <div class="resize-handle bottom" @pointerdown.stop.prevent="startResize('bottom', $event)"></div>
          <div class="resize-handle left" @pointerdown.stop.prevent="startResize('left', $event)"></div>
          <div class="resize-handle corner top-left" @pointerdown.stop.prevent="startResize('top-left', $event)"></div>
          <div class="resize-handle corner top-right" @pointerdown.stop.prevent="startResize('top-right', $event)"></div>
          <div class="resize-handle corner bottom-right" @pointerdown.stop.prevent="startResize('bottom-right', $event)">
          </div>
          <div class="resize-handle corner bottom-left" @pointerdown.stop.prevent="startResize('bottom-left', $event)">
          </div>

          <header class="studio-header" @pointerdown.stop.prevent="startDrag">
            <div class="header-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z">
                </path>
              </svg>
              <h3>{{ t('studio.title') }}</h3>
            </div>

            <div class="studio-toolbar">
              <!-- Group 1: Stack IO (Standard File Icons) -->
              <div class="tool-group">
                <button class="tool-btn icon-only" @mousedown.stop.prevent @click="onSaveStacks"
                  :title="t('studio.saveStacksTitle')">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v13a2 2 0 0 1-2 2z"></path>
                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                    <polyline points="7 3 7 8 15 8"></polyline>
                  </svg>
                </button>
                <button class="tool-btn icon-only" @mousedown.stop.prevent @click="onLoadStacksClick"
                  :title="t('studio.loadStacksTitle')">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  </svg>
                </button>
              </div>

              <div class="divider"></div>

              <!-- Group 2: Palette IO & Toggle -->
              <div class="tool-group">
                <!-- Save Palette: Floppy with Swatch Grid -->
                <button class="tool-btn icon-only" @mousedown.stop.prevent @click="onSavePalette"
                  :title="t('studio.savePaletteTitle')">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <!-- Floppy Disk Base -->
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v13a2 2 0 0 1-2 2z"></path>
                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                    <polyline points="7 3 7 8 15 8"></polyline>
                    <!-- 2x2 Grid representing Palette/Swatches inside the label area -->
                    <rect x="9" y="15" width="2" height="2" fill="currentColor" stroke="none"></rect>
                    <rect x="13" y="15" width="2" height="2" fill="currentColor" stroke="none"></rect>
                    <rect x="9" y="18" width="2" height="2" fill="currentColor" stroke="none"></rect>
                    <rect x="13" y="18" width="2" height="2" fill="currentColor" stroke="none"></rect>
                  </svg>
                </button>

                <!-- Load Palette: Folder with Swatch Grid -->
                <button class="tool-btn icon-only" @mousedown.stop.prevent @click="onLoadPaletteClick"
                  :title="t('studio.loadPaletteTitle')">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <!-- Folder Base -->
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    <!-- 2x2 Grid representing Palette/Swatches on the folder body -->
                    <rect x="9" y="11" width="2" height="2" fill="currentColor" stroke="none"></rect>
                    <rect x="13" y="11" width="2" height="2" fill="currentColor" stroke="none"></rect>
                    <rect x="9" y="14" width="2" height="2" fill="currentColor" stroke="none"></rect>
                    <rect x="13" y="14" width="2" height="2" fill="currentColor" stroke="none"></rect>
                  </svg>
                </button>

              </div>

              <div class="divider"></div>

              <!-- Group 3: Layer Manager -->
              <div class="tool-group">
                <button class="tool-btn icon-only" @mousedown.stop.prevent @click="togglePalette"
                  :title="store.palettePanelVisible ? t('studio.hidePalette') : t('studio.showPalette')"
                  :class="{ active: store.palettePanelVisible }">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle>
                    <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle>
                    <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle>
                    <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle>
                    <path
                      d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z">
                    </path>
                  </svg>
                </button>

                <button class="tool-btn icon-only" @mousedown.stop.prevent @click="toggleLayerManager"
                  :title="store.layerManagerActive ? t('studio.hideLayerManager') : t('studio.showLayerManager')"
                  :class="{ active: store.layerManagerActive }">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
                  </svg>
                </button>

                <button class="tool-btn icon-only" @mousedown.stop.prevent @click="toggleHistoryPanel"
                  :title="store.historyPanelVisible ? t('studio.hideHistory') : t('studio.showHistory')"
                  :class="{ active: store.historyPanelVisible }">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                </button>
                 <!-- Saves Manager Button -->
                <button class="tool-btn icon-only" @mousedown.stop.prevent @click="toggleSavesManager"
                  :title="t('studio.savesManager') || 'Manage Saves'"
                  :aria-label="t('studio.savesManager') || 'Manage Saves'" :class="{ active: savesManagerActive }">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v13a2 2 0 0 1-2 2z"></path>
                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                    <polyline points="7 3 7 8 15 8"></polyline>
                  </svg>
                </button>
              </div>

              <div class="divider"></div>

              <!-- Group 4: Character / Import / Export (Redesigned) -->
              <div class="tool-group">
                <!-- Import Character -->
                <button class="tool-btn icon-only" @mousedown.stop.prevent @click="importCharacterAsStack"
                  :disabled="!hasCharacterData"
                  :title="t('studio.importCharacterTitle') || 'Import Character as Stack'">
                  <!-- User Icon with Down Arrow (Import) -->
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                    <path d="M19 13l-3 3l-3-3" stroke-width="1.5"></path>
                  </svg>
                </button>

                <!-- Apply to target -->
                <button class="tool-btn icon-only" @mousedown.stop.prevent @click="applyToTarget" :disabled="!hasTarget"
                  :title="applyButtonTitle">
                  <!-- T-Shirt/Appearance Icon -->
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <path
                      d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.47a2 2 0 00-1.34-2.23z">
                    </path>
                    <path d="M16 19l2 2 4-4" stroke-width="1.5" transform="scale(0.5) translate(20, 20)"></path>
                    <!-- Small checkmark implication -->
                  </svg>
                </button>

                <!-- Export mergedAppearance -->
                <button class="tool-btn icon-only" @mousedown.stop.prevent @click="exportMergedToFileStore"
                  :disabled="!hasFileSystem" :title="t('studio.exportMergedTitle')">
                  <!-- File Export Icon -->
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <path d="M12 18v-6"></path>
                    <path d="M9 15l3 3l3-3"></path>
                  </svg>
                </button>
               
              </div>

              <div class="divider"></div>

              <!-- Group 5: Auto-save Controls -->
              <div class="tool-group">
                <!-- Force Save Button -->
                <button class="tool-btn icon-only" @mousedown.stop.prevent @click="forceSave" title="Force Save Now">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v13a2 2 0 0 1-2 2z"></path>
                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                    <polyline points="7 3 7 8 15 8"></polyline>
                    <circle cx="12" cy="17" r="1" fill="currentColor"></circle>
                  </svg>
                </button>

                <!-- Clear Auto-save Button -->
                <button class="tool-btn icon-only" @mousedown.stop.prevent @click="clearAutoSave"
                  title="Clear Auto-saved Data">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                </button>
              </div>

              <!-- Save Status Indicator -->
              <div :class="saveStatusClass" v-if="store.saveStatus !== 'idle'" :title="lastSaveTimeText">
                <span class="save-status-text">{{ saveStatusText }}</span>
              </div>

              <!-- Target Name Indicator -->
              <div class="target-indicator" v-if="hasTarget" :title="targetName">
                <span class="status-dot"></span>
                <span class="target-text">{{ targetName }}</span>
              </div>

              <div class="spacer"></div>

              <!-- Close Button -->
              <button class="window-control-btn close" @mousedown.stop.prevent="close" :title="t('studio.closeTitle')">
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
              </button>
            </div>
          </header>

          <!-- Auto-restore Notification Banner -->
          <transition name="banner-slide">
            <div v-if="showRestoreBanner" class="restore-banner">
              <div class="banner-content">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round" class="banner-icon">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
                  <circle cx="12" cy="12" r="2" fill="currentColor"></circle>
                </svg>
                <span class="banner-text">
                  Auto-saved data from <strong>{{ formatRestoreTime() }}</strong> has been restored
                </span>
              </div>
              <button class="banner-dismiss" @click="dismissRestoreBanner" aria-label="Dismiss">
                <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                  <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
              </button>
            </div>
          </transition>

          <div class="studio-body" :class="{ 'is-mobile': isMobile }">
            <!-- Mobile tab switcher -->
            <div v-if="isMobile" class="mobile-tabs u-show-mobile">
              <button @click="mobileTab = 'preview'" :class="{ active: mobileTab === 'preview' }">Preview</button>
              <button @click="mobileTab = 'stacks'" :class="{ active: mobileTab === 'stacks' }">Stacks</button>
              <button @click="mobileTab = 'parts'" :class="{ active: mobileTab === 'parts' }">Parts</button>
              <button v-if="!isReplaceMode" @click="mobileTab = 'inspector'" :class="{ active: mobileTab === 'inspector' }">Inspector</button>
              <button v-if="isReplaceMode" @click="mobileTab = 'assets'" :class="{ active: mobileTab === 'assets' }">Assets</button>
            </div>

            <!-- 左侧：Preview -->
            <aside v-if="!isMobile || mobileTab === 'preview'" class="panel-section studio-left">
              <PreviewWidget />
            </aside>

            <!-- 中间：StackList (窄) + PartList (宽) -->
            <aside v-if="!isMobile || mobileTab === 'stacks'" class="panel-section stack-column">
              <StackList />
            </aside>
            <aside v-if="!isMobile || mobileTab === 'parts'" class="panel-section parts-column">
              <PartListPanel />
            </aside>

            <!-- Inspector 列：只在非替换模式显示 -->
            <aside v-if="(!isMobile || mobileTab === 'inspector') && !isReplaceMode" class="panel-section studio-right">
              <PartInspectorPanel />
            </aside>

            <!-- Asset selector 列：只在替换模式显示 -->
            <aside v-if="(!isMobile || mobileTab === 'assets') && isReplaceMode" class="panel-section studio-assets">
              <AssetSelectorPanel />
            </aside>

            <!-- Palette 单独列 -->
            <aside v-if="store.palettePanelVisible" class="panel-section studio-palette">
              <PalettePanel @close="onPaletteClose" />
            </aside>

            <!-- Layer Manager 单独列 -->
            <aside v-if="store.layerManagerActive" class="panel-section studio-layer-manager">
              <LayerManagerWidget />
            </aside>

            <!-- History Panel 单独列 -->
            <aside v-if="store.historyPanelVisible" class="panel-section studio-history">
              <HistoryPanel />
            </aside>

            <!-- Saves Manager Panel 单独列 -->
            <aside v-if="savesManagerActive" class="panel-section saves-manager-panel">
              <SavesManager @close="toggleSavesManager" />
            </aside>
          </div>
        </div>
      </div>
    </div>

    <!-- hidden file inputs for import -->
    <input ref="stacksFileInput" type="file" accept="application/json" style="display:none"
      @change="onStacksFileSelected" />
    <input ref="paletteFileInput" type="file" accept="application/json" style="display:none"
      @change="onPaletteFileSelected" />
  </teleport>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import PreviewWidget from './PreviewWidget.vue'
import StackList from './StackList.vue'
import PartListPanel from './PartListPanel.vue'
import PartInspectorPanel from './PartInspectorPanel.vue'
import AssetSelectorPanel from './AssetSelectorPanel.vue'
import PalettePanel from './PalettePanel.vue'
import LayerManagerWidget from './LayerManagerWidget.vue'
import HistoryPanel from './HistoryPanel.vue'
import SavesManager from './SavesManager.vue'
import { useStudioStore } from '@/stores/studioStore'
import { useFileSystemStore } from '@/stores/fileSystemStore'
import { ExternalAdapter } from '@/utils/external_adapters'
import { hostWindow, doc } from '@/utils/host-window.js'
import { injectTheme } from '@/composables/useTheme'
import { useUndoRedo } from '@/composables/useUndoRedo'
import { useAutoSave } from '@/composables/useAutoSave'
import * as DialogService from '@/services/DialogService.js'

const { t } = useI18n()
const store = useStudioStore()
const fsStore = useFileSystemStore()

// Setup undo/redo keyboard shortcuts
useUndoRedo(store, {
  enableLogging: false, // Set to true for debugging
  onUndo: () => {
    // Optional: Show a notification or feedback when undo is performed
  },
  onRedo: () => {
    // Optional: Show a notification or feedback when redo is performed
  }
})

// Setup auto-save
const autoSaveControls = useAutoSave(store, {
  debounceMs: 2000,
  watchKeys: ['stacks', 'paletteMap'],
  onSave: () => {
    console.log('[Studio] Auto-save completed')
  },
  onError: (error) => {
    console.error('[Studio] Auto-save error:', error)
  }
})

// Auto-restore state
const showRestoreBanner = ref(false)
const restoreInfo = ref(null)

// Saves Manager state
const savesManagerActive = ref(false)

// Inject theme
const injectedTheme = injectTheme()
const themeClass = computed(() => injectedTheme.themeClass())

const props = defineProps({
  visible: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])
function close() { emit('close') }

// position & size state for draggable / resizable window
const pos = ref({ x: null, y: null })
const size = ref({ w: 1920, h: 1080 })

const dragging = ref(false)
const resizing = ref(false)
const resizeDir = ref(null)
const pointerStart = ref({ x: 0, y: 0 })
const startRect = ref({ x: 0, y: 0, w: 0, h: 0 })

const MOBILE_BREAKPOINT = 900
const isMobile = ref(false)
const mobileTab = ref('preview') // 'preview', 'stacks', 'parts', 'inspector'

const panelStyle = computed(() => {
  const margin = isMobile.value ? 8 : 12
  const maxW = hostWindow.innerWidth - margin * 2
  const maxH = hostWindow.innerHeight - margin * 2
  const left = pos.value.x !== null ? pos.value.x : Math.max(margin, Math.round((hostWindow.innerWidth - size.value.w) / 2))
  const top = pos.value.y !== null ? pos.value.y : Math.max(margin, Math.round((hostWindow.innerHeight - size.value.h) / 2))
  return {
    left: left + 'px',
    top: top + 'px',
    width: Math.min(size.value.w, maxW) + 'px',
    height: Math.min(size.value.h, maxH) + 'px',
    maxHeight: `calc(var(--dvh-safe, 100dvh) - ${margin * 2}px)`,
    position: 'fixed',
    zIndex: 10060
  }
})

function startDrag(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  if (e.target.closest('button')) return

  dragging.value = true
  pointerStart.value = { x: e.clientX, y: e.clientY }
  const margin = isMobile.value ? 8 : 12
  const computedLeft = pos.value.x !== null ? pos.value.x : Math.max(margin, Math.round((hostWindow.innerWidth - size.value.w) / 2))
  const computedTop = pos.value.y !== null ? pos.value.y : Math.max(margin, Math.round((hostWindow.innerHeight - size.value.h) / 2))
  startRect.value = { x: computedLeft, y: computedTop, w: size.value.w, h: size.value.h }
  doc.body.style.userSelect = 'none'
  e.target?.setPointerCapture?.(e.pointerId)
}

function startResize(dir, e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  resizing.value = true
  resizeDir.value = dir
  pointerStart.value = { x: e.clientX, y: e.clientY }
  const margin = isMobile.value ? 8 : 12
  const computedLeft = pos.value.x !== null ? pos.value.x : Math.max(margin, Math.round((hostWindow.innerWidth - size.value.w) / 2))
  const computedTop = pos.value.y !== null ? pos.value.y : Math.max(margin, Math.round((hostWindow.innerHeight - size.value.h) / 2))
  startRect.value = { x: computedLeft, y: computedTop, w: size.value.w, h: size.value.h }
  doc.body.style.userSelect = 'none'
  e.target?.setPointerCapture?.(e.pointerId)
}

function onPointerMove(e) {
  if (!props.visible) return
  const dx = e.clientX - pointerStart.value.x
  const dy = e.clientY - pointerStart.value.y

  if (dragging.value) {
    let nx = startRect.value.x + dx
    let ny = startRect.value.y + dy
    nx = Math.max(6, Math.min(nx, hostWindow.innerWidth - startRect.value.w - 6))
    ny = Math.max(6, Math.min(ny, hostWindow.innerHeight - startRect.value.h - 6))
    pos.value.x = nx
    pos.value.y = ny
  } else if (resizing.value) {
    const dir = resizeDir.value || ''
    let nx = startRect.value.x
    let ny = startRect.value.y
    let nw = startRect.value.w
    let nh = startRect.value.h

    if (dir.includes('left')) {
      nw = Math.max(720, startRect.value.w - dx)
      nx = startRect.value.x + (startRect.value.w - nw)
    }
    if (dir.includes('right')) nw = Math.max(720, startRect.value.w + dx)
    if (dir.includes('top')) {
      nh = Math.max(420, startRect.value.h - dy)
      ny = startRect.value.y + (startRect.value.h - nh)
    }
    if (dir.includes('bottom')) nh = Math.max(420, startRect.value.h + dy)

    nx = Math.max(6, Math.min(nx, hostWindow.innerWidth - 64))
    ny = Math.max(6, Math.min(ny, hostWindow.innerHeight - 64))
    nw = Math.min(nw, hostWindow.innerWidth - nx - 6)
    nh = Math.min(nh, hostWindow.innerHeight - ny - 6)

    pos.value.x = nx
    pos.value.y = ny
    size.value.w = nw
    size.value.h = nh
  }
}

function onPointerUp() {
  if (dragging.value || resizing.value) {
    dragging.value = false
    resizing.value = false
    resizeDir.value = null
    doc.body.style.userSelect = ''
  }
}

function updateIsMobile() {
  isMobile.value = hostWindow.innerWidth < MOBILE_BREAKPOINT
}

function onWindowResize() {
  updateIsMobile()
  if (!props.visible) return
  const margin = isMobile.value ? 8 : 12
  const maxW = Math.max(280, hostWindow.innerWidth - margin * 2)
  const maxH = Math.max(220, hostWindow.innerHeight - margin * 2)
  if (size.value.w > maxW) size.value.w = maxW
  if (size.value.h > maxH) size.value.h = maxH
  const computedLeft = pos.value.x !== null ? pos.value.x : Math.max(margin, Math.round((hostWindow.innerWidth - size.value.w) / 2))
  const computedTop = pos.value.y !== null ? pos.value.y : Math.max(margin, Math.round((hostWindow.innerHeight - size.value.h) / 2))
  pos.value.x = Math.max(margin, Math.min(computedLeft, hostWindow.innerWidth - size.value.w - margin))
  pos.value.y = Math.max(margin, Math.min(computedTop, hostWindow.innerHeight - size.value.h - margin))
}

// Watch visibility
watch(() => props.visible, async (v) => {
  if (v) {
    await nextTick()
    updateIsMobile()
    const margin = isMobile.value ? 8 : 12
    const targetW = isMobile.value ? Math.round(hostWindow.innerWidth * 0.98) : Math.round(hostWindow.innerWidth * 0.92)
    const targetH = isMobile.value ? Math.round(hostWindow.innerHeight * 0.94) : Math.round(hostWindow.innerHeight * 0.88)
    size.value.w = Math.min(size.value.w, targetW)
    size.value.h = Math.min(size.value.h, targetH)
    if (pos.value.x === null || pos.value.y === null) {
      pos.value.x = Math.max(margin, Math.round((hostWindow.innerWidth - size.value.w) / 2))
      pos.value.y = Math.max(margin, Math.round((hostWindow.innerHeight - size.value.h) / 2))
    }
    store.loadAssetData().catch(() => { /* ignore */ })
    hostWindow.addEventListener('keydown', escHandler)
    hostWindow.addEventListener('resize', onWindowResize)
  } else {
    hostWindow.removeEventListener('keydown', escHandler)
    hostWindow.removeEventListener('resize', onWindowResize)
  }
})

function escHandler(e) {
  if (e.key === 'Escape') close()
}

onMounted(async () => {
  updateIsMobile()
  hostWindow.addEventListener('pointermove', onPointerMove, { passive: true })
  hostWindow.addEventListener('pointerup', onPointerUp, { passive: true })

  // Enable auto-save
  store.enableAutoSave()

  // Try to restore auto-saved data using new method
  // const result = await store.autoRestoreSession()
  if (result.restored) {
    restoreInfo.value = result
    showRestoreBanner.value = true
    console.log('[Studio] Auto-saved data restored from', new Date(result.save.timestamp).toLocaleString())
  } else if (result.reason) {
    console.log('[Studio] No auto-save data restored:', result.reason)
  }
})

onBeforeUnmount(() => {
  hostWindow.removeEventListener('pointermove', onPointerMove)
  hostWindow.removeEventListener('pointerup', onPointerUp)
  hostWindow.removeEventListener('keydown', escHandler)
  hostWindow.removeEventListener('resize', onWindowResize)

  // Disable auto-save
  store.disableAutoSave()
})

/* ---------- Apply to target integration ---------- */

const hasTarget = computed(() => !!fsStore.character)
const targetName = computed(() => {
  if (!fsStore.character) return ''
  return fsStore.character?.Name || (`Member#${fsStore.character?.MemberNumber ?? '?'}`)
})

const hasFileSystem = computed(() => !!fsStore && typeof fsStore.addFile === 'function')

const hasCharacterData = computed(() => {
  return fsStore.characterItem && fsStore.characterItem.length > 0
})

const applyButtonTitle = computed(() => {
  return hasTarget.value
    ? t('studio.applyToTargetLabel', { name: targetName.value || t('studio.targetDefault') })
    : t('studio.applyNoTargetTitle')
})

async function applyToTarget() {
  if (!hasTarget.value) {
    await DialogService.alert(t('studio.applyNoTargetAlert'))
    return
  }

  try {
    store.refreshMergedAppearanceData()
    const bundle = store.mergedAppearanceData?.data || []
    if (!Array.isArray(bundle) || bundle.length === 0) {
      const confirmed = await DialogService.confirm(t('studio.applyMergedEmptyConfirm'))
      if (!confirmed) return
    }
    const success = ExternalAdapter.applyOutfitToCharacter(toRaw(fsStore.character), toRaw(bundle))
    if (success) {
      await DialogService.alert(t('studio.applySuccessAlert'))
    } else {
      await DialogService.alert(t('studio.applyFailedAlert'))
    }
  } catch (e) {
    console.error('applyToTarget failed', e)
    await DialogService.alert(t('studio.applyFailedAlert') + (e?.message ? ' ' + String(e.message) : ''))
  }
}

async function importCharacterAsStack() {
  if (!hasCharacterData.value) return
  try {
    const rawData = toRaw(fsStore.characterItem)
    const stackData = JSON.parse(JSON.stringify(rawData))
    store.addElement({
      data: stackData,
      name: 'Character',
      filterList: fsStore.fullFilters || []
    })
    ExternalAdapter.sendRetriveOutfitNotification(toRaw(fsStore.character))
  } catch (e) {
    console.error('importCharacterAsStack failed', e)
    await DialogService.alert('Failed to import character data')
  }
}

const isReplaceMode = computed(() => !!(store.replaceTarget && store.replaceTarget.active))

function togglePalette() {
  if (store.palettePanelVisible) store.closePalettePanel()
  else store.openPalettePanel([])
}

function toggleLayerManager() {
  store.toggleLayerManager(!store.layerManagerActive)
}

function toggleHistoryPanel() {
  store.toggleHistoryPanel()
}

function toggleSavesManager() {
  savesManagerActive.value = !savesManagerActive.value
}

function onPaletteClose() {
  store.closePalettePanel()
}

/* ----------------------- IMPORT / EXPORT ----------------------- */

const stacksFileInput = ref(null)
const paletteFileInput = ref(null)

function onSaveStacks() {
  store.persistStacksToLocalStorage()
  store.exportStacksToJsonFile('stacks.json')
}

function onLoadStacksClick() {
  const el = stacksFileInput.value
  if (el) { el.value = null; el.click() }
}

async function onStacksFileSelected(e) {
  const files = e.target.files
  if (!files || !files.length) return
  const ok = await store.importStacksFromJsonFile(files[0])
  if (ok) await DialogService.alert(t('studio.stacksImportSuccess'))
  else await DialogService.alert(t('studio.stacksImportFailed'))
}

function onSavePalette() {
  store.persistPaletteToLocalStorage()
  store.exportPaletteToJsonFile('palette.json')
}

function onLoadPaletteClick() {
  const el = paletteFileInput.value
  if (el) { el.value = null; el.click() }
}

async function onPaletteFileSelected(e) {
  const files = e.target.files
  if (!files || !files.length) return
  const ok = await store.importPaletteFromJsonFile(files[0])
  if (ok) await DialogService.alert(t('studio.paletteImportSuccess'))
  else await DialogService.alert(t('studio.paletteImportFailed'))
}

async function exportMergedToFileStore() {
  if (!hasFileSystem.value) {
    await DialogService.alert(t('studio.exportNoFSAlert'))
    return
  }
  try {
    store.refreshMergedAppearanceData()
    const payload = store.getMergedAppearanceForExport()
    const fileNode = {
      name: 'mergedAppearance_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json',
      type: 'outfit',
      data: payload.data || [],
      createdAt: new Date().toISOString()
    }
    fsStore.addFile(fileNode)
    try { fsStore.saveAll() } catch (e) { /* ignore */ }
    await DialogService.alert(t('studio.exportSuccessAlert'))
  } catch (e) {
    console.error('exportMergedToFileStore failed', e)
    await DialogService.alert(t('studio.exportFailedAlert', { msg: e?.message || String(e) }))
  }
}

/* ----------------------- AUTO-SAVE ----------------------- */

// Computed properties for save status display
const saveStatusText = computed(() => {
  switch (store.saveStatus) {
    case 'saving':
      return 'Saving...'
    case 'saved':
      return 'Saved ✓'
    case 'error':
      return 'Error ✗'
    default:
      return ''
  }
})

const saveStatusClass = computed(() => {
  return {
    'save-status': true,
    'save-status-saving': store.saveStatus === 'saving',
    'save-status-saved': store.saveStatus === 'saved',
    'save-status-error': store.saveStatus === 'error',
    'save-status-visible': store.saveStatus !== 'idle'
  }
})

const lastSaveTimeText = computed(() => {
  if (!store.lastSaveTime) return ''
  const now = Date.now()
  const diff = now - store.lastSaveTime
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (seconds < 60) return `${seconds}s ago`
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return new Date(store.lastSaveTime).toLocaleDateString()
})

function dismissRestoreBanner() {
  showRestoreBanner.value = false
}

function formatRestoreTime() {
  if (!restoreInfo.value || !restoreInfo.value.timestamp) return ''
  return new Date(restoreInfo.value.timestamp).toLocaleString()
}

async function forceSave() {
  try {
    await autoSaveControls.forceSave()
    console.log('[Studio] Manual save completed')
  } catch (error) {
    console.error('[Studio] Manual save failed:', error)
    await DialogService.alert('Failed to save: ' + (error?.message || String(error)))
  }
}

async function clearAutoSave() {
  const confirmed = await DialogService.confirm(
    'Are you sure you want to clear auto-saved data? This action cannot be undone.'
  )
  if (!confirmed) return

  try {
    autoSaveControls.clearSave()
    showRestoreBanner.value = false
    restoreInfo.value = null
    console.log('[Studio] Auto-save data cleared')
    await DialogService.alert('Auto-saved data has been cleared.')
  } catch (error) {
    console.error('[Studio] Failed to clear auto-save:', error)
    await DialogService.alert('Failed to clear auto-save data: ' + (error?.message || String(error)))
  }
}
</script>

<style scoped>
.studio-container {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 10050;
  font-family: var(--font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
}

.studio-window {
  pointer-events: auto;
  background: var(--color-bg-surface, #f8fafc);
  border-radius: var(--radius-xl, 12px);
  box-shadow: var(--shadow-2xl, 0 10px 40px rgba(0, 0, 0, 0.2)), 0 0 0 1px var(--color-border-base, rgba(0, 0, 0, 0.05));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  max-height: var(--panel-max-height-safe, calc(100dvh - 24px));
}

/* --- Header & Toolbar --- */
.studio-header {
  height: var(--toolbar-height, 52px);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-md, 12px);
  background: var(--color-bg-base, #ffffff);
  border-bottom: 1px solid var(--color-border-base, #e2e8f0);
  cursor: move;
  user-select: none;
}

.header-title {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 8px);
  margin-right: var(--space-lg, 16px);
  opacity: 0.8;
  color: var(--color-text-tertiary, #64748b);
}

.header-title h3 {
  margin: 0;
  font-size: var(--font-size-lg, 15px);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-text-primary, #1e293b);
}

.studio-toolbar {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--space-xs, 4px);
}

.tool-group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.divider {
  width: 1px;
  height: 20px;
  background: var(--color-border-strong, #cbd5e1);
  margin: 0 var(--space-sm, 6px);
}

.spacer {
  flex: 1;
}

/* Base button style */
.tool-btn {
  height: var(--button-height-md, 32px);
  border-radius: var(--radius-sm, 6px);
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-secondary, #475569);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast, 0.15s) ease;
  position: relative;
}

.tool-btn.icon-only {
  width: var(--button-height-md, 32px);
  padding: 0;
}

.tool-btn:hover {
  background: var(--color-bg-hover, #f1f5f9);
  color: var(--color-text-primary, #0f172a);
}

.tool-btn:active,
.tool-btn.active {
  background: var(--color-bg-active, #e2e8f0);
  color: var(--color-primary, #2563eb);
  border-color: var(--color-border-strong, #cbd5e1);
}

.tool-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}

/* Specialized icon combo (e.g., Folder + Palette) */
.icon-combo {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mini-badge {
  position: absolute;
  bottom: 2px;
  right: 2px;
  font-size: 8px;
  line-height: 1;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 50%;
}

.target-indicator {
  margin-left: var(--space-sm, 8px);
  padding: var(--space-xs, 4px) 10px;
  border-radius: var(--radius-xl, 12px);
  background: var(--color-info-bg, #eff6ff);
  color: var(--color-text-primary, #1e293b);
  font-size: var(--font-size-sm, 12px);
  font-weight: var(--font-weight-medium, 500);
  border: 1px solid var(--color-border-light, #dbeafe);
  display: flex;
  align-items: center;
  gap: var(--space-sm, 6px);
  max-width: 150px;
}

.target-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-dot {
  width: 6px;
  height: 6px;
  background: var(--color-info, #3b82f6);
  border-radius: var(--radius-round, 50%);
  flex-shrink: 0;
}

.window-control-btn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm, 6px);
  color: var(--color-text-tertiary, #64748b);
  cursor: pointer;
  margin-left: var(--space-xs, 4px);
}

.window-control-btn:hover {
  background: var(--color-error-bg, #fee2e2);
  color: var(--color-error, #ef4444);
}

/* --- Main Layout --- */
.mobile-tabs {
  display: flex;
  gap: var(--space-xs, 4px);
  padding: var(--space-sm, 8px);
  background: var(--color-bg-base, #fff);
  border-bottom: 1px solid var(--color-border-base, #e2e8f0);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.mobile-tabs button {
  flex: 1 1 auto;
  min-width: 80px;
  padding: clamp(10px, 2vw, 12px) var(--space-md, 12px);
  min-height: 44px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-base, #fff);
  color: var(--color-text-secondary, #64748b);
  font-size: var(--font-size-fluid-sm, 13px);
  font-weight: var(--font-weight-medium, 500);
  cursor: pointer;
  transition: all var(--transition-fast, 0.15s) ease;
  white-space: nowrap;
}

.mobile-tabs button.active {
  background: var(--color-primary, #2563eb);
  color: var(--color-text-inverse, #fff);
  border-color: var(--color-primary, #2563eb);
}

.studio-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  background: var(--color-bg-panel, #f1f5f9);
}

.studio-body.is-mobile {
  flex-direction: column;
}

.panel-section {
  display: flex;
  flex-direction: column;
  background: var(--color-bg-base, #ffffff);
  border-right: 1px solid var(--color-border-base, #e2e8f0);
  min-height: 0;
  position: relative;
}

.studio-body.is-mobile .panel-section {
  width: 100% !important;
  min-width: 0 !important;
  max-width: none !important;
  flex: 1 1 auto;
  border-right: none;
  border-bottom: 1px solid var(--color-border-base, #e2e8f0);
}

.panel-section:last-child {
  border-right: none;
}

/* Individual Panel Widths */
.studio-left {
  width: auto;
  min-width: 450px;
  max-width: 450px;
}

.stack-column {
  width: 240px;
  min-width: 200px;
  max-width: 300px;
}

.parts-column {
  flex: 1;
  min-width: 340px;
}

.studio-right,
.studio-assets {
  width: 360px;
  min-width: 340px;
  max-width: 500px;
  border-left: 1px solid var(--color-border-base);
  border-right: none;
}

.studio-palette {
  width: 260px;
  min-width: 220px;
  border-left: 1px solid var(--color-border-base);
}

.studio-layer-manager {
  width: 280px;
  min-width: 240px;
  border-left: 1px solid var(--color-border-base);
}

.studio-history {
  width: 280px;
  min-width: 240px;
  border-left: 1px solid var(--color-border-base);
}

.saves-manager-panel {
  width: 400px;
  min-width: 350px;
  max-width: 500px;
  border-left: 1px solid var(--color-border-base);
}


/* --- Resize Handles --- */
.resize-handle {
  position: absolute;
  z-index: 10100;
}

.resize-handle.top {
  left: 0;
  right: 0;
  top: -6px;
  height: 16px;
  cursor: ns-resize;
}

.resize-handle.bottom {
  left: 0;
  right: 0;
  bottom: -6px;
  height: 16px;
  cursor: ns-resize;
}

.resize-handle.left {
  top: 0;
  bottom: 0;
  left: -6px;
  width: 16px;
  cursor: ew-resize;
}

.resize-handle.right {
  top: 0;
  bottom: 0;
  right: -6px;
  width: 16px;
  cursor: ew-resize;
}

.resize-handle.corner {
  width: 18px;
  height: 18px;
  z-index: 10101;
}

.resize-handle.corner.top-left {
  left: -4px;
  top: -4px;
  cursor: nwse-resize;
}

.resize-handle.corner.top-right {
  right: -4px;
  top: -4px;
  cursor: nesw-resize;
}

.resize-handle.corner.bottom-right {
  right: -4px;
  bottom: -4px;
  cursor: nwse-resize;
}

.resize-handle.corner.bottom-left {
  left: -4px;
  bottom: -4px;
  cursor: nesw-resize;
}

/* --- Auto-save Status --- */
.save-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: var(--radius-sm, 6px);
  font-size: 12px;
  font-weight: 500;
  margin-left: 8px;
  transition: opacity 0.2s ease, background-color 0.2s ease;
  opacity: 0;
  pointer-events: none;
}

.save-status-visible {
  opacity: 1;
  pointer-events: auto;
}

.save-status-saving {
  background: var(--color-info-bg, #e0f2fe);
  color: var(--color-info, #0369a1);
}

.save-status-saved {
  background: var(--color-success-bg, #dcfce7);
  color: var(--color-success, #16a34a);
}

.save-status-error {
  background: var(--color-error-bg, #fee2e2);
  color: var(--color-error, #dc2626);
}

.save-status-text {
  white-space: nowrap;
}

/* --- Restore Banner --- */
.restore-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: var(--color-info-bg, #dbeafe);
  border-bottom: 1px solid var(--color-border-base, #e2e8f0);
  color: var(--color-text-primary, #1e293b);
  font-size: 13px;
}

.banner-content {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.banner-icon {
  flex-shrink: 0;
  color: var(--color-primary, #3b82f6);
}

.banner-text {
  line-height: 1.4;
}

.banner-text strong {
  font-weight: 600;
  color: var(--color-primary, #3b82f6);
}

.banner-dismiss {
  flex-shrink: 0;
  padding: 4px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary, #64748b);
  cursor: pointer;
  border-radius: var(--radius-sm, 4px);
  transition: background-color 0.2s ease, color 0.2s ease;
}

.banner-dismiss:hover {
  background: var(--color-bg-hover, rgba(0, 0, 0, 0.05));
  color: var(--color-text-primary, #1e293b);
}

/* Banner slide animation */
.banner-slide-enter-active,
.banner-slide-leave-active {
  transition: all 0.3s ease;
}

.banner-slide-enter-from {
  transform: translateY(-100%);
  opacity: 0;
}

.banner-slide-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
</style>