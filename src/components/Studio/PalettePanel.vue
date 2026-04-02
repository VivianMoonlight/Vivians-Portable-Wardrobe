<template>
  <div ref="rootEl" class="palette-panel" @keydown.esc="exitTagEditMode">
    <!-- 0. Mode Indicator Bar -->
    <div class="mode-indicator-bar" :class="{ 'is-editing-tag': !!editingTagId }">
      <div class="mode-status">
        <span v-if="!editingTagId" class="mode-label"
          >🎨 {{ t("palette.modeIndicator.browse") }}</span
        >
        <span v-else class="mode-label editing">
          ✎ {{ t("palette.modeIndicator.editingTag") }}:
          <strong>{{ editingTagId }}</strong>
        </span>
      </div>
      <div v-if="editingTagId" class="mode-actions">
        <button class="exit-btn" @click="exitTagEditMode">
          {{ t("common.done") }}
        </button>
      </div>
    </div>

    <!-- 1. Picker Area (Fixed at top) -->
    <div class="picker-section" :class="{ 'editing-tag-mode': !!editingTagId }">
      <div class="picker-wrapper" :class="{ 'editing-mode': !!editingTagId }">
        <Chrome v-model="pickerColor" :disable-alpha="true" class="vc-sketch-custom" />
      </div>

      <!-- Quick Actions Bar -->
      <div class="quick-actions" :class="`screen-${screenSize}`">
        <!-- Add to Saved -->
        <button
          class="action-btn save-btn"
          @click="addCurrentToSaved"
          :disabled="!!editingTagId"
          :title="
            editingTagId
              ? t('palette.actions.disabledInEditMode')
              : t('palette.saved.saveTitle')
          "
        >
          <span class="icon">💾</span>
          <span class="label">{{ t("palette.saved.title") }}</span>
        </button>
        <!-- Create Tag -->
        <button
          class="action-btn tag-btn"
          @click="createTagFromCurrent"
          :disabled="!!editingTagId"
          :title="
            editingTagId
              ? t('palette.actions.disabledInEditMode')
              : t('palette.tags.createFromCurrent')
          "
        >
          <span class="icon">🏷️</span>
          <span class="label">{{ t("palette.tags.title") }}</span>
        </button>
      </div>
    </div>

    <!-- Scrollable Content -->
    <div class="palette-content scrollable">
      <!-- 2. Saved Colors (Grid) -->
      <div class="section-block saved-section">
        <div class="section-header" @click="toggleSaved">
          <span class="arrow">{{ collapsedSaved ? "▸" : "▾" }}</span>
          <span class="section-icon">💾</span>
          <span class="sec-title">{{ t("palette.saved.title") }}</span>
          <span class="count" v-if="savedColors.length">({{ savedColors.length }})</span>
          <button
            v-if="savedColors.length"
            class="clear-btn"
            @click.stop="handleClearAllSaved"
            :title="t('palette.saved.clearTitle')"
          >
            Clear
          </button>
        </div>

        <div v-if="!collapsedSaved" class="section-description">
          {{ t("palette.saved.description") }}
        </div>

        <transition name="fade">
          <div v-show="!collapsedSaved" class="saved-grid">
            <div v-if="savedColors.length === 0" class="empty-state">
              <div class="empty-icon">💾</div>
              <div class="empty-text">{{ t("palette.saved.emptyText") }}</div>
              <button class="empty-cta" @click="addCurrentToSaved">
                {{ t("palette.saved.emptyCTA") }}
              </button>
            </div>

            <div
              v-for="(c, idx) in savedColors"
              :key="`saved-${idx}`"
              class="saved-swatch-item"
              @click="applySavedColor(idx)"
              :title="savedText(c)"
            >
              <div class="delete-overlay" @click.stop="deleteSavedColor(idx)">X</div>
              <span class="swatch-bg" :style="savedSwatchStyle(c)"></span>
            </div>
          </div>
        </transition>
      </div>

      <!-- 3. Tags (List) -->
      <div class="section-block tags-section">
        <div class="section-header" @click="toggleTags">
          <span class="arrow">{{ collapsedTags ? "▸" : "▾" }}</span>
          <span class="section-icon">🏷️</span>
          <span class="sec-title">{{ t("palette.tags.title") }}</span>
          <span class="count" v-if="tagKeys.length">({{ tagKeys.length }})</span>
        </div>

        <div v-if="!collapsedTags" class="section-description">
          {{ t("palette.tags.description") }}
        </div>

        <transition name="fade">
          <div v-show="!collapsedTags" class="tags-list">
            <div v-if="tagKeys.length === 0" class="empty-state tags-empty">
              <div class="empty-icon">🏷️</div>
              <div class="empty-text">{{ t("palette.tags.emptyText") }}</div>
              <button class="empty-cta" @click="createTagFromCurrent">
                {{ t("palette.tags.emptyCTA") }}
              </button>
            </div>

            <div
              v-for="tag in tagKeys"
              :key="tag"
              class="tag-row"
              :class="{ 'is-editing': editingTagId === tag }"
            >
              <!-- Color Swatch (Click to apply) -->
              <div
                class="tag-swatch-col"
                @click="applyTag(tag)"
                :title="t('palette.actions.apply')"
              >
                <span class="tag-swatch" :style="swatchStyle(tag)"></span>
              </div>

              <!-- Name Input (Auto-save) -->
              <div class="tag-name-col">
                <input
                  class="tag-name-input"
                  :value="tag"
                  @change="(e) => onTagRename(tag, e.target.value)"
                  @keydown.enter="(e) => e.target.blur()"
                />
              </div>

              <!-- Value Display (with ColorValuePreview Component) -->
              <div class="tag-val-col">
                <ColorValuePreview :value="palette[tag]" />
              </div>

              <!-- Usage Count Badge -->
              <div class="tag-usage-badge" :title="`Used in ${usageCount(tag)} layer(s)`">
                {{ usageCount(tag) }}
              </div>

              <!-- Actions -->
              <div class="tag-actions">
                <!-- Edit Color Mode Toggle -->
                <button
                  class="icon-action"
                  :class="{ active: editingTagId === tag }"
                  @click.stop="toggleEditTagMode(tag)"
                  :title="t('palette.tags.editTitle')"
                >
                  ✎
                </button>
                <!-- Delete -->
                <button
                  class="icon-action danger"
                  @click.stop="handleDeleteTag(tag)"
                  :title="t('palette.saved.delete')"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        </transition>
      </div>

      <!-- 4. Advanced Tag+Offset (below Tags) -->
      <div class="section-block advanced-section">
        <div class="section-header" @click="toggleAdvanced">
          <span class="arrow">{{ collapsedAdvanced ? "▸" : "▾" }}</span>
          <span class="section-icon">⚙️</span>
          <span class="sec-title">{{ t("palette.advanced.title") }}</span>
        </div>

        <transition name="fade">
          <div v-show="!collapsedAdvanced" class="advanced-body">
            <div class="advanced-summary">{{ t("palette.advanced.summary") }}</div>

            <div class="advanced-row status-row">
              <span class="advanced-label">{{ t("palette.advanced.targetType") }}</span>
              <span class="advanced-color-chip" :title="currentTargetDisplayText">
                <span class="advanced-color-dot" :style="currentTargetDotStyle"></span>
                <span class="advanced-color-text">{{ currentTargetDisplayText }}</span>
              </span>
            </div>

            <div class="advanced-row">
              <label class="advanced-label" for="advanced-base-tag">{{
                t("palette.advanced.baseTag")
              }}</label>
              <select
                id="advanced-base-tag"
                class="advanced-select"
                v-model="advancedBaseTag"
                :disabled="!tagKeys.length"
              >
                <option value="">{{ t("palette.advanced.selectTag") }}</option>
                <option v-for="tag in tagKeys" :key="`adv-tag-${tag}`" :value="tag">
                  {{ tag }}
                </option>
              </select>
            </div>

            <div class="advanced-row">
              <label class="advanced-slider-label">H {{ offsetH }}</label>
              <input
                type="range"
                min="-180"
                max="180"
                step="1"
                v-model.number="offsetH"
                class="advanced-slider"
              />
            </div>
            <div class="advanced-row">
              <label class="advanced-slider-label">L {{ offsetL }}</label>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                v-model.number="offsetL"
                class="advanced-slider"
              />
            </div>
            <div class="advanced-row">
              <label class="advanced-slider-label">S {{ offsetS }}</label>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                v-model.number="offsetS"
                class="advanced-slider"
              />
            </div>

            <div class="advanced-row advanced-buttons">
              <button
                class="action-btn"
                @click="suggestOffsetFromCurrent"
                :disabled="!canSuggestOffset"
              >
                {{ t("palette.advanced.suggest") }}
              </button>
              <button
                class="action-btn"
                @click="resetAdvancedOffset"
                :disabled="!canApplyAdvanced"
              >
                {{ t("palette.advanced.reset") }}
              </button>
            </div>
            <div class="advanced-row advanced-buttons">
              <button
                class="action-btn"
                @click="convertAdvancedToHls"
                :disabled="!canSuggestOffset"
              >
                {{ t("palette.advanced.toHls") }}
              </button>
              <button
                class="action-btn"
                @click="detachAdvancedToRaw"
                :disabled="!canDetachAdvanced"
              >
                {{ t("palette.advanced.detach") }}
              </button>
            </div>
          </div>
        </transition>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStudioDomainStores } from "@/stores/studio";
import { Chrome } from "@ckpack/vue-color";
import { throttle } from "@/utils/performance.js";
import { hostWindow, setTimeoutHost } from "@/utils/host-window.js";
import * as DialogService from "@/services/DialogService.js";
import * as PaletteService from "@/services/PaletteService";
import { getHlsOffsetBetweenColors } from "@/utils/color-hls.js";
import ColorValuePreview from "@/components/ui/ColorValuePreview.vue";

const { t } = useI18n();
const { studio: store, panel } = useStudioDomainStores();
const rootEl = ref(null);

/* ---------------- State ---------------- */

// Display State
const collapsedSaved = ref(false);
const collapsedTags = ref(false);
const collapsedAdvanced = ref(true);

// Picker State
// pickerColor binds to the visual picker component.
// It syncs FROM store when selection changes, and syncs TO store when user drags it.
const pickerColor = ref("#cccccc");

// "Editing Tag" Mode
// If null, picker updates the Active Selection (Store.activePaletteTargets)
// If set (string), picker updates the Store.paletteMap[tag]
const editingTagId = ref(null);

const advancedBaseTag = ref("");
const offsetH = ref(0);
const offsetL = ref(0);
const offsetS = ref(0);
const advancedSyncing = ref(false);

// Warnings
const deleteTagWarning = ref(null);
const clearSavedWarning = ref(false);
let deleteTagTimer = null;
let clearSavedTimer = null;
let pickerSyncflag = false;
let realtimeCommitTimer = null;
let paletteInteractionActive = false;

// Responsive Screen Size Tracking
const screenSize = ref("md"); // 'xs' | 'sm' | 'md' | 'lg'

function updateScreenSize() {
  const width = window.innerWidth;
  if (width < 340) screenSize.value = "xs";
  else if (width < 600) screenSize.value = "sm";
  else if (width < 1024) screenSize.value = "md";
  else screenSize.value = "lg";
}

// Initialize screen size
updateScreenSize();

onMounted(() => {
  const key = "studio.ui.palette.advancedExpanded";
  if (panel.workspaceMode === "pro") {
    const persisted = localStorage.getItem(key);
    if (persisted === "1") collapsedAdvanced.value = false;
    else if (persisted === "0") collapsedAdvanced.value = true;
  } else {
    collapsedAdvanced.value = true;
  }

  window.addEventListener("resize", updateScreenSize);

  nextTick(() => {
    syncAdvancedFromSelection();
  });
});

onUnmounted(() => {
  window.removeEventListener("resize", updateScreenSize);
  updateStoreFromPicker.cancel?.();
  applyAdvancedRealtime.cancel?.();
  if (realtimeCommitTimer) {
    clearTimeout(realtimeCommitTimer);
    realtimeCommitTimer = null;
  }
  const committed = commitPaletteInteraction();
  if (!committed) {
    store.forceEndRealtimeScope?.("palette", {
      commit: true,
      interactionKind: "palette",
    });
  }
});

watch([collapsedAdvanced, () => panel.workspaceMode], ([collapsed, mode]) => {
  if (mode !== "pro") return;
  localStorage.setItem("studio.ui.palette.advancedExpanded", collapsed ? "0" : "1");
});

/* ---------------- Computeds ---------------- */

const palette = computed(() => store.paletteSnapshot || {});
const tagKeys = computed(() => Object.keys(palette.value));
const savedColors = computed(() => store.savedColors || []);

// Determine what the picker should show
const activeTargets = computed(() => store.activePaletteTargets || []);
const firstActiveTarget = computed(() =>
  activeTargets.value.length ? activeTargets.value[0] : null
);

const parsedFirstTargetRef = computed(() => {
  const text = firstActiveTarget.value?.currentColorText;
  return PaletteService.parseTagOffsetRef(text);
});

const targetValueKind = computed(() => {
  const text = String(firstActiveTarget.value?.currentColorText || "").trim();
  if (!text) return "raw";
  if (parsedFirstTargetRef.value?.isTagOffsetRef) return "tag-offset";
  if (text in (palette.value || {})) return "tag";
  return "raw";
});

const targetValueKindLabel = computed(() => {
  if (targetValueKind.value === "tag-offset") return t("palette.advanced.kindTagOffset");
  if (targetValueKind.value === "tag") return t("palette.advanced.kindTag");
  return t("palette.advanced.kindRaw");
});

const currentTargetDisplayText = computed(() => {
  const text = String(firstActiveTarget.value?.currentColorText || "").trim();
  if (text) return text;
  return targetValueKindLabel.value;
});

const currentTargetCss = computed(() => {
  const css = String(firstActiveTarget.value?.currentColorCss || "").trim();
  if (css) return css;

  const text = String(firstActiveTarget.value?.currentColorText || "").trim();
  if (text in palette.value) {
    return extractPrimaryCssColor(palette.value[text]) || "";
  }
  if (parsedFirstTargetRef.value?.isTagOffsetRef) {
    const resolved = PaletteService.resolveTagOffsetColor(text, palette.value);
    if (resolved?.ok) return resolved.color;
  }
  return "";
});

const currentTargetDotStyle = computed(() => {
  const css = currentTargetCss.value;
  if (!css) {
    return {
      background: "transparent",
      border: "1px dashed var(--color-border-base, #e2e8f0)",
    };
  }
  return {
    background: css,
    border: "1px solid var(--color-border-base, #e2e8f0)",
  };
});

const canApplyAdvanced = computed(() => {
  return !editingTagId.value && !!advancedBaseTag.value && activeTargets.value.length > 0;
});

const canSuggestOffset = computed(() => {
  return !editingTagId.value && !!advancedBaseTag.value && !!firstActiveTarget.value;
});

const canDetachAdvanced = computed(() => {
  return (
    !editingTagId.value &&
    !!firstActiveTarget.value &&
    (parsedFirstTargetRef.value?.isTagOffsetRef || !!advancedBaseTag.value)
  );
});

// Cache for tag usage counts (invalidated when palette or stacks change)
const usageCountCache = ref({});

function calculateUsageCount(tag) {
  if (!store.stacks) return 0;
  let count = 0;
  const isRefToTag = (value) => {
    if (value === tag) return true;
    if (typeof value !== "string") return false;
    const parsed = PaletteService.parseTagOffsetRef(value);
    return parsed.isTagOffsetRef && parsed.tag === tag;
  };

  // 遍历所有 stack
  store.stacks.forEach((stack) => {
    if (!stack.data) return;
    stack.data.forEach((part) => {
      if (isRefToTag(part.Color)) count++;
      if (Array.isArray(part.Color) && part.Color.some((c) => isRefToTag(c))) count++;
    });
  });

  // 遍历 focusedPart
  if (store.focusedPart?.data) {
    store.focusedPart.data.forEach((part) => {
      if (isRefToTag(part.Color)) count++;
      if (Array.isArray(part.Color) && part.Color.some((c) => isRefToTag(c))) count++;
    });
  }

  return count;
}

function usageCount(tag) {
  // 返回缓存的值，如果没有则计算并缓存
  if (!(tag in usageCountCache.value)) {
    usageCountCache.value[tag] = calculateUsageCount(tag);
  }
  return usageCountCache.value[tag];
}

// Invalidate cache when palette changes
watch(
  [() => store.paletteMap, () => store.stacks],
  () => {
    usageCountCache.value = {};
  },
  { deep: true }
);

watch(tagKeys, (keys) => {
  if (!advancedBaseTag.value) return;
  if (!keys.includes(advancedBaseTag.value)) {
    advancedBaseTag.value = "";
    offsetH.value = 0;
    offsetL.value = 0;
    offsetS.value = 0;
  }
});

/* ---------------- Picker Logic ---------------- */

function beginPaletteInteraction() {
  if (paletteInteractionActive) return;
  store.beginInteraction?.("palette", { source: "PalettePanel" });
  paletteInteractionActive = true;
}

function commitPaletteInteraction() {
  if (!paletteInteractionActive) return false;
  paletteInteractionActive = false;

  let committed = false;
  try {
    committed = !!store.commitInteraction?.();
  } catch (e) {
    committed = false;
  }

  if (!committed) {
    try {
      committed = !!store.forceEndRealtimeScope?.("palette", {
        commit: true,
        interactionKind: "palette",
      });
    } catch (e) {
      committed = false;
    }
  }

  return committed;
}

function schedulePaletteInteractionCommit() {
  if (realtimeCommitTimer) clearTimeout(realtimeCommitTimer);
  realtimeCommitTimer = setTimeoutHost(() => {
    realtimeCommitTimer = null;
    commitPaletteInteraction();
  }, 220);
}

// 1. Sync Picker -> Store (Throttled)
const updateStoreFromPicker = throttle((val) => {
  const hex = normalizePickerOutput(val);
  if (!hex) return;
  if (pickerSyncflag) return; // Prevent loop

  if (editingTagId.value) {
    // Mode A: Editing a Tag Definition
    beginPaletteInteraction();
    store.updatePaletteTag(editingTagId.value, hex, { deferCommit: true });
    schedulePaletteInteractionCommit();
  } else {
    // Mode B: Editing active selection through transaction API.
    beginPaletteInteraction();
    const changed = store.applyDelta?.({
      type: "palette.applyColor",
      payload: { newColor: hex },
    });
    if (changed === false) {
      store.applyColorToActivePaletteTargets(hex, { deferCommit: true });
    }
    schedulePaletteInteractionCommit();
  }
}, 100);

// Watch the visual picker component
watch(pickerColor, (nv) => {
  // Only trigger update if we are interacting.
  // We need to distinguish between "Store changed picker" vs "User changed picker".
  // The simplest way is to let the update flow, but throttle it.
  updateStoreFromPicker(nv);
});

// 2. Sync Store -> Picker
// We need to update the picker color when:
// A. The user selects a different layer (and we are NOT editing a tag).
// B. The user selects a different tag to edit.
// C. The value of the edited tag changes externally.

watch(
  () => store.paletteUpdateFlag,
  () => {
    if (!editingTagId.value) {
      syncPickerToActiveSelection();
      syncAdvancedFromSelection();
    }
  }
);

watch(
  activeTargets,
  () => {
    if (!editingTagId.value && store.paletteModeActive) {
      syncPickerToActiveSelection();
      syncAdvancedFromSelection();
    }
  },
  { deep: true }
);

watch(
  () => editingTagId.value,
  (newTag) => {
    if (newTag) {
      // Sync picker to this tag's color
      const v = palette.value[newTag];
      syncPickerToColorValue(v);
    } else {
      // Revert picker to active selection
      syncPickerToActiveSelection();
    }
  }
);

watch(
  firstActiveTarget,
  () => {
    if (!store.paletteModeActive) return;
    syncAdvancedFromSelection();
  },
  { deep: true }
);

// Also watch the palette itself in case the tag being edited changes value elsewhere
watch(
  palette,
  (newPalette) => {
    if (editingTagId.value && newPalette[editingTagId.value]) {
      // If the tag we are editing changed (e.g. undo/redo), update picker
      // Check for difference to avoid loop
      const v = newPalette[editingTagId.value];
      const hex = extractPrimaryCssColor(v);
      if (
        hex &&
        normalizePickerOutput(pickerColor.value) !== normalizePickerOutput(hex)
      ) {
        syncPickerToColorValue(v);
      }
    }
  },
  { deep: true }
);

function syncAdvancedFromSelection() {
  const resetAdvancedFields = () => {
    advancedBaseTag.value = "";
    offsetH.value = 0;
    offsetL.value = 0;
    offsetS.value = 0;
  };

  const inferNearestTagOffsetFromColor = (targetColor) => {
    if (!targetColor) return null;
    const tags = tagKeys.value || [];
    if (!tags.length) return null;

    let best = null;

    for (const tag of tags) {
      const baseColor = extractPrimaryCssColor(palette.value[tag]);
      if (!baseColor) continue;
      const diff = getHlsOffsetBetweenColors(baseColor, targetColor);
      if (!diff.ok) continue;

      const score =
        Math.abs(diff.offset.h) * 0.6 + Math.abs(diff.offset.l) + Math.abs(diff.offset.s);
      if (!best || score < best.score) {
        best = {
          tag,
          offset: diff.offset,
          score,
        };
      }
    }

    return best;
  };

  const text = String(firstActiveTarget.value?.currentColorText || "").trim();
  if (!text) {
    resetAdvancedFields();
    return;
  }

  advancedSyncing.value = true;

  const parsed = PaletteService.parseTagOffsetRef(text);
  if (parsed.isTagOffsetRef && parsed.tag) {
    advancedBaseTag.value = parsed.tag;
    offsetH.value = parsed.offset.h;
    offsetL.value = parsed.offset.l;
    offsetS.value = parsed.offset.s;
    nextTick(() => {
      advancedSyncing.value = false;
    });
    return;
  }

  if (text in palette.value) {
    advancedBaseTag.value = text;
    offsetH.value = 0;
    offsetL.value = 0;
    offsetS.value = 0;
  } else {
    const targetColor =
      String(firstActiveTarget.value?.currentColorCss || "").trim() || text;
    const inferred = inferNearestTagOffsetFromColor(targetColor);
    if (inferred) {
      advancedBaseTag.value = inferred.tag;
      offsetH.value = inferred.offset.h;
      offsetL.value = inferred.offset.l;
      offsetS.value = inferred.offset.s;
    } else {
      resetAdvancedFields();
    }
  }
  nextTick(() => {
    advancedSyncing.value = false;
  });
}

const applyAdvancedRealtime = throttle(() => {
  if (advancedSyncing.value) return;
  if (!canApplyAdvanced.value) return;
  beginPaletteInteraction();
  const payload = {
    tag: advancedBaseTag.value,
    offset: {
      h: offsetH.value,
      l: offsetL.value,
      s: offsetS.value,
    },
  };
  const changed = store.applyDelta?.({
    type: "palette.applyTagOffset",
    payload,
  });
  if (changed === false) {
    store.applyTagOffsetToActivePaletteTargets(payload, { deferCommit: true });
  }
  schedulePaletteInteractionCommit();
}, 120);

watch([advancedBaseTag, offsetH, offsetL, offsetS], () => {
  applyAdvancedRealtime();
});

function syncPickerToActiveSelection() {
  if (activeTargets.value.length === 0) return;
  const first = activeTargets.value[0];
  // activeTargets contains resolved colors
  const css = first.currentColorCss;
  pickerSyncflag = true;
  if (css) pickerColor.value = css;
  nextTick(() => {
    pickerSyncflag = false;
  });
}

function syncPickerToColorValue(v) {
  const hex = extractPrimaryCssColor(v);
  pickerSyncflag = true;
  if (hex) pickerColor.value = hex;
  nextTick(() => {
    pickerSyncflag = false;
  });
}

/* ---------------- Actions ---------------- */

// Toggle "Edit Mode" for a tag
function toggleEditTagMode(tag) {
  if (editingTagId.value === tag) {
    exitTagEditMode();
  } else {
    editingTagId.value = tag;
  }
}

function exitTagEditMode() {
  editingTagId.value = null;
}

// Apply Tag to Selection
function applyTag(tag) {
  // If we were editing a tag, maybe we should stop?
  // Let's assume clicking a swatch means "I want to use this on my layer"
  if (editingTagId.value) exitTagEditMode();

  store.applyTagToActivePaletteTargets(tag);
  syncAdvancedFromSelection();
  // Force picker sync visually to show the resolved color
  const v = palette.value[tag];
  syncPickerToColorValue(v);
}

// Rename Tag (Direct Input)
async function onTagRename(oldTag, newNameRaw) {
  const newName = (newNameRaw || "").trim();
  if (!newName || newName === oldTag) {
    // Revert input visual if needed? Vue :value binding handles it on re-render usually,
    // but forcing a refresh might be needed if strictly equal.
    return;
  }

  if (palette.value[newName]) {
    await DialogService.alert(t("palette.messages.tagNameExists") || "Tag name exists");
    // Force UI revert
    return;
  }

  // Perform expensive rename (search and replace in all stacks)
  performRename(oldTag, newName);
}

function performRename(oldTag, newTag) {
  try {
    const ok = store.renamePaletteTagAndReferences(oldTag, newTag);
    if (!ok) return;

    if (editingTagId.value === oldTag) {
      editingTagId.value = newTag;
    }
  } catch (e) {
    console.error("Rename failed", e);
  }
}

// Delete Tag (with Undo Toast)
function handleDeleteTag(tag) {
  // Immediately delete the tag
  store.deletePaletteTag(tag);

  // Clear editing mode if this was the tag being edited
  if (editingTagId.value === tag) exitTagEditMode();

  // Show undo toast with 5 second window
  DialogService.showUndoToast({
    message: t("palette.messages.tagDeleted", { tag }),
    undoLabel: t("common.undo"),
    duration: 5000,
    onUndo: () => {
      store.undo();
    },
  });
}

/* ---------------- Saved Colors Logic ---------------- */

function applySavedColor(idx) {
  const color = savedColors.value[idx];
  store.applyColorToActivePaletteTargets(color);
  syncPickerToColorValue(color);
}

function addCurrentToSaved() {
  // Add whatever is in the picker
  const hex = normalizePickerOutput(pickerColor.value);
  if (hex) store.addSavedColor(hex);
}

function deleteSavedColor(idx) {
  store.deleteSavedColor(idx);

  // Show undo toast with 5 second window
  DialogService.showUndoToast({
    message: t("palette.messages.colorDeleted"),
    undoLabel: t("common.undo"),
    duration: 5000,
    onUndo: () => {
      store.undo();
    },
  });
}

function handleClearAllSaved() {
  // Immediately clear all saved colors
  if (store.clearSavedColors) {
    store.clearSavedColors();
  } else {
    // Fallback if store method is not available
    for (let i = savedColors.value.length - 1; i >= 0; i--) {
      store.deleteSavedColor(i);
    }
  }

  // Show undo toast with 5 second window
  DialogService.showUndoToast({
    message: t("palette.messages.allColorsDeletd"),
    undoLabel: t("common.undo"),
    duration: 5000,
    onUndo: () => {
      store.undo();
    },
  });
}

function createTagFromCurrent() {
  const hex = normalizePickerOutput(pickerColor.value);
  if (hex) store.createTagAndReplaceInStacks(hex);
}

function toggleAdvanced() {
  if (panel.workspaceMode === "easy" && collapsedAdvanced.value) {
    collapsedAdvanced.value = false;
    return;
  }
  collapsedAdvanced.value = !collapsedAdvanced.value;
}

function resetAdvancedOffset() {
  if (!canApplyAdvanced.value) return;
  offsetH.value = 0;
  offsetL.value = 0;
  offsetS.value = 0;
  store.resetTagOffsetToTag(advancedBaseTag.value);
}

function detachAdvancedToRaw() {
  if (!canDetachAdvanced.value) return;

  const currentText = String(firstActiveTarget.value?.currentColorText || "").trim();
  const parsedCurrent = PaletteService.parseTagOffsetRef(currentText);

  if (parsedCurrent.isTagOffsetRef) {
    store.detachTagOffsetToRaw({ ref: currentText });
    return;
  }

  if (advancedBaseTag.value) {
    const ref = PaletteService.formatTagOffsetRef(advancedBaseTag.value, {
      h: offsetH.value,
      l: offsetL.value,
      s: offsetS.value,
    });
    store.detachTagOffsetToRaw({ ref });
  }
}

function convertAdvancedToHls() {
  if (!canSuggestOffset.value) return;
  const targetText = String(firstActiveTarget.value?.currentColorText || "").trim();
  if (!targetText) return;

  const parsed = PaletteService.parseTagOffsetRef(targetText);
  if (parsed.isTagOffsetRef && parsed.tag) {
    advancedBaseTag.value = parsed.tag;
    offsetH.value = parsed.offset.h;
    offsetL.value = parsed.offset.l;
    offsetS.value = parsed.offset.s;
  } else {
    suggestOffsetFromCurrent();
  }

  if (!advancedBaseTag.value) return;
  store.applyTagOffsetToActivePaletteTargets({
    tag: advancedBaseTag.value,
    offset: {
      h: offsetH.value,
      l: offsetL.value,
      s: offsetS.value,
    },
  });
}

function suggestOffsetFromCurrent() {
  if (!canSuggestOffset.value) return;
  const targetText = String(firstActiveTarget.value?.currentColorText || "").trim();
  if (!targetText) return;

  const parsed = PaletteService.parseTagOffsetRef(targetText);
  if (parsed.isTagOffsetRef && parsed.tag) {
    advancedBaseTag.value = parsed.tag;
    offsetH.value = parsed.offset.h;
    offsetL.value = parsed.offset.l;
    offsetS.value = parsed.offset.s;
    return;
  }

  const baseColor = extractPrimaryCssColor(palette.value[advancedBaseTag.value]);
  let targetColor = targetText;

  if (targetText in palette.value) {
    targetColor = extractPrimaryCssColor(palette.value[targetText]);
  }

  const diff = getHlsOffsetBetweenColors(baseColor, targetColor);
  if (!diff.ok) return;

  offsetH.value = diff.offset.h;
  offsetL.value = diff.offset.l;
  offsetS.value = diff.offset.s;
}

function toggleSaved() {
  collapsedSaved.value = !collapsedSaved.value;
}
function toggleTags() {
  collapsedTags.value = !collapsedTags.value;
}

/* ---------------- Helpers ---------------- */

function normalizePickerOutput(val) {
  if (!val) return null;
  if (typeof val === "string") return val;
  if (val.hex) return val.hex;
  return String(val);
}

function extractPrimaryCssColor(v) {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.length ? String(v[0]) : null;
  return String(v);
}

function savedSwatchStyle(v) {
  const c = extractPrimaryCssColor(v);
  return c ? { background: c } : { background: "var(--color-bg-base, #fff)" };
}

function swatchStyle(tag) {
  const v = palette.value[tag];
  const c = extractPrimaryCssColor(v);
  return c
    ? { background: c }
    : {
        background: "transparent",
        border: "1px solid var(--color-border-base, #e2e8f0)",
      };
}

function valText(tag) {
  const v = palette.value[tag];
  return typeof v === "string" ? v : JSON.stringify(v);
}

function savedText(v) {
  return typeof v === "string" ? v : JSON.stringify(v);
}
</script>

<style scoped>
.palette-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  max-width: 100%;
  background: var(--color-bg-base, #fff);
  font-family: "Segoe UI", sans-serif;
  color: var(--color-text-primary, #0f172a);
  overflow: hidden;
}

/* --- Mode Indicator Bar (MD3 Style) --- */
.mode-indicator-bar {
  flex: 0 0 auto;
  background: var(--color-bg-surface, #f8fafc);
  border-bottom: 2px solid var(--color-border-light, #f1f5f9);
  padding: 8px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
  font-size: 13px;
}

.mode-indicator-bar.is-editing-tag {
  background: rgba(217, 70, 239, 0.08);
  border-bottom-color: #d946ef;
  box-shadow: 0 1px 3px rgba(217, 70, 239, 0.15);
}

.mode-status {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
}

.mode-label {
  font-weight: 500;
  color: var(--color-text-primary, #0f172a);
  font-size: 12px;
}

.mode-label.editing {
  color: #d946ef;
  font-weight: 600;
}

.mode-label strong {
  color: #d946ef;
  font-weight: 700;
}

.mode-actions {
  display: flex;
  gap: 4px;
}

.exit-btn {
  padding: 4px 12px;
  background: #d946ef;
  color: white;
  border: none;
  border-radius: var(--radius-xs, 4px);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.1s;
}

.exit-btn:hover {
  background: #c335d9;
  box-shadow: 0 2px 4px rgba(217, 70, 239, 0.3);
}

.exit-btn:active {
  background: #b324c4;
}

/* --- Picker Section --- */
.picker-section {
  flex: 0 0 auto;
  border-bottom: 1px solid var(--color-border-light, #f1f5f9);
  padding-bottom: 10px;
  background: var(--color-bg-surface, #f8fafc);
  position: relative;
  transition: background 0.3s;
}

.picker-section.editing-tag-mode {
  background: rgba(217, 70, 239, 0.05);
  border-bottom-color: rgba(217, 70, 239, 0.2);
}

.picker-wrapper {
  padding: 6px;
  display: flex;
  justify-content: center;
  transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
  border: 2px solid transparent;
  border-radius: var(--radius-md, 8px);
  margin: 0 auto;
  max-width: 100%;
}

.picker-wrapper.editing-mode {
  border-color: #d946ef;
  box-shadow: 0 2px 8px rgba(217, 70, 239, 0.2);
}

/* Vue Color override - 适配 260px 容器宽度 */
.vc-sketch-custom {
  box-shadow: none !important;
  border: 1px solid var(--color-border-base, #e2e8f0);
  border-radius: var(--radius-sm, 6px);
  background: var(--color-bg-base, #fff);
  width: 100% !important;
  max-width: 240px !important;
}

.quick-actions {
  display: flex;
  gap: 6px;
  padding: 0 8px;
  margin-top: 4px;
}

.action-btn {
  flex: 1;
  padding: 6px 4px;
  border: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-base, #fff);
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  color: var(--color-text-secondary, #475569);
  transition: all 0.1s;
}

.action-btn:hover:not(:disabled) {
  background: var(--color-bg-hover, #f1f5f9);
  border-color: var(--color-border-strong, #cbd5e1);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  color: var(--color-text-muted, #94a3b8);
}

.action-btn:disabled span {
  color: inherit;
}

.action-btn span {
  font-weight: bold;
  color: var(--color-selection-single, #417aed);
}

.action-btn:disabled span {
  color: var(--color-text-muted, #94a3b8);
}

/* --- Responsive Design --- */

/* 响应式样式已移除 - 容器宽度固定为 260px */
/* 所有样式针对固定容器优化 */

/* --- Content --- */
.palette-content {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.section-block {
  margin-bottom: 16px;
}

.section-header {
  display: flex;
  align-items: center;
  padding: 6px 0;
  cursor: pointer;
  user-select: none;
  color: var(--color-text-secondary, #475569);
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid var(--color-border-light, #f1f5f9);
  margin-bottom: 8px;
}

.arrow {
  width: 16px;
}

.sec-title {
  flex: 1;
  color: var(--color-text-primary, #0f172a);
  font-size: 13px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  color: var(--color-text-tertiary, #64748b);
  font-weight: 400;
  font-size: 12px;
  margin-right: 8px;
}

.section-icon {
  margin-right: 6px;
  font-size: 16px;
  flex-shrink: 0;
}

/* Saved Colors Section Styling */
.saved-section .section-header {
  border-bottom: 2px solid #2563eb;
}

.saved-section .section-description {
  font-size: 11px;
  color: var(--color-text-tertiary, #64748b);
  padding: 4px 0 6px;
  font-style: italic;
}

.saved-section .empty-state {
  background: rgba(37, 99, 235, 0.08);
  border-radius: var(--radius-md, 8px);
  padding: 16px;
  text-align: center;
}

/* Tags Section Styling */
.tags-section .section-header {
  border-bottom: 2px solid #d946ef;
}

.tags-section .section-description {
  font-size: 11px;
  color: var(--color-text-tertiary, #64748b);
  padding: 4px 0 6px;
}

.tags-section .empty-state {
  background: rgba(217, 70, 239, 0.08);
  border-radius: var(--radius-md, 8px);
  padding: 16px;
  text-align: center;
}

.advanced-section .section-header {
  border-bottom: 2px solid var(--color-selection-single, #417aed);
}

.advanced-body {
  border: 1px solid var(--color-border-light, #f1f5f9);
  border-radius: var(--radius-sm, 6px);
  padding: 8px;
  background: var(--color-bg-base, #fff);
}

.advanced-summary {
  font-size: 11px;
  color: var(--color-text-tertiary, #64748b);
  margin-bottom: 8px;
}

.advanced-row {
  margin-bottom: 8px;
}

.advanced-label {
  font-size: 11px;
  color: var(--color-text-secondary, #475569);
  margin-right: 6px;
}

.advanced-select {
  width: 100%;
  border: 1px solid var(--color-border-base, #e2e8f0);
  border-radius: var(--radius-xs, 4px);
  padding: 5px 6px;
  font-size: 12px;
  background: var(--color-bg-base, #fff);
  color: var(--color-text-primary, #0f172a);
}

.advanced-slider-label {
  display: block;
  font-size: 11px;
  color: var(--color-text-secondary, #475569);
  margin-bottom: 4px;
}

.advanced-slider {
  width: 100%;
}

.advanced-buttons {
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
}

.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.advanced-chip {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 999px;
  border: 1px solid var(--color-border-base, #e2e8f0);
  color: var(--color-text-secondary, #475569);
  background: var(--color-bg-surface, #f8fafc);
}

.advanced-chip.type-tag-offset {
  border-color: var(--color-selection-single, #417aed);
  color: var(--color-selection-single, #417aed);
}

.advanced-color-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 165px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-surface, #f8fafc);
}

.advanced-color-dot {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  flex-shrink: 0;
}

.advanced-color-text {
  font-size: 11px;
  color: var(--color-text-secondary, #475569);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Empty State Common Styles */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.empty-icon {
  font-size: 32px;
  opacity: 0.6;
}

.empty-text {
  font-size: 12px;
  color: var(--color-text-secondary, #475569);
  max-width: 200px;
  line-height: 1.4;
  font-weight: 500;
}

.empty-cta {
  margin-top: 4px;
  padding: 6px 12px;
  border: 1px solid var(--color-selection-single, #417aed);
  background: var(--color-selection-single, #417aed);
  color: white;
  border-radius: var(--radius-sm, 6px);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.1s;
}

.empty-cta:hover {
  background: #3366d6;
  border-color: #3366d6;
  box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2);
}

.clear-btn {
  font-size: 11px;
  color: var(--color-error, #ef4444);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
}

.clear-btn:hover {
  background: var(--color-error-bg, #fee2e2);
  border-radius: var(--radius-xs, 4px);
}

/* --- Saved Colors Grid --- 适配 260px 容器 */
.saved-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  padding: 8px;
}

.saved-swatch-item {
  width: 100%;
  aspect-ratio: 1;
  min-height: 32px;
  border-radius: var(--radius-xs, 4px);
  border: 1px solid var(--color-border-base, #e2e8f0);
  cursor: pointer;
  position: relative;
  overflow: hidden;
}

.saved-swatch-item:hover {
  transform: scale(1.05);
  box-shadow: var(--shadow-md);
  z-index: 1;
}

.swatch-bg {
  display: block;
  width: 100%;
  height: 100%;
}

.delete-overlay {
  position: absolute;
  top: 0px;
  right: 2px;
  left: auto;
  bottom: auto;

  color: var(--color-error, #ef4444);

  display: flex;
  align-items: center;
  justify-content: top;

  font-size: 12px;
  line-height: 1;

  cursor: pointer;

  opacity: 0;
  transition: opacity 0.1s, background 0.1s;
}

.saved-swatch-item:hover .delete-overlay {
  opacity: 1;
}

/* --- Tags List --- */
.tags-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tag-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid transparent;
  background: var(--color-bg-base, #fff);
  transition: all 0.1s;
}

.tag-row:hover {
  background: var(--color-bg-surface, #f8fafc);
  border-color: var(--color-border-light, #f1f5f9);
}

.tag-row.is-editing {
  background: var(--color-warning-bg, rgba(245, 158, 11, 0.15));
  border-color: var(--color-warning, #f59e0b);
}

.tag-swatch-col {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  cursor: pointer;
}

.tag-swatch {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-xs, 4px);
  border: 1px solid var(--color-border-base, #e2e8f0);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
}

.tag-name-col {
  flex: 1;
  min-width: 0;
}

.tag-name-input {
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  font-size: 13px;
  color: var(--color-text-primary, #0f172a);
  padding: 2px 4px;
  border-radius: var(--radius-xs, 4px);
  font-weight: 600;
}

.tag-name-input:focus {
  border-color: var(--color-selection-single, #417aed);
  background: var(--color-bg-base, #fff);
  outline: none;
}

/* If editing, make input dimmer to show it's not the focus? No, keep it editable. */

.tag-val-col {
  font-size: 11px;
  color: var(--color-text-tertiary, #64748b);
  flex: 0 1 auto;
  min-width: 60px;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-usage-badge {
  font-size: 10px;
  background: var(--md3-outline-variant, #cbd5e1);
  color: var(--color-text-inverse, #fff);
  padding: 2px 6px;
  border-radius: 10px;
  min-width: 24px;
  text-align: center;
  flex-shrink: 0;
  font-weight: 600;
}

.tag-actions {
  display: flex;
  gap: 4px;
  opacity: 0.2;
  /* Hide by default to reduce clutter */
  transition: opacity 0.2s;
}

.tag-row:hover .tag-actions,
.tag-row.is-editing .tag-actions {
  opacity: 1;
}

.icon-action {
  width: 24px;
  height: 24px;
  border: 1px solid var(--color-border-light, #f1f5f9);
  background: var(--color-bg-base, #fff);
  border-radius: var(--radius-xs, 4px);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--color-text-secondary, #475569);
  font-size: 12px;
}

.icon-action:hover {
  background: var(--color-bg-hover, #f1f5f9);
  color: var(--color-text-primary, #0f172a);
}

.icon-action.active {
  background: var(--color-warning, #f59e0b);
  color: var(--color-text-inverse, #fff);
  border-color: var(--color-warning, #f59e0b);
}

.icon-action.danger:hover {
  background: var(--color-error-bg, #fee2e2);
  color: var(--color-error, #ef4444);
  border-color: var(--color-error, #ef4444);
}

.empty-msg {
  font-size: 12px;
  color: var(--color-text-muted, #94a3b8);
  font-style: italic;
  padding: 8px;
  text-align: center;
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
