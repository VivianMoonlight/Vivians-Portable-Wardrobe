<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFileSystemStore } from '@/stores/fileSystemStore'
import { injectTheme } from '@/composables/useTheme'

const { t } = useI18n()

// Inject theme
const injectedTheme = injectTheme()
const themeClass = computed(() => injectedTheme.themeClass())

// 使用 Pinia store 的 filterSnapshot 作为渲染源
const fsStore = useFileSystemStore()

// 使用 visibleGroups（过滤掉隐藏分组）
const visibleGroups = computed(() => fsStore.filterSnapshot.visibleGroups ??  [])

// 是否显示隐藏分组的开关
const showHiddenGroups = ref(false)

// 所有分组（包括隐藏分组）
const allGroups = computed(() => fsStore.filterSnapshot.groups ?? [])

// 根据开关决定显示哪些分组
const displayGroups = computed(() => {
  if (showHiddenGroups.value) {
    return allGroups.value
  }
  return visibleGroups.value
})

// UI 操作全部转为 store 的 wrapper 调用
function toggleItem(key) { fsStore.filterToggle(key) }
function setAll(v) { fsStore.filterSetAll(v) }
function invertAll() { fsStore.filterInvertAll() }
function setGroupAll(gid, v) { fsStore.filterSetGroupAll(gid, v) }
function invertGroup(gid) { fsStore.filterInvertGroup(gid) }

// 挂载时自动刷新 filter
onMounted(() => {
  fsStore.initFilterServiceDefault()
})
</script>

<template>
  <div class="filter-panel" :class="themeClass" role="region" :aria-label="t('filterManager.ariaLabel')">
    <div class="filter-top">
      <button class="batch" @click="setAll(true)">{{ t('filterManager.allOn') }}</button>
      <button class="batch" @click="setAll(false)">{{ t('filterManager.allOff') }}</button>
      <button class="batch" @click="invertAll()">{{ t('filterManager.invert') }}</button>
      <label class="toggle-hidden">
        <input type="checkbox" v-model="showHiddenGroups" />
        <span>{{ t('filterManager.showHiddenGroups') }}</span>
      </label>
    </div>

    <div class="filter-scroll scrollable">
      <div
        v-for="group in displayGroups"
        :key="group.groupID"
        class="filter-group"
        :class="{ 'hidden-group': group.isHiddenGroup }"
      >
        <div class="filter-group-title">
          <span class="group-name">
            {{ group.displayName || group.groupID }}
            <span v-if="group.isHiddenGroup" class="hidden-badge">{{ t('filterManager.hiddenBadge') }}</span>
          </span>
          <div class="group-actions">
            <button class="small" @click="setGroupAll(group.groupID, true)">{{ t('filterManager.groupAllOn') }}</button>
            <button class="small" @click="setGroupAll(group.groupID, false)">{{ t('filterManager.groupAllOff') }}</button>
            <button class="small" @click="invertGroup(group.groupID)">{{ t('filterManager.groupInvert') }}</button>
          </div>
        </div>

        <div class="filter-row">
          <button
            v-for="it in group.itemList"
            :key="it.key"
            :class="['filter-item', { active: it.active }]"
            @click="toggleItem(it.key)"
            :title="it.data.Description || it.data.Name || it.key"
          >
            {{ it.data.Description || it.data.Name || it.key }}
          </button>
        </div>

        <div v-if="group.itemList.length === 0" class="empty-hint">
          {{ t('filterManager.emptyItems') }}
        </div>
      </div>

      <div v-if="displayGroups.length === 0" class="empty-hint">
        {{ t('filterManager.emptyGroups') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.filter-panel {
  border-left: 1px solid var(--color-border-base, #e2e8f0);
  padding: var(--space-md, 12px);
  box-sizing: border-box;
  background: var(--color-bg-surface, #f8fafc);
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-md, 10px);
  overflow:auto;
}

.filter-top {
  display: flex;
  gap: var(--space-sm, 8px);
  flex-wrap: wrap;
  align-items: center;
}

.batch {
  padding: var(--space-sm, 6px) 10px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-base, #fff);
  color: var(--color-text-primary, #0f172a);
  cursor: pointer;
  font-size: var(--font-size-base, 13px);
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
  overflow: auto;
  padding-right: var(--space-sm, 6px);
}

.filter-group {
  border: 1px solid var(--color-border-light, #f1f5f9);
  border-radius: var(--radius-md, 8px);
  padding: var(--space-sm, 8px);
  margin-bottom: var(--space-sm, 8px);
  background: var(--color-bg-base, #fff);
  transition: all var(--transition-fast, 0.15s) ease;
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
  gap: var(--space-sm, 8px);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-text-primary, #0f172a);
  margin-bottom: var(--space-sm, 8px);
}

.group-name {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 6px);
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
}

.small {
  padding: var(--space-xs, 4px) var(--space-sm, 8px);
  border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--color-border-light, #f1f5f9);
  background: var(--color-bg-base, #fff);
  color: var(--color-text-primary, #0f172a);
  cursor: pointer;
  font-size: var(--font-size-sm, 12px);
  transition: all var(--transition-fast, 0.15s) ease;
}

.small:hover {
  background: var(--color-bg-hover, #f1f5f9);
  border-color: var(--color-border-strong, #cbd5e1);
}

.filter-row {
  display: flex;
  gap: var(--space-sm, 8px);
  flex-wrap: wrap;
}

.filter-item {
  padding: var(--space-sm, 6px) 10px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-base, #fff);
  color: var(--color-text-primary, #0f172a);
  cursor: pointer;
  font-size: var(--font-size-base, 13px);
  transition: all var(--transition-fast, 0.15s) ease;
}

.filter-item:hover {
  background: var(--color-bg-hover, #f1f5f9);
  border-color: var(--color-border-strong, #cbd5e1);
}

.filter-item.active {
  background: var(--color-success-bg, rgba(16, 185, 129, 0.15));
  border-color: var(--color-success, #10b981);
}

.filter-item.active:hover {
  background: var(--color-success-bg, rgba(16, 185, 129, 0.25));
  border-color: var(--color-success, #10b981);
}

.empty-hint {
  color: var(--color-text-muted, #94a3b8);
  font-size: var(--font-size-sm, 12px);
  text-align: center;
  padding: var(--space-sm, 8px);
}
</style>