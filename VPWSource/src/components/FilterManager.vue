<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFileSystemStore } from '@/stores/fileSystemStore'

const { t } = useI18n()

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
  <div class="filter-panel" role="region" :aria-label="t('filterManager.ariaLabel')">
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
  width: 300px;
  min-width: 220px;
  max-width: 360px;
  border-left: 1px solid rgba(200, 210, 230, 0.35);
  padding: 12px;
  box-sizing: border-box;
  background: linear-gradient(180deg, #fbfdff, #f7fbff);
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.filter-top {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.batch {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid #d6dbe2;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s ease;
}

.batch:hover {
  background: #f0f4f8;
  border-color: #b0bcc8;
}

.toggle-hidden {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #666;
  cursor: pointer;
  margin-left: auto;
}

.toggle-hidden input {
  cursor: pointer;
}

.filter-scroll {
  flex: 1;
  overflow: auto;
  padding-right: 6px;
}

.filter-group {
  border: 1px solid #eef2f6;
  border-radius: 8px;
  padding: 8px;
  margin-bottom: 8px;
  background: #fff;
  transition: all 0.15s ease;
}

.filter-group.hidden-group {
  background: #f9f5f0;
  border-color: #e5ddd5;
  opacity: 0.85;
}

.filter-group-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 8px;
}

.group-name {
  display: flex;
  align-items: center;
  gap: 6px;
}

.hidden-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #e5ddd5;
  color: #8b7355;
  font-weight: 500;
}

.group-actions {
  display: flex;
  gap: 6px;
}

.small {
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid #e6eef6;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s ease;
}

.small:hover {
  background: #f0f4f8;
  border-color: #c0ccd8;
}

.filter-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.filter-item {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid #d5dde6;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s ease;
}

.filter-item:hover {
  background: #f5f8fb;
  border-color: #b0c0d0;
}

.filter-item.active {
  background: #d7f5d8;
  border-color: #7fd27e;
}

.filter-item.active:hover {
  background: #c5edc6;
  border-color: #6bc36a;
}

.empty-hint {
  color: #9aa3b2;
  font-size: 12px;
  text-align: center;
  padding: 8px;
}
</style>