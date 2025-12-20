<template>
  <div class="saves-manager">
    <div class="manager-header">
      <h4>{{ t('savesManager.title') || 'Studio Saves' }}</h4>
      <button class="icon-btn" @click="$emit('close')" :title="t('savesManager.close') || 'Close'">✖</button>
    </div>

    <div class="manager-toolbar">
      <button class="btn primary" @click="createNewSave">
        <span>💾</span> {{ t('savesManager.saveNew') || 'Save Current' }}
      </button>
      <div class="storage-info">
        {{ t('savesManager.storageUsed') || 'Storage' }}: {{ storageInfo.totalSizeMB }}MB
      </div>
    </div>

    <div class="saves-list scrollable">
      <div v-if="saves.length === 0" class="empty-state">
        {{ t('savesManager.noSaves') || 'No saves yet' }}
      </div>

      <div v-for="save in sortedSaves" :key="save.id" class="save-item"
        :class="{ 'auto-save': save.isAutoSave, 'current': save.id === store.currentSaveId }">
        
        <div class="save-icon">
          {{ save.isAutoSave ? '⚡' : '💾' }}
        </div>

        <div class="save-info">
          <div class="save-name" v-if="renamingId !== save.id">
            {{ save.name }}
            <span v-if="save.id === store.currentSaveId" class="current-badge">
              {{ t('savesManager.current') || 'Current' }}
            </span>
          </div>
          <input v-else
            v-model="renameValue"
            class="rename-input"
            @blur="commitRename(save.id)"
            @keydown.enter="commitRename(save.id)"
            @keydown.esc="cancelRename"
            @click.stop
          />
          <div class="save-meta">
            {{ formatDate(save.timestamp) }} • {{ formatSize(save.dataSize) }}
          </div>
        </div>

        <div class="save-actions">
          <button class="icon-btn" @click="loadSave(save.id)" 
            :title="t('savesManager.load') || 'Load'"
            :aria-label="t('savesManager.load') || 'Load'">
            📂
          </button>
          <button v-if="!save.isAutoSave" class="icon-btn" @click="startRename(save.id, save.name)" 
            :title="t('savesManager.rename') || 'Rename'"
            :aria-label="t('savesManager.rename') || 'Rename'">
            ✎
          </button>
          <button class="icon-btn delete" @click="deleteSave(save.id)" 
            :title="t('savesManager.delete') || 'Delete'"
            :aria-label="t('savesManager.delete') || 'Delete'">
            🗑
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStudioStore } from '@/stores/studioStore'
import { StudioStorageService } from '@/services/StudioStorageService'
import * as DialogService from '@/services/DialogService'

const { t } = useI18n()
const store = useStudioStore()
const emit = defineEmits(['close'])

const saves = ref([])
const renamingId = ref(null)
const renameValue = ref('')

const sortedSaves = computed(() => {
  return [...saves.value].sort((a, b) => {
    // Auto-save always first
    if (a.isAutoSave) return -1
    if (b.isAutoSave) return 1
    // Then by timestamp (newest first)
    return b.timestamp - a.timestamp
  })
})

const storageInfo = computed(() => StudioStorageService.getStorageInfo())

function refreshList() {
  saves.value = StudioStorageService.getSavesList()
}

async function createNewSave() {
  const name = await DialogService.prompt(
    t('savesManager.enterName') || 'Enter save name:',
    'My Studio Session'
  )
  if (!name) return

  const result = await store.saveStudioSession(name)
  if (result.success) {
    refreshList()
    await DialogService.alert(t('savesManager.saved') || 'Saved successfully!')
  } else {
    await DialogService.alert(t('savesManager.saveFailed') || `Save failed: ${result.error}`)
  }
}

async function loadSave(id) {
  const confirmed = await DialogService.confirm(
    t('savesManager.loadConfirm') || 'Load this save? Current unsaved changes will be lost.'
  )
  if (!confirmed) return

  const result = await store.loadStudioSession(id)
  if (result.success) {
    await DialogService.alert(t('savesManager.loaded') || 'Loaded successfully!')
  } else {
    await DialogService.alert(t('savesManager.loadFailed') || `Load failed: ${result.error}`)
  }
}

function startRename(id, currentName) {
  renamingId.value = id
  renameValue.value = currentName
}

function commitRename(id) {
  if (renameValue.value.trim()) {
    StudioStorageService.renameSave(id, renameValue.value.trim())
    refreshList()
  }
  cancelRename()
}

function cancelRename() {
  renamingId.value = null
  renameValue.value = ''
}

async function deleteSave(id) {
  const confirmed = await DialogService.confirm(
    t('savesManager.deleteConfirm') || 'Delete this save? This cannot be undone.'
  )
  if (!confirmed) return

  const result = StudioStorageService.deleteSave(id)
  if (result.success) {
    refreshList()
  } else {
    await DialogService.alert(t('savesManager.deleteFailed') || 'Delete failed')
  }
}

function formatDate(timestamp) {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now - date
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return t('savesManager.justNow') || 'Just now'
  if (minutes < 60) return t('savesManager.minutesAgo', { n: minutes }) || `${minutes}m ago`
  if (hours < 24) return t('savesManager.hoursAgo', { n: hours }) || `${hours}h ago`
  if (days < 7) return t('savesManager.daysAgo', { n: days }) || `${days}d ago`
  return date.toLocaleDateString()
}

function formatSize(bytes) {
  if (!bytes) return '0 KB'
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(2)} MB`
}

onMounted(() => {
  refreshList()
})
</script>

<style scoped>
.saves-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-base, #fff);
}

.manager-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-base, #e2e8f0);
}

.manager-header h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.manager-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-surface, #f8fafc);
}

.btn.primary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--color-primary, #3b82f6);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
}

.btn.primary:hover {
  background: var(--color-primary-hover, #2563eb);
}

.storage-info {
  font-size: 12px;
  color: var(--color-text-tertiary, #64748b);
}

.saves-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.empty-state {
  text-align: center;
  padding: 48px 24px;
  color: var(--color-text-tertiary, #64748b);
}

.save-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  margin-bottom: 8px;
  background: var(--color-bg-surface, #f8fafc);
  border: 1px solid var(--color-border-base, #e2e8f0);
  border-radius: 8px;
  transition: all 0.2s;
}

.save-item:hover {
  border-color: var(--color-primary, #3b82f6);
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.1);
}

.save-item.auto-save {
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  border-color: #fbbf24;
}

.save-item.current {
  border-color: var(--color-success, #10b981);
  border-width: 2px;
}

.save-icon {
  font-size: 24px;
  flex-shrink: 0;
}

.save-info {
  flex: 1;
  min-width: 0;
}

.save-name {
  font-weight: 600;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.current-badge {
  display: inline-block;
  padding: 2px 8px;
  background: var(--color-success, #10b981);
  color: white;
  font-size: 11px;
  border-radius: 12px;
  font-weight: 500;
}

.rename-input {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--color-primary, #3b82f6);
  border-radius: 4px;
  font-size: 14px;
}

.save-meta {
  font-size: 12px;
  color: var(--color-text-tertiary, #64748b);
}

.save-actions {
  display: flex;
  gap: 4px;
}

.icon-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
  transition: background 0.2s;
}

.icon-btn:hover {
  background: var(--color-bg-hover, #f1f5f9);
}

.icon-btn.delete:hover {
  background: var(--color-error-bg, #fee2e2);
  color: var(--color-error, #ef4444);
}
</style>
