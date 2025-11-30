<template>
  <div class="preview-widget" role="region" aria-label="预览窗口">
    <div class="preview-header">
      <h4>Preview</h4>
      <button class="icon-btn" @click="refresh">↻</button>
    </div>
    <div class="preview-canvas-wrap" ref="wrap">
      <canvas ref="canvas" class="preview-canvas" width="300" height="600" style="display:none"></canvas>
      <!--div v-if="!hasItem" class="placeholder">从右侧选择元素以查看预览</div>
      <div v-else class="item-name">{{ selectedName }}</div-->
    </div>
    <!--div class="preview-controls">
      <button @click="refresh">刷新</button>
      <button @click="clear">清除</button>
    </div-->
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick, computed } from 'vue'
import { useStudioStore } from '@/stores/studioStore'
import { RenderApi } from '@/utils/RenderApi'
import { hostWindow, doc } from '@/utils/host-window.js'

const store = useStudioStore()
const canvas = ref(null)
const wrap = ref(null)
let resizeObserver = null

const hasItem = computed(() => !!store.selectedElement)
const selectedName = computed(() => store.selectedElement?.name ?? '')

// Interaction state for pan / zoom
const latestSrc = ref(null) // keep latest source (image/canvas/video) to redraw during pan/zoom
const scale = ref(1) // visual scale (1 = fitted-to-canvas)
const panOffset = ref({ x: 0, y: 0 }) // CSS-pixel offsets relative to centered image
const isPanning = ref(false)
const pointerId = ref(null)
const panStart = ref({ x: 0, y: 0 })
const panStartOffset = ref({ x: 0, y: 0 })
const MIN_SCALE = 0.1
const MAX_SCALE = 8

// Helper to size canvas backing store to container (supports DPR)
function setCanvasBackingSize() {
  nextTick(() => {
    const c = canvas.value
    const parent = wrap.value || (c && c.parentNode)
    if (!c || !parent) return
    const rect = parent.getBoundingClientRect()
    const cssW = Math.max(1, rect.width)
    const cssH = Math.max(1, rect.height - 40) // leave space for title controls
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
// This replaces drawSourceCentered to support pan/zoom.
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
  //store.refreshMergedAppearanceData()
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

  try {
    // Ask store.renderer for a stable canvas (it may generate)
    const src = await store.renderer.getCanvas(merged, { timeout: 2500 }).catch(() => null)
    if (src) {
      // reset transform to fit new content (keep user's transform? we keep current scale/pan)
      // If you prefer resetting on content change, uncomment:
      // scale.value = 1; panOffset.value = { x: 0, y: 0 }
      drawSourceTransformed(src)
    } else {
      // Try synchronous fallback
      const syn = store.renderer._getCanvas(merged)
      if (syn) drawSourceTransformed(syn)
      else if (c) c.style.display = 'none'
    }
  } catch (e) {
    // swallow errors
    if (c) c.style.display = 'none'
  }
}

function refresh() {
  store.refreshMergedAppearanceData()
  updatePreview()
}
function clear() {
  store.select(-1)
}

// Interaction handlers (pointer pan + wheel zoom)

function onPointerDown(e) {
  const c = canvas.value
  if (!c) return
  // only start panning for primary button (mouse) or for touch/stylus pointer types
  if (e.pointerType === 'mouse' && e.button !== 0) return
  isPanning.value = true
  pointerId.value = e.pointerId
  panStart.value = { x: e.clientX, y: e.clientY }
  panStartOffset.value = { x: panOffset.value.x || 0, y: panOffset.value.y || 0 }
  try { c.setPointerCapture(e.pointerId) } catch (err) { /* ignore */ }
  // visual cue
  try { c.style.cursor = 'grabbing' } catch (e) { }
}

function onPointerMove(e) {
  if (!isPanning.value) return
  if (pointerId.value !== null && e.pointerId !== pointerId.value) return
  const dx = e.clientX - panStart.value.x
  const dy = e.clientY - panStart.value.y
  panOffset.value = {
    x: panStartOffset.value.x + dx,
    y: panStartOffset.value.y + dy
  }
  // redraw with latest source
  if (latestSrc.value) drawSourceTransformed(latestSrc.value)
}

function onPointerUp(e) {
  if (!isPanning.value) return
  if (pointerId.value !== null && e.pointerId !== pointerId.value) return
  isPanning.value = false
  try {
    const c = canvas.value
    if (c) c.releasePointerCapture && c.releasePointerCapture(e.pointerId)
  } catch (err) { /* ignore */ }
  pointerId.value = null
  try { if (canvas.value) canvas.value.style.cursor = 'grab' } catch (e) { }
}

// Wheel zoom — zoom towards pointer
function onWheel(e) {
  const c = canvas.value
  if (!c) return
  // If there's no image, ignore
  if (!latestSrc.value) return
  e.preventDefault()
  const rect = c.getBoundingClientRect()
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  const centerX = rect.width / 2
  const centerY = rect.height / 2

  const oldScale = scale.value
  // exponential zoom factor for smoothness
  const factor = Math.exp(-e.deltaY * 0.0016)
  let newScale = oldScale * factor
  newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale))

  // Adjust pan so the point under cursor stays at the same canvas position
  const ratio = newScale / oldScale
  // px_rel_old = px - centerX - offsetX
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
  // observe size
  const target = wrap.value || (canvas.value && canvas.value.parentNode)
  if (target) {
    resizeObserver = new hostWindow.ResizeObserver(() => {
      setCanvasBackingSize()
      updatePreview()
    })
    resizeObserver.observe(target)
  }

  // Attach pointer & wheel listeners to canvas for pan/zoom
  const c = canvas.value
  if (c) {
    c.addEventListener('pointerdown', onPointerDown)
    // pointermove/pointerup are handled globally via hostWindow to be robust
    hostWindow.addEventListener('pointermove', onPointerMove, { passive: false })
    hostWindow.addEventListener('pointerup', onPointerUp)
    c.addEventListener('wheel', onWheel, { passive: false })
    c.addEventListener('dblclick', onDoubleClick)
    // cursor hint
    c.addEventListener('pointerenter', () => { try { if (latestSrc.value) c.style.cursor = 'grab' } catch (e) { } })
    c.addEventListener('pointerleave', () => { try { c.style.cursor = 'default' } catch (e) { } })
  }
})

onBeforeUnmount(() => {
  if (resizeObserver && wrap.value) resizeObserver.unobserve(wrap.value)
  const c = canvas.value
  if (c) {
    c.removeEventListener('pointerdown', onPointerDown)
    c.removeEventListener('wheel', onWheel)
    c.removeEventListener('dblclick', onDoubleClick)
    c.removeEventListener('pointerenter', () => { })
    c.removeEventListener('pointerleave', () => { })
  }
  hostWindow.removeEventListener('pointermove', onPointerMove)
  hostWindow.removeEventListener('pointerup', onPointerUp)
})

// When mergedAppearanceData changes, update preview (and keep current pan/zoom)
watch(() => store.mergedAppearanceData, () => updatePreview(), { deep: true })
</script>

<style scoped>
.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.preview-header h4 {
  margin: 0;
  font-size: 14px;
  color: #21314a;
}

.preview-widget {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  box-sizing: border-box;
  height: 100%;
}

.preview-title {
  font-weight: 700;
  color: #21314a;
}

.preview-canvas-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  min-height: 220px;
}

.preview-canvas {
  width: 100%;
  height: 100%;
  background: transparent;
  border-radius: 10px;
  box-shadow: 0 8px 30px rgba(20, 30, 60, 0.04);
  border: 1px solid rgba(200, 210, 230, 0.6);
  display: block;
  touch-action: none;
  /* allow pointer events for pan/zoom */
}

.placeholder {
  color: #7d8795;
  text-align: center;
  padding: 12px;
}

.item-name {
  position: absolute;
  left: 12px;
  top: 12px;
  background: rgba(255, 255, 255, 0.8);
  padding: 6px 10px;
  border-radius: 8px;
  font-weight: 600;
}

.preview-controls {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.preview-controls button {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid #dfe6ef;
  background: #fff;
  cursor: pointer;
}

/* cursor styles during panning */
.preview-canvas[style*="cursor: grabbing"] {
  cursor: grabbing !important;
}

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
</style>