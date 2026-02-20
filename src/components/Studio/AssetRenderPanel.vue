<template>
  <div class="asset-render-panel" role="region" :aria-label="t('assetRender.ariaLabel')">
    <div class="header">
      <h4>{{ t('assetRender.title') }}</h4>
      <div class="meta">
        <div class="mline"><strong>{{ t('assetRender.part') }}</strong> <span>{{ partName }}</span></div>
        <div class="mline"><strong>{{ t('assetRender.asset') }}</strong> <span>{{ assetName }}</span></div>
      </div>
    </div>

    <div class="body" ref="bodyWrap">
      <div v-if="!hasPart" class="placeholder">{{ t('assetRender.placeholder') }}</div>

      <div v-else class="render-area">
        <canvas ref="canvas" class="render-canvas" style="display:block"></canvas>

        <div v-if="loading" class="overlay">{{ t('assetRender.loading') }}</div>
        <div v-if="errorMsg" class="error">{{ errorMsg }}</div>

        <div class="controls">
          <button @click="restartRender" :disabled="!hasPart || loading">{{ t('assetRender.retry') }}</button>
          <button @click="stopRender" :disabled="!running">{{ t('assetRender.stop') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStudioStore } from '@/stores/studioStore'
import { useFileSystemStore } from '@/stores/fileSystemStore'

const { t } = useI18n()

const store = useStudioStore()
const fsStore = useFileSystemStore()

const part = computed(() => store.focusedPart)
const hasPart = computed(() => !!part.value)
const partName = computed(() => part.value?.Name || part.value?.Description || '(unnamed)')

const canvas = ref(null)
const bodyWrap = ref(null)
let resizeObserver = null

// internal state
const loading = ref(false)
const running = ref(false)
const errorMsg = ref(null)
let loopMeta = null
const pollInterval = 600 // ms

// Resolve asset for a part using store helper(s)
const resolvedAsset = computed(() => {
  if (!part.value) return null
  try {
    if (typeof store.resolveAssetForPart === 'function') return store.resolveAssetForPart(part.value)
    if (typeof store.findAssetGroupEntryForPart === 'function') return store.findAssetGroupEntryForPart(part.value)
  } catch (e) {
    // ignore
  }
  return null
})
const assetName = computed(() => resolvedAsset.value?.Description || resolvedAsset.value?.Name || resolvedAsset.value?.name || '-')

// Helper: compute image path for asset with optional DynamicPreviewImage(C)
function computeImagePath(asset) {
  if (!asset) return null

  // C can be the target character from file system store
  const C = fsStore.character || null

  // Determine dynamic suffix: Asset.DynamicPreviewImage may be a function or a static string
  let dynamicSuffix = ''
  try {
    if (C && asset.DynamicPreviewImage) {
      if (typeof asset.DynamicPreviewImage === 'function') {
        // may throw; guard
        try {
          const res = asset.DynamicPreviewImage(C)
          if (res) dynamicSuffix = String(res)
        } catch (e) {
          // ignore result on failure
          dynamicSuffix = ''
        }
      } else if (typeof asset.DynamicPreviewImage === 'string') {
        dynamicSuffix = asset.DynamicPreviewImage || ''
      }
      // ensure suffix begins with something reasonable (we won't add separators here,
      // caller expects exactly to append to Name)
    }
  } catch (e) {
    dynamicSuffix = ''
  }

  try {
    // Prefer game-provided AssetGetPreviewPath if available
    if (typeof AssetGetPreviewPath === 'function') {
      try {
        const base = AssetGetPreviewPath(asset)
        if (base) {
          // assemble: /path/Name + dynamicSuffix + .png
          return `${base}/${asset.Name}${dynamicSuffix}.png`
        }
      } catch (e) {
        // fall through to field-based fallbacks
      }
    }

    // fallback fields
    if (asset.PreviewPath) return asset.PreviewPath
    if (asset.Url) return asset.Url
    if (asset.Path) return `${asset.Path}/${asset.Name}${dynamicSuffix}.png`

    return asset.Name ? `${asset.Name}${dynamicSuffix}.png` : null
  } catch (e) {
    return null
  }
}

// Utility: compute a cheap hash of ImageData (sampled)
function hashImageData(imgData) {
  if (!imgData || !imgData.data) return 0
  const data = imgData.data
  let hash = 0
  const step = 20
  for (let i = 0; i < data.length; i += step) {
    hash = (hash * 31 + data[i]) >>> 0
  }
  return hash
}

// Resize canvas to container (DPR aware)
async function setCanvasSize() {
  await nextTick()
  const c = canvas.value
  const container = bodyWrap.value || (c && c.parentNode)
  if (!c || !container) return
  const rect = container.getBoundingClientRect()
  const cssW = Math.max(48, rect.width)
  const cssH = Math.max(48, rect.height - 36) // leave header space
  const dpr = window.devicePixelRatio || 1
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

// Core loop: draw -> compute hash -> repeat until stable
function startPollingRender(asset) {
  stopPollingRender() // cleanup previous

  if (!asset || !canvas.value) return

  const ctx = canvas.value.getContext('2d')
  if (!ctx) return

  const imagePath = computeImagePath(asset)
  if (!imagePath) {
    errorMsg.value = '无法确定 asset 预览路径'
    return
  }

  loading.value = true
  running.value = true
  errorMsg.value = null

  const emptyData = (() => {
    try {
      return ctx.getImageData(0, 0, canvas.value.width, canvas.value.height)
    } catch (e) {
      return null
    }
  })()
  const emptyHash = emptyData ? hashImageData(emptyData) : null

  loopMeta = {
    canvas: canvas.value,
    lastHash: null,
    stopped: false,
    attempts: 0,
    timerId: null,
    tainted: false
  }

  // draw attempt - prefer DrawImageEx if present
  async function drawOnce() {
    try {
      if (typeof DrawImageEx === 'function') {
        try {
          DrawImageEx(imagePath, ctx, 0, 0, { Width: canvas.value.__cssW || canvas.value.width, Height: canvas.value.__cssH || canvas.value.height })
        } catch (e) {
          await drawWithImageElement()
        }
      } else {
        await drawWithImageElement()
      }
    } catch (e) {
      // ignore
    }
  }

  function drawWithImageElement() {
    return new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const cssW = canvas.value.__cssW || parseFloat(canvas.value.style.width) || canvas.value.width
          const cssH = canvas.value.__cssH || parseFloat(canvas.value.style.height) || canvas.value.height
          ctx.clearRect(0, 0, cssW, cssH)
          ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, cssW, cssH)
        } catch (e) {
          // ignore
        }
        resolve()
      }
      img.onerror = () => resolve()
      img.src = imagePath
    })
  }

  const loop = async (count = 0) => {
    if (!loopMeta || loopMeta.stopped) return
    loopMeta.attempts = count
    try {
      try {
        const cssW = canvas.value.__cssW || parseFloat(canvas.value.style.width) || canvas.value.width
        const cssH = canvas.value.__cssH || parseFloat(canvas.value.style.height) || canvas.value.height
        ctx.clearRect(0, 0, cssW, cssH)
      } catch (e) { /* ignore */ }

      await drawOnce()

      let imgData = null
      try {
        imgData = ctx.getImageData(0, 0, canvas.value.width, canvas.value.height)
      } catch (e) {
        loopMeta.tainted = true
      }

      if (!loopMeta.tainted && imgData) {
        const cur = hashImageData(imgData)
        if (loopMeta.lastHash === cur && (cur !== emptyHash || count > 6)) {
          loopMeta.stopped = true
        }
        loopMeta.lastHash = cur
      } else {
        if (count > 6) loopMeta.stopped = true
      }
    } catch (e) {
      // swallow
    }

    if (!loopMeta.stopped) {
      loopMeta.timerId = setTimeout(() => loop(count + 1), pollInterval)
    } else {
      loading.value = false
      running.value = false
    }
  }

  loopMeta.timerId = setTimeout(() => loop(0), 8)
}

// stop and cleanup
function stopPollingRender() {
  if (!loopMeta) return
  loopMeta.stopped = true
  if (loopMeta.timerId) clearTimeout(loopMeta.timerId)
  loopMeta = null
  loading.value = false
  running.value = false
}

// restart helper
function restartRender() {
  if (!resolvedAsset.value) return
  startPollingRender(resolvedAsset.value)
}
function stopRender() {
  stopPollingRender()
}

// watch focused part / asset changes
watch(resolvedAsset, async (nv, ov) => {
  errorMsg.value = null
  stopPollingRender()
  if (!nv) return
  await setCanvasSize()
  setTimeout(() => startPollingRender(nv), 12)
}, { immediate: true })

// resize observer to keep canvas sized
onMounted(() => {
  const target = bodyWrap.value || (canvas.value && canvas.value.parentNode)
  if (target) {
    resizeObserver = new hostWindow.ResizeObserver(() => {
      setCanvasSize()
      if (loopMeta) {
        if (resolvedAsset.value) {
          startPollingRender(resolvedAsset.value)
        }
      }
    })
    resizeObserver.observe(target)
  }
})

onBeforeUnmount(() => {
  if (resizeObserver && (bodyWrap.value || canvas.value?.parentNode)) {
    try { resizeObserver.disconnect() } catch (e) { /* ignore */ }
    resizeObserver = null
  }
  stopPollingRender()
})
</script>

<style scoped>
.asset-render-panel {
  height: 100%;
  display:flex;
  flex-direction:column;
  gap:8px;
  box-sizing:border-box;
  padding-left:8px;
}
.header {
  display:flex;
  align-items:center;
  justify-content:space-between;
}
.header h4 { margin:0; font-size:15px; color:var(--color-text-primary, #0f172a); }
.header .meta { display:flex; gap:12px; align-items:center; font-size:13px; color:var(--color-text-secondary, #475569); }
.mline { color:var(--color-text-secondary, #475569); }

.body {
  flex:1;
  overflow:auto;
  padding:8px;
  border-radius: var(--radius-md, 8px);
  background:linear-gradient(180deg,var(--color-bg-base, #fff),var(--color-bg-surface, #f8fafc));
  border:1px solid var(--color-border-base, #e2e8f0);
  min-height:0;
  display:flex;
  flex-direction:column;
}

.placeholder {
  color:var(--color-text-tertiary, #64748b);
  padding:12px;
  text-align:center;
  flex:1;
}

.render-area {
  position:relative;
  flex:1;
  display:flex;
  flex-direction:column;
  gap:8px;
  min-height:0;
}

.render-canvas {
  width:100%;
  flex:1 1 auto;
  min-height:120px;
  border-radius: var(--radius-md, 8px);
  background: var(--color-bg-surface, #f8fafc);
  border:1px solid var(--color-border-base, #e2e8f0);
  display:block;
}

.overlay {
  position:absolute;
  left:12px;
  bottom:12px;
  background: var(--color-bg-base, rgba(255,255,255,0.9));
  padding:6px 8px;
  border-radius: var(--radius-sm, 6px);
  border:1px solid var(--color-border-base, #e2e8f0);
  font-size:13px;
}

.error {
  color:var(--color-error, #ef4444);
  padding:6px;
  font-size:13px;
}

.controls {
  display:flex;
  gap:8px;
  justify-content:flex-end;
}
.controls button {
  padding:6px 10px;
  border-radius: var(--radius-md, 8px);
  border:1px solid var(--color-border-light, #f1f5f9);
  background:var(--color-bg-base, #fff);
  cursor:pointer;
  font-size:13px;
}
</style>