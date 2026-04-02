<template>
  <div
    class="asset-selector-panel"
    role="region"
    :aria-label="t('assetSelector.ariaLabel')"
  >
    <div class="header">
      <h4>{{ t("assetSelector.title") }}</h4>

      <div class="actions">
        <input
          v-model="searchTerm"
          @input="onSearchInput"
          type="search"
          :placeholder="t('assetSelector.searchPlaceholder')"
          class="search-input"
          :aria-label="t('assetSelector.searchAria')"
        />

        <button
          @click="toggleCraftOnly"
          class="craft-toggle-btn"
          :class="{ active: craftOnly }"
          title="Show craft items only"
        >
          Craft
        </button>

        <!-- new: 切换按钮 -->
        <button
          @click="toggleView"
          class="view-toggle-btn"
          :title="
            isCardView
              ? t('assetSelector.toggleToListView')
              : t('assetSelector.toggleToCardView')
          "
        >
          {{ isCardView ? "▦" : "≣" }}
        </button>

        <button
          @click="refresh"
          :disabled="loading"
          class="refresh-btn"
          :title="t('assetSelector.refreshTitle')"
        >
          ↻
        </button>
      </div>
    </div>

    <div class="body">
      <div v-if="!isReplaceMode" class="placeholder">
        {{ t("assetSelector.notInReplaceModePlaceholder") }}
      </div>

      <div v-else>
        <div class="meta">
          <div>
            <strong>{{ t("assetSelector.groupLabel") }}</strong>
            {{ groupDescription || "—" }}
          </div>
          <div>
            <strong>{{ t("assetSelector.candidatesLabel") }}</strong>
            {{ filteredAssets.length }}
          </div>
          <div>
            <strong>Craft</strong>
            {{ craftCandidateCount }}
          </div>
        </div>

        <div v-if="loading" class="placeholder">{{ t("assetSelector.loading") }}</div>
        <div v-else-if="filteredAssets.length === 0" class="placeholder">
          {{ t("assetSelector.noMatches") }}
        </div>

        <!-- ====================== -->
        <!-- LIST VIEW（原样） -->
        <!-- ====================== -->
        <div v-if="!isCardView" class="asset-list">
          <div
            v-for="(a, idx) in filteredAssets"
            :key="assetKey(a, idx)"
            class="asset-row"
            :title="displayPrimaryLabel(a)"
            @mouseenter="onHoverAssetThrottled(a)"
            @mouseleave="onLeaveAssetImpl(a)"
          >
            <div class="left">
              <canvas
                class="entry-thumb"
                :ref="(el) => registerCanvas(el, a, idx)"
                aria-hidden="true"
              ></canvas>
            </div>

            <div class="middle">
              <div class="aname" :title="displayPrimaryLabel(a)">{{ displayPrimaryLabel(a) }}</div>
              <div v-if="displaySecondaryLabel(a)" class="asub" :title="displaySecondaryLabel(a)">{{ displaySecondaryLabel(a) }}</div>
              <span v-if="isCraftAsset(a)" class="craft-badge">Craft</span>
            </div>

            <div class="right">
              <button
                class="tiny"
                @click="applyAsset(a)"
                :disabled="!canApply"
                :title="t('assetSelector.applyTitle')"
              >
                {{ t("assetSelector.apply") }}
              </button>
            </div>
          </div>
        </div>

        <!-- ====================== -->
        <!-- CARD VIEW（新） -->
        <!-- ====================== -->
        <div v-else class="asset-card-grid">
          <div
            v-for="(a, idx) in filteredAssets"
            :key="assetKey(a, idx)"
            class="asset-card"
          >
            <!-- 图片区域：始终显示、占主要宽度 -->
            <div class="card-img-wrapper">
              <canvas
                class="card-thumb"
                :ref="(el) => registerCanvas(el, a, idx)"
                aria-hidden="true"
              ></canvas>
            </div>

            <!-- 文本与按钮 -->
            <div class="card-info">
              <div class="card-text">
                <div class="card-name" :title="displayPrimaryLabel(a)">
                  {{ displayPrimaryLabel(a) }}
                </div>
                <div v-if="displaySecondaryLabel(a)" class="card-sub" :title="displaySecondaryLabel(a)">
                  {{ displaySecondaryLabel(a) }}
                </div>
              </div>

              <span v-if="isCraftAsset(a)" class="craft-badge">Craft</span>

              <button
                class="apply-btn"
                @click="applyAsset(a)"
                :disabled="!canApply"
                :title="t('assetSelector.applyTitle')"
              >
                {{ t("assetSelector.apply") }}
              </button>
            </div>
          </div>
        </div>
        <!-- END CARD VIEW -->
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick, toRaw } from "vue";
import { useI18n } from "vue-i18n";
import { useStudioDomainStores } from "@/stores/studio";
import { createStudioSelectionBridge } from "@/stores/studio/selectionBridge";
import { useFileSystemStore } from "@/stores/fileSystemStore";
import { classifyToGroup } from "@/config/filterGroupConfig.js";
import { AssetApi } from "@/utils/AssetApi";
import * as Palette from "@/services/PaletteService";
import { hostWindow, doc, setTimeoutHost } from "@/utils/host-window.js";
import * as DialogService from "@/services/DialogService.js";
import { throttle, debounce } from "@/utils/performance.js";
import { readPlayerCrafting, resolveCraftForAssetSlot, applyCraftVisualToPart } from "@/studio/craft-resolver.js";

const { t } = useI18n();

const isCardView = ref(false);
function toggleView() {
  isCardView.value = !isCardView.value;
}

const { studio: store, selection } = useStudioDomainStores();
const selectionBridge = createStudioSelectionBridge(store, selection);
const fsStore = useFileSystemStore();
const loading = ref(false);

// Replace mode target (from selectionBridge.replaceTarget)
const replaceTarget = computed(() => selectionBridge.replaceTarget);
const isReplaceMode = computed(
  () => !!(replaceTarget.value && replaceTarget.value.active)
);
const part = computed(() => (replaceTarget.value ? replaceTarget.value.item : null));
const hasFocused = computed(() => isReplaceMode.value && !!part.value);

// search state
const searchTerm = ref("");
const searchDebounceTimer = ref(null);
const craftOnly = ref(false);

// ✅ Performance optimization: throttle hover preview rendering (100ms min interval)
// This prevents excessive render calls when user quickly hovers over multiple assets
let lastPreviewMerged = null;
let hoverPreviewActive = false;
const onHoverAssetThrottled = throttle(onHoverAssetImpl, 100);

// group description (do NOT show group name) - delegated to store helper
const groupDescription = computed(() => {
  if (!part.value) return null;
  return store.getGroupDescriptionForPart
    ? store.getGroupDescriptionForPart(part.value)
    : part.value.Asset?.Group?.Description || part.value.GroupDescription || null;
});

// assets for the target part (delegated to store)
const assets = computed(() => {
  if (!part.value) return [];
  return store.getAssetCandidatesForPart
    ? store.getAssetCandidatesForPart(part.value)
    : store.findAssetsGroupForPart
    ? store.findAssetsGroupForPart(part.value)
    : [];
});

const playerCrafting = computed(() => readPlayerCrafting(hostWindow?.Player));

function extractAssetName(asset) {
  if (!asset) return "";
  return String(asset.Name || asset.name || "").trim();
}

function extractAssetGroupName(asset) {
  if (!asset) return "";
  if (typeof asset.Group === "string") return asset.Group;
  return String(asset.Group?.Name || asset.Group?.name || "").trim();
}

function resolveCraftEntryForAsset(asset) {
  const assetName = extractAssetName(asset);
  const groupName = extractAssetGroupName(asset);
  if (!assetName || !groupName) return null;

  return resolveCraftForAssetSlot({
    assetName,
    groupName,
    player: hostWindow?.Player,
    playerCrafting: playerCrafting.value,
    assetGet: typeof hostWindow?.AssetGet === "function" ? hostWindow.AssetGet.bind(hostWindow) : null,
    cloneFn: (v) => v,
  });
}

function isCraftAsset(asset) {
  return !!resolveCraftEntryForAsset(asset);
}

const craftCandidateCount = computed(() => {
  let count = 0;
  for (const a of assets.value || []) {
    if (isCraftAsset(a)) count++;
  }
  return count;
});

// filtered assets according to searchTerm
const filteredAssets = computed(() => {
  const term = (searchTerm.value || "").trim().toLowerCase();
  let list = assets.value || [];
  if (craftOnly.value) {
    list = list.filter((a) => isCraftAsset(a));
  }
  if (!term) return list;
  return list.filter((a) => {
    try {
      const primary = assetPrimary(a).toLowerCase();
      if (primary.includes(term)) return true;
      const name = (a && (a.Name || a.name || "")).toString().toLowerCase();
      if (name.includes(term)) return true;
      const desc = (a && (a.Description || a.Desc || a.description || ""))
        .toString()
        .toLowerCase();
      if (desc.includes(term)) return true;
    } catch (e) {
      /* ignore */
    }
    return false;
  });
});

function toggleCraftOnly() {
  craftOnly.value = !craftOnly.value;
}

// helper for primary label
function assetPrimary(a) {
  if (!a) return t("assetSelector.unknown");
  if (typeof a === "string") return a;
  return a.Description || a.Desc || a.description || a.name || t("assetSelector.unnamed");
}

function displayPrimaryLabel(asset) {
  const fallbackPrimary = assetPrimary(asset);
  const craftEntry = resolveCraftEntryForAsset(asset);
  const craftName = (craftEntry?.Name || "").toString().trim();
  if (!craftName) return fallbackPrimary;
  return craftName;
}

function displaySecondaryLabel(asset) {
  const fallbackPrimary = assetPrimary(asset);
  const craftEntry = resolveCraftEntryForAsset(asset);
  const craftName = (craftEntry?.Name || "").toString().trim();
  if (!craftName) return "";
  if (fallbackPrimary === craftName) return "";
  return fallbackPrimary;
}

// generate stable key for v-for (use Name when available)
function assetKey(a, idx) {
  try {
    if (!a) return String(idx);
    if (typeof a === "string") return "s_" + a;
    if (a.Name) return "n_" + a.Name;
    if (a.name) return "n_" + a.name;
    return "i_" + idx;
  } catch (e) {
    return "i_" + idx;
  }
}

/* -------------------------
   Thumbnail drawing utilities (fixed for DPR & canvas backing store)
   ------------------------- */

// Map: key (string) -> canvas element
const canvasMap = new Map();
// Map: key -> asset object (latest)
const keyToAsset = new Map();

// square area in CSS pixels for thumbnails
const CSS_SIZE = 56;

// Compute path for asset (uses DynamicPreviewImage and fsStore.character)
function computeImagePath(asset) {
  if (!asset) return null;

  // C can be the target character from file system store
  const C = fsStore.character || null;

  // Determine dynamic suffix
  let dynamicSuffix = "";
  try {
    if (C && asset.DynamicPreviewImage) {
      if (typeof asset.DynamicPreviewImage === "function") {
        try {
          const res = asset.DynamicPreviewImage(C);
          if (res) dynamicSuffix = String(res);
        } catch (e) {
          dynamicSuffix = "";
        }
      } else if (typeof asset.DynamicPreviewImage === "string") {
        dynamicSuffix = asset.DynamicPreviewImage || "";
      }
    }
  } catch (e) {
    dynamicSuffix = "";
  }

  try {
    if (typeof AssetGetPreviewPath === "function") {
      try {
        const base = AssetGetPreviewPath(asset);
        if (base) return `${base}/${asset.Name}${dynamicSuffix}.png`;
      } catch (e) {
        /* fallthrough */
      }
    }
    if (asset.PreviewPath) return asset.PreviewPath;
    if (asset.Url) return asset.Url;
    if (asset.Path) return `${asset.Path}/${asset.Name}${dynamicSuffix}.png`;
    return asset.Name ? `${asset.Name}${dynamicSuffix}.png` : null;
  } catch (e) {
    return null;
  }
}

// Draw asset into a square canvas with aspect-fit centering and DPR handling
async function drawAssetThumbOnCanvas(asset, canvasEl) {
  if (!asset || !canvasEl) return;

  let cssSize = CSS_SIZE;
  const dpr = hostWindow.devicePixelRatio || 1;

  if (isCardView.value) {
    const wrapper = canvasEl.parentNode; // card-img-wrapper
    if (wrapper) {
      const rect = wrapper.getBoundingClientRect();
      cssSize = Math.floor(rect.width); // 正方形卡片 → 宽=高
    }
  }

  // Ensure CSS size (visual) and backing store size (actual pixels) are set
  try {
    canvasEl.style.width = cssSize + "px";
    canvasEl.style.height = cssSize + "px";
    // set backing store to DPR-scaled size
    canvasEl.width = Math.round(cssSize * dpr);
    canvasEl.height = Math.round(cssSize * dpr);
  } catch (e) {
    // ignore if setting sizes fails for some reason
  }

  const ctx = canvasEl.getContext("2d");
  if (!ctx) return;

  // Set transform so we can draw using CSS pixel coordinates (0..cssSize)
  try {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  } catch (e) {
    /* ignore */
  }

  // clear canvas (use CSS coords)
  try {
    ctx.clearRect(0, 0, cssSize, cssSize);
  } catch (e) {
    /* ignore */
  }

  // If group hasn't preview images or preview zone, draw placeholder
  if (!asset.Group || (!asset.Group.HasPreviewImages && !asset.Group.PreviewZone)) {
    try {
      ctx.fillStyle = "#f3f7fb";
      ctx.fillRect(0, 0, cssSize, cssSize);
    } catch (e) {
      /* ignore */
    }
    return;
  }

  const GroupType = classifyToGroup(asset.Group);
  if (GroupType === "Hair" || GroupType === "Face") {
    const previewItem = toRaw(createPreviewDataWithAsset(asset));

    // render via engine and get a canvas-like source
    try {
      store.renderer &&
        store.renderer.startThumbFor &&
        store.renderer.startThumbFor(previewItem);
      const srcRaw = await store.renderer
        .getCanvas(previewItem, { timeout: 4000 })
        .catch(() => null);
      const src = srcRaw ? srcRaw : store.renderer._getCanvas(previewItem) || null;

      // clear (already cleared, but ensure)
      ctx.clearRect(0, 0, cssSize, cssSize);

      const previewZone = asset.Group.PreviewZone || null;
      if (src && previewZone) {
        try {
          const srcX = previewZone[0] || 0;
          const srcY = previewZone[1] || 0;
          const srcW = previewZone[2] || src.width || 1;
          const srcH = previewZone[3] || src.height || 1;

          const srcAspect = (srcW || 1) / (srcH || 1);
          const destAspect = 1; // square
          let destW, destH;
          if (destAspect > srcAspect) {
            destH = cssSize;
            destW = destH * srcAspect;
          } else {
            destW = cssSize;
            destH = destW / srcAspect;
          }
          const dx = (cssSize - destW) / 2;
          const dy = (cssSize - destH) / 2;

          // drawImage accepts canvas/image elements
          try {
            // If src is a canvas or image element, use drawImage with specified source rect
            ctx.drawImage(src, srcX, srcY, srcW, srcH, dx, dy, destW, destH);
          } catch (e) {
            // ignore drawing errors
          }
        } catch (e) {
          // ignore
        }
      }
    } catch (e) {
      // ignore render errors
    } finally {
      store.renderer && store.renderer.stopFor && store.renderer.stopFor(previewItem);
    }

    return;
  }

  // now we draw the image if it has a valid path
  if (!asset.Group.HasPreviewImages) {
    // draw placeholder background
    try {
      ctx.fillStyle = "#f3f7fb";
      ctx.fillRect(0, 0, cssSize, cssSize);
    } catch (e) {
      /* ignore */
    }
    return;
  }

  ctx.imageSmoothingEnabled = true;
  try {
    ctx.imageSmoothingQuality = "high";
  } catch (e) {
    /* ignore */
  }

  const imagePath = computeImagePath(asset);
  if (!imagePath) {
    // draw placeholder background
    try {
      ctx.fillStyle = "#f3f7fb";
      ctx.fillRect(0, 0, cssSize, cssSize);
    } catch (e) {
      /* ignore */
    }
    return;
  }

  // Prefer DrawImageEx when available. Assume DrawImageEx expects logical (CSS) units here.
  if (typeof DrawImageEx === "function") {
    try {
      DrawImageEx(imagePath, ctx, 0, 0, { Width: cssSize, Height: cssSize });
      return;
    } catch (e) {
      // fallback to image element
    }
  }

  // Browser fallback using Image
  await drawWithImageElement(imagePath, ctx, cssSize);
}

function drawWithImageElement(srcUrl, ctx, cssSize) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    let resolved = false;

    img.onload = () => {
      try {
        const srcW = img.width || 1;
        const srcH = img.height || 1;
        const srcAspect = srcW / srcH;
        const destAspect = 1; // square

        let destW, destH;
        if (destAspect > srcAspect) {
          destH = cssSize;
          destW = destH * srcAspect;
        } else {
          destW = cssSize;
          destH = destW / srcAspect;
        }

        const dx = (cssSize - destW) / 2;
        const dy = (cssSize - destH) / 2;

        ctx.clearRect(0, 0, cssSize, cssSize);
        try {
          // drawImage(img, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
          ctx.drawImage(img, 0, 0, srcW, srcH, dx, dy, destW, destH);
        } catch (e) {
          // ignore
        }
      } catch (e) {
        // ignore
      } finally {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }
    };

    img.onerror = () => {
      // draw placeholder if image fails
      try {
        ctx.clearRect(0, 0, cssSize, cssSize);
        ctx.fillStyle = "#f7fbff";
        ctx.fillRect(0, 0, cssSize, cssSize);
      } catch (e) {
        /* ignore */
      }
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    img.src = srcUrl;
    // if cached and onload didn't fire, ensure we call load path
    setTimeoutHost(() => {
      if (!resolved && img.complete) {
        try {
          img.onload && img.onload();
        } catch (e) {
          /* ignore */
        }
      }
    }, 0);
  });
}

/* -------------------------
   refs registration and lifecycle
   ------------------------- */

// registerCanvas is used as function ref in template
function registerCanvas(el, asset, idx) {
  const key = assetKey(asset, idx);
  // if el is null -> unmounting: remove maps
  if (!el) {
    canvasMap.delete(key);
    keyToAsset.delete(key);
    return;
  }
  // keep latest asset object for this key
  keyToAsset.set(key, asset);
  canvasMap.set(key, el);

  // schedule an immediate draw (allow DOM to stabilize)
  setTimeoutHost(() => {
    drawAssetThumbOnCanvas(asset, el).catch(() => {
      /* ignore */
    });
  }, 8);
}

// redraw all visible thumbs (called when assets list changes or character changes)
async function redrawAllThumbs() {
  await nextTick();
  for (const [key, canvasEl] of canvasMap.entries()) {
    const asset = keyToAsset.get(key);
    if (asset && canvasEl) {
      // small timeout to reduce layout thrash
      setTimeoutHost(() => drawAssetThumbOnCanvas(asset, canvasEl).catch(() => {}), 6);
    }
  }
}

let charWatcherStop = null;
onMounted(() => {
  // watch for character changes: redraw thumbnails since DynamicPreviewImage may differ
  charWatcherStop = watch(
    () => fsStore.character,
    () => redrawAllThumbs(),
    { immediate: false }
  );
});

onBeforeUnmount(() => {
  try {
    charWatcherStop && charWatcherStop();
  } catch (e) {
    /* ignore */
  }
});

watch(
  assets,
  () => {
    // When assets change, rebind/redraw canvases
    setTimeoutHost(() => redrawAllThumbs(), 12);
  },
  { deep: true }
);

watch(
  () => fsStore.character,
  () => {
    // redundant safety: also trigger redraw on character update
    setTimeoutHost(() => redrawAllThumbs(), 10);
  }
);

/* -------------------------
   UI actions (apply + search + preview)
   ------------------------- */

function refresh() {
  loading.value = true;
  // call store loader and ensure loading flag reset
  store
    .loadAssetData()
    .catch((e) => {
      console.warn("loadAssetData failed", e);
    })
    .finally(() => {
      loading.value = false;
    });
}

const canApply = computed(() => {
  // need a replace target and a selected stack
  return (
    isReplaceMode.value &&
    !!part.value &&
    store.selectedIndex !== undefined &&
    store.selectedIndex !== null &&
    store.selectedIndex !== -1 &&
    Array.isArray(store.stacks)
  );
});

// Apply asset now delegates to store method if available (which handles layerEntries / commits)
async function applyAsset(asset) {
  if (!asset) return;
  if (!canApply.value) {
    // use i18n message
    await DialogService.alert(t("assetSelector.alertNoReplaceMode"));
    return;
  }

  try {
    const res = await store.execute({
      type: "asset.apply",
      payload: {
        asset,
        replaceTarget: replaceTarget.value,
      },
    });

    if (!res) {
      console.warn("applyAsset: store.applyAssetToSelectedStack failed or returned null");
      await DialogService.alert(t("assetSelector.alertApplyFailed"));
      return;
    }
    // optionally exit replace mode
    // store.clearReplaceTarget && store.clearReplaceTarget()
  } catch (e) {
    console.error("applyAsset failed", e);
    await DialogService.alert(t("assetSelector.alertApplyFailed"));
  }
}

/* -------------------------
   Preview on hover implementation
   - create a previewStacks copy where for each stack we append the preview part
   - build unexpanded item via AssetApi.stackOutfitData(previewStacks)
   - expand via Palette.expandedAppearanceForRendering and call renderer.renderPreviewWithItem(toRaw(merged))
   - on leave, restore rendering to store.mergedAppearanceData
   ------------------------- */

function createPreviewDataWithAsset(asset) {
  const groupName =
    (asset.Group &&
      (typeof asset.Group === "string"
        ? asset.Group
        : asset.Group.Name || asset.Group.name)) ||
    undefined;

  const newPart = {
    Name: asset.Name,
    Group: groupName,
    Color: asset.DefaultColor ?? asset.DefaultColour ?? asset.Default ?? null,
  };

  const resolvedCraft = resolveCraftForAssetSlot({
    assetName: asset.Name,
    groupName,
    player: hostWindow?.Player,
    playerCrafting: playerCrafting.value,
    assetGet: typeof hostWindow?.AssetGet === "function" ? hostWindow.AssetGet.bind(hostWindow) : null,
    cloneFn: (v) => {
      try {
        return JSON.parse(JSON.stringify(v));
      } catch (e) {
        return v;
      }
    },
  });

  if (resolvedCraft) {
    newPart.Craft = resolvedCraft;
    applyCraftVisualToPart(newPart, resolvedCraft, (v) => {
      try {
        return JSON.parse(JSON.stringify(v));
      } catch (e) {
        return v;
      }
    });
  }

  // ensure entries for preview part
  let entries = [];
  try {
    const res =
      typeof store.buildLayerEntriesForPart === "function"
        ? store.buildLayerEntriesForPart(newPart)
        : null;
    entries = res || [];
  } catch (e) {
    entries = [];
  }
  try {
    newPart.layerEntries = JSON.parse(JSON.stringify(entries || []));
  } catch (e) {
    newPart.layerEntries = (entries || []).slice();
  }

  // Build previewStacks: clone current stacks and append preview part onto each stack's data (top layer)
  const previewStacks = JSON.parse(JSON.stringify(store.stacks || []));
  previewStacks.push({
    data: [newPart],
    filterList: [newPart.Group || ""],
    id: `preview_stack_${Date.now()}`,
    name: "Preview Stack",
  });

  // Build unexpanded item and expand with palette to get mergedAppearanceData-like shape
  const unexpanded = { data: AssetApi.stackOutfitData(previewStacks), type: "outfit" };
  const mergedPreview = Palette.expandedAppearanceForRendering(
    unexpanded,
    store.paletteMap
  );
  return mergedPreview;
}

async function onHoverAssetImpl(asset) {
  if (!asset) return;
  if (!store.renderer || typeof store.renderer.renderPreviewWithItem !== "function")
    return;

  try {
    // Construct preview part like apply logic (but do NOT write into store.stacks)
    const mergedPreview = createPreviewDataWithAsset(asset);
    lastPreviewMerged = mergedPreview;
    hoverPreviewActive = true;

    // Push preview onto stack (priority 2: higher than layer blink - asset selection takes precedence)
    store.pushPreview("asset-hover", 2, mergedPreview, "asset-hover");
  } catch (e) {
    console.warn("onHoverAsset failed", e);
  }
}

function onLeaveAssetImpl(asset) {
  // Remove preview from stack to restore state
  hoverPreviewActive = false;
  store.popPreview("asset-hover");
}

/* -------------------------
   Search helpers
   ------------------------- */
function onSearchInput() {
  if (searchDebounceTimer.value) clearTimeout(searchDebounceTimer.value);
  // simple debounce to avoid frequent re-calculations
  searchDebounceTimer.value = setTimeoutHost(() => {
    searchDebounceTimer.value = null;
    // filteredAssets is computed; nothing else needed here
  }, 120);
}
</script>

<style scoped>
.asset-selector-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
  padding-left: 8px;
  min-width: 0;
  min-height: 0;
}

/* header */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.header h4 {
  margin: 0;
  font-size: 15px;
  color: var(--color-text-primary, #0f172a);
}

/* actions */
.actions {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.search-input {
  padding: 6px 10px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-light, #f1f5f9);
  background: var(--color-bg-base, #fff);
  font-size: 13px;
  width: min(220px, 100%);
  min-width: 0;
  box-sizing: border-box;
}

.refresh-btn {
  padding: 6px 10px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-light, #f1f5f9);
  background: var(--color-bg-base, #fff);
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text-primary, #0f172a);
}

.craft-toggle-btn {
  padding: 6px 10px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-light, #f1f5f9);
  background: var(--color-bg-base, #fff);
  cursor: pointer;
  font-size: 12px;
  color: var(--color-text-primary, #0f172a);
}

.craft-toggle-btn.active {
  border-color: var(--color-border-base, #cbd5e1);
  background: var(--color-bg-surface, #f8fafc);
}

/* body */
.body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 8px;
  border-radius: var(--radius-md, 8px);
  background: linear-gradient(
    180deg,
    var(--color-bg-base, #fff),
    var(--color-bg-surface, #f8fafc)
  );
  border: 1px solid var(--color-border-base, #e2e8f0);
}

/* placeholder */
.placeholder {
  color: var(--color-text-tertiary, #64748b);
  padding: 12px;
  text-align: center;
}

/* meta row */
.meta {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 8px;
  color: var(--color-text-secondary, #475569);
  font-size: 13px;
}

/* asset list */
.asset-list {
  display: flex;
  flex-direction: column;
  gap: 0px;
}

.asset-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  border-radius: 0px;
  border: 0.5px solid var(--color-border-light, #f1f5f9);
  background: var(--color-bg-base, #fff);
  transition: background 0.08s ease, border-color 0.08s ease;
}

.asset-row:hover {
  background: var(--color-bg-hover, #f1f5f9);
  border-color: var(--color-border-base, #e2e8f0);
}

/* left: small square thumbnail */
.asset-row .left {
  width: 72px;
  min-width: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.asset-row canvas.entry-thumb {
  width: 56px;
  /* CSS size */
  height: 56px;
  border-radius: var(--radius-md, 8px);
  background: var(--color-bg-surface, #f8fafc);
  border: 1px solid var(--color-border-base, #e2e8f0);
  display: block;
  box-sizing: border-box;
  position: relative;
}

/* middle: labels */
.middle {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.aname {
  font-weight: 700;
  color: var(--color-text-primary, #0f172a);
  font-size: 13px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asub {
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-text-tertiary, #64748b);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.craft-badge {
  margin-top: 4px;
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 999px;
  border: 1px solid var(--color-border-base, #e2e8f0);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary, #475569);
  background: var(--color-bg-surface, #f8fafc);
}

/* right: actions */
.right {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--color-text-primary, #0f172a);
}

.tiny {
  padding: 6px 8px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-light, #f1f5f9);
  background: var(--color-bg-base, #fff);
  cursor: pointer;
  color: var(--color-text-primary, #0f172a);
  font-size: 12px;
}

/* ============ 新增：切换按钮 ============ */
.view-toggle-btn {
  padding: 6px 10px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-light, #f1f5f9);
  background: var(--color-bg-base, #fff);
  cursor: pointer;
  color: var(--color-text-primary, #0f172a);
  font-size: 13px;
}

/* ====================================================== */
/* ============ 大图卡片 CARD VIEW 样式 =============== */
/* ====================================================== */

.asset-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 14px;
  margin-top: 6px;
}

.asset-card {
  background: var(--color-bg-base, #ffffff);
  border: 1px solid var(--color-border-base, #e2e8f0);
  border-radius: var(--radius-xl, 12px);
  padding: 8px;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: box-shadow 0.15s ease;
}

.asset-card:hover {
  box-shadow: var(--shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.1));
}

/* 图片区域 */
.card-img-wrapper {
  position: relative;
  width: 100%;
  padding-top: 100%; /* 正方形 */
  overflow: hidden;
  border-radius: var(--radius-lg, 10px);
  background: var(--color-bg-surface, #f8fafc);
  border: 1px solid var(--color-border-base, #e2e8f0);
}

.card-thumb {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

/* 文本 + 按钮 */
.card-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  color: var(--color-text-primary, #0f172a);
}

.card-text {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary, #0f172a);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 100%;
}

.card-sub {
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-text-tertiary, #64748b);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.apply-btn {
  padding: 6px 8px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-light, #f1f5f9);
  font-size: 12px;
  background: var(--color-bg-base, #fff);
  cursor: pointer;
  color: var(--color-text-primary, #0f172a);
}
</style>
