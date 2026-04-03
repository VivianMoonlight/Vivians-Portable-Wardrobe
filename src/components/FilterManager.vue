<script setup>
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useFileSystemStore } from "@/stores/fileSystemStore";
import { injectTheme } from "@/services/ThemeService";
import { ExternalAdapter } from "@/utils/external_adapters.js";
import * as DialogService from "@/services/DialogService.js";

const { t } = useI18n();

// Inject theme
const injectedTheme = injectTheme();
const themeClass = computed(() => injectedTheme.themeClass());

// 使用 Pinia store 的 filterSnapshot 作为渲染源
const fsStore = useFileSystemStore();

// 使用 visibleGroups（过滤掉隐藏分组）
const visibleGroups = computed(() => fsStore.filterSnapshot.visibleGroups ?? []);

// 是否显示隐藏分组的开关
const showHiddenGroups = ref(false);

// 所有分组（包括隐藏分组）
const allGroups = computed(() => fsStore.filterSnapshot.groups ?? []);

// 根据开关决定显示哪些分组
const displayGroups = computed(() => {
  if (showHiddenGroups.value) {
    return allGroups.value;
  }
  return visibleGroups.value;
});

const applyMode = computed({
  get: () => fsStore.defaultReplaceMode || "merge-replace",
  set: (mode) => fsStore.setDefaultReplaceMode(mode),
});

const slotPresenceMap = computed(() => fsStore.slotPresenceMap || {});
const collapsedGroupIds = ref(new Set());

function isGroupCollapsed(group) {
  const id = group?.groupID;
  if (!id) return false;
  return collapsedGroupIds.value.has(id);
}

function toggleGroupCollapsed(group) {
  const id = group?.groupID;
  if (!id) return;
  const next = new Set(collapsedGroupIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  collapsedGroupIds.value = next;
}

function getSlotPresence(key) {
  return slotPresenceMap.value?.[key] || { inCharacter: false, inHover: false };
}

function getGroupNameFromPart(part) {
  if (!part) return "";
  return part.Group || part.Asset?.Group?.Name || part.Asset?.Group?.name || "";
}

function getPartName(part) {
  if (!part) return "";
  return part.Name || part.Asset?.Name || "";
}

function getPartDescription(part, family = null, descriptionLookupCache = null) {
  if (!part) return "";

  const direct = (part.Description || part.Desc || part.description || "")
    .toString()
    .trim();
  if (direct) return direct;

  const group = getGroupNameFromPart(part);
  const name = getPartName(part);
  if (!group || !name) return "";

  const cacheKey = `${family || "default"}:${group}:${name}`;
  if (descriptionLookupCache && descriptionLookupCache.has(cacheKey)) {
    return descriptionLookupCache.get(cacheKey);
  }

  const asset = ExternalAdapter.assetGet(family, group, name);
  const resolved = (asset?.Description || asset?.Desc || asset?.description || "")
    .toString()
    .trim();

  if (descriptionLookupCache) {
    descriptionLookupCache.set(cacheKey, resolved);
  }

  return resolved;
}

function getPartDisplayLabel(part, family = null, descriptionLookupCache = null) {
  const description = getPartDescription(part, family, descriptionLookupCache);
  if (description) return description;
  return getPartName(part);
}

const slotSourceNameMap = computed(() => {
  const originalMap = new Map();
  const incomingMap = new Map();
  const descriptionLookupCache = new Map();
  const family = fsStore.character?.AssetFamily || null;

  const originalParts = Array.isArray(fsStore.characterItem) ? fsStore.characterItem : [];
  const incomingParts = Array.isArray(fsStore.activeItem?.data)
    ? fsStore.activeItem.data
    : [];

  for (const part of originalParts) {
    const key = getGroupNameFromPart(part);
    if (!key || originalMap.has(key)) continue;
    originalMap.set(key, getPartDisplayLabel(part, family, descriptionLookupCache));
  }

  for (const part of incomingParts) {
    const key = getGroupNameFromPart(part);
    if (!key || incomingMap.has(key)) continue;
    incomingMap.set(key, getPartDisplayLabel(part, family, descriptionLookupCache));
  }

  return { originalMap, incomingMap };
});

function getOriginalModeLabel(key) {
  const label = slotSourceNameMap.value.originalMap.get(key);
  return label || t("filterManager.slotModeEmpty");
}

function getIncomingModeLabel(key) {
  const label = slotSourceNameMap.value.incomingMap.get(key);
  return label || t("filterManager.slotModeEmpty");
}

function getAutoModeLabel() {
  return t("filterManager.slotModeAuto");
}

function getSlotControl(key) {
  return fsStore.getSlotControlState(key);
}

function getSlotMode(key) {
  return getSlotControl(key).mode;
}

function getAllSlotKeys() {
  const groups = Array.isArray(allGroups.value) ? allGroups.value : [];
  const keys = [];
  for (const group of groups) {
    const list = Array.isArray(group?.itemList) ? group.itemList : [];
    for (const item of list) {
      if (item?.key) keys.push(item.key);
    }
  }
  return Array.from(new Set(keys));
}

function getGroupSlotKeys(group) {
  const list = Array.isArray(group?.itemList) ? group.itemList : [];
  return list.map((item) => item?.key).filter(Boolean);
}

function isGroupAllMode(group, mode) {
  const keys = getGroupSlotKeys(group);
  if (keys.length === 0) return false;
  return keys.every((key) => getSlotMode(key) === mode);
}

async function applyCurrentPreview() {
  const ok = fsStore.applyCurrentPreviewToCharacter();
  if (!ok) {
    await DialogService.alert(t("filterManager.applyFailed"));
  }
}

// UI 操作全部转为 store 的 slot control API
function setSlotMode(key, mode) {
  fsStore.setSlotMode(key, mode);
}

function setAllMode(mode) {
  fsStore.setAllSlotModes(mode);
}

function setGroupMode(groupID, mode) {
  fsStore.setGroupSlotModes(groupID, mode);
}
</script>

<template>
  <div
    class="filter-panel"
    :class="themeClass"
    role="region"
    :aria-label="t('filterManager.ariaLabel')"
  >
    <div class="filter-top">
      <button class="batch" @click="setAllMode('original')">
        <span class="action-icon" aria-hidden="true">↺</span>
        {{ t("filterManager.allModeOriginal") }}
      </button>
      <button class="batch" @click="setAllMode('incoming')">
        <span class="action-icon" aria-hidden="true">✚</span>
        {{ t("filterManager.allModeIncoming") }}
      </button>
      <button class="batch" @click="setAllMode('empty')">
        <span class="action-icon" aria-hidden="true">⊘</span>
        {{ t("filterManager.allModeEmpty") }}
      </button>
      <button class="batch" @click="setAllMode('auto')">
        <span class="action-icon" aria-hidden="true">⚙</span>
        {{ t("filterManager.allModeAuto") }}
      </button>
      <label class="toggle-hidden">
        <input type="checkbox" v-model="showHiddenGroups" />
        <span>{{ t("filterManager.showHiddenGroups") }}</span>
      </label>
    </div>

    <div class="mode-row">
      <span class="mode-label">{{ t("filterManager.defaultReplaceModeLabel") }}</span>
      <div
        class="mode-buttons"
        role="group"
        :aria-label="t('filterManager.defaultReplaceModeLabel')"
      >
        <button
          class="mode-btn"
          :class="{ active: applyMode === 'fill-empty' }"
          @click="applyMode = 'fill-empty'"
        >
          {{ t("filterManager.modeFillEmpty") }}
        </button>
        <button
          class="mode-btn"
          :class="{ active: applyMode === 'merge-replace' }"
          @click="applyMode = 'merge-replace'"
        >
          {{ t("filterManager.modeMergeReplace") }}
        </button>
        <button
          class="mode-btn"
          :class="{ active: applyMode === 'full-replace' }"
          @click="applyMode = 'full-replace'"
        >
          {{ t("filterManager.modeFullReplace") }}
        </button>
      </div>
    </div>

    <div class="apply-row">
      <button class="batch apply apply-full" @click="applyCurrentPreview">
        {{ t("filterManager.applyCurrent") }}
      </button>
    </div>

    <div class="filter-scroll scrollable">
      <div
        v-for="group in displayGroups"
        :key="group.groupID"
        class="filter-group"
        :class="{ 'hidden-group': group.isHiddenGroup, collapsed: isGroupCollapsed(group) }"
      >
        <div class="filter-group-title">
          <span class="group-name">
            <button
              class="group-collapse-btn"
              :title="isGroupCollapsed(group) ? 'Expand' : 'Collapse'"
              :aria-label="isGroupCollapsed(group) ? 'Expand group' : 'Collapse group'"
              :aria-expanded="!isGroupCollapsed(group)"
              @click="toggleGroupCollapsed(group)"
            >
              <span class="group-collapse-icon" aria-hidden="true">{{ isGroupCollapsed(group) ? '▸' : '▾' }}</span>
            </button>
            {{ group.displayName || group.groupID }}
            <span v-if="group.isHiddenGroup" class="hidden-badge">{{
              t("filterManager.hiddenBadge")
            }}</span>
          </span>
          <div class="group-actions">
            <button
              class="small"
              :class="{ active: isGroupAllMode(group, 'original') }"
              @click="setGroupMode(group.groupID, 'original')"
            >
              <span class="action-icon" aria-hidden="true">↺</span>
              {{ t("filterManager.groupModeOriginal") }}
            </button>
            <button
              class="small"
              :class="{ active: isGroupAllMode(group, 'incoming') }"
              @click="setGroupMode(group.groupID, 'incoming')"
            >
              <span class="action-icon" aria-hidden="true">✚</span>
              {{ t("filterManager.groupModeIncoming") }}
            </button>
            <button
              class="small"
              :class="{ active: isGroupAllMode(group, 'empty') }"
              @click="setGroupMode(group.groupID, 'empty')"
            >
              <span class="action-icon" aria-hidden="true">⊘</span>
              {{ t("filterManager.groupModeEmpty") }}
            </button>
            <button
              class="small"
              :class="{ active: isGroupAllMode(group, 'auto') }"
              @click="setGroupMode(group.groupID, 'auto')"
            >
              <span class="action-icon" aria-hidden="true">⚙</span>
              {{ t("filterManager.groupModeAuto") }}
            </button>
          </div>
        </div>

        <div v-if="!isGroupCollapsed(group)" class="filter-row">
          <div
            v-for="it in group.itemList"
            :key="it.key"
            :class="[
              'slot-row',
              {
                'has-character': getSlotPresence(it.key).inCharacter,
                'has-hover': getSlotPresence(it.key).inHover,
                'has-both':
                  getSlotPresence(it.key).inCharacter && getSlotPresence(it.key).inHover,
              },
            ]"
            :title="it.data.Description || it.data.Name || it.key"
          >
            <div class="slot-main">
              <span class="slot-item-label">{{
                it.data.Description || it.data.Name || it.key
              }}</span>
            </div>

            <div
              class="slot-mode-buttons"
              role="group"
              :aria-label="t('filterManager.slotModeAriaLabel')"
            >
              <button
                class="slot-mode-btn"
                :class="{ active: getSlotMode(it.key) === 'original' }"
                :title="getOriginalModeLabel(it.key)"
                @click="setSlotMode(it.key, 'original')"
              >
                {{ getOriginalModeLabel(it.key) }}
              </button>
              <button
                class="slot-mode-btn"
                :class="{ active: getSlotMode(it.key) === 'incoming' }"
                :title="getIncomingModeLabel(it.key)"
                @click="setSlotMode(it.key, 'incoming')"
              >
                {{ getIncomingModeLabel(it.key) }}
              </button>
              <button
                class="slot-mode-btn slot-mode-btn-compact"
                :class="{ active: getSlotMode(it.key) === 'empty' }"
                :title="t('filterManager.slotModeEmpty')"
                :aria-label="t('filterManager.slotModeEmpty')"
                @click="setSlotMode(it.key, 'empty')"
              >
                ⊘
              </button>
              <button
                class="slot-mode-btn slot-mode-btn-compact"
                :class="{ active: getSlotMode(it.key) === 'auto' }"
                :title="getAutoModeLabel()"
                :aria-label="getAutoModeLabel()"
                @click="setSlotMode(it.key, 'auto')"
              >
                A
              </button>
            </div>
          </div>
        </div>

        <div v-if="!isGroupCollapsed(group) && group.itemList.length === 0" class="empty-hint">
          {{ t("filterManager.emptyItems") }}
        </div>
      </div>

      <div v-if="displayGroups.length === 0" class="empty-hint">
        {{ t("filterManager.emptyGroups") }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.filter-panel {
  border-left: 1px solid var(--color-border-base, #e2e8f0);
  padding: var(--space-fluid-md, 12px);
  box-sizing: border-box;
  background: var(--color-bg-surface, #f8fafc);
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-fluid-sm, 10px);
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.filter-top {
  display: flex;
  gap: var(--space-fluid-sm, 8px);
  flex-wrap: wrap;
  align-items: center;
}

.batch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs, 4px);
  padding: clamp(6px, 1.2vw, 8px) 10px;
  min-height: 32px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-base, #fff);
  color: var(--color-text-primary, #0f172a);
  cursor: pointer;
  font-size: var(--font-size-sm, 12px);
  white-space: nowrap;
  transition: all var(--transition-fast, 0.15s) ease;
}

.batch:hover {
  background: var(--color-bg-hover, #f1f5f9);
  border-color: var(--color-border-strong, #cbd5e1);
}

.toggle-hidden {
  display: flex;
  align-items: center;
  gap: var(--space-xs, 4px);
  font-size: var(--font-size-sm, 12px);
  color: var(--color-text-secondary, #64748b);
  cursor: pointer;
  margin-left: auto;
}

.toggle-hidden input {
  cursor: pointer;
}

.filter-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  max-height: var(--panel-max-height-safe, calc(100dvh - 160px));
  padding-right: var(--space-sm, 6px);
  -webkit-overflow-scrolling: touch;
  scrollbar-gutter: stable;
}

.mode-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm, 8px);
  padding: var(--space-sm, 8px);
  border: 1px solid var(--color-border-light, #f1f5f9);
  border-radius: var(--radius-md, 8px);
  background: var(--color-bg-base, #fff);
}

.mode-label {
  font-size: var(--font-size-sm, 12px);
  color: var(--color-text-secondary, #64748b);
}

.mode-buttons {
  display: flex;
  gap: var(--space-sm, 6px);
  flex-wrap: wrap;
}

.mode-btn {
  padding: 4px 8px;
  min-height: 28px;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--color-border-light, #f1f5f9);
  background: var(--color-bg-base, #fff);
  color: var(--color-text-primary, #0f172a);
  cursor: pointer;
  font-size: var(--font-size-sm, 12px);
}

.mode-btn.active {
  background: var(--color-primary, #3b82f6);
  border-color: var(--color-primary, #3b82f6);
  color: var(--color-text-inverse, #fff);
  font-weight: var(--font-weight-semibold, 600);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
}

.apply-row {
  display: block;
}

.batch.apply {
  background: var(--color-success-bg, rgba(16, 185, 129, 0.15));
  border-color: var(--color-success, #10b981);
}

.batch.apply.apply-full {
  width: 100%;
  justify-content: center;
  min-height: 36px;
  font-weight: var(--font-weight-semibold, 600);
}

.batch.danger {
  background: var(--color-danger-bg, rgba(239, 68, 68, 0.12));
  border-color: var(--color-danger, #ef4444);
}

.filter-group {
  border: 1px solid var(--color-border-light, #f1f5f9);
  border-radius: var(--radius-md, 8px);
  padding: var(--space-sm, 8px);
  margin-bottom: var(--space-sm, 8px);
  background: var(--color-bg-base, #fff);
  transition: all var(--transition-fast, 0.15s) ease;
  box-sizing: border-box;
}

.filter-group.hidden-group {
  background: var(--color-bg-panel, #f1f5f9);
  border-color: var(--color-border-base, #e2e8f0);
  opacity: 0.85;
}

.filter-group-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-sm, 8px);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-text-primary, #0f172a);
  margin-bottom: var(--space-sm, 8px);
}

.group-name {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 6px);
  min-width: 0;
  flex: 1 1 auto;
}

.group-collapse-btn {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--color-border-light, #f1f5f9);
  background: var(--color-bg-base, #fff);
  color: var(--color-text-secondary, #64748b);
  cursor: pointer;
  flex: 0 0 auto;
  transition: all var(--transition-fast, 0.15s) ease;
}

.group-collapse-btn:hover {
  background: var(--color-bg-hover, #f1f5f9);
  border-color: var(--color-border-strong, #cbd5e1);
  color: var(--color-text-primary, #0f172a);
}

.group-collapse-icon {
  line-height: 1;
  font-size: 11px;
}

.filter-group.collapsed .filter-group-title {
  margin-bottom: 0;
}

.hidden-badge {
  font-size: var(--font-size-xs, 10px);
  padding: 2px var(--space-sm, 6px);
  border-radius: var(--radius-sm, 4px);
  background: var(--color-bg-panel, #f1f5f9);
  color: var(--color-text-secondary, #64748b);
  font-weight: var(--font-weight-medium, 500);
}

.group-actions {
  display: flex;
  gap: var(--space-sm, 6px);
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 100%;
}

.small {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs, 4px);
  padding: 3px 7px;
  min-height: 26px;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--color-border-light, #f1f5f9);
  background: var(--color-bg-base, #fff);
  color: var(--color-text-primary, #0f172a);
  cursor: pointer;
  font-size: var(--font-size-xs, 11px);
  transition: all var(--transition-fast, 0.15s) ease;
}

.action-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1em;
  opacity: 0.85;
}

.small:hover {
  background: var(--color-bg-hover, #f1f5f9);
  border-color: var(--color-border-strong, #cbd5e1);
}

.small.active {
  background: var(--color-primary, #3b82f6);
  border-color: var(--color-primary, #3b82f6);
  color: var(--color-text-inverse, #fff);
}

.filter-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs, 6px);
  min-width: 0;
}

.slot-row {
  display: grid;
  grid-template-columns: minmax(0, 0.66fr) minmax(0, 1.74fr);
  align-items: center;
  gap: var(--space-sm, 8px);
  padding: clamp(6px, 1.2vw, 8px) 8px;
  border: 1px solid var(--color-border-base, #e2e8f0);
  border-radius: var(--radius-md, 8px);
  background: var(--color-bg-base, #fff);
  transition: all var(--transition-fast, 0.15s) ease;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  box-sizing: border-box;
}

.slot-row.has-character {
  border-left-color: var(--color-primary, #3b82f6);
}

.slot-row.has-hover {
  border-right-color: var(--color-success, #10b981);
}

.slot-main {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm, 6px);
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
}

.slot-item-label {
  display: block;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-primary, #0f172a);
  font-size: var(--font-size-sm, 12px);
}

.slot-mode-buttons {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.2fr) 34px 34px;
  gap: var(--space-xs, 6px);
  min-width: 0;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  box-sizing: border-box;
}

.slot-mode-btn {
  width: 100%;
  min-width: 0;
  padding: 4px 10px;
  min-height: 30px;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--color-border-light, #f1f5f9);
  background: var(--color-bg-base, #fff);
  color: var(--color-text-primary, #0f172a);
  cursor: pointer;
  font-size: var(--font-size-xs, 11px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  box-sizing: border-box;
}

.slot-mode-btn-compact {
  width: 34px;
  min-width: 34px;
  max-width: 34px;
  height: 34px;
  min-height: 34px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-base, 14px);
}

.slot-mode-btn.active {
  background: var(--color-primary, #3b82f6);
  border-color: var(--color-primary, #3b82f6);
  color: var(--color-text-inverse, #fff);
}

@media (max-width: 880px) {
  .slot-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .slot-mode-buttons {
    justify-self: start;
  }

  .slot-mode-buttons {
    min-width: 0;
    width: 100%;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 34px 34px;
  }
}

.empty-hint {
  color: var(--color-text-muted, #94a3b8);
  font-size: var(--font-size-sm, 12px);
  text-align: center;
  padding: var(--space-sm, 8px);
}
</style>
