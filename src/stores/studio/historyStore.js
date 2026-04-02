import { defineStore } from 'pinia'
import { fastClone } from '@/utils/clone'
import UndoRedoManager from '@/utils/undo_redo'

export const useStudioHistoryStore = defineStore('studioHistory', {
  state: () => ({
    _undoRedoManager: null,
    historyRevision: 0
  }),

  actions: {
    _ensureUndoRedo(studio) {
      if (this._undoRedoManager) return
      if (!studio) return

      this._undoRedoManager = new UndoRedoManager({
        captureState: () => {
          return {
            stacks: studio._sanitizeStacksForPersistence(studio.stacks),
            paletteMap: fastClone(studio.paletteMap),
            _paletteNextCounter: studio._paletteNextCounter,
            focusedPartIndex: fastClone(studio.focusedPartIndex),
            selectedLayers: fastClone(studio.selectedLayers),
            selectionMode: studio.selectionMode,
            activeFocusContext: fastClone(studio.activeFocusContext),
            previewTool: studio.previewTool,
            focusState: fastClone(studio.focusState)
          }
        },
        restoreState: (snapshot) => {
          studio.stacks = studio._sanitizeStacksForPersistence(snapshot.stacks)
          studio.paletteMap = fastClone(snapshot.paletteMap)
          studio._paletteNextCounter = snapshot._paletteNextCounter || 1
          studio.focusedPartIndex = fastClone(snapshot.focusedPartIndex)

          if (snapshot.focusState) {
            studio.focusState = fastClone(snapshot.focusState)
            studio._syncLegacyFromFocusState()
          } else {
            if (Array.isArray(snapshot.selectedLayers)) {
              studio.selectedLayers = fastClone(snapshot.selectedLayers)
            }
            if (snapshot.selectionMode === 'single' || snapshot.selectionMode === 'multiple') {
              studio.selectionMode = snapshot.selectionMode
            }
            if (snapshot.activeFocusContext) {
              studio.activeFocusContext = fastClone(snapshot.activeFocusContext)
            }
            if (snapshot.previewTool === 'view' || snapshot.previewTool === 'move') {
              studio.previewTool = snapshot.previewTool
            }
            studio._syncFocusStateScopeFromFocusedPart()
            studio._syncFocusStateSelectionFromLegacy()
            studio._syncFocusStateEditorFromLegacy()
            studio.focusState.tool.preview = studio.previewTool
          }

          studio._paletteVersion++
          studio.RebuildAllStacksLayerEntriesFromParts()
          studio._refreshAllLayerEntriesFromPalette()
          studio.refreshMergedAppearanceData()

          if (studio.focusedPartIndex.stackIndex !== null && studio.focusedPartIndex.partIndex !== null) {
            studio.triggerFocusedPartUpdate()
          }
        },
        onChange: () => {
          this.historyRevision += 1
        },
        maxHistory: 100,
        throttleInterval: 150,
        enableLogging: false
      })
    },

    startHistoryTransaction(studio, tag = null) {
      this._ensureUndoRedo(studio)
      if (!this._undoRedoManager) return
      this._undoRedoManager.startTransaction(tag)
    },

    endHistoryTransaction(studio) {
      this._ensureUndoRedo(studio)
      if (!this._undoRedoManager) return
      this._undoRedoManager.endTransaction()
    },

    cancelHistoryTransaction(studio) {
      this._ensureUndoRedo(studio)
      if (!this._undoRedoManager) return
      this._undoRedoManager.cancelTransaction()
    },

    pushHistorySnapshot(studio, historyMeta = null) {
      this._ensureUndoRedo(studio)
      if (!this._undoRedoManager) return
      this._undoRedoManager.pushSnapshot(historyMeta)
    },

    pushHistorySnapshotThrottled(studio, delay = null, historyMeta = null) {
      this._ensureUndoRedo(studio)
      if (!this._undoRedoManager) return

      let resolvedDelay = delay
      let resolvedMeta = historyMeta
      if (resolvedDelay && typeof resolvedDelay === 'object' && resolvedMeta === null) {
        resolvedMeta = resolvedDelay
        resolvedDelay = null
      }

      this._undoRedoManager.pushSnapshotThrottled(resolvedDelay, resolvedMeta)
    },

    undo(studio) {
      this._ensureUndoRedo(studio)
      if (!this._undoRedoManager) return false
      return this._undoRedoManager.undo()
    },

    redo(studio) {
      this._ensureUndoRedo(studio)
      if (!this._undoRedoManager) return false
      return this._undoRedoManager.redo()
    },

    clearHistory(studio) {
      this._ensureUndoRedo(studio)
      if (!this._undoRedoManager) return false
      this._undoRedoManager.clearHistory()
      return true
    },

    getHistory(studio) {
      this._ensureUndoRedo(studio)
      if (!this._undoRedoManager) return {
        undoCount: 0,
        redoCount: 0,
        canUndo: false,
        canRedo: false
      }
      return this._undoRedoManager.getHistory()
    },

    getFullHistory(studio) {
      this._ensureUndoRedo(studio)
      if (!this._undoRedoManager) {
        return {
          undoStack: [],
          redoStack: [],
          undoCount: 0,
          redoCount: 0,
          canUndo: false,
          canRedo: false
        }
      }
      return this._undoRedoManager.getFullHistory()
    },

    jumpToHistoryState(studio, steps) {
      this._ensureUndoRedo(studio)
      if (!this._undoRedoManager) return false
      return this._undoRedoManager.jumpToState(steps)
    },

    canUndo(studio) {
      this._ensureUndoRedo(studio)
      if (!this._undoRedoManager) return false
      return this._undoRedoManager.canUndo()
    },

    canRedo(studio) {
      this._ensureUndoRedo(studio)
      if (!this._undoRedoManager) return false
      return this._undoRedoManager.canRedo()
    }
  }
})

export default useStudioHistoryStore
