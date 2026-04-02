export function createStudioPersistenceBridge(studio, persistence) {
  const hasDomain = !!studio && !!persistence

  return {
    get stacks() {
      return hasDomain ? studio.stacks : []
    },

    get paletteMap() {
      return hasDomain ? studio.paletteMap : {}
    },

    get autoSaveEnabled() {
      return hasDomain ? persistence.autoSaveEnabled : false
    },

    get saveStatus() {
      return hasDomain ? persistence.saveStatus : 'idle'
    },

    get lastSaveTime() {
      return hasDomain ? persistence.lastSaveTime : null
    },

    get currentSaveId() {
      return hasDomain ? persistence.currentSaveId : null
    },

    enableAutoSave: () => (hasDomain ? persistence.enableAutoSave(studio) : { autoSaveEnabled: false }),
    disableAutoSave: () => (hasDomain ? persistence.disableAutoSave(studio) : { autoSaveEnabled: false }),
    saveToLocalStorage: () => (hasDomain ? persistence.saveToLocalStorage(studio) : false),
    restoreFromLocalStorage: () => (hasDomain ? persistence.restoreFromLocalStorage(studio) : { restored: false }),
    clearLocalStorage: () => (hasDomain ? persistence.clearLocalStorage(studio) : false),
    getAutoSaveInfo: () => (hasDomain ? persistence.getAutoSaveInfo() : { exists: false }),
    autoSave: () => (hasDomain ? persistence.autoSave(studio) : undefined),
    autoRestoreSession: () => (hasDomain ? persistence.autoRestoreSession(studio) : { restored: false }),
    saveStudioSession: (name) => (hasDomain ? persistence.saveStudioSession(studio, name) : { success: false }),
    loadStudioSession: (id) => (hasDomain ? persistence.loadStudioSession(studio, id) : { success: false }),
    renameStudioSession: (id, newName) => (hasDomain ? persistence.renameStudioSession(studio, id, newName) : { success: false }),
    deleteStudioSession: (id) => (hasDomain ? persistence.deleteStudioSession(studio, id) : { success: false }),
    persistStacksToLocalStorage: () => (hasDomain ? persistence.persistStacksToLocalStorage(studio) : false),
    loadStacksFromLocalStorage: () => (hasDomain ? persistence.loadStacksFromLocalStorage(studio) : false),
    persistPaletteToLocalStorage: () => (hasDomain ? persistence.persistPaletteToLocalStorage(studio) : false),
    loadPaletteFromLocalStorage: () => (hasDomain ? persistence.loadPaletteFromLocalStorage(studio) : false),
    exportStacksToJsonFile: (filename) => (hasDomain ? persistence.exportStacksToJsonFile(studio, filename) : false),
    importStacksFromJsonFile: (file) => (hasDomain ? persistence.importStacksFromJsonFile(studio, file) : false),
    exportPaletteToJsonFile: (filename) => (hasDomain ? persistence.exportPaletteToJsonFile(studio, filename) : false),
    importPaletteFromJsonFile: (file) => (hasDomain ? persistence.importPaletteFromJsonFile(studio, file) : false),
    exportStudioSnapshot: (filename) => (hasDomain ? persistence.exportStudioSnapshot(studio, filename) : false),
    importStudioSnapshotFromFile: (file) => (hasDomain ? persistence.importStudioSnapshotFromFile(studio, file) : false),
    getMergedAppearanceForExport: () => (hasDomain ? persistence.getMergedAppearanceForExport(studio) : { data: [] })
  }
}

export default createStudioPersistenceBridge
