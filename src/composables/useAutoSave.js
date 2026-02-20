import { watch, onBeforeUnmount } from 'vue'
import { debounce } from '@/utils/performance.js'

/**
 * Composable for auto-save functionality
 * @param {Object} store - The store instance with auto-save methods
 * @param {Object} options - Configuration options
 * @returns {Object} Auto-save control methods
 */
export function useAutoSave(store, options = {}) {
  const {
    debounceMs = 2000,
    watchKeys = ['stacks', 'paletteMap'],
    onSave = null,
    onError = null
  } = options

  const debouncedSave = debounce(async () => {
    // Check if auto-save is still enabled before saving
    if (!store.autoSaveEnabled) {
      return
    }

    try {
      // Use new autoSave method if available, fallback to legacy
      if (typeof store.autoSave === 'function') {
        await store.autoSave()
      } else {
        await store.saveToLocalStorage()
      }
      onSave?.()
    } catch (error) {
      console.error('Auto-save failed:', error)
      onError?.(error)
    }
  }, debounceMs)

  // Watch specified store properties
  const stopWatchers = watchKeys.map(key =>
    watch(() => store[key], () => {
      if (store.autoSaveEnabled) {
        debouncedSave()
      }
    }, { deep: true })
  )

  // Cleanup
  onBeforeUnmount(() => {
    stopWatchers.forEach(stop => stop())
    debouncedSave.cancel()
  })

  return {
    forceSave: () => store.autoSave ? store.autoSave() : store.saveToLocalStorage(),
    clearSave: () => store.clearLocalStorage()
  }
}
