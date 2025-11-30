<template>
  <aside class="side-preview" aria-label="预览面板">
    <div class="preview-inner">
      <canvas ref="canvas" class="preview-canvas"></canvas>
      <div v-if="!hasItem" class="hint">Hover 文件项查看预览</div>
      <div v-else class="item-name">{{ itemName }}</div>
    </div>
  </aside>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick, computed } from 'vue'
import { useFileSystemStore } from '@/stores/fileSystemStore'
import { hostWindow, setTimeoutHost } from '@/utils/host-window.js'

const fsStore = useFileSystemStore()
const canvas = ref(null)
let resizeObserver = null
let resizeTarget = null

const hasItem = computed(() => !!fsStore.previewItem)
const itemName = computed(() => fsStore.previewItem?.name || '')

// 找到一个“可靠的测量目标”：优先 canvas.parentNode，如果高度太小则向上查找最近的有显式高度/可见高度的祖先
function findReliableResizeTarget() {
  if (!canvas.value) return null
  let el = canvas.value.parentNode
  const limit = 4 // 向上查找的层级深度上限
  let attempts = 0
  while (el && attempts < limit) {
    const r = el.getBoundingClientRect()
    if (r.height >= 48) { // 认为这个元素高度可靠（48px 为经验阈值）
      return el
    }
    el = el.parentNode
    attempts++
  }
  // fallback: return canvas.parentNode even if small
  return canvas.value.parentNode
}

// 设置 canvas backing size（支持 DPR），使用指定的测量目标
async function setupCanvasSize() {
  await nextTick()
  const c = canvas.value
  if (!c) return
  // 选择目标（优先上次的 resizeTarget）
  const target = resizeTarget || findReliableResizeTarget()
  if (!target) return
  const rect = target.getBoundingClientRect()
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
}

// 等比居中绘制源 canvas 到 preview canvas（以 CSS 像素为单位）
function drawSourceCentered(src) {
  const c = canvas.value
  if (!c || !src) return
  const ctx = c.getContext('2d')
  const cssW = c.__cssW || parseFloat(c.style.width) || c.width
  const cssH = c.__cssH || parseFloat(c.style.height) || c.height

  ctx.clearRect(0, 0, cssW, cssH)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const srcW = src.width || src.videoWidth || 1
  const srcH = src.height || src.videoHeight || 1
  const srcAspect = srcW / srcH
  const destAspect = cssW / cssH

  let destW, destH
  if (destAspect > srcAspect) {
    destH = cssH
    destW = destH * srcAspect
  } else {
    destW = cssW
    destH = destW / srcAspect
  }

  const dx = (cssW - destW) / 2
  const dy = (cssH - destH) / 2

  try {
    ctx.drawImage(src, 0, 0, srcW, srcH, dx, dy, destW, destH)
    c.style.display = 'block'
  } catch (e) {
    // drawImage 可能在某些环境对 OffscreenCanvas 抛错，忽略以免崩溃
    // console.warn('SidePreview drawImage failed', e)
  }
}

// 从 store.renderer 获取 canvas 并绘制（与 FileThumbnail 行为一致）
async function updatePreview() {
  const previewItem = fsStore.previewItem
  if (!previewItem) {
    // 清空
    if (canvas.value) {
      const ctx = canvas.value.getContext('2d')
      const cssW = canvas.value.__cssW || parseFloat(canvas.value.style.width) || canvas.value.width
      const cssH = canvas.value.__cssH || parseFloat(canvas.value.style.height) || canvas.value.height
      if (ctx && cssW && cssH) ctx.clearRect(0, 0, cssW, cssH)
      canvas.value.style.display = 'none'
    }
    return
  }

  const renderer = fsStore.renderer
  if (!renderer) return

  // 保证 canvas 尺寸
  await setupCanvasSize()

  let src = null
  try {
    if (typeof renderer.startThumbFor === 'function') {
      try { renderer.startThumbFor(previewItem) } catch (_) {}
    }
    if (typeof renderer.getThumbCanvas === 'function') {
      src = await renderer.getThumbCanvas(previewItem, { timeout: 3000 })
    } else if (typeof renderer.getCanvas === 'function') {
      src = await renderer.getCanvas(previewItem, { timeout: 3000 })
    } else if (typeof renderer._getCanvas === 'function') {
      src = renderer._getCanvas(previewItem)
    }
  } catch (err) {
    // 回退到同步读取
    try { src = (renderer && typeof renderer._getCanvas === 'function') ? renderer._getCanvas(previewItem) : null } catch (_) { src = null }
  }

  if (src) drawSourceCentered(src)
  else if (canvas.value) canvas.value.style.display = 'none'
}

onMounted(() => {
  // 找到合适的 resize target（优先 canvas parent, 如果太小则上溯）
  resizeTarget = findReliableResizeTarget()

  // 如果找到，使用 ResizeObserver 监听。如果未找到也观察 parent
  const targetToObserve = resizeTarget || (canvas.value && canvas.value.parentNode)
  if (targetToObserve) {
    resizeObserver = new hostWindow.ResizeObserver(() => {
      setupCanvasSize()
      updatePreview()
    })
    resizeObserver.observe(targetToObserve)
  }

  // 初次更新（等下一帧）
  setTimeoutHost(() => updatePreview(), 0)
})

// 当 previewItem 变化时立即重绘（深度监听由 store 管理）
watch(() => fsStore.previewItem, () => updatePreview(), { deep: true, immediate: true })

onBeforeUnmount(() => {
  if (resizeObserver && resizeTarget) resizeObserver.unobserve(resizeTarget)
})
</script>

<style scoped>
.side-preview {
  width: 300px;
  min-width: 250px;
  max-width: 420px;
  border-right: 1px solid rgba(200,210,230,0.35);
  background: linear-gradient(180deg,#fbfdff,#f7fbff);
  padding: 5px;
  box-sizing: border-box;
  display: flex;
  align-items: stretch; /* fill vertical space */
  justify-content: center;
  height: 100%; /* ensure it can stretch inside the panel */
  object-fit: contain;
}

/* preview-inner fills available height so canvas can measure a meaningful rect */
.preview-inner {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  flex: 1 1 auto; /* allow to grow and fill vertical space */
  min-height: 220px;
  position: relative;
  object-fit: contain;
}

/* canvas fills remaining area of preview-inner */
.preview-canvas {
  width: 100%;
  flex: 1 1 auto;
  min-height: 180px;
  border-radius: 10px;
  box-shadow: 0 6px 20px rgba(30,45,80,0.05);
  border: 1px solid rgba(200,210,230,0.6);
  background: transparent;
  display: block;
  position: relative;
}

/* hint and name */
.hint { font-size: 13px; color: #7d8795; text-align: center; }
.item-name {
  font-size: 13px;
  color: #21314a;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  width: 100%;
  text-align: center;
}
</style>