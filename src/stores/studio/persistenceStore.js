import { defineStore } from 'pinia'
import { fastClone } from '@/utils/clone.js'
import { setTimeoutHost, clearTimeoutHost } from '@/utils/host-window.js'
import * as StorageActions from '@/studio/storage-actions.js'
import * as SaveActions from '@/studio/save-actions.js'
import { StudioStorageService } from '@/services/StudioStorageService'

export const useStudioPersistenceStore = defineStore('studioPersistence', {
  state: () => ({
    autoSaveEnabled: true,
    lastSaveTime: null,
    saveStatus: 'idle',
    _saveStatusTimeout: null,
    currentSaveId: null
  }),

  actions: {
    _syncLegacyPersistenceState(studio) {
      if (!studio) return
      studio.autoSaveEnabled = this.autoSaveEnabled
      studio.lastSaveTime = this.lastSaveTime
      studio.saveStatus = this.saveStatus
      studio._saveStatusTimeout = this._saveStatusTimeout
      studio.currentSaveId = this.currentSaveId
    },

    _scheduleStatusReset(delayMs, studio) {
      if (this._saveStatusTimeout) {
        clearTimeoutHost(this._saveStatusTimeout)
      }

      this._saveStatusTimeout = setTimeoutHost(() => {
        if (this.saveStatus === 'saved' || this.saveStatus === 'error') {
          this.saveStatus = 'idle'
        }
        this._saveStatusTimeout = null
        this._syncLegacyPersistenceState(studio)
      }, delayMs)

      this._syncLegacyPersistenceState(studio)
    },

    _refreshStudioAfterDataLoad(studio) {
      if (!studio) return
      studio.RebuildAllStacksLayerEntriesFromParts()
      studio._refreshAllLayerEntriesFromPalette()
      studio.refreshMergedAppearanceData()
    },

    sanitizeStacksForPersistence(stacks = null, studio = null) {
      const sourceStacks = Array.isArray(stacks)
        ? stacks
        : (Array.isArray(studio?.stacks) ? studio.stacks : [])
      const sanitizedStacks = fastClone(sourceStacks)

      const stripDerivedLayerEntries = (parts) => {
        if (!Array.isArray(parts)) return
        for (const part of parts) {
          if (!part || typeof part !== 'object') continue
          if (Object.prototype.hasOwnProperty.call(part, 'layerEntries')) {
            delete part.layerEntries
          }
          if (Array.isArray(part.drawData)) {
            stripDerivedLayerEntries(part.drawData)
          }
        }
      }

      for (const stack of sanitizedStacks) {
        if (stack && typeof stack === 'object' && Array.isArray(stack.data)) {
          stripDerivedLayerEntries(stack.data)
        }
      }

      return sanitizedStacks
    },

    persistStacksToLocalStorage(studio) {
      if (!studio) return false
      return StorageActions.persistStacksToLocalStorage(studio)
    },

    loadStacksFromLocalStorage(studio) {
      if (!studio) return false

      const result = StorageActions.loadStacksFromLocalStorage()
      if (!result) return false

      studio.stacks = this.sanitizeStacksForPersistence(result.stacks, studio)
      if (result._partUidCounter) {
        studio._partUidCounter = result._partUidCounter
      }
      this._refreshStudioAfterDataLoad(studio)
      return true
    },

    persistPaletteToLocalStorage(studio) {
      if (!studio) return false
      return StorageActions.persistPaletteToLocalStorage(studio)
    },

    loadPaletteFromLocalStorage(studio) {
      if (!studio) return false

      const result = StorageActions.loadPaletteFromLocalStorage()
      if (!result) return false

      studio.paletteMap = result.paletteMap || {}
      studio._paletteVersion++
      if (result._paletteNextCounter) {
        studio._paletteNextCounter = result._paletteNextCounter
      }
      studio._refreshAllLayerEntriesFromPalette()
      studio.refreshMergedAppearanceData()
      return true
    },

    exportStacksToJsonFile(studio, filename = 'stacks.json') {
      if (!studio) return false
      return StorageActions.exportStacksToJsonFile(studio, filename)
    },

    async importStacksFromJsonFile(studio, file) {
      if (!studio) return false

      const result = await StorageActions.importStacksFromJsonFile(file)
      if (!result.success) return false

      studio.stacks = this.sanitizeStacksForPersistence(result.stacks, studio)
      if (result._partUidCounter) {
        studio._partUidCounter = result._partUidCounter
      }
      this._refreshStudioAfterDataLoad(studio)
      return true
    },

    exportPaletteToJsonFile(studio, filename = 'palette.json') {
      if (!studio) return false
      return StorageActions.exportPaletteToJsonFile(studio, filename)
    },

    async importPaletteFromJsonFile(studio, file) {
      if (!studio) return false

      const result = await StorageActions.importPaletteFromJsonFile(file)
      if (!result.success) return false

      studio.paletteMap = result.paletteMap
      studio._paletteVersion++
      if (result._paletteNextCounter) {
        studio._paletteNextCounter = result._paletteNextCounter
      }
      studio._refreshAllLayerEntriesFromPalette()
      studio.refreshMergedAppearanceData()
      return true
    },

    exportStudioSnapshot(studio, filename = 'studio_snapshot.json') {
      if (!studio) return false
      return StorageActions.exportStudioSnapshot(studio, filename)
    },

    async importStudioSnapshotFromFile(studio, file) {
      if (!studio) return false

      const result = await StorageActions.importStudioSnapshotFromFile(file)
      if (!result.success) return false

      const { data } = result
      if (data.stacks) {
        studio.stacks = this.sanitizeStacksForPersistence(data.stacks, studio)
      }
      if (data.paletteMap) {
        studio.paletteMap = data.paletteMap
        studio._paletteVersion++
      }
      if (data._paletteNextCounter) {
        studio._paletteNextCounter = data._paletteNextCounter
      }
      if (data._partUidCounter) {
        studio._partUidCounter = data._partUidCounter
      }

      this._refreshStudioAfterDataLoad(studio)
      return true
    },

    getMergedAppearanceForExport(studio) {
      if (!studio) return { data: [] }
      return SaveActions.getMergedAppearanceForExport(studio)
    },

    enableAutoSave(studio) {
      this.autoSaveEnabled = true
      this._syncLegacyPersistenceState(studio)
      return { autoSaveEnabled: this.autoSaveEnabled }
    },

    disableAutoSave(studio) {
      this.autoSaveEnabled = false
      this._syncLegacyPersistenceState(studio)
      return { autoSaveEnabled: this.autoSaveEnabled }
    },

    async saveToLocalStorage(studio) {
      if (!studio) return false

      this.saveStatus = 'saving'
      this._syncLegacyPersistenceState(studio)

      const result = await SaveActions.saveToLocalStorage(studio)
      if (result.success) {
        this.lastSaveTime = result.lastSaveTime
        this.saveStatus = result.saveStatus
      } else {
        this.saveStatus = result.saveStatus || 'error'
      }

      this._scheduleStatusReset(2000, studio)
      return result.success
    },

    async restoreFromLocalStorage(studio) {
      if (!studio) return { restored: false, reason: 'missing-studio' }

      const result = await SaveActions.restoreFromLocalStorage()
      if (!result.restored) {
        return result
      }

      const data = result.data
      if (data.stacks) {
        studio.stacks = this.sanitizeStacksForPersistence(data.stacks, studio)
      }
      if (data.paletteMap) {
        studio.paletteMap = data.paletteMap
      }
      if (typeof data._paletteNextCounter === 'number') {
        studio._paletteNextCounter = data._paletteNextCounter
      }
      if (typeof data._partUidCounter === 'number') {
        studio._partUidCounter = data._partUidCounter
      }
      if (typeof data.selectedIndex === 'number') {
        studio.selectedIndex = data.selectedIndex
      }
      if (typeof data.focusedPartIndex === 'object' && data.focusedPartIndex !== null) {
        studio.focusedPartIndex = fastClone(data.focusedPartIndex)
      }

      if (data.focusState && typeof data.focusState === 'object') {
        studio.focusState = fastClone(data.focusState)
        studio._syncLegacyFromFocusState()
      } else {
        if (Array.isArray(data.selectedLayers)) {
          studio.selectedLayers = fastClone(data.selectedLayers)
        }
        if (data.selectionMode === 'single' || data.selectionMode === 'multiple') {
          studio.selectionMode = data.selectionMode
        }
        if (data.activeFocusContext && typeof data.activeFocusContext === 'object') {
          studio.activeFocusContext = fastClone(data.activeFocusContext)
        }
        if (data.previewTool === 'view' || data.previewTool === 'move') {
          studio.previewTool = data.previewTool
        }
        studio._syncFocusStateScopeFromFocusedPart()
        studio._syncFocusStateSelectionFromLegacy()
        studio._syncFocusStateEditorFromLegacy()
        studio.focusState.tool.preview = studio.previewTool
      }

      studio._paletteVersion++
      this._refreshStudioAfterDataLoad(studio)

      this.lastSaveTime = result.timestamp
      this._syncLegacyPersistenceState(studio)

      if (studio.focusedPartIndex.stackIndex !== null && studio.focusedPartIndex.partIndex !== null) {
        studio.triggerFocusedPartUpdate()
      }

      return {
        restored: true,
        timestamp: result.timestamp,
        age: result.age
      }
    },

    clearLocalStorage(studio) {
      const result = SaveActions.clearLocalStorage()
      if (!result) return result

      if (this._saveStatusTimeout) {
        clearTimeoutHost(this._saveStatusTimeout)
      }
      this.lastSaveTime = null
      this.saveStatus = 'idle'
      this._saveStatusTimeout = null
      this._syncLegacyPersistenceState(studio)
      return true
    },

    async getAutoSaveInfo() {
      return SaveActions.getAutoSaveInfo()
    },

    async autoSave(studio) {
      if (!studio || !this.autoSaveEnabled) return

      this.saveStatus = 'saving'
      this._syncLegacyPersistenceState(studio)

      const result = SaveActions.autoSave(studio)
      if (result.success) {
        this.lastSaveTime = result.lastSaveTime
        this.saveStatus = result.saveStatus
      } else {
        this.saveStatus = result.saveStatus || 'error'
      }

      this._scheduleStatusReset(result.success ? 2000 : 3000, studio)
    },

    async saveStudioSession(studio, name) {
      if (!studio) {
        return { success: false, error: 'Missing studio store' }
      }

      this.saveStatus = 'saving'
      this._syncLegacyPersistenceState(studio)

      const result = SaveActions.saveStudioSession(studio, name)
      if (result.success) {
        this.currentSaveId = result.id
        this.lastSaveTime = result.lastSaveTime
        this.saveStatus = result.saveStatus
      } else {
        this.saveStatus = result.saveStatus || 'error'
      }

      this._scheduleStatusReset(result.success ? 2000 : 3000, studio)
      return { success: result.success, error: result.error }
    },

    async loadStudioSession(studio, id) {
      if (!studio) {
        return { success: false, error: 'Missing studio store' }
      }

      const result = SaveActions.loadStudioSession(id)
      if (!result.success) {
        return { success: false, error: result.error }
      }

      const { data } = result
      studio.stacks = this.sanitizeStacksForPersistence(data.stacks || [], studio)
      studio.paletteMap = data.paletteMap || {}
      studio._paletteNextCounter = data._paletteNextCounter || 0
      studio._partUidCounter = data._partUidCounter || 0
      studio.selectedIndex = data.selectedIndex ?? -1
      this.currentSaveId = id

      studio._paletteVersion++
      this._refreshStudioAfterDataLoad(studio)
      this._syncLegacyPersistenceState(studio)

      return { success: true }
    },

    renameStudioSession(studio, id, newName) {
      const normalizedName = String(newName || '').trim()
      if (!normalizedName) {
        return { success: false, error: 'Invalid save name' }
      }

      const result = StudioStorageService.renameSave(id, normalizedName)
      this._syncLegacyPersistenceState(studio)
      return result
    },

    deleteStudioSession(studio, id) {
      const result = StudioStorageService.deleteSave(id)
      if (result?.success && this.currentSaveId === id) {
        this.currentSaveId = null
      }
      this._syncLegacyPersistenceState(studio)
      return result
    },

    async autoRestoreSession(studio) {
      const result = SaveActions.autoRestoreSession()
      if (!result.restored) {
        return result
      }

      const loadResult = await this.loadStudioSession(studio, result.save.id)
      if (loadResult.success) {
        return { restored: true, save: result.save }
      }
      return { restored: false }
    }
  }
})

export default useStudioPersistenceStore
