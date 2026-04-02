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

function parseLayerKey(key) {
  const [stackRaw, partRaw, layerRaw] = String(key).split('-')
  const stackIndex = Number(stackRaw)
  const partIndex = Number(partRaw)
  const layerIndex = Number(layerRaw)
  if (!Number.isFinite(stackIndex) || !Number.isFinite(partIndex) || !Number.isFinite(layerIndex)) {
    return null
  }
  return { stackIndex, partIndex, layerIndex, _key: String(key) }
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
    },

    applyFocusState(focusState) {
      this.focusState = fastClone(focusState || createDefaultFocusState())

      const scope = this.focusState?.scope || {}
      this.focusedPartIndex = {
        stackIndex: (typeof scope.stackIndex === 'number') ? scope.stackIndex : null,
        partIndex: (typeof scope.partIndex === 'number') ? scope.partIndex : null
      }

      const selection = this.focusState?.selection || {}
      this.selectionMode = selection.mode === 'multiple' ? 'multiple' : 'single'
      const layerKeys = Array.isArray(selection.layerKeys) ? selection.layerKeys : []
      this.selectedLayers = layerKeys
        .map(parseLayerKey)
        .filter(Boolean)

      const editor = this.focusState?.editor || {}
      this.activeFocusContext = {
        property: editor.property || null,
        subLayerIndex: editor.subLayerIndex ?? null,
        timestamp: editor.timestamp || 0
      }

      const tool = this.focusState?.tool || {}
      this.previewTool = tool.preview === 'move' ? 'move' : 'view'
    }
  }
})

export default useStudioSelectionStore
