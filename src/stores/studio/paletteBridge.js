export function createStudioPaletteBridge(studio, palette) {
  const hasDomain = !!studio && !!palette

  return {
    get paletteSnapshot() {
      return hasDomain ? palette.paletteSnapshot : {}
    },

    get paletteMap() {
      return hasDomain ? palette.paletteMap : {}
    },

    get savedColors() {
      return hasDomain ? palette.savedColors : []
    },

    get paletteModeActive() {
      return hasDomain ? palette.paletteModeActive : false
    },

    get paletteWorkMode() {
      return hasDomain ? palette.paletteWorkMode : 'external'
    },

    get paletteUpdateFlag() {
      return hasDomain ? palette.paletteUpdateFlag : 0
    },

    get activePaletteTargets() {
      return hasDomain ? (studio.activePaletteTargets || []) : []
    },

    beginInteraction: (source = 'PalettePanel') => (hasDomain ? palette.beginInteraction(studio, source) : undefined),
    commitInteraction: () => (hasDomain ? palette.commitInteraction(studio) : false),
    forceEndRealtimeScope: (payload = {}) => (hasDomain ? palette.forceEndRealtimeScope(studio, payload) : false),
    applyDelta: (command) => (hasDomain ? palette.applyDelta(studio, command) : undefined),

    applyColorToActivePaletteTargets: (newColor, options = {}) => (
      hasDomain ? palette.applyColorToActivePaletteTargets(studio, newColor, options) : false
    ),
    applyTagToActivePaletteTargets: (tag, options = {}) => (
      hasDomain ? palette.applyTagToActivePaletteTargets(studio, tag, options) : false
    ),
    applyTagOffsetToActivePaletteTargets: (payload = {}, options = {}) => (
      hasDomain ? palette.applyTagOffsetToActivePaletteTargets(studio, payload, options) : false
    ),
    resetTagOffsetToTag: (tag, options = {}) => (
      hasDomain ? palette.resetTagOffsetToTag(studio, tag, options) : false
    ),
    detachTagOffsetToRaw: (payload = {}) => (
      hasDomain ? palette.detachTagOffsetToRaw(studio, payload) : false
    ),
    updatePaletteTag: (tag, newValue, options = {}) => (
      hasDomain ? palette.updatePaletteTag(studio, tag, newValue, options) : false
    ),
    renamePaletteTagAndReferences: (oldTag, newTag) => (
      hasDomain ? palette.renamePaletteTagAndReferences(studio, oldTag, newTag) : false
    ),
    deletePaletteTag: (tag) => (hasDomain ? palette.deletePaletteTag(studio, tag) : false),
    createTagAndReplaceInStacks: (value) => (hasDomain ? palette.createTagAndReplaceInStacks(studio, value) : null),

    addSavedColor: (value) => (hasDomain ? palette.addSavedColor(studio, value) : false),
    updateSavedColor: (idx, value) => (hasDomain ? palette.updateSavedColor(studio, idx, value) : false),
    deleteSavedColor: (idx) => (hasDomain ? palette.deleteSavedColor(studio, idx) : false),
    clearSavedColors: () => (hasDomain ? palette.clearSavedColors(studio) : false),

    setPaletteMode: (active = false, targets = []) => (hasDomain ? palette.setPaletteMode(studio, active, targets) : undefined),
    clearPaletteMode: () => (hasDomain ? palette.clearPaletteMode(studio) : undefined),
    setPaletteWorkMode: (mode = 'external') => (hasDomain ? palette.setPaletteWorkMode(studio, mode) : undefined),
    openPalettePanel: (targets = []) => (hasDomain ? palette.openPalettePanel(studio, targets) : undefined),
    closePalettePanel: (options = {}) => (hasDomain ? palette.closePalettePanel(studio, options) : undefined)
  }
}

export default createStudioPaletteBridge
