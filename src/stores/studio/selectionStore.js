import { defineStore } from 'pinia'
import { fastClone } from '@/utils/clone.js'

function createDefaultFocusedPartIndex() {
  return {
    stackIndex: null,
    partIndex: null
  }
}

function createDefaultReplaceTarget() {
  return {
    active: false,
    key: null,
    item: null,
    isEmpty: false
  }
}

function createDefaultActiveFocusContext() {
  return {
    property: null,
    subLayerIndex: null,
    timestamp: 0
  }
}

function createDefaultFocusState() {
  return {
    scope: {
      stackIndex: null,
      partIndex: null,
      partUid: null
    },
    selection: {
      mode: 'single',
      layerKeys: [],
      anchorLayerKey: null
    },
    editor: {
      property: null,
      subLayerIndex: null,
      timestamp: 0
    },
    tool: {
      preview: 'view'
    }
  }
}

export const useStudioSelectionStore = defineStore('studioSelection', {
  state: () => ({
    focusedPartIndex: createDefaultFocusedPartIndex(),
    replaceTarget: createDefaultReplaceTarget(),
    selectedLayers: [],
    selectionMode: 'single',
    activeFocusContext: createDefaultActiveFocusContext(),
    previewTool: 'view',
    focusState: createDefaultFocusState()
  }),

  actions: {
    syncFromLegacyState(payload = {}) {
      this.focusedPartIndex = fastClone(payload.focusedPartIndex || createDefaultFocusedPartIndex())
      this.replaceTarget = fastClone(payload.replaceTarget || createDefaultReplaceTarget())
      this.selectedLayers = Array.isArray(payload.selectedLayers) ? fastClone(payload.selectedLayers) : []
      this.selectionMode = payload.selectionMode === 'multiple' ? 'multiple' : 'single'
      this.activeFocusContext = fastClone(payload.activeFocusContext || createDefaultActiveFocusContext())
      this.previewTool = payload.previewTool === 'move' ? 'move' : 'view'
      this.focusState = fastClone(payload.focusState || createDefaultFocusState())
    }
  }
})

export default useStudioSelectionStore
