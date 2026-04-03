export function createStudioSelectionBridge(studio, selection) {
  const hasDomain = !!studio && !!selection

  return {
    get focusedPartIndex() {
      return hasDomain
        ? selection.focusedPartIndex
        : { stackIndex: null, partIndex: null }
    },

    get replaceTarget() {
      return hasDomain ? selection.replaceTarget : { active: false, key: null, item: null, isEmpty: false }
    },

    get selectedLayers() {
      return hasDomain ? selection.selectedLayers : []
    },

    get selectedLayersCount() {
      return hasDomain && Array.isArray(selection.selectedLayers) ? selection.selectedLayers.length : 0
    },

    get selectionMode() {
      return hasDomain ? selection.selectionMode : 'single'
    },

    get activeFocusContext() {
      return hasDomain ? selection.activeFocusContext : { property: null, subLayerIndex: null, timestamp: 0 }
    },

    get previewTool() {
      return hasDomain ? selection.previewTool : 'view'
    },

    clearReplaceTarget: () => (hasDomain ? studio.clearReplaceTarget() : undefined),
    clearLayerSelection: () => (hasDomain ? studio.clearLayerSelection() : undefined),
    setSelectionMode: (mode) => (hasDomain ? studio.setSelectionMode(mode) : undefined),
    setPreviewTool: (tool) => (hasDomain ? studio.setPreviewTool(tool) : undefined)
  }
}

export default createStudioSelectionBridge
