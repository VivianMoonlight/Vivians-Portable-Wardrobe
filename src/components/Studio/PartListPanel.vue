<template>
  <div
    class="partlist-panel"
    role="region"
    :aria-label="t('partList.ariaLabel')"
    ref="rootEl"
  >
    <div class="header">
      <h4>{{ t("partList.title") }}</h4>

      <!-- All-level controls: eye (toggle all visibility for selected element) and delete (click once to arm, click again to confirm) -->
      <div class="header-controls">
        <button
          class="icon-btn eye-btn"
          :class="{ active: isAllVisible }"
          :disabled="!hasSelected"
          @click="toggleAllVisibility"
          :title="t('partList.toggleAllVisibilityTitle')"
        >
          {{ isAllVisible ? "👁" : "—" }}
        </button>

        <button
          class="icon-btn delete-btn"
          :class="{ armed: armedAll }"
          :disabled="!hasSelected"
          @click.stop="armAllDelete"
          data-delete-button
          data-delete-key="__ALL__"
          :title="t('partList.armAllTitle')"
        >
          {{ armedAll ? "⚠" : "✖" }}
        </button>
      </div>
    </div>

    <!-- Search / controls -->
    <div class="controls">
      <input
        v-model="searchTerm"
        type="search"
        :placeholder="t('partList.searchPlaceholder')"
        class="search"
        @input="onSearchInput"
      />
      <div class="control-buttons">
        <button @click="expandAll" :disabled="!hasGroups">
          {{ t("partList.expandAll") }}
        </button>
        <button @click="collapseAll" :disabled="!hasGroups">
          {{ t("partList.collapseAll") }}
        </button>
      </div>
    </div>

    <div class="toggle-row">
      <label class="toggle-label">
        <input type="checkbox" v-model="showHiddenGroups" />
        <span>{{ t("partList.showHiddenGroups") }}</span>
      </label>
      <label class="toggle-label">
        <input type="checkbox" v-model="showEmptySlots" />
        <span>{{ t("partList.showEmptySlots") }}</span>
      </label>
    </div>

    <div class="body scrollable">
      <div v-if="!hasSelected" class="placeholder">
        {{ t("partList.noSelectionPlaceholder") }}
      </div>

      <div v-else class="groups modern-layout">
        <aside class="group-rail">
          <button
            v-for="entry in groupEntries"
            :key="entry.gid"
            class="group-rail-item"
            :class="{
              active: entry.gid === activeGroupId,
              hidden: isHiddenGroup(entry.gid),
            }"
            @click="setActiveGroup(entry.gid)"
          >
            <span class="group-rail-label">{{ getGroupDisplayName(entry.gid) }}</span>
            <span class="group-rail-count"
              >{{ entry.groupData.parts.length }}/{{ entry.groupData.totalSlots }}</span
            >
          </button>
        </aside>

        <section class="group-detail" v-if="activeGroupData">
          <div class="group-header sticky">
            <div class="title">
              <span class="gid">{{ getGroupDisplayName(activeGroupId) }}</span>
              <span v-if="isHiddenGroup(activeGroupId)" class="hidden-badge">{{
                t("partList.hiddenBadge")
              }}</span>
              <span class="count"
                >({{ activeGroupData.parts.length }} /
                {{ activeGroupData.totalSlots }})</span
              >
            </div>

            <div class="group-controls">
              <button
                class="icon-btn eye-btn"
                :class="{ active: isGroupVisible(activeGroupId) }"
                :disabled="!hasSelected"
                @click.stop="toggleGroupVisibility(activeGroupId)"
                :title="t('partList.groupToggleVisibilityTitle')"
              >
                {{ isGroupVisible(activeGroupId) ? "👁" : "—" }}
              </button>

              <button
                class="icon-btn delete-btn"
                :class="{ armed: isGroupArmed(activeGroupId) }"
                :disabled="!hasSelected"
                @click.stop="armGroupDelete(activeGroupId)"
                data-delete-button
                :data-delete-key="`GROUP::${activeGroupId}`"
                :title="t('partList.groupDeleteTitle')"
              >
                {{ isGroupArmed(activeGroupId) ? "⚠" : "✖" }}
              </button>
            </div>
          </div>

          <div
            v-for="row in activeGroupRows"
            :key="row.key"
            class="part-row"
            :data-slot-key="row.key"
            :class="{
              active: row.type === 'part' ? isFocused(row.part) : isFocusedSlot(row.slot),
              'empty-slot': row.type === 'empty',
              clickable: row.type === 'empty',
              highlighted: highlightedSlotKey === row.key,
            }"
            @click="
              row.type === 'part'
                ? focusPart(row.part)
                : enterReplaceForEmptySlot(row.slot, activeGroupId)
            "
            @mouseenter="row.type === 'part' ? onPartRowMouseEnter(row.part) : null"
            @mouseleave="row.type === 'part' ? onPartRowMouseLeave() : null"
          >
            <div class="row-content">
              <div class="left-col">
                <div class="slot-name">{{ row.slotLabel }}</div>
                <div
                  class="item-name"
                  :class="{ empty: row.type === 'empty' }"
                  :title="row.itemLabel"
                >
                  {{ row.itemLabel }}
                </div>
              </div>

              <div
                class="part-controls"
                v-if="row.type === 'part'"
                @mouseenter="onPartControlsMouseEnter"
                @mouseleave="onPartControlsMouseLeave"
              >
                <button
                  class="icon-btn replace-btn"
                  :class="{
                    active: isPartReplaceArmed(row.part, row.idx, activeGroupId),
                  }"
                  @click.stop="toggleReplaceForPart(row.part, row.idx, activeGroupId)"
                  :title="t('partList.partReplaceTitle')"
                >
                  ⇄
                </button>

                <button
                  class="icon-btn eye-btn"
                  :class="{ active: isPartVisible(row.part) }"
                  @click.stop="togglePartVisibility(row.part)"
                  :disabled="!hasSelected"
                  :title="t('partList.partVisibilityTitle')"
                >
                  {{ isPartVisible(row.part) ? "👁" : "—" }}
                </button>

                <button
                  class="icon-btn delete-btn"
                  :class="{ armed: isPartArmed(row.part, row.idx, activeGroupId) }"
                  @click.stop="armPartDelete(row.part, row.idx, activeGroupId)"
                  data-delete-button
                  :data-delete-key="partUniqueKey(row.part, row.idx, activeGroupId)"
                  :title="t('partList.partDeleteTitle')"
                >
                  {{ isPartArmed(row.part, row.idx, activeGroupId) ? "⚠" : "✖" }}
                </button>
              </div>
            </div>
          </div>

          <div v-if="activeGroupRows.length === 0" class="muted">
            {{ t("partList.emptyGroupLabel") }}
          </div>
        </section>

        <div v-if="groupEntries.length === 0" class="placeholder">
          {{ t("partList.noMatch") }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { useStudioDomainStores } from "@/stores/studio";
import { createStudioSelectionBridge } from "@/stores/studio/selectionBridge";
import {
  classifyToGroup,
  isHiddenGroup as checkIsHiddenGroup,
  getGroupDisplayName as getDisplayName,
  getAllGroupIDs,
} from "@/config/filterGroupConfig";
import { AssetApi } from "@/utils/AssetApi";
import * as Palette from "@/services/PaletteService";
import { hostWindow, doc } from "@/utils/host-window.js";
import { throttle } from "@/utils/performance.js";

const { t } = useI18n();
const { studio: store, selection } = useStudioDomainStores();
const selectionBridge = createStudioSelectionBridge(store, selection);
const emit = defineEmits(["part-focused"]);
const selected = computed(() => store.selectedElement);
const hasSelected = computed(
  () => !!selected.value && Array.isArray(selected.value.data)
);

// root element ref for global click handling
const rootEl = ref(null);

// UI state
const searchQueryRaw = ref("");
const searchTerm = searchQueryRaw; // keep original var name used by template
const collapsed = ref(new Set()); // set of groupIDs that are collapsed
const showHiddenGroups = ref(false); // 是否显示隐藏分组
const showEmptySlots = ref(true); // 是否显示空槽位
const activeGroupId = ref(null);
const activeSlotKey = ref(null);
const highlightedSlotKey = ref(null);
const highlightTimerId = ref(null);

// Armed / UI states for delete actions (delete arms kept local)
const armedParts = ref(new Set()); // keys for parts prepared to delete (only one active at a time by behavior)
const armedGroups = ref(new Set()); // groupIDs prepared to delete (only one)
const armedAll = ref(false); // prepared to delete entire selection

// hover blink state (part list -> preview visibility flashing)
const partHoverBlinkTimerId = ref(null);
const partHoverBlinkRafId = ref(null); // ✅ Add requestAnimationFrame ID
const partHoverBlinkState = ref(null);
const hoveredPartForBlink = ref(null);
const partHoverBlinkSuppressedByControls = ref(false);
const partHoverBlinkSuppressUntil = ref(0);
const partHoverBlinkResumeTimerId = ref(null);
const PART_HOVER_PREVIEW_ID = "part-hover-blink";
const DISABLE_PART_HOVER_BLINK = true;

/* ----------------------
   Helpers for keys
   ---------------------- */
function partUniqueKey(p, idx, gid) {
  // create a stable key using group id, slot name and index
  const slot =
    (p &&
      (p.Group ||
        (p.Asset && p.Asset.Group && (p.Asset.Group.Name || p.Asset.Group.name)))) ||
    "";
  const name = (p && (p.Name || p.Asset?.Name)) || "";
  return `${gid}::${slot}::${name}::${idx}`;
}
function emptySlotKey(slot, gid) {
  return `${gid}::empty::${slot?.Name || slot?.Name}`;
}

/* ----------------------
   Search / collapse helpers
   ---------------------- */
function onSearchInput() {
  if (!searchTerm.value) return;
  for (const gid of Object.keys(displayGrouped.value || {})) {
    const groupData = displayGrouped.value[gid];
    if (!groupData) continue;
    const parts = groupData.parts || [];
    const slots = groupData.emptySlots || [];
    const matchedPart = parts.some((p) =>
      store.matchesSearchForPart ? store.matchesSearchForPart(p, searchTerm.value) : true
    );
    const matchedSlot = slots.some((slot) =>
      `${slot?.Description || ""} ${slot?.Name || ""}`
        .toLowerCase()
        .includes(String(searchTerm.value).toLowerCase())
    );
    if ((matchedPart || matchedSlot) && !activeGroupId.value) {
      activeGroupId.value = gid;
      break;
    }
  }
}

function expandAll() {
  collapsed.value = new Set();
}
function collapseAll() {
  collapsed.value = new Set(Object.keys(grouped.value || {}));
}
function toggleGroup(gid) {
  if (collapsed.value.has(gid)) {
    collapsed.value.delete(gid);
  } else {
    collapsed.value.add(gid);
  }
}
function isCollapsed(gid) {
  return collapsed.value.has(gid);
}

// 使用统一配置的分组工具函数
function isHiddenGroup(gid) {
  return checkIsHiddenGroup(gid);
}

function getGroupDisplayName(gid) {
  return getDisplayName(gid);
}

// 使用统一的分类函数
function classifyGroup(part) {
  if (!part) return "Appearance";

  const rawGroup = store.findAssetGroupEntryForPart
    ? store.findAssetGroupEntryForPart(part)
    : null;

  return classifyToGroup(rawGroup && rawGroup.data ? rawGroup.data : null);
}

// 获取所有可用的槽位信息（从 studioStore 的 assetGroupsRaw 中获取）
function getAllSlotsForGroup(groupID) {
  const assetGroups = (store.assetGroupsRaw || []).map((g) => g.data) || [];
  const slots = [];

  for (const group of assetGroups) {
    if (!group || !group.Name) continue;
    const gid = classifyToGroup({
      Name: group.Name,
      BodyCosplay: group.BodyCosplay,
      Category: group.Category,
    });
    if (gid === groupID) {
      slots.push({
        Name: group.Name,
        Description: group.Description || group.Name,
        BodyCosplay: group.BodyCosplay,
        Category: group.Category,
      });
    }
  }

  return slots;
}

// 获取 part 所属的槽位名称
function getPartSlotName(part) {
  const rawGroup = store.findAssetGroupEntryForPart
    ? store.findAssetGroupEntryForPart(part)
    : null;
  if (rawGroup && rawGroup.data) {
    return rawGroup.data.Name || rawGroup.data.name || "";
  }
  return "";
}

const grouped = computed(() => {
  const out = {};
  if (!hasSelected.value) return out;
  const parts = selected.value.data || [];

  // 首先收集所有已使用的槽位
  const usedSlots = new Map(); // slotName -> [parts]

  for (const p of parts) {
    const gid = classifyGroup(p);
    const slotName = getPartSlotName(p);

    if (!out[gid]) {
      out[gid] = {
        parts: [],
        allSlots: getAllSlotsForGroup(gid),
        emptySlots: [],
        totalSlots: 0,
      };
    }
    out[gid].parts.push(p);

    if (slotName) {
      if (!usedSlots.has(gid)) {
        usedSlots.set(gid, new Set());
      }
      usedSlots.get(gid).add(slotName);
    }
  }

  // 计算空槽位
  for (const gid of Object.keys(out)) {
    const groupData = out[gid];
    const usedSet = usedSlots.get(gid) || new Set();

    groupData.emptySlots = groupData.allSlots.filter((slot) => !usedSet.has(slot.Name));
    groupData.totalSlots = groupData.allSlots.length;
  }

  // 如果需要显示空槽位，也需要添加完全为空的分组
  if (showEmptySlots.value) {
    const allGroupIDs = getAllGroupIDs();
    for (const gid of allGroupIDs) {
      if (!out[gid]) {
        const allSlots = getAllSlotsForGroup(gid);
        if (allSlots.length > 0) {
          out[gid] = {
            parts: [],
            allSlots: allSlots,
            emptySlots: allSlots,
            totalSlots: allSlots.length,
          };
        }
      }
    }
  }

  // 按优先级排序
  const allGroupIDs = getAllGroupIDs();
  const ordered = {};
  for (const k of allGroupIDs) {
    if (out[k]) ordered[k] = out[k];
  }
  // 添加不在预定义列表中的分组
  for (const k of Object.keys(out)) {
    if (!ordered[k]) ordered[k] = out[k];
  }
  return ordered;
});

// 根据 showHiddenGroups 过滤显示的分组
const visibleGrouped = computed(() => {
  const out = {};
  for (const [gid, groupData] of Object.entries(grouped.value)) {
    if (!checkIsHiddenGroup(gid)) {
      out[gid] = groupData;
    }
  }
  return out;
});

const filteredGrouped = computed(() => {
  const source = showHiddenGroups.value ? grouped.value : visibleGrouped.value;
  const out = {};
  if (!hasSelected.value) return out;
  const term = searchTerm.value && searchTerm.value.trim().toLowerCase();

  for (const [gid, groupData] of Object.entries(source)) {
    if (!groupData) continue;

    const filteredParts = term
      ? groupData.parts.filter((p) =>
          store.matchesSearchForPart ? store.matchesSearchForPart(p, term) : true
        )
      : groupData.parts.slice();

    // 过滤空槽位（如果有搜索词）
    const filteredEmptySlots = term
      ? groupData.emptySlots.filter((slot) => {
          const slotText = (slot.Description || slot.Name || "").toLowerCase();
          return slotText.includes(term);
        })
      : groupData.emptySlots.slice();

    out[gid] = {
      ...groupData,
      parts: filteredParts,
      emptySlots: filteredEmptySlots,
    };
  }

  if (term) {
    const pruned = {};
    for (const [k, v] of Object.entries(out)) {
      if (
        (v.parts && v.parts.length > 0) ||
        (showEmptySlots.value && v.emptySlots && v.emptySlots.length > 0)
      ) {
        pruned[k] = v;
      }
    }
    return pruned;
  }
  return out;
});

// 最终用于显示的分组
const displayGrouped = computed(() => filteredGrouped.value);
const groupEntries = computed(() =>
  Object.entries(displayGrouped.value || {}).map(([gid, groupData]) => ({
    gid,
    groupData,
  }))
);
const hasGroups = computed(() => groupEntries.value.length > 0);

function slotKeyByNames(gid, slotName) {
  return `${gid}::slot::${slotName || ""}`;
}

function parseSlotKey(slotKey) {
  const [gid, , slotName] = String(slotKey || "").split("::");
  return { gid: gid || "", slotName: slotName || "" };
}

const activeGroupData = computed(() => {
  const gid = activeGroupId.value;
  if (!gid) return null;
  return displayGrouped.value?.[gid] || null;
});

const activeGroupRows = computed(() => {
  const gid = activeGroupId.value;
  const groupData = activeGroupData.value;
  if (!gid || !groupData) return [];

  const rows = [];
  for (let idx = 0; idx < (groupData.parts || []).length; idx++) {
    const part = groupData.parts[idx];
    const slotName = getPartSlotName(part);
    rows.push({
      key: slotKeyByNames(gid, slotName || `part-${idx}`),
      gid,
      type: "part",
      idx,
      part,
      slot: null,
      slotName,
      slotLabel: partGroupDescription(part),
      itemLabel: partDescription(part),
      groupLabel: getGroupDisplayName(gid),
    });
  }

  if (showEmptySlots.value) {
    for (const slot of groupData.emptySlots || []) {
      const slotName = slot?.Name || "";
      rows.push({
        key: slotKeyByNames(gid, slotName),
        gid,
        type: "empty",
        idx: -1,
        part: null,
        slot,
        slotName,
        slotLabel: slot.Description || slot.Name || t("partList.emptySlotLabel"),
        itemLabel: t("partList.emptySlotLabel"),
        groupLabel: getGroupDisplayName(gid),
      });
    }
  }

  return rows;
});

const slotJumpIndex = computed(() => {
  const entries = [];
  for (const [gid, groupData] of Object.entries(grouped.value || {})) {
    if (!showHiddenGroups.value && checkIsHiddenGroup(gid)) continue;

    for (let idx = 0; idx < (groupData.parts || []).length; idx++) {
      const part = groupData.parts[idx];
      const slotName = getPartSlotName(part);
      entries.push({
        key: slotKeyByNames(gid, slotName || `part-${idx}`),
        gid,
        type: "part",
        idx,
        part,
        slot: null,
        slotName,
        slotLabel: partGroupDescription(part),
        itemLabel: partDescription(part),
        groupLabel: getGroupDisplayName(gid),
        searchText: `${getGroupDisplayName(gid)} ${partGroupDescription(
          part
        )} ${partDescription(part)} used`.toLowerCase(),
      });
    }

    if (showEmptySlots.value) {
      for (const slot of groupData.emptySlots || []) {
        const slotName = slot?.Name || "";
        const slotLabel = slot.Description || slot.Name || t("partList.emptySlotLabel");
        entries.push({
          key: slotKeyByNames(gid, slotName),
          gid,
          type: "empty",
          idx: -1,
          part: null,
          slot,
          slotName,
          slotLabel,
          itemLabel: t("partList.emptySlotLabel"),
          groupLabel: getGroupDisplayName(gid),
          searchText: `${getGroupDisplayName(
            gid
          )} ${slotLabel} ${slotName} empty`.toLowerCase(),
        });
      }
    }
  }
  return entries;
});

function setActiveGroup(gid) {
  if (!gid) return;
  activeGroupId.value = gid;
}

function setHighlightedSlot(slotKey) {
  highlightedSlotKey.value = slotKey || null;
  if (highlightTimerId.value !== null) {
    hostWindow.clearTimeout(highlightTimerId.value);
  }
  if (!slotKey) return;
  highlightTimerId.value = hostWindow.setTimeout(() => {
    highlightedSlotKey.value = null;
    highlightTimerId.value = null;
  }, 1300);
}

function ensureSlotVisible(slotKey) {
  if (!rootEl.value || !slotKey) return;
  hostWindow.requestAnimationFrame(() => {
    const target = rootEl.value.querySelector(`[data-slot-key="${slotKey}"]`);
    if (target && target.scrollIntoView) {
      target.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
}

function jumpToResult(result) {
  if (!result) return;
  if (checkIsHiddenGroup(result.gid) && !showHiddenGroups.value) {
    showHiddenGroups.value = true;
  }
  activeGroupId.value = result.gid;
  activeSlotKey.value = result.key;
  if (result.type === "part") {
    focusPart(result.part);
  } else {
    enterReplaceForEmptySlot(result.slot, result.gid);
  }
  setHighlightedSlot(result.key);
  ensureSlotVisible(result.key);
}

function jumpByGroupStep(step) {
  const entries = groupEntries.value;
  if (entries.length === 0) return;
  const currentIndex = Math.max(
    0,
    entries.findIndex((item) => item.gid === activeGroupId.value)
  );
  const nextIndex = Math.min(entries.length - 1, Math.max(0, currentIndex + step));
  activeGroupId.value = entries[nextIndex].gid;
}

function jumpByRowStep(step) {
  const rows = activeGroupRows.value;
  if (rows.length === 0) return;
  const currentIndex = Math.max(
    0,
    rows.findIndex((item) => item.key === activeSlotKey.value)
  );
  const nextIndex = Math.min(rows.length - 1, Math.max(0, currentIndex + step));
  jumpToResult(rows[nextIndex]);
}

function onPanelKeydown(event) {
  if (!hasSelected.value) return;
  const key = event.key;

  if (key === "[") {
    event.preventDefault();
    jumpByGroupStep(-1);
    return;
  }
  if (key === "]") {
    event.preventDefault();
    jumpByGroupStep(1);
    return;
  }
  if (event.altKey && key === "ArrowUp") {
    event.preventDefault();
    jumpByRowStep(-1);
    return;
  }
  if (event.altKey && key === "ArrowDown") {
    event.preventDefault();
    jumpByRowStep(1);
  }
}

function partDescription(p) {
  if (!p) return t("partList.unnamed");
  const asset = store.resolveAssetForPart ? store.resolveAssetForPart(p) : null;
  if (asset)
    return asset.Description || asset.Desc || asset.description || t("partList.unnamed");
  const groupDesc = store.getGroupDescriptionForPart
    ? store.getGroupDescriptionForPart(p)
    : null;
  return (
    groupDesc ||
    p.Asset?.Description ||
    p.Asset?.Group?.Description ||
    t("partList.unnamed")
  );
}

function partGroupDescription(p) {
  if (!p) return t("partList.noGroup");
  const entry = store.findAssetGroupEntryForPart
    ? store.findAssetGroupEntryForPart(p)
    : null;
  const rawGroup = entry && entry.data ? entry.data : null;
  if (rawGroup) {
    return rawGroup.Description || rawGroup.Name || t("partList.noGroup");
  }
  return p.Asset?.Group?.Description || p.Asset?.Group?.Name || t("partList.noGroup");
}

// focus handling
function focusPart(part) {
  clearPartHoverBlinkState();
  // focusing a part cancels replace mode (mutual exclusivity)
  if (store.focusPart) {
    store.focusPart(part);
    emit("part-focused");
  }
  // store.focusPart clears replaceTarget already
}

function isFocused(part) {
  if (!store.focusedPart) return false;
  try {
    return JSON.stringify(store.focusedPart) === JSON.stringify(part);
  } catch (e) {
    return store.focusedPart === part;
  }
}

/* -------------------------
   Empty slot selection support
   ------------------------- */

function enterReplaceForEmptySlot(slot, gid) {
  if (!slot) return;
  const placeholder = {
    Name: slot.Name,
    Description: slot.Description || slot.Name,
    Group: slot.Name,
  };
  const key = emptySlotKey(slot, gid);
  store.setReplaceTarget(placeholder, key, true);
}

function isFocusedSlot(slot) {
  if (!slot) return false;
  if (!store.focusedPart) return false;
  try {
    if (store.focusedPart.Name && store.focusedPart.Name === slot.Name) return true;
    return false;
  } catch (e) {
    return false;
  }
}

/* -------------------------
   Visibility helpers (eye button)
   Operate on selected element's filterList
   ------------------------- */

function _ensureFilterListForSelected() {
  if (!hasSelected.value) return null;
  const sel = selected.value;
  if (!sel.filterList || !Array.isArray(sel.filterList)) {
    // initialize to list of all slot names present in element.data
    const names = new Set();
    for (const p of sel.data || []) {
      const n = getPartSlotName(p);
      if (n) names.add(n);
    }
    const arr = Array.from(names);
    store.setSelectedStackFilterList(arr, { refresh: false });
    return arr;
  }
  return sel.filterList.slice();
}

function isPartVisible(part) {
  if (!hasSelected.value || !part) return true;
  const sel = selected.value;
  if (!sel.filterList || !Array.isArray(sel.filterList)) return true;
  const slotName = getPartSlotName(part);
  if (!slotName) return true;
  return sel.filterList.includes(slotName);
}

function _buildBlinkFilterList(baseList, slotName, visible) {
  const next = Array.isArray(baseList) ? baseList.slice() : [];
  const idx = next.indexOf(slotName);
  if (visible && idx === -1) next.push(slotName);
  if (!visible && idx !== -1) next.splice(idx, 1);
  return next;
}

function _collectVisibleSlotNamesForElement(element) {
  if (!element || !Array.isArray(element.data)) return [];
  const names = new Set();
  for (const p of element.data) {
    const n = getPartSlotName(p);
    if (n) names.add(n);
  }
  return Array.from(names);
}

function _buildHoverBlinkAppearance(context, visible) {
  if (!context) return null;
  const { stackIndex, slotName } = context;
  if (
    typeof stackIndex !== "number" ||
    stackIndex < 0 ||
    stackIndex >= store.stacks.length
  )
    return null;

  const renderStacks = (store.stacks || []).map((el, idx) => {
    const baseFilterList = Array.isArray(el?.filterList)
      ? el.filterList.slice()
      : _collectVisibleSlotNamesForElement(el);
    const nextFilterList =
      idx === stackIndex
        ? _buildBlinkFilterList(baseFilterList, slotName, visible)
        : baseFilterList;
    return {
      data: Array.isArray(el?.data) ? el.data : [],
      filterList: nextFilterList,
    };
  });

  const unexpanded = {
    data: AssetApi.stackOutfitData(renderStacks),
    type: "outfit",
  };
  return Palette.expandedAppearanceForRendering(unexpanded, store.paletteMap);
}

function _applyPartHoverBlinkFrame(context, visible) {
  const appearance = _buildHoverBlinkAppearance(context, visible);
  if (!appearance) return;
  // Route through centralized preview stack so hover-preview lifecycle is consistent.
  store.pushPreview(PART_HOVER_PREVIEW_ID, 0, appearance, "part-hover-blink");
}

function _clearPartHoverBlinkResumeTimer() {
  const timerId = partHoverBlinkResumeTimerId.value;
  if (timerId !== null) {
    hostWindow.clearTimeout(timerId);
    partHoverBlinkResumeTimerId.value = null;
  }
}

function _isPartHoverBlinkSuppressed() {
  return (
    partHoverBlinkSuppressedByControls.value ||
    Date.now() < partHoverBlinkSuppressUntil.value
  );
}

function _schedulePartHoverBlinkResumeIfNeeded() {
  if (DISABLE_PART_HOVER_BLINK) {
    _clearPartHoverBlinkResumeTimer();
    return;
  }
  _clearPartHoverBlinkResumeTimer();
  if (partHoverBlinkSuppressedByControls.value) return;
  if (!hoveredPartForBlink.value) return;

  const remain = partHoverBlinkSuppressUntil.value - Date.now();
  if (remain <= 0) {
    startPartHoverBlink(hoveredPartForBlink.value);
    return;
  }

  partHoverBlinkResumeTimerId.value = hostWindow.setTimeout(() => {
    partHoverBlinkResumeTimerId.value = null;
    if (!hoveredPartForBlink.value) return;
    if (_isPartHoverBlinkSuppressed()) {
      _schedulePartHoverBlinkResumeIfNeeded();
      return;
    }
    startPartHoverBlink(hoveredPartForBlink.value);
  }, remain);
}

function suspendPartHoverBlink(durationMs = 700) {
  if (DISABLE_PART_HOVER_BLINK) {
    _clearPartHoverBlinkResumeTimer();
    return;
  }
  const until = Date.now() + Math.max(0, durationMs);
  if (until > partHoverBlinkSuppressUntil.value) {
    partHoverBlinkSuppressUntil.value = until;
  }
  stopPartHoverBlink();
  _schedulePartHoverBlinkResumeIfNeeded();
}

function onPartRowMouseEnter(part) {
  if (isFocused(part)) {
    clearPartHoverBlinkState();
    return;
  }
  hoveredPartForBlink.value = part || null;
  if (!hoveredPartForBlink.value) return;
  if (_isPartHoverBlinkSuppressed()) {
    _schedulePartHoverBlinkResumeIfNeeded();
    return;
  }
  startPartHoverBlink(hoveredPartForBlink.value);
}

function onPartRowMouseLeave() {
  hoveredPartForBlink.value = null;
  _clearPartHoverBlinkResumeTimer();
  stopPartHoverBlink();
}

function onPartControlsMouseEnter() {
  partHoverBlinkSuppressedByControls.value = true;
  stopPartHoverBlink();
  _clearPartHoverBlinkResumeTimer();
}

function onPartControlsMouseLeave() {
  partHoverBlinkSuppressedByControls.value = false;
  if (!hoveredPartForBlink.value) return;
  if (_isPartHoverBlinkSuppressed()) {
    _schedulePartHoverBlinkResumeIfNeeded();
    return;
  }
  startPartHoverBlink(hoveredPartForBlink.value);
}

function startPartHoverBlink(part) {
  if (DISABLE_PART_HOVER_BLINK) {
    return;
  }
  if (!hasSelected.value || !part) return;

  // Don't start part blink if asset hover (higher priority) is active
  if (store.isPreviewActive && store.isPreviewActive("asset-hover")) return;

  const slotName = getPartSlotName(part);
  const stackIndex = store.selectedIndex;
  if (!slotName || stackIndex < 0) return;

  const current = partHoverBlinkState.value;
  if (current && current.stackIndex === stackIndex && current.slotName === slotName)
    return;

  stopPartHoverBlink();

  const context = {
    stackIndex,
    slotName,
    visible: true,
    startTime: Date.now(), // ✅ Record start time for calculation
    BLINK_INTERVAL: 260, // Blink cycle: 260ms on + 260ms off = 520ms total
  };
  partHoverBlinkState.value = context;

  // ✅ Use requestAnimationFrame + timestamp-based calculation instead of setInterval
  // This synchronizes with browser refresh rate and reduces unnecessary renders
  function updateBlinkFrame() {
    const latest = partHoverBlinkState.value;
    if (!latest) return;

    // Stop blinking if a higher priority preview (asset-hover) becomes active
    if (store.isPreviewActive && store.isPreviewActive("asset-hover")) {
      stopPartHoverBlink();
      return;
    }

    const elapsed = Date.now() - latest.startTime;
    const cyclePos = (elapsed % (latest.BLINK_INTERVAL * 2)) / latest.BLINK_INTERVAL;

    // cyclePos 0-1: visible, cyclePos 1-2: hidden
    latest.visible = cyclePos < 1;

    _applyPartHoverBlinkFrame(latest, latest.visible);

    // Continue animation only if still hovering
    partHoverBlinkRafId.value = hostWindow.requestAnimationFrame(updateBlinkFrame);
  }

  // Initial frame (hidden to start the blink effect)
  context.visible = false;
  _applyPartHoverBlinkFrame(context, context.visible);

  // Start RAF loop
  partHoverBlinkRafId.value = hostWindow.requestAnimationFrame(updateBlinkFrame);
}

function stopPartHoverBlink() {
  // ✅ Cancel requestAnimationFrame instead of clearInterval
  const rafId = partHoverBlinkRafId.value;
  if (rafId !== null) {
    hostWindow.cancelAnimationFrame(rafId);
    partHoverBlinkRafId.value = null;
  }

  // Keep old timer cleanup for backward compatibility
  const timerId = partHoverBlinkTimerId.value;
  if (timerId !== null) {
    hostWindow.clearInterval(timerId);
    partHoverBlinkTimerId.value = null;
  }

  const context = partHoverBlinkState.value;
  partHoverBlinkState.value = null;
  store.popPreview(PART_HOVER_PREVIEW_ID);
  if (!context) return;
}

function clearPartHoverBlinkState() {
  hoveredPartForBlink.value = null;
  partHoverBlinkSuppressedByControls.value = false;
  partHoverBlinkSuppressUntil.value = 0;
  _clearPartHoverBlinkResumeTimer();
  stopPartHoverBlink();
}

function togglePartVisibility(part) {
  if (!hasSelected.value || !part) return;
  suspendPartHoverBlink(700);
  const idx = store.selectedIndex;
  if (idx < 0) return;
  const slotName = getPartSlotName(part);
  if (!slotName) return;
  let fl = selected.value.filterList;
  if (!Array.isArray(fl)) {
    // initialize to all present
    fl = _ensureFilterListForSelected() || [];
  } else {
    fl = fl.slice();
  }
  const pos = fl.indexOf(slotName);
  if (pos === -1) fl.push(slotName);
  else fl.splice(pos, 1);
  store.setSelectedStackFilterList(fl);
}

/* Group visibility: toggle all slot names for group (based on getAllSlotsForGroup) */
function isGroupVisible(gid) {
  if (!hasSelected.value) return true;
  const sel = selected.value;
  if (!sel.filterList || !Array.isArray(sel.filterList)) return true;
  const allSlots = getAllSlotsForGroup(gid).map((s) => s.Name);
  if (allSlots.length === 0) return true;
  // visible if any slot from this group is present in filterList
  return allSlots.some((n) => sel.filterList.includes(n));
}

function toggleGroupVisibility(gid) {
  if (!hasSelected.value) return;
  suspendPartHoverBlink(700);
  const idx = store.selectedIndex;
  if (idx < 0) return;
  let fl = selected.value.filterList;
  if (!Array.isArray(fl)) {
    fl = _ensureFilterListForSelected() || [];
  } else {
    fl = fl.slice();
  }
  const groupSlots = getAllSlotsForGroup(gid)
    .map((s) => s.Name)
    .filter(Boolean);
  if (groupSlots.length === 0) return;
  const anyPresent = groupSlots.some((n) => fl.includes(n));
  if (anyPresent) {
    // remove all
    fl = fl.filter((n) => !groupSlots.includes(n));
  } else {
    // add all (avoid duplicates)
    const s = new Set(fl);
    groupSlots.forEach((n) => s.add(n));
    fl = Array.from(s);
  }
  store.setSelectedStackFilterList(fl);
}

/* All visibility: toggle show/hide all for selected element */
const isAllVisible = computed(() => {
  if (!hasSelected.value) return false;
  const sel = selected.value;
  if (!sel.filterList || !Array.isArray(sel.filterList)) return true;
  // if there exists at least one filterList entry, consider visible
  return sel.filterList.length > 0;
});

function toggleAllVisibility() {
  if (!hasSelected.value) return;
  suspendPartHoverBlink(700);
  const idx = store.selectedIndex;
  if (idx < 0) return;
  const sel = selected.value;
  if (!sel.filterList || !Array.isArray(sel.filterList)) {
    // currently considered visible; toggle to hide -> set empty filterList
    store.setSelectedStackFilterList([]);
  } else {
    // if empty -> restore to all present slots in element
    if (sel.filterList.length === 0) {
      const names = new Set();
      for (const p of sel.data || []) {
        const n = getPartSlotName(p);
        if (n) names.add(n);
      }
      store.setSelectedStackFilterList(Array.from(names));
    } else {
      // currently visible (non-empty) -> hide (empty)
      store.setSelectedStackFilterList([]);
    }
  }
}

/* -------------------------
   Delete logic (single click arm, single click again confirm)
   ------------------------- */

function clearArmedStates() {
  armedParts.value.clear();
  armedGroups.value.clear();
  armedAll.value = false;
}

function armPartDelete(part, idx, gid) {
  const key = partUniqueKey(part, idx, gid);
  // if this part already armed -> confirm delete
  if (armedParts.value.has(key)) {
    confirmPartDelete(part, idx, gid);
    return;
  }
  // otherwise arm this part and clear others
  armedParts.value = new Set([key]);
  armedGroups.value.clear();
  armedAll.value = false;
}

function isPartArmed(part, idx, gid) {
  const key = partUniqueKey(part, idx, gid);
  return armedParts.value.has(key);
}

function confirmPartDelete(part, idx, gid) {
  if (!hasSelected.value) return;
  const key = partUniqueKey(part, idx, gid);
  // perform deletion: remove matching part from selected element.data
  const si = store.selectedIndex;
  if (si < 0) return;
  try {
    const orig = selected.value.data || [];
    const str = JSON.stringify(part);
    const newData = orig.filter((p) => {
      try {
        return JSON.stringify(p) !== str;
      } catch (e) {
        return p !== part;
      }
    });
    store.replaceSelectedStackData(newData, { recordHistory: true });
    // cleanup armed state
    armedParts.value.delete(key);
  } catch (e) {
    console.error("confirmPartDelete failed", e);
  }
}

/* Group delete */
function armGroupDelete(gid) {
  if (armedGroups.value.has(gid)) {
    confirmGroupDelete(gid);
    return;
  }
  // arm this group and clear others
  armedGroups.value = new Set([gid]);
  armedParts.value.clear();
  armedAll.value = false;
}

function isGroupArmed(gid) {
  return armedGroups.value.has(gid);
}

function confirmGroupDelete(gid) {
  if (!hasSelected.value) return;
  const si = store.selectedIndex;
  if (si < 0) return;
  try {
    const orig = selected.value.data || [];
    const newData = orig.filter((p) => classifyGroup(p) !== gid);
    store.replaceSelectedStackData(newData);
    armedGroups.value.delete(gid);
    // also clear any per-part armed keys that belonged to this group
    for (const key of Array.from(armedParts.value)) {
      if (String(key).startsWith(gid + "::")) armedParts.value.delete(key);
    }
  } catch (e) {
    console.error("confirmGroupDelete failed", e);
  }
}

/* All delete */
function armAllDelete() {
  if (armedAll.value) {
    confirmAllDelete();
    return;
  }
  armedAll.value = true;
  armedGroups.value.clear();
  armedParts.value.clear();
}

function confirmAllDelete() {
  if (!hasSelected.value) return;
  const si = store.selectedIndex;
  if (si < 0) return;
  try {
    store.replaceSelectedStackData([]);
    armedAll.value = false;
    // clear related armed states
    armedGroups.value.clear();
    armedParts.value.clear();
  } catch (e) {
    console.error("confirmAllDelete failed", e);
  }
}

/* -------------------------
   Replace mode (mutually exclusive with focus)
  - uses selectionBridge.replaceTarget for cross-component visibility
   ------------------------- */

function toggleReplaceForPart(part, idx, gid) {
  const key = partUniqueKey(part, idx, gid);
  const current = selectionBridge.replaceTarget;
  if (current && current.active && current.key === key) {
    // currently in replace mode for this key -> clear
    store.clearReplaceTarget();
  } else {
    // enter replace mode for this part
    store.setReplaceTarget(part, key, false);
  }
}

function returnToPolish() {
  store.clearReplaceTarget();
  // Deprecated: legacy taskStage flow removed.
  // store.setTaskStage("polish");
  store.openContextPanel("inspector", "partlist-return-polish");
}

function isPartReplaceArmed(part, idx, gid) {
  const key = partUniqueKey(part, idx, gid);
  const current = selectionBridge.replaceTarget;
  return !!(current && current.active && current.key === key);
}

/* -------------------------
   Cleanup watchers: reset armed when selection changes
   ------------------------- */

// Watch for index changes (switching between different outfits/stacks)
// Only reset the view state (collapsed groups, search) when the user actively switches stacks.
watch(
  () => store.selectedIndex,
  () => {
    clearPartHoverBlinkState();
    searchTerm.value = "";
    activeSlotKey.value = null;
    highlightedSlotKey.value = null;
    collapsed.value = new Set();
  }
);

watch(
  () =>
    `${selectionBridge.focusedPartIndex?.stackIndex ?? "n"}:${
      selectionBridge.focusedPartIndex?.partIndex ?? "n"
    }`,
  () => {
    clearPartHoverBlinkState();
    const part = store.focusedPart;
    if (!part) return;
    const gid = classifyGroup(part);
    const slotName = getPartSlotName(part);
    if (gid) activeGroupId.value = gid;
    if (gid && slotName) {
      const key = slotKeyByNames(gid, slotName);
      activeSlotKey.value = key;
      setHighlightedSlot(key);
      ensureSlotVisible(key);
    }
  }
);

// Watch for data changes (content updates within same stack OR stack switch)
// Clear transient interaction states (delete confirmation, replace target) to ensure safety.
watch(selected, () => {
  clearPartHoverBlinkState();
  clearArmedStates();
  store.clearReplaceTarget();
});

watch(
  groupEntries,
  (entries) => {
    if (!Array.isArray(entries) || entries.length === 0) {
      activeGroupId.value = null;
      return;
    }
    const exists = entries.some((item) => item.gid === activeGroupId.value);
    if (!exists) {
      activeGroupId.value = entries[0].gid;
    }
  },
  { immediate: true }
);

watch(
  () => selectionBridge.replaceTarget,
  (nextTarget) => {
    if (!nextTarget || !nextTarget.active) return;
    const item = nextTarget.item;
    if (!item) return;
    const gid = classifyGroup(item);
    const slotName = item.Group || item.Name || getPartSlotName(item);
    if (gid) activeGroupId.value = gid;
    if (gid && slotName) {
      const key = slotKeyByNames(gid, slotName);
      activeSlotKey.value = key;
      setHighlightedSlot(key);
      ensureSlotVisible(key);
    }
  },
  { deep: true }
);

/* -------------------------
   Global click handling to disarm when clicking elsewhere
   ------------------------- */
function onDocumentClick(e) {
  const target = e.target;
  if (!rootEl.value) return;
  const clickedInsideRoot = rootEl.value.contains(target);
  // if clicked outside the panel -> clear all armed states
  if (!clickedInsideRoot) {
    clearArmedStates();
    return;
  }
  // clicked inside: if clicked on a delete button, do nothing (let its handler manage arm/confirm)
  const deleteBtn = target.closest ? target.closest("[data-delete-button]") : null;
  if (deleteBtn) {
    // clicked a delete button -> don't auto-clear
    return;
  }
  clearArmedStates();
}

onMounted(() => {
  doc.addEventListener("click", onDocumentClick, true); // use capture to be more robust
  doc.addEventListener("keydown", onPanelKeydown, true);
});

onBeforeUnmount(() => {
  clearPartHoverBlinkState();
  if (highlightTimerId.value !== null) {
    hostWindow.clearTimeout(highlightTimerId.value);
    highlightTimerId.value = null;
  }
  doc.removeEventListener("click", onDocumentClick, true);
  doc.removeEventListener("keydown", onPanelKeydown, true);
});
</script>

<style scoped>
.partlist-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
  padding: 8px;
  min-width: 0;
}

/* header */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header h4 {
  margin: 0;
  font-size: 14px;
  color: var(--color-text-primary, #0f172a);
}

.header-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* Global: remove all button focus shadow/ring to avoid layout jump */
button:focus,
.icon-btn:focus,
.control-buttons button:focus,
.chev:focus {
  outline: none;
  box-shadow: none !important;
}

/* Icon buttons: 关键调整
   - 固定尺寸（width/height）以保证垂直对齐
   - padding 归一化为 0，使用内联居中对齐图标/文字
   - box-sizing: border-box 确保 border 不会改变外部布局尺寸
   - 增大文字大小以满足可读性要求
*/
.icon-btn {
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-base);
  background: var(--color-bg-base);
  cursor: pointer;
  font-size: 15px;
  /* increased button text size */
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  color: var(--color-text-primary, #0f172a);
}

/* 保持禁用/状态样式，但不改变 border 宽度 */
.icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon-btn.active {
  background: var(--color-interactive-hover);
  /* border-color: var(--color-border-focus); */
}

.icon-btn.armed {
  background: var(--color-warning-bg, rgba(245, 158, 11, 0.15));
  border-color: var(--color-warning, #f59e0b);
}

/* 去掉 focus 默认外边框导致的布局跳动：全局禁止 focus 的 box-shadow（见上方） */
/* 为 keyboard focus 保留不改变尺寸的视觉提示（可选，使用 subtle outline inset） */
.icon-btn:focus-visible {
  outline: none;
}

/* controls */
.controls {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 4px 0;
  flex-wrap: wrap;
}

.search {
  flex: 1;
  padding: 8px 10px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-light, #f1f5f9);
  background: var(--color-bg-base, #fff);
  font-size: 13px;
  min-width: 120px;
  box-sizing: border-box;
}

.control-buttons {
  display: flex;
  gap: 6px;
  align-items: center;
}

.control-buttons button {
  padding: 6px 8px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-light, #f1f5f9);
  background: var(--color-bg-base, #fff);
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text-primary, #0f172a);
  /* increased text size for control buttons */
}

.control-buttons button:hover {
  background: var(--color-bg-hover, #f1f5f9);
  border-color: var(--color-border-strong, #cbd5e1);
}

.control-buttons button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* toggle row */
.toggle-row {
  display: flex;
  gap: 16px;
  padding: 4px 0;
  flex-wrap: wrap;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-secondary, #475569);
  cursor: pointer;
  white-space: nowrap;
}

.toggle-label input {
  cursor: pointer;
}

/* body: scrollable area */
.body {
  flex: 1 1 auto;
  overflow: auto;
  padding: 8px;
  border-radius: var(--radius-md, 8px);
  background: linear-gradient(180deg, var(--color-bg-base), var(--color-bg-surface));
  border: 1px solid var(--color-border-base);
  min-height: 0;
  box-sizing: border-box;
}

.modern-layout {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 12px;
  min-height: 0;
}

.group-rail {
  border-right: 1px solid var(--color-border-base);
  padding-right: 8px;
  overflow: auto;
  min-height: 0;
}

.group-rail-item {
  width: 100%;
  border: 1px solid var(--color-border-light, #f1f5f9);
  border-radius: var(--radius-sm, 6px);
  background: var(--color-bg-base, #fff);
  padding: 8px;
  margin-bottom: 6px;
  cursor: pointer;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.group-rail-item.active {
  border-color: var(--color-border-focus, #94a3b8);
  background: var(--color-bg-hover, #f1f5f9);
}

.group-rail-item.hidden {
  opacity: 0.65;
}

.group-rail-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary, #0f172a);
}

.group-rail-count {
  font-size: 11px;
  color: var(--color-text-tertiary, #64748b);
}

.group-detail {
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.group-header.sticky {
  position: sticky;
  top: 0;
  background: var(--color-bg-base, #fff);
  z-index: 1;
  padding-bottom: 6px;
}

/* group card: 保持平面化 */
.group-card {
  border-radius: var(--radius-sm, 6px);
  background: var(--color-bg-base);
  border: 1px solid var(--color-border-base);
  padding: 8px;
  margin-bottom: 8px;
  box-shadow: none;
}

.group-card.hidden-group {
  background: var(--color-bg-panel, #f1f5f9);
  border-color: var(--color-border-strong, #cbd5e1);
  opacity: 0.95;
}

.group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.group-header .title {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  flex: 1;
}

.chev {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  border: none;
  font-weight: 700;
  cursor: pointer;
  font-size: 14px;
  /* slightly larger for readability */
}

.gid {
  font-weight: 700;
  color: var(--color-text-primary, #0f172a);
  font-size: 13px;
}

.hidden-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: var(--radius-xs, 4px);
  background: var(--color-border-light, #f1f5f9);
  color: var(--color-text-secondary, #475569);
  font-weight: 500;
  margin-left: 4px;
}

.count {
  font-size: 12px;
  color: var(--color-text-tertiary, #64748b);
  margin-left: 6px;
}

.group-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* part row: 平面化并铺满宽度，统一高度，垂直居中对齐 */
.part-row {
  display: flex;
  align-items: center;
  border-radius: 0;
  border: 0;
  margin: 0 0 4px 0;
  box-shadow: none;
  transition: none;
  width: 100%;
  box-sizing: border-box;
  min-height: 48px;
  /* 固定最小高度，便于对齐 */
  cursor: pointer;
}

/* hover 只做非常细微的颜色变化，不改变尺寸或边框宽度 */
.part-row:hover {
  background: var(--color-bg-hover);
}

/* 选中状态：使用左栏加背景色来标识（不影响水平对齐） */
.part-row.active {
  border-left: 3px solid var(--color-selection-single);
  background: var(--color-selection-single-bg);
  padding-left: 9px;
  /* 保持内容对齐（minimize shift: 9 = 12 - 3） */
}

.part-row.highlighted {
  box-shadow: inset 0 0 0 1px var(--color-border-focus, #94a3b8);
  background: var(--color-bg-hover, #f1f5f9);
}

/* empty slot 行同样处理 */
.part-row.empty-slot {
  background: transparent;
  cursor: default;
}

.part-row.empty-slot.clickable {
  cursor: pointer;
}

.part-row.empty-slot.clickable:hover {
  background: var(--color-bg-hover);
}

/* 内容区：撑满宽度以便右侧按钮对齐 */
.row-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
}

/* 左侧文字列 */
.left-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.slot-name {
  font-size: 12px;
  color: var(--color-text-tertiary, #64748b);
  flex-shrink: 0;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--color-text-primary, #0f172a);
  text-align: left;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-name.empty {
  color: var(--color-text-muted, #94a3b8);
  font-weight: 400;
  font-style: italic;
}

/* per-part controls：保证高度、垂直居中，按钮固定大小以便严格对齐 */
.part-controls {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-left: 12px;
  flex: 0 0 auto;
}

/* 保证 icon-btn 在 part-controls 区域里的呈现完全一致（避免文字大小影响高度） */
.part-controls .icon-btn {
  width: 36px;
  height: 36px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* 删除按钮等视觉微调（不改变尺寸） */
.icon-btn.delete-btn {
  background: var(--color-bg-base, #fff);
}

.icon-btn.eye-btn {
  background: var(--color-bg-base, #fff);
}

.icon-btn.replace-btn {
  background: var(--color-bg-base, #fff);
}

/* 对于内联图标（emoji）或字体图标，确保垂直居中 */
.icon-btn > * {
  display: inline-block;
  line-height: 1;
}

/* ---------- 增强选中/预览/删除效果 ---------- */

/* Eye (可见/隐藏) 的选中效果：更明显的背景与边框，配合图标颜色变化 */
.icon-btn.eye-btn.active,
.icon-btn.eye-btn[aria-pressed="true"] {
  background: var(--color-bg-panel, #f1f5f9);
  /* border-color: rgba(161, 166, 180, 0.65); */
  /* color: #4b4f56; */
}

/* Replace (替换) 的选中效果：明确的强调色 */
.icon-btn.replace-btn.active,
.icon-btn.replace-btn[aria-pressed="true"] {
  background: var(--color-warning-bg, rgba(245, 158, 11, 0.15));
  border-color: var(--color-warning);
  color: var(--color-warning);
}

/* Delete 的预备删除（armed）效果：更强调的危险色调，注意不改变尺寸 */
.icon-btn.delete-btn.armed,
.icon-btn.delete-btn[data-armed="true"] {
  background: var(--color-error-bg);
  border-color: var(--color-error);
  /* subtle inner highlight to draw attention without changing layout */
  box-shadow: inset 0 0 0 1px var(--color-error-bg);
}

/* hover state for delete when not yet armed: mild warning on hover */
.icon-btn.delete-btn:hover:not(.disabled):not(.armed) {
  background: var(--color-error-bg);
  border-color: var(--color-error);
}

/* 统一按钮字体大小（包括 group-level controls）以保证视觉一致 */
.group-controls .icon-btn,
.header-controls .icon-btn,
.part-controls .icon-btn {
  font-size: 15px;
}

/* transitions: 删除视觉动画带来的尺寸闪烁 */
.fade-enter-active,
.fade-leave-active {
  transition: none;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 1;
  transform: none;
}
</style>

<!-- Scoped override for vue-color component styles to prevent global pollution -->
<style scoped>
/* Use :deep() to pierce into vue-color child components */
:deep(.vc-input__input) {
  background-color: var(--color-bg-base, #fff) !important;
  color: var(--color-text-primary, #0f172a) !important;
  font-size: 16px !important;
}
</style>
