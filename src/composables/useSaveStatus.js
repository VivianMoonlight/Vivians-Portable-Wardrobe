/**
 * Composable for auto-save status display in Studio
 * Provides computed properties and helper functions for save status
 */
import { ref, computed } from 'vue'
import { useStudioStore } from '@/stores/studioStore'

export function useSaveStatus() {
  const store = useStudioStore()
  const showRestoreBanner = ref(false)
  const restoreInfo = ref(null)

  const saveStatusText = computed(() => {
    switch (store.saveStatus) {
      case 'saving':
        return 'Saving...'
      case 'saved':
        return 'Saved ✓'
      case 'error':
        return 'Error ✗'
      default:
        return ''
    }
  })

  const saveStatusClass = computed(() => {
    return {
      'save-status': true,
      'save-status-saving': store.saveStatus === 'saving',
      'save-status-saved': store.saveStatus === 'saved',
      'save-status-error': store.saveStatus === 'error',
      'save-status-visible': store.saveStatus !== 'idle'
    }
  })

  const lastSaveTimeText = computed(() => {
    if (!store.lastSaveTime) return ''
    const now = Date.now()
    const diff = now - store.lastSaveTime
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    if (seconds < 60) return `${seconds}s ago`
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    return new Date(store.lastSaveTime).toLocaleDateString()
  })

  function formatRestoreTime() {
    if (!restoreInfo.value || !restoreInfo.value.timestamp) return ''
    return new Date(restoreInfo.value.timestamp).toLocaleString()
  }

  function dismissRestoreBanner() {
    showRestoreBanner.value = false
  }

  return {
    showRestoreBanner,
    restoreInfo,
    saveStatusText,
    saveStatusClass,
    lastSaveTimeText,
    formatRestoreTime,
    dismissRestoreBanner
  }
}
