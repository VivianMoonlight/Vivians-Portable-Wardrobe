<template>
  <teleport to="body">
    <div v-if="visible" class="studio-container">
      <div class="studio-window" role="dialog" :aria-label="t('studio.ariaLabel')" :style="panelStyle">
        <header class="studio-header" @mousedown.stop.prevent="startDrag">
          <h3>{{ t('studio.title') }}</h3>
          <div class="studio-actions">
            <!-- Persist / Import/Export controls -->
            <button
              class="palette-toggle"
              @mousedown.stop.prevent
              @click="onSaveStacks"
              :title="t('studio.saveStacksTitle')"
            >
              💾
            </button>

            <button
              class="palette-toggle"
              @mousedown.stop.prevent
              @click="onLoadStacksClick"
              :title="t('studio.loadStacksTitle')"
            >
              📂
            </button>

            <button
              class="palette-toggle"
              @mousedown.stop.prevent
              @click="onSavePalette"
              :title="t('studio.savePaletteTitle')"
            >
              💾🎨
            </button>

            <button
              class="palette-toggle"
              @mousedown.stop.prevent
              @click="onLoadPaletteClick"
              :title="t('studio.loadPaletteTitle')"
            >
              📂🎨
            </button>

            <!-- Palette toggle button -->
            <button
              class="palette-toggle"
              @mousedown.stop.prevent
              @click="togglePalette"
              :title="store.palettePanelVisible ? t('studio.hidePalette') : t('studio.showPalette')"
            >
              {{ store.palettePanelVisible ? '🎨' : '🎨' }}
            </button>

            <!-- Apply to target character button (uses fs store's character) -->
            <button
              class="palette-toggle"
              @mousedown.stop.prevent
              @click="applyToTarget"
              :disabled="!hasTarget"
              :title="applyButtonTitle"
            >
              → 👤
            </button>

            <!-- Export mergedAppearance into FileSystem store -->
            <button
              class="palette-toggle"
              @mousedown.stop.prevent
              @click="exportMergedToFileStore"
              :disabled="!hasFileSystem"
              :title="t('studio.exportMergedTitle')"
            >
              → 📁
            </button>

            <!-- show current target name if available -->
            <div class="target-name" v-if="hasTarget" :title="targetName">{{ targetName }}</div>

            <button class="palette-toggle" @mousedown.stop.prevent="close" :title="t('studio.closeTitle')">×</button>
          </div>
        </header>

        <div class="studio-body">
          <!-- 左侧：Preview -->
          <aside class="studio-left">
            <PreviewWidget />
          </aside>

          <!-- 中间：StackList (窄) + PartList (宽) -->
            <aside class="stack-column">
              <StackList />
            </aside>
            <aside class="parts-column">
              <PartListPanel />
            </aside>

          <!-- Inspector 列：只在非替换模式显示（不显示时不占列宽） -->
          <aside v-if="!isReplaceMode" class="studio-right">
            <PartInspectorPanel />
          </aside>

          <!-- Asset selector 列：只在替换模式显示（不显示时不占列宽） -->
          <aside v-if="isReplaceMode" class="studio-assets">
            <AssetSelectorPanel />
          </aside>

          <!-- 新增最右列：Palette 单独列，始终位于最右侧 -->
          <aside v-if="store.palettePanelVisible" class="studio-palette">
            <PalettePanel @close="onPaletteClose" />
          </aside>
        </div>

        <!-- Resize handles -->
        <div class="resize-handle top" @mousedown.stop.prevent="startResize('top', $event)"></div>
        <div class="resize-handle right" @mousedown.stop.prevent="startResize('right', $event)"></div>
        <div class="resize-handle bottom" @mousedown.stop.prevent="startResize('bottom', $event)"></div>
        <div class="resize-handle left" @mousedown.stop.prevent="startResize('left', $event)"></div>

        <div class="resize-handle corner top-left" @mousedown.stop.prevent="startResize('top-left', $event)"></div>
        <div class="resize-handle corner top-right" @mousedown.stop.prevent="startResize('top-right', $event)"></div>
        <div class="resize-handle corner bottom-right" @mousedown.stop.prevent="startResize('bottom-right', $event)"></div>
        <div class="resize-handle corner bottom-left" @mousedown.stop.prevent="startResize('bottom-left', $event)"></div>
      </div>
    </div>

    <!-- hidden file inputs for import -->
    <input ref="stacksFileInput" type="file" accept="application/json" style="display:none" @change="onStacksFileSelected" />
    <input ref="paletteFileInput" type="file" accept="application/json" style="display:none" @change="onPaletteFileSelected" />
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
import AssetRenderPanel from './AssetRenderPanel.vue' // keep if still used elsewhere
import PriorityArrangementPanel from './PriorityArrangementPanel.vue' // NEW
import { useStudioStore } from '@/stores/studioStore'
import { useFileSystemStore } from '@/stores/fileSystemStore'
import { ExternalAdapter } from '@/utils/external_adapters'
import { hostWindow, doc } from '@/utils/host-window.js'

const { t } = useI18n()
const store = useStudioStore()
const fsStore = useFileSystemStore()

const props = defineProps({
  visible: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])
function close() { emit('close') }

// position & size state for draggable / resizable window
const pos = ref({ x: null, y: null })
const size = ref({ w: 1280, h: 760 })

const dragging = ref(false)
const resizing = ref(false)
const resizeDir = ref(null)
const pointerStart = ref({ x: 0, y: 0 })
const startRect = ref({ x: 0, y: 0, w: 0, h: 0 })

const panelStyle = computed(() => {
  const left = pos.value.x !== null ? pos.value.x : Math.max(12, Math.round((hostWindow.innerWidth - size.value.w) / 2))
  const top = pos.value.y !== null ? pos.value.y : Math.max(12, Math.round((hostWindow.innerHeight - size.value.h) / 2))
  return {
    left: left + 'px',
    top: top + 'px',
    width: Math.min(size.value.w, hostWindow.innerWidth - 24) + 'px',
    height: Math.min(size.value.h, hostWindow.innerHeight - 24) + 'px',
    position: 'fixed',
    zIndex: 10060
  }
})

function startDrag(e) {
  if (e.button !== 0) return
  dragging.value = true
  pointerStart.value = { x: e.clientX, y: e.clientY }
  const computedLeft = pos.value.x !== null ? pos.value.x : Math.max(12, Math.round((hostWindow.innerWidth - size.value.w) / 2))
  const computedTop = pos.value.y !== null ? pos.value.y : Math.max(12, Math.round((hostWindow.innerHeight - size.value.h) / 2))
  startRect.value = { x: computedLeft, y: computedTop, w: size.value.w, h: size.value.h }
  doc.body.style.userSelect = 'none'
}

function startResize(dir, e) {
  if (e.button !== 0) return
  resizing.value = true
  resizeDir.value = dir
  pointerStart.value = { x: e.clientX, y: e.clientY }
  const computedLeft = pos.value.x !== null ? pos.value.x : Math.max(12, Math.round((hostWindow.innerWidth - size.value.w) / 2))
  const computedTop = pos.value.y !== null ? pos.value.y : Math.max(12, Math.round((hostWindow.innerHeight - size.value.h) / 2))
  startRect.value = { x: computedLeft, y: computedTop, w: size.value.w, h: size.value.h }
  doc.body.style.userSelect = 'none'
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

// 当 Studio 可见时加载 asset 数据（若尚未加载）
watch(() => props.visible, async (v) => {
  if (v) {
    await nextTick()
    size.value.w = Math.min(size.value.w, Math.round(hostWindow.innerWidth * 0.96))
    size.value.h = Math.min(size.value.h, Math.round(hostWindow.innerHeight * 0.9))
    if (pos.value.x === null || pos.value.y === null) {
      pos.value.x = Math.max(12, Math.round((hostWindow.innerWidth - size.value.w) / 2))
      pos.value.y = Math.max(12, Math.round((hostWindow.innerHeight - size.value.h) / 2))
    }
    // 尝试加载 asset 数据（如果还没加载）
    store.loadAssetData().catch(() => { /* ignore */ })

    hostWindow.addEventListener('keydown', escHandler)
  } else {
    hostWindow.removeEventListener('keydown', escHandler)
  }
})

function escHandler(e) {
  if (e.key === 'Escape') close()
}

onMounted(() => {
  hostWindow.addEventListener('mousemove', onPointerMove)
  hostWindow.addEventListener('mouseup', onPointerUp)
})

onBeforeUnmount(() => {
  hostWindow.removeEventListener('mousemove', onPointerMove)
  hostWindow.removeEventListener('mouseup', onPointerUp)
  hostWindow.removeEventListener('keydown', escHandler)
})

/* ---------- New: Apply to target character integration ---------- */

// computed helper: whether a target character exists in file system store
const hasTarget = computed(() => !!fsStore.character)
const targetName = computed(() => {
  if (!fsStore.character) return ''
  return fsStore.character?.Name || (`Member#${fsStore.character?.MemberNumber ?? 'unknown'}`)
})

// whether file system store is available (for export)
const hasFileSystem = computed(() => !!fsStore && typeof fsStore.addFile === 'function')

// computed title for apply button
const applyButtonTitle = computed(() => {
  return hasTarget.value
    ? t('studio.applyToTargetLabel', { name: targetName.value || t('studio.targetDefault') })
    : t('studio.applyNoTargetTitle')
})

// Apply merged appearance to target character
function applyToTarget() {
  if (!hasTarget.value) {
    alert(t('studio.applyNoTargetAlert'))
    return
  }

  try {
    // Ensure merged appearance data is up-to-date
    store.refreshMergedAppearanceData()

    const bundle = store.mergedAppearanceData?.data || []
    // Defensive check
    if (!Array.isArray(bundle) || bundle.length === 0) {
      if (!confirm(t('studio.applyMergedEmptyConfirm'))) return
    }

    // Use ExternalAdapter to safely call game functions
    const success = ExternalAdapter.applyOutfitToCharacter(toRaw(fsStore.character), toRaw(bundle))
    if (success) {
      alert(t('studio.applySuccessAlert'))
    } else {
      alert(t('studio.applyFailedAlert'))
    }
  } catch (e) {
    console.error('applyToTarget failed', e)
    alert(t('studio.applyFailedAlert') + (e?.message ? ' ' + String(e.message) : ''))
  }
}
/* -------------------------------------------------------------- */

// UI: whether currently in replace mode (driven by studioStore)
const isReplaceMode = computed(() => !!(store.replaceTarget && store.replaceTarget.active))

// palette toggle helper (uses centralized store)
function togglePalette() {
  if (store.palettePanelVisible) store.closePalettePanel()
  else store.openPalettePanel([])
}

function onPaletteClose() {
  store.closePalettePanel()
}

/* -----------------------
   IMPORT / EXPORT HANDLERS
   ----------------------- */

const stacksFileInput = ref(null)
const paletteFileInput = ref(null)

function onSaveStacks() {
  // persist to localStorage as well for quick restore
  store.persistStacksToLocalStorage()
  store.exportStacksToJsonFile('stacks.json')
}

function onLoadStacksClick() {
  const el = stacksFileInput.value
  if (el) {
    el.value = null
    el.click()
  }
}

async function onStacksFileSelected(e) {
  const files = e.target.files
  if (!files || !files.length) return
  const file = files[0]
  const ok = await store.importStacksFromJsonFile(file)
  if (ok) {
    alert(t('studio.stacksImportSuccess'))
  } else {
    alert(t('studio.stacksImportFailed'))
  }
}

function onSavePalette() {
  store.persistPaletteToLocalStorage()
  store.exportPaletteToJsonFile('palette.json')
}

function onLoadPaletteClick() {
  const el = paletteFileInput.value
  if (el) {
    el.value = null
    el.click()
  }
}

async function onPaletteFileSelected(e) {
  const files = e.target.files
  if (!files || !files.length) return
  const file = files[0]
  const ok = await store.importPaletteFromJsonFile(file)
  if (ok) {
    alert(t('studio.paletteImportSuccess'))
  } else {
    alert(t('studio.paletteImportFailed'))
  }
}

/**
 * Export mergedAppearanceData into FileSystem store as a file node.
 */
async function exportMergedToFileStore() {
  if (!hasFileSystem.value) {
    alert(t('studio.exportNoFSAlert'))
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
    try { fsStore.saveAll() } catch (e) { /* ignore if addFile already saved */ }
    alert(t('studio.exportSuccessAlert'))
  } catch (e) {
    console.error('exportMergedToFileStore failed', e)
    alert(t('studio.exportFailedAlert', { msg: e?.message || String(e) }))
  }
}
</script>

<style scoped>
.studio-container {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 10050;
}

.studio-window {
  pointer-events: auto;
  background: linear-gradient(180deg, #ffffff, #fbfdff);
  border-radius: 12px;
  box-shadow: 0 18px 60px rgba(10, 20, 40, 0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(200, 210, 230, 0.6);
  box-sizing: border-box;
}

.studio-header {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(220, 230, 240, 0.7);
  cursor: move;
  user-select: none;
}

.studio-header h3 {
  margin: 0;
  font-size: 18px;
}

.studio-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* .studio-actions button {
  border: none;
  background: #fff;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 20px;
} */

/* palette toggle */
.palette-toggle {
  width: 60px;
  height: 36px;
  padding: 0;
  border-radius: 8px;
  border: 1px solid rgba(220, 230, 240, 0.85);
  background: #fff;
  cursor: pointer;
  font-size: 15px;
  /* increased button text size */
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
.palette-toggle.active {
  background: #f0f6ff;
  /* border-color: rgba(96, 155, 255, 0.4); */
}

/* small apply button */
.studio-actions .apply {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid #dfe6ef;
  background: linear-gradient(180deg, #f7fbff, #ffffff);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  min-width: 78px;
}

.studio-actions .apply[disabled] {
  opacity: 0.48;
  cursor: default;
  pointer-events: none;
}

/* target name display */
.target-name {
  font-size: 13px;
  color: #30445b;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(240, 246, 255, 0.8);
  border: 1px solid rgba(220, 230, 240, 0.6);
}

/* body layout: left preview | center (stack + parts) | inspector | assets | palette */
/* IMPORTANT: ensure flex children can shrink and allow their internal .body to scroll.
   Without `min-height: 0` the children' overflow:auto won't behave inside flex containers
   in many browsers (they'll overflow outside). */
.studio-body {
  flex: 1;
  display: flex;
  gap: 12px;
  padding: 12px;
  box-sizing: border-box;
  align-items: stretch;
  min-height: 0;
}

/* left column */
.studio-left {
  border-right: 1px solid rgba(220, 230, 240, 0.6);
  padding-right: 8px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  max-width: fit-content;
  aspect-ratio: 1/2;
}

/* center: stack + parts */
.studio-center {
  flex: 1;
  display: flex;
  gap: 10px;
  align-items: stretch;
  min-width: 600px;
  min-height: 0;
}

/* narrow stack column */
.stack-column {
  width: 250px;
  min-width: 200px;
  max-width: 350px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* parts column */
.parts-column {
  flex: 1 1 auto;
  min-width: 300px;
  max-width: 1000px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* inspector column - widened to provide more room for color group strings */
.studio-assets,
.studio-right {
  width: 520px;
  /* increased width */
  min-width: 340px;
  max-width: 640px;
  border-left: 1px solid rgba(220, 230, 240, 0.6);
  padding-left: 12px;
  box-sizing: border-box;
  background: linear-gradient(180deg, #fbfdff, #f7fbff);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* palette column - near-right */
.studio-palette {
  width: 220px;
  min-width: 300px;
  max-width: 500px;
  border-left: 1px solid rgba(220, 230, 240, 0.6);
  /* padding-left: 12px; */
  /* box-sizing: border-box; */
  background: linear-gradient(180deg, #ffffff, #fbfdff);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* asset render column */
.studio-assetrender {
  width: 260px;
  min-width: 220px;
  max-width: 320px;
  border-left: 1px solid rgba(220, 230, 240, 0.6);
  padding-left: 12px;
  box-sizing: border-box;
  background: linear-gradient(180deg, #ffffff, #fbfdff);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* priority arrangement column - far right */
.studio-priority {
  width: 300px;
  min-width: 240px;
  max-width: 360px;
  border-left: 1px solid rgba(220, 230, 240, 0.6);
  padding-left: 12px;
  box-sizing: border-box;
  background: linear-gradient(180deg, #ffffff, #fbfdff);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* resize handles */
.resize-handle {
  position: absolute;
  z-index: 10100;
  background: transparent;
}

.resize-handle.top {
  left: 8px;
  right: 8px;
  top: -6px;
  height: 12px;
  cursor: ns-resize;
}

.resize-handle.bottom {
  left: 8px;
  right: 8px;
  bottom: -6px;
  height: 12px;
  cursor: ns-resize;
}

.resize-handle.left {
  top: 8px;
  bottom: 8px;
  left: -6px;
  width: 12px;
  cursor: ew-resize;
}

.resize-handle.right {
  top: 8px;
  bottom: 8px;
  right: -6px;
  width: 12px;
  cursor: ew-resize;
}

.resize-handle.corner {
  width: 14px;
  height: 14px;
  background: rgba(20, 30, 60, 0.06);
  border-radius: 3px;
  position: absolute;
}

.resize-handle.corner.top-left {
  left: -8px;
  top: -8px;
  cursor: nwse-resize;
}

.resize-handle.corner.top-right {
  right: -8px;
  top: -8px;
  cursor: nesw-resize;
}

.resize-handle.corner.bottom-right {
  right: -8px;
  bottom: -8px;
  cursor: nwse-resize;
}

.resize-handle.corner.bottom-left {
  left: -8px;
  bottom: -8px;
  cursor: nesw-resize;
}

.studio-window * {
  pointer-events: auto;
}

/* Ensure internal panels scroll vertically only */
.asset-selector-panel .body,
.inspector-panel .body,
.partlist-panel .body,
.detail-panel .body,
.json-panel .panel-body,
.palette-panel .body,
.asset-render-panel .body,
.priority-panel .body {
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
}
</style>