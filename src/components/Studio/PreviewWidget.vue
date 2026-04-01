<template>
  <div class="preview-widget" role="region" :aria-label="t('previewWidget.title')">
    <div class="preview-header">
      <div class="header-left">
        <h4>{{ t('previewWidget.title') }}</h4>

        <!-- Tools Toggle -->
        <div class="preview-tools">
          <button class="tool-btn" :class="{ active: activeTool === 'view' }" @click="store.setPreviewTool('view')"
            :title="t('previewWidget.viewMode')">
            ✋
          </button>
          <button class="tool-btn" :class="{ active: activeTool === 'move' }" @click="store.setPreviewTool('move')"
            :disabled="!store.canUseMoveTool" :title="store.canUseMoveTool ? t('previewWidget.moveMode') : t('previewWidget.selectPartToMove')">
            ✥
          </button>

          <!-- Layer Manager Toggle >
          <div class="divider"></div>
          <button class="tool-btn" :class="{ active: layerManagerActive }" @click="toggleLayerManager"
            :title="t('previewWidget.toggleLayerManager')">
            ≡
          </button-->
        </div>
      </div>

      <button class="icon-btn" @click="refresh" :title="t('previewWidget.refreshRender')">↻</button>
    </div>

    <div class="preview-canvas-wrap" ref="wrap">
      <canvas ref="canvas" class="preview-canvas" :class="cursorClass" width="300" height="600"
        style="display:none"></canvas>

      <!-- Optional overlay hints -->
      <div v-if="activeTool === 'move' && store.canUseMoveTool" class="mode-hint">
        {{ isDraggingMultipleLayers ? t('previewWidget.moveHintMultiple', { count: store.selectedLayers.length }) : t('previewWidget.moveHint') }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStudioStore } from '@/stores/studioStore'
import { RenderApi } from '@/utils/RenderApi'
import { hostWindow, doc } from '@/utils/host-window.js'
import { throttle } from '@/utils/performance.js'

const { t } = useI18n()

const store = useStudioStore()
const canvas = ref(null)
const wrap = ref(null)
let resizeObserver = null

const hasItem = computed(() => !!store.selectedElement && !!store.focusedPart)
const selectedName = computed(() => store.selectedElement?.name ?? '')

// Layer Manager State
const layerManagerActive = computed(() => store.layerManagerActive)
function toggleLayerManager() {
  store.toggleLayerManager()
}

// Tools state - now from store
const activeTool = computed(() => store.previewTool)

// Interaction state for pan / zoom
const latestSrc = ref(null) // keep latest source (image/canvas/video) to redraw during pan/zoom
const scale = ref(1) // visual scale (1 = fitted-to-canvas)
const panOffset = ref({ x: 0, y: 0 }) // CSS-pixel offsets relative to centered image
const isPanning = ref(false)
const pointerId = ref(null)

// View Pan Start State
const panStart = ref({ x: 0, y: 0 })
const panStartOffset = ref({ x: 0, y: 0 })

// Move Layer Start State
const isDraggingLayer = ref(false)
const isDraggingMultipleLayers = ref(false)
const dragStartPointer = ref({ x: 0, y: 0 })
const dragStartLayerVals = ref({ left: 0, top: 0 })
const targetLayerIndex = ref(0)
const multiLayerStartOffsets = ref([])

const MIN_SCALE = 0.1
const MAX_SCALE = 8

// Computed Cursor Class
const cursorClass = computed(() => {
  if (activeTool.value === 'move') {
    return (isDraggingLayer.value || isDraggingMultipleLayers.value) ? 'cursor-moving' : (store.canUseMoveTool ? 'cursor-move' : 'cursor-default')
  } else {
    return isPanning.value ? 'cursor-grabbing' : 'cursor-grab'
  }
})

// Helper to size canvas backing store to container (supports DPR)
function setCanvasBackingSize() {
  nextTick(() => {
    const c = canvas.value
    const parent = wrap.value || (c && c.parentNode)
    if (!c || !parent) return
    const rect = parent.getBoundingClientRect()
    const cssW = Math.max(1, rect.width)
    const cssH = Math.max(1, rect.height)
    const dpr = hostWindow.devicePixelRatio || 1
    c.width = Math.round(cssW * dpr)
    c.height = Math.round(cssH * dpr)
    c.style.width = cssW + 'px'
    c.style.height = cssH + 'px'
    c.__cssW = cssW
    c.__cssH = cssH
    c.__dpr = dpr
    const ctx = c.getContext('2d')
    if (ctx && typeof ctx.setTransform === 'function') ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (ctx) ctx.clearRect(0, 0, cssW, cssH)
  })
}

// Draw the provided source centered, respecting current scale and panOffset.
function drawSourceTransformed(src) {
  latestSrc.value = src || null
  nextTick(() => {
    const c = canvas.value
    if (!c || !src) {
      if (c) c.style.display = 'none'
      return
    }
    const ctx = c.getContext('2d')
    const cssW = c.__cssW || parseFloat(c.style.width) || c.width
    const cssH = c.__cssH || parseFloat(c.style.height) || c.height
    if (!ctx || !cssW || !cssH) return
    ctx.clearRect(0, 0, cssW, cssH)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const srcW = src.width || src.videoWidth || 1
    const srcH = src.height || src.videoHeight || 1
    const srcAspect = srcW / srcH
    const destAspect = cssW / cssH

    // Compute base (fit) width/height before applying our user scale.
    let baseW, baseH
    if (destAspect > srcAspect) {
      baseH = cssH
      baseW = baseH * srcAspect
    } else {
      baseW = cssW
      baseH = baseW / srcAspect
    }

    const destW = baseW * scale.value
    const destH = baseH * scale.value

    const centerX = cssW / 2
    const centerY = cssH / 2

    const dx = centerX - destW / 2 + (panOffset.value?.x || 0)
    const dy = centerY - destH / 2 + (panOffset.value?.y || 0)

    try {
      ctx.drawImage(src, 0, 0, srcW, srcH, dx, dy, destW, destH)
      c.style.display = 'block'
    } catch (e) {
      // ignore drawing errors
      c.style.display = 'none'
    }
  })
}

async function updatePreview() {
  const merged = store.mergedAppearanceData
  const c = canvas.value
  if (!merged) {
    if (c) {
      const ctx = c.getContext('2d')
      const cssW = c.__cssW || parseFloat(c.style.width) || c.width
      const cssH = c.__cssH || parseFloat(c.style.height) || c.height
      if (ctx && cssW && cssH) ctx.clearRect(0, 0, cssW, cssH)
      c.style.display = 'none'
    }
    latestSrc.value = null
    return
  }

  // Ensure canvas size
  setCanvasBackingSize()


  // Ask store.renderer for a stable canvas (it may generate)
  const src = store.previewRenderer.getPreviewCanvas(merged)
  if (src) {
    drawSourceTransformed(src)
  } else {
    // Try synchronous fallback
    //const syn = store.previewRenderer._getCanvas(merged)
    //if (syn) drawSourceTransformed(syn)
    //else if (c) c.style.display = 'none'
  }
}

function refresh() {
  store.refreshMergedAppearanceData()
  updatePreview()
}

// -------------------------------------------------------------
// Throttled Store Update for Dragging Layers
// -------------------------------------------------------------
const updateLayerPosition = throttle((layerIdx, newLeft, newTop) => {
  const part = store.focusedPart
  if (!part) return

  const entries = typeof store.getLayerEntriesForPart === 'function'
    ? store.getLayerEntriesForPart(part, { forceRebuild: false, clone: false })
    : []
  if (!Array.isArray(entries) || entries.length === 0) return

  const directLayer = entries.find(entry => Number(entry?.layerIndex) === Number(layerIdx))
  const layer = directLayer || entries[layerIdx]
  if (!layer) return

  const layerIndex = Number(layer.layerIndex)
  if (!Number.isFinite(layerIndex)) return

  const delta = {
    layerIndex,
    drawingLeft: Math.round(newLeft),
    drawingTop: Math.round(newTop)
  }

  if (Array.isArray(layer.subLayers) && layer.subLayers.length > 0) {
    const subLayers = layer.subLayers
      .map(sub => {
        const subIndex = Number(sub?.layerIndex)
        if (!Number.isFinite(subIndex)) return null
        return {
          layerIndex: subIndex,
          drawingLeft: Math.round(newLeft),
          drawingTop: Math.round(newTop)
        }
      })
      .filter(Boolean)

    if (subLayers.length > 0) {
      delta.subLayers = subLayers
    }
  }

  store.execute({
    type: 'part.applyLayerDeltas',
    payload: { part, deltas: [delta] },
    meta: { deferCommit: true }
  })
}, 32, { leading: true, trailing: true }) // ~30fps throttle

// Throttled multi-layer update
const updateMultipleLayersOffset = throttle((deltaX, deltaY) => {
  const layersData = store.getSelectedLayersData()
  const partsMap = new Map()

  for (let i = 0; i < layersData.length && i < multiLayerStartOffsets.value.length; i++) {
    const target = layersData[i]
    const part = target?.part
    if (!part) continue

    const layerIndex = Number(target?.selection?.layerIndex)
    if (!Number.isFinite(layerIndex)) continue

    const partKey = part._uid || `${target?.selection?.stackIndex ?? 's'}:${target?.selection?.partIndex ?? 'p'}`
    if (!partsMap.has(partKey)) {
      partsMap.set(partKey, {
        part,
        deltas: []
      })
    }

    const startOffset = multiLayerStartOffsets.value[i] || { left: 0, top: 0 }
    const nextLeft = Math.round((startOffset.left || 0) + deltaX)
    const nextTop = Math.round((startOffset.top || 0) + deltaY)

    const group = partsMap.get(partKey)
    const currentLayer = target?.layer
    const delta = {
      layerIndex,
      drawingLeft: nextLeft,
      drawingTop: nextTop
    }

    if (Array.isArray(currentLayer?.subLayers) && currentLayer.subLayers.length > 0) {
      const subLayers = currentLayer.subLayers
        .map(sub => {
          const subIndex = Number(sub?.layerIndex)
          if (!Number.isFinite(subIndex)) return null
          return {
            layerIndex: subIndex,
            drawingLeft: nextLeft,
            drawingTop: nextTop
          }
        })
        .filter(Boolean)

      if (subLayers.length > 0) {
        delta.subLayers = subLayers
      }
    }

    group.deltas.push(delta)
  }

  const updates = Array.from(partsMap.values())
  if (updates.length > 0) {
    store.execute({
      type: 'layer.batchApplyLayerDeltas',
      payload: { updates },
      meta: { deferCommit: true }
    })
  }
}, 32, { leading: true, trailing: true }) // ~30fps throttle

// -------------------------------------------------------------
// Interaction Handlers (Pointer Logic)
// -------------------------------------------------------------

function onPointerDown(e) {
  const c = canvas.value
  if (!c) return
  // only start panning for primary button (mouse) or for touch/stylus pointer types
  if (e.pointerType === 'mouse' && e.button !== 0) return

  pointerId.value = e.pointerId
  try { c.setPointerCapture(e.pointerId) } catch (err) { /* ignore */ }

  if (activeTool.value === 'move') {
    // --- MOVE MODE ---
    const part = store.focusedPart
    const entries = part && typeof store.getLayerEntriesForPart === 'function'
      ? store.getLayerEntriesForPart(part, { forceRebuild: false, clone: false })
      : []

    if (part && Array.isArray(entries) && entries.length > 0) {
      // Check if we're in multi-selection mode with multiple layers
      const isMultiMode = store.selectionMode === 'multiple'
      const selectedCount = store.selectedLayers.length

      if (isMultiMode && selectedCount > 0) {
        // Multi-layer dragging
        store.setPropertyFocus('drawing')
        isDraggingMultipleLayers.value = true
        dragStartPointer.value = { x: e.clientX, y: e.clientY }
        
        // Store initial offsets for all selected layers
        const layersData = store.getSelectedLayersData()
        multiLayerStartOffsets.value = layersData.map(({ layer }) => ({
          left: layer.drawingLeft || 0,
          top: layer.drawingTop || 0
        }))
        
        // Begin transaction for multi-layer drag
        store.beginInteraction('preview-move')
      } else {
        // Single layer dragging (existing behavior)
        const idx = store.getPrimaryMoveLayerIndex(part)

        const stackIndex = store.focusedPartIndex?.stackIndex
        const partIndex = store.focusedPartIndex?.partIndex
        if (typeof stackIndex === 'number' && typeof partIndex === 'number') {
          const layerInfo = { stackIndex, partIndex, layerIndex: idx }
          if (!store.isLayerFocused(layerInfo)) {
            store.focusLayer(layerInfo)
          }
          store.setPropertyFocus('drawing')
        }

        const layer = entries.find(entry => Number(entry?.layerIndex) === Number(idx)) || entries[idx]
        if (!layer) return

        targetLayerIndex.value = Number.isFinite(Number(layer.layerIndex)) ? Number(layer.layerIndex) : idx
        dragStartLayerVals.value = {
          left: layer.drawingLeft || 0,
          top: layer.drawingTop || 0
        }
        dragStartPointer.value = { x: e.clientX, y: e.clientY }
        isDraggingLayer.value = true
        
        // Begin transaction for single-layer drag
        store.beginInteraction('preview-move')
      }
    }
  } else {
    // --- VIEW MODE ---
    isPanning.value = true
    panStart.value = { x: e.clientX, y: e.clientY }
    panStartOffset.value = { x: panOffset.value.x || 0, y: panOffset.value.y || 0 }
  }
}

function onPointerMove(e) {
  if (pointerId.value !== null && e.pointerId !== pointerId.value) return

  if (activeTool.value === 'move') {
    // --- MOVE MODE ---
    if (!isDraggingLayer.value && !isDraggingMultipleLayers.value) return

    // Calculate delta in screen pixels
    const dxScreen = e.clientX - dragStartPointer.value.x
    const dyScreen = e.clientY - dragStartPointer.value.y

    // Convert to canvas logical pixels (account for Zoom Scale)
    const dxLogic = dxScreen / scale.value
    const dyLogic = dyScreen / scale.value

    if (isDraggingMultipleLayers.value) {
      // Multi-layer dragging: use relative batch update
      updateMultipleLayersOffset(dxLogic, dyLogic)
    } else {
      // Single layer dragging
      const newLeft = dragStartLayerVals.value.left + dxLogic
      const newTop = dragStartLayerVals.value.top + dyLogic
      updateLayerPosition(targetLayerIndex.value, newLeft, newTop)
    }

  } else {
    // --- VIEW MODE ---
    if (!isPanning.value) return
    const dx = e.clientX - panStart.value.x
    const dy = e.clientY - panStart.value.y
    panOffset.value = {
      x: panStartOffset.value.x + dx,
      y: panStartOffset.value.y + dy
    }
    // redraw with latest source to update view
    if (latestSrc.value) drawSourceTransformed(latestSrc.value)
  }
}

function finalizePreviewMoveInteraction(commit = true) {
  if (!store) return false

  let finalized = false
  try {
    finalized = commit ? !!store.commitInteraction() : !!store.cancelInteraction()
  } catch (err) {
    finalized = false
  }

  if (!finalized && typeof store.forceEndRealtimeScope === 'function') {
    try {
      finalized = !!store.forceEndRealtimeScope('editor', {
        commit,
        interactionKind: 'preview-move'
      })
    } catch (err) {
      finalized = false
    }
  }

  return finalized
}

function onPointerUp(e) {
  if (pointerId.value !== null && e.pointerId !== pointerId.value) return

  const hadDrag = isDraggingLayer.value || isDraggingMultipleLayers.value

  // Cleanup Move
  if (isDraggingLayer.value) {
    isDraggingLayer.value = false
    updateLayerPosition.flush()
    updateLayerPosition.cancel()
  }

  if (isDraggingMultipleLayers.value) {
    isDraggingMultipleLayers.value = false
    updateMultipleLayersOffset.flush()
    updateMultipleLayersOffset.cancel()
    multiLayerStartOffsets.value = []
  }

  // Cleanup View
  isPanning.value = false

  try {
    const c = canvas.value
    if (c) c.releasePointerCapture && c.releasePointerCapture(e.pointerId)
  } catch (err) { /* ignore */ }
  pointerId.value = null

  // Commit the preview-move interaction if we were dragging
  if (hadDrag) {
    finalizePreviewMoveInteraction(true)
  }
}

function onPointerCancel(e) {
  if (pointerId.value !== null && e.pointerId !== pointerId.value) return

  const hadDrag = isDraggingLayer.value || isDraggingMultipleLayers.value

  // Cleanup Move
  if (isDraggingLayer.value) {
    isDraggingLayer.value = false
    updateLayerPosition.flush()
    updateLayerPosition.cancel()
  }

  if (isDraggingMultipleLayers.value) {
    isDraggingMultipleLayers.value = false
    updateMultipleLayersOffset.flush()
    updateMultipleLayersOffset.cancel()
    multiLayerStartOffsets.value = []
  }

  // Cleanup View
  isPanning.value = false

  try {
    const c = canvas.value
    if (c) c.releasePointerCapture && c.releasePointerCapture(e.pointerId)
  } catch (err) { /* ignore */ }
  pointerId.value = null

  // If canvas deltas were already applied, prefer committing to keep history consistent.
  if (hadDrag) {
    finalizePreviewMoveInteraction(true)
  } else {
    finalizePreviewMoveInteraction(false)
  }
}

// Wheel zoom — zoom towards pointer
function onWheel(e) {
  const c = canvas.value
  if (!c) return
  if (!latestSrc.value) return
  e.preventDefault()

  const rect = c.getBoundingClientRect()
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  const centerX = rect.width / 2
  const centerY = rect.height / 2

  const oldScale = scale.value
  const factor = Math.exp(-e.deltaY * 0.0016)
  let newScale = oldScale * factor
  newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale))

  // Adjust pan so the point under cursor stays at the same canvas position
  const ratio = newScale / oldScale
  const px_rel_old = px - centerX - (panOffset.value.x || 0)
  const py_rel_old = py - centerY - (panOffset.value.y || 0)
  const newOffsetX = (panOffset.value.x || 0) + px_rel_old * (1 - ratio)
  const newOffsetY = (panOffset.value.y || 0) + py_rel_old * (1 - ratio)

  scale.value = newScale
  panOffset.value = { x: newOffsetX, y: newOffsetY }

  drawSourceTransformed(latestSrc.value)
}

// double-click to reset pan/zoom (useful)
function onDoubleClick(e) {
  scale.value = 1
  panOffset.value = { x: 0, y: 0 }
  if (latestSrc.value) drawSourceTransformed(latestSrc.value)
}

onMounted(() => {
  setCanvasBackingSize()
  const target = wrap.value || (canvas.value && canvas.value.parentNode)
  if (target) {
    resizeObserver = new hostWindow.ResizeObserver(() => {
      setCanvasBackingSize()
      updatePreview()
    })
    resizeObserver.observe(target)
  }

  const c = canvas.value
  if (c) {
    c.addEventListener('pointerdown', onPointerDown)
    hostWindow.addEventListener('pointermove', onPointerMove, { passive: false })
    hostWindow.addEventListener('pointerup', onPointerUp)
    hostWindow.addEventListener('pointercancel', onPointerCancel)
    c.addEventListener('wheel', onWheel, { passive: false })
    c.addEventListener('dblclick', onDoubleClick)
  }
})

onBeforeUnmount(() => {
  if (resizeObserver && wrap.value) resizeObserver.unobserve(wrap.value)
  const c = canvas.value
  if (c) {
    c.removeEventListener('pointerdown', onPointerDown)
    c.removeEventListener('wheel', onWheel)
    c.removeEventListener('dblclick', onDoubleClick)
  }
  hostWindow.removeEventListener('pointermove', onPointerMove)
  hostWindow.removeEventListener('pointerup', onPointerUp)
  hostWindow.removeEventListener('pointercancel', onPointerCancel)
  updateLayerPosition.flush()
  updateMultipleLayersOffset.flush()
  updateLayerPosition.cancel()
  updateMultipleLayersOffset.cancel()
})

watch(() => store.mergedAppearanceData, () => updatePreview(), { deep: true })
// If selected part changes, we might want to ensure tool state is valid, but keeping 'move' is usually fine.
</script>

<style scoped>
.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.preview-header h4 {
  margin: 0;
  font-size: 14px;
  color: var(--color-text-primary);
}

/* Tool Buttons */
.preview-tools {
  display: flex;
  background: var(--color-bg-surface);
  padding: 2px;
  border-radius: var(--radius-sm, 6px);
  gap: 2px;
  align-items: center;
}

.divider {
  width: 1px;
  height: 16px;
  background: var(--color-border-base);
  margin: 0 2px;
}

.tool-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: var(--radius-xs, 4px);
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary);
  transition: all 0.15s;
}

.tool-btn:hover:not(:disabled) {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}

.tool-btn.active {
  background: var(--color-bg-base);
  color: var(--color-selection-single);
  box-shadow: var(--shadow-sm);
}

.tool-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.preview-widget {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  box-sizing: border-box;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.preview-canvas-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--color-bg-surface);
  border-radius: var(--radius-lg, 10px);
  border: 1px solid var(--color-border-base);
}

.preview-canvas {
  width: 100%;
  height: 100%;
  background: transparent;
  display: block;
  touch-action: none;
  /* crucial for pointer events */
}

/* Cursor States */
.cursor-grab {
  cursor: grab !important;
}

.cursor-grabbing {
  cursor: grabbing !important;
}

.cursor-move {
  cursor: move !important;
}

.cursor-moving {
  cursor: move !important;
}

.cursor-default {
  cursor: default !important;
}

/* Hint overlay */
.mode-hint {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-bg-overlay);
  color: var(--color-text-secondary);
  padding: 4px 10px;
  border-radius: var(--radius-xl, 12px);
  font-size: 11px;
  pointer-events: none;
  opacity: 0.8;
}

.icon-btn {
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-base);
  background: var(--color-bg-base);
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  color: var(--color-text-primary);
  transition: all 0.15s;
}

.icon-btn:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-border-strong);
}
</style>