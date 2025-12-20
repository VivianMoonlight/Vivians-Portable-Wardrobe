/**
 * Composable for managing undo/redo keyboard shortcuts
 * 
 * Usage:
 * ```vue
 * <script setup>
 * import { useUndoRedo } from '@/composables/useUndoRedo'
 * import { useStudioStore } from '@/stores/studioStore'
 * 
 * const store = useStudioStore()
 * 
 * // Auto-setup keyboard shortcuts
 * useUndoRedo(store)
 * </script>
 * ```
 */

import { onMounted, onUnmounted } from 'vue'

/**
 * Setup undo/redo keyboard shortcuts
 * @param {Object} store - Studio store instance
 * @param {Object} options - Configuration options
 * @param {boolean} options.enableLogging - Enable debug logging
 * @param {Function} options.onUndo - Callback after undo
 * @param {Function} options.onRedo - Callback after redo
 */
export function useUndoRedo(store, options = {}) {
  const {
    enableLogging = false,
    onUndo = null,
    onRedo = null
  } = options

  const handleKeyDown = (event) => {
    // Check for Ctrl+Z (Windows/Linux) or Cmd+Z (Mac)
    // Use userAgent check as navigator.platform is deprecated
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
    const modifierKey = isMac ? event.metaKey : event.ctrlKey

    if (!modifierKey) return

    // Undo: Ctrl/Cmd + Z (without Shift)
    if (event.key === 'z' && !event.shiftKey) {
      event.preventDefault()
      
      if (!store || typeof store.undo !== 'function') {
        console.warn('[useUndoRedo] Store or undo method not available')
        return
      }

      const success = store.undo()
      
      if (enableLogging) {
        console.log('[useUndoRedo] Undo:', success ? 'Success' : 'Nothing to undo')
      }

      if (success && onUndo && typeof onUndo === 'function') {
        onUndo()
      }
    }
    // Redo: Ctrl/Cmd + Shift + Z
    else if (event.key === 'z' && event.shiftKey) {
      event.preventDefault()
      
      if (!store || typeof store.redo !== 'function') {
        console.warn('[useUndoRedo] Store or redo method not available')
        return
      }

      const success = store.redo()
      
      if (enableLogging) {
        console.log('[useUndoRedo] Redo:', success ? 'Success' : 'Nothing to redo')
      }

      if (success && onRedo && typeof onRedo === 'function') {
        onRedo()
      }
    }
    // Alternative Redo: Ctrl+Y (Windows convention only)
    else if (event.key === 'y' && !isMac && event.ctrlKey) {
      event.preventDefault()
      
      if (!store || typeof store.redo !== 'function') {
        console.warn('[useUndoRedo] Store or redo method not available')
        return
      }

      const success = store.redo()
      
      if (enableLogging) {
        console.log('[useUndoRedo] Redo (Ctrl+Y):', success ? 'Success' : 'Nothing to redo')
      }

      if (success && onRedo && typeof onRedo === 'function') {
        onRedo()
      }
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', handleKeyDown)
    if (enableLogging) {
      console.log('[useUndoRedo] Keyboard shortcuts registered')
    }
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeyDown)
    if (enableLogging) {
      console.log('[useUndoRedo] Keyboard shortcuts unregistered')
    }
  })

  return {
    // Expose store methods for manual control
    undo: () => store?.undo?.() || false,
    redo: () => store?.redo?.() || false,
    canUndo: () => store?.canUndo?.() || false,
    canRedo: () => store?.canRedo?.() || false,
    getHistory: () => store?.getHistory?.() || { canUndo: false, canRedo: false, undoCount: 0, redoCount: 0 }
  }
}

export default useUndoRedo
