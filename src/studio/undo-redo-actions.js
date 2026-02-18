/**
 * Undo/Redo Actions Module
 * Pure functions for history management operations
 * These functions modify store state but are organized here for clarity
 */
import UndoRedoManager from '@/utils/undo_redo'
import { toRaw } from 'vue'

/**
 * Initialize undo/redo manager
 * @param {Object} state - Current store state
 * @returns {Object} New manager instance and state
 */
export function initUndoRedoManager(state) {
  if (state._undoRedoManager) {
    return { _undoRedoManager: state._undoRedoManager }
  }

  const manager = new UndoRedoManager({
    captureState: () => ({
      stacks: toRaw(state.stacks),
      paletteMap: toRaw(state.paletteMap)
    }),
    restoreState: (snapshot) => {
      state.stacks = snapshot.stacks
      state.paletteMap = snapshot.paletteMap
      if (snapshot.focusedPartIndex) {
        state.focusedPartIndex = snapshot.focusedPartIndex
      }
    },
    maxHistory: 100,
    throttleInterval: 150,
    enableLogging: false
  })

  return {
    _undoRedoManager: manager
  }
}

/**
 * Push current state to history
 * @param {Object} state - Current store state
 * @param {Function} helpers - Helper functions from store
 */
export function pushHistorySnapshot(state, helpers) {
  const { _undoRedoManager, refreshMergedAppearanceData } = helpers

  try {
    _undoRedoManager.pushSnapshot()
    refreshMergedAppearanceData()
  } catch (e) {
    console.warn('[undo-redo-actions] pushHistorySnapshot failed', e)
  }
}

/**
 * Push throttled history snapshot (for high-frequency operations)
 * @param {Object} state - Current store state
 * @param {number} delay - Throttle delay in ms
 * @param {Function} helpers - Helper functions from store
 */
export function pushHistorySnapshotThrottled(state, delay, helpers) {
  const { _undoRedoManager, refreshMergedAppearanceData } = helpers

  _undoRedoManager.pushSnapshotThrottled(delay)
  refreshMergedAppearanceData()
}

/**
 * Perform undo operation
 * @param {Object} state - Current store state
 * @param {Function} helpers - Helper functions from store
 */
export function performUndo(state, helpers) {
  const { _undoRedoManager, refreshMergedAppearanceData,
          triggerFocusedPartUpdate } = helpers

  try {
    _undoRedoManager.undo()
    refreshMergedAppearanceData()
    triggerFocusedPartUpdate()
  } catch (e) {
    console.warn('[undo-redo-actions] undo failed', e)
  }
}

/**
 * Perform redo operation
 * @param {Object} state - Current store state
 * @param {Function} helpers - Helper functions from store
 */
export function performRedo(state, helpers) {
  const { _undoRedoManager, refreshMergedAppearanceData,
          triggerFocusedPartUpdate } = helpers

  try {
    _undoRedoManager.redo()
    refreshMergedAppearanceData()
    triggerFocusedPartUpdate()
  } catch (e) {
    console.warn('[undo-redo-actions] redo failed', e)
  }
}

/**
 * Start a history transaction (for merging high-frequency operations)
 * @param {Object} state - Current store state
 * @param {string} tag - Optional tag to identify the transaction
 * @param {Function} helpers - Helper functions from store
 */
export function startHistoryTransaction(state, tag, helpers) {
  const { _undoRedoManager } = helpers

  _undoRedoManager.startTransaction(tag)
}

/**
 * End a history transaction
 * @param {Object} state - Current store state
 * @param {Function} helpers - Helper functions from store
 */
export function endHistoryTransaction(state, helpers) {
  const { _undoRedoManager } = helpers

  _undoRedoManager.endTransaction()
}

/**
 * Clear all history
 * @param {Object} state - Current store state
 * @param {Function} helpers - Helper functions from store
 */
export function clearHistory(state, helpers) {
  const { _undoRedoManager } = helpers

  _undoRedoManager.clearHistory()
}

/**
 * Check if undo is available
 * @param {Object} state - Current store state
 * @returns {boolean} True if undo is available
 */
export function canUndo(state) {
  return state._undoRedoManager ? state._undoRedoManager.canUndo() : false
}

/**
 * Check if redo is available
 * @param {Object} state - Current store state
 * @returns {boolean} True if redo is available
 */
export function canRedo(state) {
  return state._undoRedoManager ? state._undoRedoManager.canRedo() : false
}
