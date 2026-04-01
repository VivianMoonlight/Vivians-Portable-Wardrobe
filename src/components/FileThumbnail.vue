<script setup>
import { onMounted, onBeforeUnmount, ref, watch, nextTick } from "vue";
//import { drawThumb } from "@/utils/RenderApi.js";
import { useFileSystemStore } from "@/stores/fileSystemStore";
import { hostWindow } from "@/utils/host-window.js";


const fsStore = useFileSystemStore();
const props = defineProps({ item: Object });
const thumbnailRoot = ref(null);
const canvas = ref(null);


let resizeObserver = null;
let intersectionObserver = null;
let isRendering = false;
let rerenderPending = false;
let hasPendingHiddenUpdate = false;
const isInViewport = ref(false);

function setCanvasSizeToContainer() {
  nextTick(() => {
    const c = canvas.value;
    if (!c || !c.parentNode) return;
    const rect = c.parentNode.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    const dpr = hostWindow.devicePixelRatio || 1;

    // 物理像素尺寸（backing store）
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
    // 样式尺寸保持为 CSS 像素
    c.style.width = cssW + "px";
    c.style.height = cssH + "px";

    // 标记以便后续绘制使用
    c.__cssW = cssW;
    c.__cssH = cssH;
    c.__dpr = dpr;

    const ctx = c.getContext("2d");
    if (!ctx) return;
    // 把坐标系缩放到以 CSS 像素为单位，方便后面以 cssW/cssH 计算坐标
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
  });
}

function drawSourceCentered(src) {
  nextTick(() => {
    const c = canvas.value;
    if (!c || !src) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const cssW = c.__cssW || parseFloat(c.style.width) || c.width;
    const cssH = c.__cssH || parseFloat(c.style.height) || c.height;

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // 使用源 canvas 的物理像素作为宽高来计算长宽比
    const srcW = src.width || (src.videoWidth || 1);
    const srcH = src.height || (src.videoHeight || 1);
    const srcAspect = srcW / srcH;
    const destAspect = cssW / cssH;

    let destW, destH;
    if (destAspect > srcAspect) {
      // 目标更宽，按高度撑满
      destH = cssH;
      destW = destH * srcAspect;
    } else {
      // 目标更窄，按宽度撑满
      destW = cssW;
      destH = destW / srcAspect;
    }

    const dx = (cssW - destW) / 2;
    const dy = (cssH - destH) / 2;

    try {
      ctx.drawImage(src, 0, 0, srcW, srcH, dx, dy, destW, destH);
      c.style.display = "block";
    } catch (err) {
      // 防御性日志
      // console.warn("drawImage failed", err);
    }
  });

}
function requestInsertCanvas(force = false) {
  if (!props.item) return;

  if (!force && !isInViewport.value) {
    hasPendingHiddenUpdate = true;
    return;
  }

  if (isRendering) {
    rerenderPending = true;
    return;
  }

  void insertCanvas(force);
}

async function insertCanvas(force = false) {
  if (!props.item) return;
  if (!force && !isInViewport.value) return;

  isRendering = true;

  // 确保 service 开始生成
  try {
    fsStore.startThumbnailGeneration(props.item);

    // 先调整尺寸
    setCanvasSizeToContainer();

    let src = null;
    try {
      src = await fsStore.renderer.getCanvas(props.item, { timeout: 6000 });
    } catch (err) {
      // 超时或失败：降级处理（例如隐藏 canvas）
      src = fsStore.renderer._getCanvas(props.item) || null;
    }
    if (src) {
      drawSourceCentered(src);
    } else {
      if (canvas.value) canvas.value.style.display = "none";
    }
  } finally {
    isRendering = false;
    if (rerenderPending) {
      rerenderPending = false;
      if (isInViewport.value) {
        requestInsertCanvas();
      }
    }
  }
}

onMounted(() => {
  setCanvasSizeToContainer();

  if (thumbnailRoot.value && typeof hostWindow.IntersectionObserver === "function") {
    intersectionObserver = new hostWindow.IntersectionObserver(
      (entries) => {
        const entry = entries && entries[0];
        const visible = !!(entry && (entry.isIntersecting || entry.intersectionRatio > 0));
        isInViewport.value = visible;

        if (visible) {
          if (hasPendingHiddenUpdate) {
            hasPendingHiddenUpdate = false;
          }
          requestInsertCanvas();
        }
      },
      {
        root: null,
        rootMargin: "180px 0px",
        threshold: 0.01
      }
    );
    intersectionObserver.observe(thumbnailRoot.value);
  } else {
    isInViewport.value = true;
    requestInsertCanvas(true);
  }

  // 在容器尺寸变化时更新画布
  if (canvas.value && canvas.value.parentNode) {
    resizeObserver = new hostWindow.ResizeObserver(() => {
      setCanvasSizeToContainer();
      if (isInViewport.value) {
        requestInsertCanvas();
      }
    });
    resizeObserver.observe(canvas.value.parentNode);
  }
});

onBeforeUnmount(() => {
  if (resizeObserver && canvas.value && canvas.value.parentNode) {
    resizeObserver.unobserve(canvas.value.parentNode);
  }
  if (intersectionObserver) {
    intersectionObserver.disconnect();
  }
});

// 当 item 或者 store 中的 thumb canvas 更新时重绘
watch(() => props.item, () => {
  if (isInViewport.value) {
    requestInsertCanvas();
  } else {
    hasPendingHiddenUpdate = true;
  }
});

// 兼容手动刷新缩略图：FileManager 会更新 __thumbRefresh 标记
watch(() => props.item?.__thumbRefresh, () => {
  if (isInViewport.value) {
    requestInsertCanvas();
  } else {
    hasPendingHiddenUpdate = true;
  }
});
</script>

<template>
  <div ref="thumbnailRoot" class="thumbnail">
    <canvas ref="canvas" width="80" height="160" style="display:none"></canvas>
  </div>
</template>

<style scoped>
.thumbnail {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-hover, #05396e);
  overflow: hidden;
}

.thumbnail canvas {
  width: 100%;
  height: 100%;
  display: block;
  background: transparent;
}
</style>