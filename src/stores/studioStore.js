/**
 * NOTE:
 * This file manages the studio state with unified focus system (focusState) and
 * per-part _uid bookkeeping so components can refer to parts by reference or uid.
 */
import { defineStore } from 'pinia'
import { toRaw } from 'vue'

// Clone utilities
import { fastClone, shallowClone } from '@/utils/clone.js'

// Action modules
import * as PaletteActions from '@/studio/palette-actions.js'
import * as FocusActions from '@/studio/focus-actions.js'
import * as RenderingActions from '@/studio/rendering-actions.js'
import * as LayerActions from '@/studio/layer-actions.js'
import * as SelectionActions from '@/studio/selection-actions.js'
import * as PreviewActions from '@/studio/preview-actions.js'
import * as PriorityActions from '@/studio/priority-actions.js'
import { getStudioFacade } from '@/studio/StudioFacade'
import {
  PANEL_HOST,
  PANEL_VISIBILITY,
  createHostActiveDefaults,
  createPanelRuntimeDefaults
} from '@/studio/panel-system'
import {
  isStudioFacadeEnabled,
  isRenderReconstructFromLayerEntriesEnabled
} from '@/config/featureFlags'

/*
  NOTE:
  - Palette functions: '@/services/PaletteService'
  - Asset index functions: '@/services/AssetIndexService'
  - Layer translator functions: '@/services/LayerTranslator'
*/
import * as Palette from '@/services/PaletteService'
import * as LayerTranslator from '@/services/LayerTranslator'
import { useStudioPanelStore } from '@/stores/studio/panelStore'
import { useStudioHistoryStore } from '@/stores/studio/historyStore'
import { useStudioPersistenceStore } from '@/stores/studio/persistenceStore'
import { useStudioSelectionStore } from '@/stores/studio/selectionStore'
import { useStudioPaletteStore } from '@/stores/studio/paletteStore'
import { useStudioRenderStore } from '@/stores/studio/renderStore'
import { useStudioCoreStore } from '@/stores/studio/coreStore'
import { useStudioAssetStore } from '@/stores/studio/assetStore'

// PriorityService (refactored)
import PriorityService from '@/services/PriorityService'

/**
 * Simple hash for part content (used for caching layer entries)
 */
function hashPartForCache(part) {
  if (!part) return ''
  try {
    // Only hash the fields that affect layer entries
    const relevant = {
      Name: part.Name,
      Group: part.Group,
      Color: part.Color,
      Property: part.Property
    }
    return JSON.stringify(relevant)
  } catch (e) {
    return ''
  }
}

// Layer entries cache (WeakMap for automatic cleanup)
const layerEntriesCache = new WeakMap()

const DATA_HISTORY_ACTION_ALLOWLIST = new Set([
  'part.updateMetadata',
  'part.updateProperty',
  'part.applyLayerDeltas',
  'layer.batchApplyLayerDeltas',
  'batch.updateOpacity',
  'batch.updateOffset',
  'batch.updateColor',
  'batch.updatePriority',
  'palette.applyColor',
  'palette.applyTag',
  'palette.applyTagOffset',
  'palette.resetTagOffset',
  'palette.updateTag',
  'palette.createTagAndReplace',
  'palette.renameTagReferences',
  'palette.deleteTag',
  'palette.clear',
  'palette.savedColor.add',
  'palette.savedColor.update',
  'palette.savedColor.delete',
  'palette.savedColor.clear',
  'stack.add',
  'stack.remove',
  'stack.move',
  'stack.clear',
  'stack.rename',
  'asset.apply'
])

function ensureSelectionProxyBindings(store) {
  if (!store || store._selectionDomainProxyReady === true) return store

  const selectionStore = useStudioSelectionStore()
  const proxyKeys = [
    'replaceTarget',
    'selectedLayers',
    'selectionMode',
    'activeFocusContext',
    'previewTool',
    'focusState'
  ]

  for (const key of proxyKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(store, key)
    if (descriptor && (descriptor.get || descriptor.set)) continue

    Object.defineProperty(store, key, {
      configurable: true,
      enumerable: true,
      get: () => selectionStore[key],
      set: (value) => {
        selectionStore[key] = value
      }
    })
  }

  if (store.focusedPartIndex && typeof store.focusedPartIndex === 'object') {
    selectionStore.focusedPartIndex = {
      stackIndex: (typeof store.focusedPartIndex.stackIndex === 'number') ? store.focusedPartIndex.stackIndex : null,
      partIndex: (typeof store.focusedPartIndex.partIndex === 'number') ? store.focusedPartIndex.partIndex : null
    }
  }

  store._selectionDomainProxyReady = true
  return store
}

function ensurePaletteProxyBindings(store) {
  if (!store || store._paletteDomainProxyReady === true) return store

  const paletteStore = useStudioPaletteStore()
  const proxyKeys = [
    'paletteMap',
    'savedColors',
    '_paletteNextCounter',
    '_paletteVersion',
    'paletteModeActive',
    'paletteWorkMode',
    'paletteUpdateFlag',
    '_paletteRealtimeMode',
    '_paletteRealtimeDirty',
    '_paletteRealtimeHistoryMeta',
    '_paletteRealtimeInteractionKind'
  ]

  for (const key of proxyKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(store, key)
    if (descriptor && (descriptor.get || descriptor.set)) continue

    Object.defineProperty(store, key, {
      configurable: true,
      enumerable: true,
      get: () => paletteStore[key],
      set: (value) => {
        paletteStore[key] = value
      }
    })
  }

  store._paletteDomainProxyReady = true
  return store
}

function ensureRenderProxyBindings(store) {
  if (!store || store._renderDomainProxyReady === true) return store

  const renderStore = useStudioRenderStore()
  const proxyKeys = [
    'mergedAppearanceData',
    'renderer',
    'previewRenderer',
    'useOptimizedRenderer',
    'renderPipeline',
    '_renderPipelineLastStats',
    'translatedLayerEntries',
    '_refreshScheduler',
    '_pendingMergedRefresh',
    '_pendingLayerRefresh',
    '_previewStack',
    '_activePreviewId'
  ]

  for (const key of proxyKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(store, key)
    if (descriptor && (descriptor.get || descriptor.set)) continue

    Object.defineProperty(store, key, {
      configurable: true,
      enumerable: true,
      get: () => renderStore[key],
      set: (value) => {
        renderStore[key] = value
      }
    })
  }

  store._renderDomainProxyReady = true
  return store
}

const useStudioStoreBase = defineStore('studio', {
  state: () => ({
    stacks: [],
    selectedIndex: -1,

    // NEW: Only use focusedPartIndex to locate the focused part
    focusedPartIndex: {
      stackIndex: null,
      partIndex: null
    },
    layerManagerActive: false,

    assetGroupsRaw: [],
    assetIndex: {},

    // internal per-part uid counter and mapping
    _partUidCounter: 1,

    // NEW: central palette panel visibility (UI-level)
    palettePanelVisible: false,

    focusedPartUpdateFlag: 0,


    // Editor realtime update session (used for preview-move, layer-edit, batch-edit, priority-drag)
    _editorRealtimeMode: false,
    _editorRealtimeDirty: false,
    _editorRealtimeHistoryMeta: null,
    _editorRealtimeInteractionKind: null,

    // Phase F observability: centralized mutation telemetry counters.
    _mutationStats: {
      totalCalls: 0,
      deferredCalls: 0,
      committedCalls: 0,
      scopeCalls: {
        palette: 0,
        editor: 0,
        batch: 0,
        asset: 0,
        stack: 0,
        generic: 0
      },
      scheduleLayerCalls: 0,
      schedulePartCalls: 0,
      scheduleRefreshCalls: 0,
      refreshMergedCalls: 0,
      touchFocusedPartCalls: 0,
      historyImmediateCalls: 0,
      historyThrottledCalls: 0,
      historyNoneCalls: 0,
      lastScope: null,
      lastHistoryMode: null,
      lastHistoryActionType: null,
      lastWasDeferred: false,
      lastMutationAt: 0
    },

    batchEditBuffer: {
      opacity: null,
      offsetX: null,
      offsetY: null,
      color: null,
      priority: null
    },

    // History panel visibility
    historyPanelVisible: false,
    // Studio V2 UI state
    workspaceMode: 'pro', // fixed to 'pro'
    // Deprecated: legacy stage state machine is no longer used for UI gating.
    // Keep this field only for backward compatibility with older callers.
    taskStage: 'assemble', // legacy: 'assemble' | 'replace' | 'polish' | 'commit'
    activeContextPanel: null, // 'inspector' | 'asset' | null
    panelStates: {
      inspector: 'pinned',
      asset: 'hidden',
      palette: 'hidden',
      layer: 'hidden',
      history: 'hidden',
      saves: 'hidden'
    }, // 'pinned' | 'peek' | 'hidden'
    panelRuntime: createPanelRuntimeDefaults(),
    hostActivePanels: createHostActiveDefaults(),
    historyTrayExpanded: false,
    storageModalVisible: false,
    pinnedPanel: null,
    mobileTab: 'structure', // 'structure' | 'replace' | 'property' | 'history'
    firstRunGuideDone: false,

    // Preview stack and refresh scheduler state moved to renderStore (Wave 6).
  }),

  getters: {
    selectedElement(state) {
      if (state.selectedIndex < 0 || state.selectedIndex >= state.stacks.length) return null
      return state.stacks[state.selectedIndex]
    },

    // NEW: Computed getter for focusedPart based on focusedPartIndex
    focusedPart(state) {
      const idx = state.focusedPartIndex
      if (idx.stackIndex === null || idx.partIndex === null) return null
      if (idx.stackIndex < 0 || idx.stackIndex >= state.stacks.length) return null

      const stack = state.stacks[idx.stackIndex]
      if (!stack || !Array.isArray(stack.data)) return null
      if (idx.partIndex < 0 || idx.partIndex >= stack.data.length) return null

      return stack.data[idx.partIndex]
    },

    getAssetsByGroup(state) {
      return (groupName) => {
        if (!groupName) return []
        return state.assetIndex[groupName] || []
      }
    },
    paletteSnapshot(state) {
      return Palette.paletteSnapshot(state.paletteMap)
    },

    activePaletteTargets(state) {
      if (!state.paletteModeActive) return []
      const selected = this.getSelectedLayersData()
      return selected
        .filter(d => d.layer && d.layer.isColorable)
        .map(d => ({
          uid: d.part?._uid || null,
          stackIndex: d.selection?.stackIndex,
          partIndex: d.selection?.partIndex,
          layerIndex: (typeof d.layer?.colorableIndex === 'number') ? d.layer.colorableIndex : d.selection?.layerIndex,
          currentColorText: d.layer?.colorText || null,
          currentColorCss: this._resolveColorCssFromText(d.layer?.colorText || null)
        }))
    },

    // NEW: Get all focused layers data (unified getter)
    focusedLayersData() {
      return this.getSelectedLayersData()
    },

    // Check if move tool can be used (requires focused part)
    canUseMoveTool(state) {
      return PreviewActions.canUseMoveTool(state)
    },

    isPanelVisible(state) {
      return (panelId) => {
        if (!panelId || !state.panelRuntime?.[panelId]) return false
        return state.panelRuntime[panelId].state !== PANEL_VISIBILITY.HIDDEN
      }
    },

    getActivePanelForHost(state) {
      return (host) => {
        if (!host) return null
        return state.hostActivePanels?.[host] || null
      }
    }
  },

  actions: {
    // Action modules imported from separate files
    PaletteActions,
    FocusActions,
    RenderingActions,
    LayerActions,
    SelectionActions,
    PreviewActions,
    PriorityActions,

    // -------------------------
    // Layer manager toggle
    // -------------------------

    toggleLayerManager(val) {
      const nextVisible = typeof val === 'boolean' ? val : !this.layerManagerActive
      const panelStore = this._getPanelStore()
      if (nextVisible) {
        panelStore.openPanel('layer', {
          host: PANEL_HOST.TOOL_DOCK,
          state: PANEL_VISIBILITY.PINNED,
          reason: 'toggle-layer-manager'
        })
      } else {
        panelStore.closePanel('layer', { reason: 'toggle-layer-manager' })
      }
      this._syncPanelDomainState()
    },

    // -------------------------
    // Preview tool management
    // -------------------------

    /**
     * Set the preview tool mode
     * @param {string} tool - 'view' or 'move'
     */
    setPreviewTool(tool) {
      const result = PreviewActions.setPreviewTool(tool)
      this.previewTool = result.previewTool
      this.focusState.tool.preview = result.previewTool
    },

    /**
     * Toggle between view and move modes
     */
    togglePreviewTool() {
      const result = PreviewActions.togglePreviewTool(this)
      this.previewTool = result.previewTool
      this.focusState.tool.preview = result.previewTool
    },

    // -------------------------
    // Preview Stack Management
    // -------------------------
    // Coordinates preview rendering between components (Inspector vs Selector)
    // Ensures only the highest-priority preview is rendered

    /**
     * Push a preview onto the stack
     * @param {string} id - Unique identifier for this preview (e.g., 'asset-hover', 'layer-blink')
     * @param {number} priority - Higher priority takes precedence (0-10, layer-blink: 2, asset-hover: 1)
     * @param {object} previewData - The preview appearance data to render
     * @param {string} source - Description of preview source (for debugging)
     */
    pushPreview(id, priority, previewData, source = '') {
      const renderStore = this._getRenderStore()
      return renderStore.pushPreview(this, id, priority, previewData, source)
    },

    /**
     * Remove a preview from the stack
     * @param {string} id - ID of preview to remove
     */
    popPreview(id) {
      const renderStore = this._getRenderStore()
      return renderStore.popPreview(this, id)
    },

    /**
     * Internal: Update active preview based on max priority
     */
    _updateActivePreview() {
      const renderStore = this._getRenderStore()
      return renderStore.updateActivePreview(this)
    },

    /**
     * Check if a preview source is currently active
     * @param {string} id - Preview ID to check
     * @returns {boolean}
     */
    isPreviewActive(id) {
      const renderStore = this._getRenderStore()
      return renderStore.isPreviewActive(id)
    },

    // -------------------------
    // Preview tool management
    // -------------------------
    ensurePartUid(part) {
      const coreStore = this._getCoreStore()
      return coreStore.ensurePartUid(this, part)
    },

    findPartByUid(uid) {
      const coreStore = this._getCoreStore()
      return coreStore.findPartByUid(this, uid)
    },

    // -------------------------
    // replace mode helpers
    // -------------------------
    setReplaceTarget(item, key, isEmpty = false) {
      const result = FocusActions.setReplaceTargetState(this, item, key, isEmpty)
      this.replaceTarget = result.replaceTarget
      this.focusedPartIndex = { stackIndex: null, partIndex: null }
      this._syncFocusStateScopeFromFocusedPart()
      this.clearPropertyFocus()
      this.onReplaceEnter({ key, isEmpty })
    },

    clearReplaceTarget() {
      const result = FocusActions.clearReplaceTargetState()
      this.replaceTarget = result.replaceTarget
      this._syncPanelDomainState()
      // Deprecated flow: clearing replace target no longer mutates taskStage.
      if (this.activeContextPanel === 'asset' && this.pinnedPanel !== 'asset') {
        this.openContextPanel('inspector', 'replace-cleared')
      }
    },

    _getPanelStore() {
      return useStudioPanelStore()
    },

    _getHistoryStore() {
      return useStudioHistoryStore()
    },

    _getPersistenceStore() {
      return useStudioPersistenceStore()
    },

    _getSelectionStore() {
      return useStudioSelectionStore()
    },

    _getPaletteStore() {
      return useStudioPaletteStore()
    },

    _getRenderStore() {
      return useStudioRenderStore()
    },

    _getCoreStore() {
      return useStudioCoreStore()
    },

    _getAssetStore() {
      return useStudioAssetStore()
    },

    _syncFocusedPartIndexToSelectionDomain() {
      ensureSelectionProxyBindings(this)
      const selectionStore = this._getSelectionStore()
      selectionStore.focusedPartIndex = {
        stackIndex: (typeof this.focusedPartIndex?.stackIndex === 'number') ? this.focusedPartIndex.stackIndex : null,
        partIndex: (typeof this.focusedPartIndex?.partIndex === 'number') ? this.focusedPartIndex.partIndex : null
      }
    },

    _syncPanelDomainState() {
      const panelStore = this._getPanelStore()
      this.workspaceMode = panelStore.workspaceMode
      this.taskStage = panelStore.taskStage
      this.activeContextPanel = panelStore.activeContextPanel
      this.panelStates = panelStore.panelStates
      this.panelRuntime = panelStore.panelRuntime
      this.hostActivePanels = panelStore.hostActivePanels
      this.historyTrayExpanded = panelStore.historyTrayExpanded
      this.storageModalVisible = panelStore.storageModalVisible
      this.pinnedPanel = panelStore.pinnedPanel
      this.mobileTab = panelStore.mobileTab
      this.firstRunGuideDone = panelStore.firstRunGuideDone
      this.palettePanelVisible = panelStore.palettePanelVisible
      this.layerManagerActive = panelStore.layerManagerActive
      this.historyPanelVisible = panelStore.historyPanelVisible
    },

    setWorkspaceMode() {
      const panelStore = this._getPanelStore()
      panelStore.setWorkspaceMode()
      this._syncPanelDomainState()
    },

    setTaskStage(stage = 'assemble') {
      const panelStore = this._getPanelStore()
      panelStore.setTaskStage(stage)
      this._syncPanelDomainState()
    },

    openPanel(panelId, options = {}) {
      const panelStore = this._getPanelStore()
      const result = panelStore.openPanel(panelId, options)
      this._syncPanelDomainState()
      return result
    },

    closePanel(panelId, options = {}) {
      const panelStore = this._getPanelStore()
      const result = panelStore.closePanel(panelId, options)
      this._syncPanelDomainState()
      return result
    },

    togglePanel(panelId, options = {}) {
      const panelStore = this._getPanelStore()
      const result = panelStore.togglePanel(panelId, options)
      this._syncPanelDomainState()
      return result
    },

    setHistoryTrayExpanded(expanded = false) {
      const panelStore = this._getPanelStore()
      panelStore.setHistoryTrayExpanded(expanded)
      this._syncPanelDomainState()
    },

    setStorageModalVisible(visible = false) {
      const panelStore = this._getPanelStore()
      panelStore.setStorageModalVisible(visible)
      this._syncPanelDomainState()
    },

    openContextPanel(panel, reason = 'manual') {
      const panelStore = this._getPanelStore()
      panelStore.openContextPanel(panel, reason)
      this._syncPanelDomainState()
    },

    pinPanel(panel) {
      const panelStore = this._getPanelStore()
      panelStore.pinPanel(panel)
      this._syncPanelDomainState()
    },

    unpinPanel(panel) {
      const panelStore = this._getPanelStore()
      panelStore.unpinPanel(panel)
      this._syncPanelDomainState()
    },

    setPanelState(panel, state) {
      const panelStore = this._getPanelStore()
      panelStore.setPanelState(panel, state)
      this._syncPanelDomainState()
    },

    onReplaceEnter(payload = {}) {
      const panelStore = this._getPanelStore()
      panelStore.onReplaceEnter(payload)
      this._syncPanelDomainState()
    },

    onReplaceApplied() {
      const panelStore = this._getPanelStore()
      panelStore.onReplaceApplied()
      this._syncPanelDomainState()
    },

    enterPeekPanel(panel) {
      const panelStore = this._getPanelStore()
      panelStore.enterPeekPanel(panel)
      this._syncPanelDomainState()
    },

    exitPeekPanel(panel) {
      const panelStore = this._getPanelStore()
      panelStore.exitPeekPanel(panel)
      this._syncPanelDomainState()
    },

    hydrateUiLayout() {
      const panelStore = this._getPanelStore()
      panelStore.hydrateUiLayout()
      this._syncPanelDomainState()
    },

    persistUiLayout() {
      const panelStore = this._getPanelStore()
      panelStore.persistUiLayout()
      this._syncPanelDomainState()
    },

    // -------------------------
    // Rendering / preview (OPTIMIZED)
    // -------------------------

    /**
     * Schedule a merged appearance refresh (batched via rAF)
     */
    _scheduleRefresh() {
      const renderStore = this._getRenderStore()
      return renderStore.scheduleRefresh(this)
    },

    /**
     * Immediate refresh (for critical paths like initial load)
     */
    refreshMergedAppearanceData() {
      const renderStore = this._getRenderStore()
      return renderStore.refreshMergedAppearanceData(this)
    },

    /**
     * Internal: actual refresh logic
     */
    _doRefreshMergedAppearanceData() {
      const renderStore = this._getRenderStore()
      return renderStore.doRefreshMergedAppearanceData(this)
    },

    _reconstructStacksForRender(stacks = this.stacks) {
      const sourceStacks = Array.isArray(stacks) ? stacks : []
      const useLegacyLayerEntriesReconstruct = isRenderReconstructFromLayerEntriesEnabled()

      return sourceStacks.map(el => {
        const data = Array.isArray(el?.data) ? el.data : []
        const reconstructed = data.map(part => {
          const clonedPart = fastClone(part)
          if (!clonedPart || typeof clonedPart !== 'object') return clonedPart

          if (useLegacyLayerEntriesReconstruct) {
            try {
              if (Array.isArray(clonedPart.layerEntries) && clonedPart.layerEntries.length) {
                const asset = (typeof this.resolveAssetForPart === 'function') ? this.resolveAssetForPart(clonedPart) : null
                const rebuiltPart = LayerTranslator.reconstructPartFromLayerEntries(clonedPart.layerEntries, clonedPart, { originalAsset: asset })
                if (rebuiltPart) {
                  return rebuiltPart
                }
              }
            } catch (e) {
              // Fall through to Part truth clone.
            }
          }

          // Render domain consumes Part as source-of-truth; layerEntries remains UI/editor projection.
          if (Object.prototype.hasOwnProperty.call(clonedPart, 'layerEntries')) {
            delete clonedPart.layerEntries
          }

          return clonedPart
        })
        return { data: reconstructed, filterList: el?.filterList }
      })
    },

    _sanitizeStacksForPersistence(stacks = this.stacks) {
      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.sanitizeStacksForPersistence(stacks, this)
    },

    // -------------------------
    // stack manipulation
    // -------------------------
    async addElement(el) {
      const coreStore = this._getCoreStore()
      return coreStore.addElement(this, el)
    },

    removeElement(idx) {
      const coreStore = this._getCoreStore()
      return coreStore.removeElement(this, idx)
    },

    moveElement(fromIdx, toIdx) {
      const coreStore = this._getCoreStore()
      return coreStore.moveElement(this, fromIdx, toIdx)
    },

    setSelectedStackFilterList(filterList = [], options = {}) {
      const idx = Number(this.selectedIndex)
      if (!Number.isFinite(idx) || idx < 0 || idx >= this.stacks.length) return false

      const stack = this.stacks[idx]
      if (!stack || typeof stack !== 'object') return false

      const normalized = Array.isArray(filterList)
        ? Array.from(new Set(filterList.filter(v => typeof v === 'string' && v.trim())))
        : []

      const nextStacks = this.stacks.slice()
      nextStacks[idx] = { ...stack, filterList: normalized }
      this.stacks = nextStacks

      if (options?.refresh !== false) {
        this.refreshMergedAppearanceData()
      }
      if (options?.recordHistory === true) {
        this.pushHistorySnapshot()
      }

      return true
    },

    replaceSelectedStackData(newData = [], options = {}) {
      const idx = Number(this.selectedIndex)
      if (!Number.isFinite(idx) || idx < 0 || idx >= this.stacks.length) return false

      const stack = this.stacks[idx]
      if (!stack || typeof stack !== 'object') return false

      const normalizedData = Array.isArray(newData) ? newData : []
      const nextStacks = this.stacks.slice()
      nextStacks[idx] = { ...stack, data: normalizedData }
      this.stacks = nextStacks

      if (options?.recordHistory === true) {
        this.pushHistorySnapshot()
      }
      if (options?.refresh !== false) {
        this.refreshMergedAppearanceData()
      }

      return true
    },

    select(idx) {
      const coreStore = this._getCoreStore()
      return coreStore.select(this, idx)
    },

    clear() {
      const coreStore = this._getCoreStore()
      return coreStore.clear(this)
    },

    focusPart(part) {
      const result = FocusActions.focusOnPart(this, part, {
        focusedPartIndex: this.focusedPartIndex,
        findPartByUid: this.findPartByUid.bind(this),
        ensurePartUid: this.ensurePartUid.bind(this),
        clearLayerSelection: this.clearLayerSelection.bind(this)
      })

      this.focusedPartIndex = result.focusedPartIndex
      this._syncFocusStateScopeFromFocusedPart()
      if (result.clearLayerSelection) {
        this.clearLayerSelection()
      }

      this.clearReplaceTarget()
      this.triggerFocusedPartUpdate()
    },

    clearPartFocus() {
      const result = FocusActions.clearFocusState({
        focusedPartIndex: this.focusedPartIndex,
        clearLayerSelection: this.clearLayerSelection.bind(this)
      })

      this.focusedPartIndex = result.focusedPartIndex
      if (result.clearPropertyFocus) {
        this.clearPropertyFocus()
      }
      if (result.clearLayerSelection) {
        this.clearLayerSelection()
      }

      this._syncFocusStateScopeFromFocusedPart()
    },

    // -------------------------
    // Asset index helpers (pure)
    // -------------------------
    async loadAssetData() {
      const assetStore = this._getAssetStore()
      return assetStore.loadAssetData(this)
    },

    findAssetsGroupForPart(part) {
      const assetStore = this._getAssetStore()
      return assetStore.findAssetsGroupForPart(this, part)
    },

    findAssetGroupEntryForPart(part) {
      const assetStore = this._getAssetStore()
      return assetStore.findAssetGroupEntryForPart(this, part)
    },

    _normalizeAssetsFromGroupData(groupData) {
      const assetStore = this._getAssetStore()
      return assetStore.normalizeAssetsFromGroupData(this, groupData)
    },

    getAssetCandidatesForPart(part) {
      const assetStore = this._getAssetStore()
      return assetStore.getAssetCandidatesForPart(this, part)
    },

    resolveAssetForPart(part) {
      const assetStore = this._getAssetStore()
      return assetStore.resolveAssetForPart(this, part)
    },

    getGroupDescriptionForPart(part) {
      const assetStore = this._getAssetStore()
      return assetStore.getGroupDescriptionForPart(this, part)
    },

    matchesSearchForPart(part, term) {
      const assetStore = this._getAssetStore()
      return assetStore.matchesSearchForPart(this, part, term)
    },

    // -------------------------
    // Palette helpers (pure)
    // -------------------------
    createTagAndReplaceInStacks(value) {
      const paletteStore = this._getPaletteStore()
      return paletteStore.createTagAndReplaceInStacks(this, value)
    },

    renamePaletteTagAndReferences(oldTag, newTag) {
      const paletteStore = this._getPaletteStore()
      return paletteStore.renamePaletteTagAndReferences(this, oldTag, newTag)
    },

    /**
     * Set palette mode state and register active palette targets. 
     */
    setPaletteMode(active = false, targets = []) {
      const paletteStore = this._getPaletteStore()
      return paletteStore.setPaletteMode(this, active, targets)
    },

    clearPaletteMode() {
      const paletteStore = this._getPaletteStore()
      return paletteStore.clearPaletteMode(this)
    },

    openPalettePanel(targets = []) {
      const paletteStore = this._getPaletteStore()
      return paletteStore.openPalettePanel(this, targets)
    },

    setPaletteWorkMode(mode = 'external') {
      const paletteStore = this._getPaletteStore()
      return paletteStore.setPaletteWorkMode(this, mode)
    },

    closePalettePanel(options = {}) {
      const paletteStore = this._getPaletteStore()
      return paletteStore.closePalettePanel(this, options)
    },

    _isDataHistoryActionAllowed(actionType) {
      return DATA_HISTORY_ACTION_ALLOWLIST.has(String(actionType || '').trim())
    },

    _normalizeHistoryMeta(historyMeta = null, fallbackActionType = null, extra = {}) {
      const sourceMeta = historyMeta && typeof historyMeta === 'object' ? historyMeta : {}
      const actionType = String(sourceMeta.actionType || fallbackActionType || '').trim()
      if (!actionType || !this._isDataHistoryActionAllowed(actionType)) return null

      const normalized = { actionType }
      const interactionKind = String(sourceMeta.interactionKind || extra?.interactionKind || '').trim()
      const source = String(sourceMeta.source || extra?.source || '').trim()

      if (interactionKind) normalized.interactionKind = interactionKind
      if (source) normalized.source = source

      const changedParts = Number(sourceMeta.changedParts ?? extra?.changedParts)
      if (Number.isFinite(changedParts) && changedParts > 0) {
        normalized.changedParts = changedParts
      }

      const deltaCount = Number(sourceMeta.deltaCount ?? extra?.deltaCount)
      if (Number.isFinite(deltaCount) && deltaCount > 0) {
        normalized.deltaCount = deltaCount
      }

      return normalized
    },

    _mergeHistoryMeta(previous = null, next = null) {
      if (!next) return previous || null
      if (!previous) return next

      const merged = { ...previous, ...next }
      if (previous.actionType && next.actionType && previous.actionType !== next.actionType) {
        merged.previousActionType = previous.actionType
      }
      return merged
    },

    _setDeferredHistoryMeta(scope = 'editor', historyMeta = null) {
      if (!historyMeta) return

      if (scope === 'palette') {
        this._paletteRealtimeHistoryMeta = this._mergeHistoryMeta(this._paletteRealtimeHistoryMeta, historyMeta)
        return
      }

      if (scope === 'editor') {
        this._editorRealtimeHistoryMeta = this._mergeHistoryMeta(this._editorRealtimeHistoryMeta, historyMeta)
      }
    },

    _consumePendingHistoryMeta(scope = 'editor', { historyMeta = null, interactionKind = null } = {}) {
      const pending = scope === 'palette' ? this._paletteRealtimeHistoryMeta : this._editorRealtimeHistoryMeta
      const explicit = this._normalizeHistoryMeta(historyMeta, null, { interactionKind })
      const merged = this._mergeHistoryMeta(pending, explicit)

      if (scope === 'palette') {
        this._paletteRealtimeHistoryMeta = null
      } else {
        this._editorRealtimeHistoryMeta = null
      }

      if (merged && interactionKind && !merged.interactionKind) {
        merged.interactionKind = interactionKind
      }

      return merged
    },

    beginPaletteRealtimeUpdate(kind = 'palette') {
      this._paletteRealtimeMode = true
      this._paletteRealtimeInteractionKind = String(kind || 'palette')
    },

    _finalizeMutation({
      changed = false,
      deferCommit = false,
      scope = 'generic',
      historyMode = 'throttled',
      historyMeta = null,
      scheduleLayer = null,
      schedulePart = null,
      scheduleRefresh = null,
      refreshMerged = false,
      touchFocusedPart = false
    } = {}) {
      if (!changed) return false

      const scopeDefaults = {
        palette: {
          scheduleLayer: false,
          schedulePart: false,
          scheduleRefresh: true,
          refreshMerged: false,
          touchFocusedPart: false,
          deferDirty: 'palette'
        },
        editor: {
          scheduleLayer: false,
          schedulePart: false,
          scheduleRefresh: true,
          refreshMerged: false,
          touchFocusedPart: false,
          deferDirty: 'editor'
        },
        batch: {
          scheduleLayer: true,
          schedulePart: false,
          scheduleRefresh: true,
          refreshMerged: false,
          touchFocusedPart: true,
          deferDirty: 'editor'
        },
        asset: {
          scheduleLayer: false,
          schedulePart: false,
          scheduleRefresh: true,
          refreshMerged: false,
          touchFocusedPart: false,
          deferDirty: null
        },
        stack: {
          scheduleLayer: false,
          schedulePart: false,
          scheduleRefresh: false,
          refreshMerged: true,
          touchFocusedPart: false,
          deferDirty: null
        },
        generic: {
          scheduleLayer: false,
          schedulePart: false,
          scheduleRefresh: true,
          refreshMerged: false,
          touchFocusedPart: false,
          deferDirty: null
        }
      }

      const defaults = scopeDefaults[scope] || scopeDefaults.generic
      const shouldScheduleLayer = typeof scheduleLayer === 'boolean' ? scheduleLayer : defaults.scheduleLayer
      const shouldSchedulePart = typeof schedulePart === 'boolean' ? schedulePart : defaults.schedulePart
      const shouldScheduleRefresh = typeof scheduleRefresh === 'boolean' ? scheduleRefresh : defaults.scheduleRefresh
      const shouldRefreshMerged = refreshMerged === true || defaults.refreshMerged === true
      const shouldTouchFocusedPart = touchFocusedPart === true || defaults.touchFocusedPart === true
      let normalizedHistoryMeta = this._normalizeHistoryMeta(historyMeta)

      if (!this._mutationStats || typeof this._mutationStats !== 'object') {
        this._mutationStats = {
          totalCalls: 0,
          deferredCalls: 0,
          committedCalls: 0,
          scopeCalls: {
            palette: 0,
            editor: 0,
            batch: 0,
            asset: 0,
            stack: 0,
            generic: 0
          },
          scheduleLayerCalls: 0,
          schedulePartCalls: 0,
          scheduleRefreshCalls: 0,
          refreshMergedCalls: 0,
          touchFocusedPartCalls: 0,
          historyImmediateCalls: 0,
          historyThrottledCalls: 0,
          historyNoneCalls: 0,
          lastScope: null,
          lastHistoryMode: null,
          lastHistoryActionType: null,
          lastWasDeferred: false,
          lastMutationAt: 0
        }
      }

      const stats = this._mutationStats
      stats.totalCalls += 1
      stats.scopeCalls[scope] = (stats.scopeCalls[scope] || 0) + 1
      stats.lastScope = scope
      stats.lastHistoryMode = historyMode
      stats.lastHistoryActionType = normalizedHistoryMeta?.actionType || null
      stats.lastWasDeferred = deferCommit === true
      stats.lastMutationAt = Date.now()

      if (deferCommit) {
        stats.deferredCalls += 1

        if (historyMode !== 'none' && normalizedHistoryMeta) {
          this._setDeferredHistoryMeta(scope, normalizedHistoryMeta)
        }

        if (defaults.deferDirty === 'palette') {
          this._paletteRealtimeDirty = true
        } else if (defaults.deferDirty === 'editor') {
          this._editorRealtimeDirty = true
        }

        if (shouldScheduleRefresh) {
          stats.scheduleRefreshCalls += 1
          this._scheduleRefresh()
        }

        if (historyMode === 'immediate') {
          stats.historyImmediateCalls += 1
        } else if (historyMode === 'throttled') {
          stats.historyThrottledCalls += 1
        } else {
          stats.historyNoneCalls += 1
        }

        return true
      }

      stats.committedCalls += 1

      if (scope === 'palette') {
        normalizedHistoryMeta = this._mergeHistoryMeta(this._paletteRealtimeHistoryMeta, normalizedHistoryMeta)
        this._paletteRealtimeHistoryMeta = null
        if (!this._paletteRealtimeMode) {
          this._paletteRealtimeDirty = false
        }
      } else if (scope === 'editor') {
        normalizedHistoryMeta = this._mergeHistoryMeta(this._editorRealtimeHistoryMeta, normalizedHistoryMeta)
        this._editorRealtimeHistoryMeta = null
        if (!this._editorRealtimeMode) {
          this._editorRealtimeDirty = false
        }
      }

      stats.lastHistoryActionType = normalizedHistoryMeta?.actionType || stats.lastHistoryActionType

      if (shouldScheduleLayer) {
        stats.scheduleLayerCalls += 1
        this._scheduleLayerRefresh()
      }

      if (shouldSchedulePart) {
        stats.schedulePartCalls += 1
        this._schedulePartUpdate()
      }

      if (shouldScheduleRefresh) {
        stats.scheduleRefreshCalls += 1
        this._scheduleRefresh()
      }

      if (shouldRefreshMerged) {
        stats.refreshMergedCalls += 1
        this.refreshMergedAppearanceData()
      }

      if (shouldTouchFocusedPart) {
        stats.touchFocusedPartCalls += 1
        this.triggerFocusedPartUpdate()
      }

      if (historyMode === 'immediate') {
        stats.historyImmediateCalls += 1
        this.pushHistorySnapshot(normalizedHistoryMeta)
      } else if (historyMode === 'throttled') {
        stats.historyThrottledCalls += 1
        this.pushHistorySnapshotThrottled(null, normalizedHistoryMeta)
      } else {
        stats.historyNoneCalls += 1
      }

      return true
    },

    _finalizePaletteMutation(changed, { deferCommit = false, throttleHistory = true, historyMeta = null } = {}) {
      return this._finalizeMutation({
        changed,
        deferCommit,
        scope: 'palette',
        historyMode: throttleHistory ? 'throttled' : 'immediate',
        historyMeta
      })
    },

    _finalizeEditorMutation(changed, { deferCommit = false, throttleHistory = true, historyMeta = null } = {}) {
      return this._finalizeMutation({
        changed,
        deferCommit,
        scope: 'editor',
        historyMode: throttleHistory ? 'throttled' : 'immediate',
        historyMeta
      })
    },

    execute(command, options = {}) {
      return getStudioFacade(this).execute(command, options)
    },

    query(name, params = {}) {
      return getStudioFacade(this).query(name, params)
    },

    getQueryNames() {
      return getStudioFacade(this).getQueryNames()
    },

    beginInteraction(kind = 'palette', meta = {}) {
      return getStudioFacade(this).beginInteraction(kind, meta)
    },

    applyDelta(delta = {}) {
      return getStudioFacade(this).applyDelta(delta)
    },

    commitInteraction() {
      return getStudioFacade(this).commitInteraction()
    },

    cancelInteraction() {
      return getStudioFacade(this).cancelInteraction()
    },

    endPaletteRealtimeUpdate({ commit = true, historyMeta = null, interactionKind = null } = {}) {
      const resolvedInteractionKind = String(interactionKind || this._paletteRealtimeInteractionKind || '').trim() || null
      const shouldCommit = !!commit && this._paletteRealtimeDirty
      const pendingHistoryMeta = this._consumePendingHistoryMeta('palette', {
        historyMeta,
        interactionKind: resolvedInteractionKind
      })

      this._paletteRealtimeMode = false
      this._paletteRealtimeDirty = false
      this._paletteRealtimeInteractionKind = null

      if (!shouldCommit) return false

      // Commit deferred heavy work once after interaction settles.
      return this._finalizePaletteMutation(true, {
        deferCommit: false,
        throttleHistory: false,
        historyMeta: pendingHistoryMeta
      })
    },

    beginEditorRealtimeUpdate(kind = 'editor') {
      this._editorRealtimeMode = true
      this._editorRealtimeInteractionKind = String(kind || 'editor')
    },

    endEditorRealtimeUpdate({ commit = true, historyMeta = null, interactionKind = null } = {}) {
      const resolvedInteractionKind = String(interactionKind || this._editorRealtimeInteractionKind || '').trim() || null
      const shouldCommit = !!commit && this._editorRealtimeDirty
      const pendingHistoryMeta = this._consumePendingHistoryMeta('editor', {
        historyMeta,
        interactionKind: resolvedInteractionKind
      })

      this._editorRealtimeMode = false
      this._editorRealtimeDirty = false
      this._editorRealtimeInteractionKind = null

      if (!shouldCommit) return false

      // Commit deferred heavy work once after interaction settles.
      return this._finalizeEditorMutation(true, {
        deferCommit: false,
        throttleHistory: false,
        historyMeta: pendingHistoryMeta
      })
    },

    forceEndRealtimeScope(scope = 'editor', { commit = true, historyMeta = null, interactionKind = null } = {}) {
      const normalizedScope = String(scope || '').trim().toLowerCase()

      if (normalizedScope === 'palette') {
        return this.endPaletteRealtimeUpdate({
          commit,
          historyMeta,
          interactionKind: interactionKind || this._paletteRealtimeInteractionKind || 'palette'
        })
      }

      if (normalizedScope === 'editor') {
        return this.endEditorRealtimeUpdate({
          commit,
          historyMeta,
          interactionKind: interactionKind || this._editorRealtimeInteractionKind || 'editor'
        })
      }

      return false
    },

    renameStack(stackIndex, newName, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'stack.rename',
          payload: { stackIndex, newName },
          meta: {}
        })
      }

      const coreStore = this._getCoreStore()
      const changed = coreStore.renameStack(this, stackIndex, newName)
      if (!changed) return false

      const historyMeta = this._normalizeHistoryMeta(options?.historyMeta, 'stack.rename')

      return this._finalizeMutation({
        changed: true,
        scope: 'stack',
        historyMode: 'immediate',
        historyMeta
      })
    },

    applyFocusedPartProperty(propertyValue, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'part.updateProperty',
          payload: {
            property: propertyValue,
            rebuildLayers: options?.rebuildLayers !== false,
            refresh: options?.refresh !== false
          },
          meta: { deferCommit: options?.deferCommit === true }
        })
      }

      const changed = this._updateFocusedPartProperty('Property', fastClone(propertyValue || {}))
      if (!changed) return false

      const deferCommit = options?.deferCommit === true || this._editorRealtimeMode === true
      const historyMeta = this._normalizeHistoryMeta(
        options?.historyMeta,
        'part.updateProperty',
        { interactionKind: this._editorRealtimeInteractionKind }
      )

      if (options?.rebuildLayers !== false) {
        this.RebuildAllStacksLayerEntriesFromParts()
      } else if (options?.refresh !== false) {
        this._scheduleRefresh()
      }

      return this._finalizeMutation({
        changed: true,
        deferCommit,
        scope: 'editor',
        historyMode: deferCommit ? 'throttled' : 'immediate',
        historyMeta,
        scheduleLayer: false,
        schedulePart: false,
        scheduleRefresh: false,
        touchFocusedPart: false
      })
    },

    applyFocusedPartMetadata(patch = {}, options = {}) {
      if (!patch || typeof patch !== 'object') return false

      const location = this._resolvePartLocation(this.focusedPart)
      if (!location?.partRef) return false

      const sourcePart = location.partRef
      const nextPart = fastClone(sourcePart)
      let changed = false

      if (Object.prototype.hasOwnProperty.call(patch, 'Name')) {
        const nextName = String(patch.Name ?? '')
        if ((nextPart.Name ?? '') !== nextName) {
          nextPart.Name = nextName
          changed = true
        }
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'Description')) {
        const nextDescription = String(patch.Description ?? '')
        if ((nextPart.Description ?? '') !== nextDescription) {
          nextPart.Description = nextDescription
          changed = true
        }
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'Group')) {
        const nextGroup = String(patch.Group ?? '')
        if ((nextPart.Group ?? '') !== nextGroup) {
          nextPart.Group = nextGroup
          changed = true
        }
      }

      if (patch.Asset && typeof patch.Asset === 'object') {
        const nextAsset = { ...(nextPart.Asset || {}) }

        if (Object.prototype.hasOwnProperty.call(patch.Asset, 'Description')) {
          const nextDescription = String(patch.Asset.Description ?? '')
          if ((nextAsset.Description ?? '') !== nextDescription) {
            nextAsset.Description = nextDescription
            changed = true
          }
        }

        if (Object.prototype.hasOwnProperty.call(patch.Asset, 'Name')) {
          const nextName = String(patch.Asset.Name ?? '')
          if ((nextAsset.Name ?? '') !== nextName) {
            nextAsset.Name = nextName
            changed = true
          }
        }

        if (Object.prototype.hasOwnProperty.call(patch.Asset, 'Group')) {
          const sourceGroup = nextAsset.Group && typeof nextAsset.Group === 'object' ? nextAsset.Group : {}
          const patchGroup = patch.Asset.Group
          const nextGroupObject = (patchGroup && typeof patchGroup === 'object')
            ? { ...sourceGroup, ...patchGroup }
            : { ...sourceGroup, Name: String(patchGroup ?? '') }

          if (JSON.stringify(sourceGroup) !== JSON.stringify(nextGroupObject)) {
            nextAsset.Group = nextGroupObject
            changed = true
          }
        }

        if (changed) {
          nextPart.Asset = nextAsset
        }
      }

      if (!changed) return false

      const uid = sourcePart._uid || this.ensurePartUid(sourcePart)
      if (uid) {
        try { nextPart._uid = uid } catch (e) { console.warn(e) }
      }

      const stack = this.stacks[location.stackIndex]
      if (!stack || !Array.isArray(stack.data)) return false

      const nextStack = { ...stack, data: stack.data.slice() }
      nextStack.data[location.partIndex] = nextPart

      const nextStacks = this.stacks.slice()
      nextStacks[location.stackIndex] = nextStack
      this.stacks = nextStacks

      this.triggerFocusedPartUpdate()

      try {
        this.translateFocusedPartToLayers()
      } catch (e) {
        // ignore translate errors, history capture should still happen
      }

      const deferCommit = options?.deferCommit === true || this._editorRealtimeMode === true
      const historyMeta = this._normalizeHistoryMeta(
        options?.historyMeta,
        'part.updateMetadata',
        { interactionKind: this._editorRealtimeInteractionKind }
      )

      return this._finalizeMutation({
        changed: true,
        deferCommit,
        scope: 'editor',
        historyMode: deferCommit ? 'throttled' : 'immediate',
        historyMeta,
        scheduleLayer: false,
        schedulePart: false,
        scheduleRefresh: false,
        touchFocusedPart: false
      })
    },

    batchUpdatePartLayerEntries(updates = [], options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        const sourceUpdates = Array.isArray(updates) ? updates : []
        const deltaUpdates = []
        let canUseDeltaPath = true

        for (const update of sourceUpdates) {
          const part = update?.part
          const entries = update?.entries
          if (!part || !Array.isArray(entries)) continue

          const previousEntries = this.getLayerEntriesForPart(part, { forceRebuild: false, clone: true })
          const deltas = this._deriveLayerDeltas(previousEntries, entries)
          if (!Array.isArray(deltas)) {
            canUseDeltaPath = false
            break
          }

          if (deltas.length > 0) {
            deltaUpdates.push({ part, deltas })
          }
        }

        if (canUseDeltaPath) {
          if (deltaUpdates.length === 0) return false
          return this.execute({
            type: 'layer.batchApplyLayerDeltas',
            payload: { updates: deltaUpdates },
            meta: { deferCommit: options?.deferCommit === true }
          })
        }

        return this.batchUpdatePartLayerEntries(sourceUpdates, {
          deferCommit: options?.deferCommit === true,
          _fromFacade: true
        })
      }

      const coreStore = this._getCoreStore()
      return coreStore.batchUpdatePartLayerEntries(this, updates, options)
    },

    // -------------------------
    // apply/modify palette targets (OPTIMIZED)
    // -------------------------
    _collectPaletteTargetDeltaUpdates(colorText) {
      if (!this.paletteModeActive) return []

      const targets = Array.isArray(this.activePaletteTargets) ? this.activePaletteTargets : []
      if (!targets.length) return []

      const updatesByPart = new Map()

      for (const target of targets) {
        let stackIndex = (typeof target?.stackIndex === 'number') ? target.stackIndex : null
        let partIndex = (typeof target?.partIndex === 'number') ? target.partIndex : null
        let partRef = null

        if (target?.uid) {
          const found = this.findPartByUid(target.uid)
          if (found?.partRef) {
            partRef = found.partRef
            if (stackIndex === null) stackIndex = found.stackIndex
            if (partIndex === null) partIndex = found.partIndex
          }
        }

        if (!partRef && typeof stackIndex === 'number' && typeof partIndex === 'number') {
          const stack = this.stacks[stackIndex]
          partRef = stack && Array.isArray(stack.data) ? stack.data[partIndex] : null
        }

        if (!partRef) continue

        const resolvedLayerIndex = this._resolveLayerIndexFromPaletteTarget(partRef, Number(target?.layerIndex))
        if (!Number.isFinite(resolvedLayerIndex)) continue

        const partKey = partRef._uid || `${stackIndex ?? 's'}:${partIndex ?? 'p'}`
        if (!updatesByPart.has(partKey)) {
          updatesByPart.set(partKey, {
            part: partRef,
            deltas: [],
            _layerIndexSet: new Set()
          })
        }

        const update = updatesByPart.get(partKey)
        if (update._layerIndexSet.has(resolvedLayerIndex)) continue

        update._layerIndexSet.add(resolvedLayerIndex)
        update.deltas.push({
          layerIndex: resolvedLayerIndex,
          colorText
        })
      }

      return Array.from(updatesByPart.values())
        .filter(update => Array.isArray(update.deltas) && update.deltas.length > 0)
        .map(({ part, deltas }) => ({ part, deltas }))
    },

    _applyPaletteColorViaLayerDeltas(colorText) {
      const updates = this._collectPaletteTargetDeltaUpdates(colorText)
      if (!updates.length) {
        return { changed: false, updatedCount: 0 }
      }

      let changedCount = 0
      let focusedChanged = false

      for (const update of updates) {
        const result = this._applyPartLayerDeltasInternal(update.part, update.deltas)
        if (!result) continue

        changedCount += 1
        const isFocusedTarget =
          this.focusedPartIndex?.stackIndex === result.location.stackIndex &&
          this.focusedPartIndex?.partIndex === result.location.partIndex
        if (isFocusedTarget) {
          focusedChanged = true
        }
      }

      if (changedCount > 0) {
        if (focusedChanged) {
          this.triggerFocusedPartUpdate()
        }
        this.translateFocusedPartToLayers()
      }

      return {
        changed: changedCount > 0,
        updatedCount: changedCount
      }
    },

    applyColorToActivePaletteTargets(newColor, options = {}) {
      const paletteStore = this._getPaletteStore()
      return paletteStore.applyColorToActivePaletteTargets(this, newColor, options)
    },

    applyTagToActivePaletteTargets(tag, options = {}) {
      const paletteStore = this._getPaletteStore()
      return paletteStore.applyTagToActivePaletteTargets(this, tag, options)
    },

    applyTagOffsetToActivePaletteTargets(payload = {}, options = {}) {
      const paletteStore = this._getPaletteStore()
      return paletteStore.applyTagOffsetToActivePaletteTargets(this, payload, options)
    },

    resetTagOffsetToTag(tag, options = {}) {
      const paletteStore = this._getPaletteStore()
      return paletteStore.resetTagOffsetToTag(this, tag, options)
    },

    detachTagOffsetToRaw(payload = {}) {
      const paletteStore = this._getPaletteStore()
      return paletteStore.detachTagOffsetToRaw(this, payload)
    },

    deletePaletteTag(tag) {
      const paletteStore = this._getPaletteStore()
      return paletteStore.deletePaletteTag(this, tag)
    },

    clearPalette() {
      const result = PaletteActions.clearPalette(this, {
        paletteMap: this.paletteMap,
        _paletteNextCounter: this._paletteNextCounter,
        _paletteVersion: this._paletteVersion,
        pushHistorySnapshot: this.pushHistorySnapshot.bind(this)
      })

      this.paletteMap = result.paletteMap
      this._paletteNextCounter = result._paletteNextCounter
      this._paletteVersion = result._paletteVersion

      // Rebuild all layer entries
      try {
        for (const stack of this.stacks) {
          if (!stack || !Array.isArray(stack.data)) continue
          for (const part of stack.data) {
            if (!part) continue
            try { part.layerEntries = this._buildLayerEntriesWithCache(part, true) || [] } catch (e) { console.warn(e) }
          }
        }
      } catch (e) { console.warn(e) }

      const focusedP = this.focusedPart
      if (focusedP) {
        try {
          const entries = this._buildLayerEntriesWithCache(focusedP, true) || []
          this._updateFocusedPartProperty('layerEntries', entries)
        } catch (e) { console.warn(e) }
      }

      this._scheduleLayerRefresh()
      this._scheduleRefresh()
      this.pushHistorySnapshot(this._normalizeHistoryMeta(null, 'palette.clear'))
    },

    updatePaletteTag(tag, newValue, options = {}) {
      const paletteStore = this._getPaletteStore()
      return paletteStore.updatePaletteTag(this, tag, newValue, options)
    },

    // -------------------------
    // Saved colors management
    // -------------------------
    addSavedColor(value) {
      const paletteStore = this._getPaletteStore()
      return paletteStore.addSavedColor(this, value)
    },

    updateSavedColor(idx, newValue) {
      const paletteStore = this._getPaletteStore()
      return paletteStore.updateSavedColor(this, idx, newValue)
    },

    deleteSavedColor(idx) {
      const paletteStore = this._getPaletteStore()
      return paletteStore.deleteSavedColor(this, idx)
    },

    clearSavedColors() {
      const paletteStore = this._getPaletteStore()
      return paletteStore.clearSavedColors(this)
    },

    // -------------------------
    // Layer translation helpers (OPTIMIZED with caching)
    // -------------------------

    /**
     * Build layer entries with caching support
     */
    _buildLayerEntriesWithCache(part, forceRebuild = false) {
      if (!part) return []

      // Check cache
      if (!forceRebuild) {
        const cached = layerEntriesCache.get(part)
        if (cached && cached.paletteVersion === this._paletteVersion) {
          const currentHash = hashPartForCache(part)
          if (cached.hash === currentHash) {
            return cached.entries
          }
        }
      }

      // Build new entries
      const deps = {
        paletteSnapshot: () => this.paletteSnapshot,
        resolveAssetForPart: (p) => this.resolveAssetForPart(p),
        getAssetCandidatesForPart: (p) => this.getAssetCandidatesForPart(p),
        findAssetGroupEntryForPart: (p) => this.findAssetGroupEntryForPart(p)
      }
      const entries = LayerTranslator.buildLayerEntriesForPart(part, deps)

      // Store in cache
      layerEntriesCache.set(part, {
        entries: entries,
        hash: hashPartForCache(part),
        paletteVersion: this._paletteVersion
      })

      return entries
    },

    getLayerEntriesForPart(part, { forceRebuild = false, clone = false } = {}) {
      if (!part) return []

      let entries = this._buildLayerEntriesWithCache(part, forceRebuild) || []
      if ((!Array.isArray(entries) || entries.length === 0) && Array.isArray(part.layerEntries)) {
        entries = part.layerEntries
      }

      return clone ? fastClone(entries) : entries
    },

    buildLayerEntriesForPart(part) {
      const entries = this.getLayerEntriesForPart(part, { forceRebuild: false, clone: false })
      this.translatedLayerEntries = entries
      return entries
    },

    translateFocusedPartToLayers() {
      const fp = this.focusedPart
      if (!fp) {
        this.translatedLayerEntries = []
        return []
      }
      return this.buildLayerEntriesForPart(fp)
    },

    _findLayerEntryByIndex(entries, layerIndex) {
      if (!Array.isArray(entries)) return null
      const normalizedIndex = Number(layerIndex)
      if (!Number.isFinite(normalizedIndex)) return null

      const direct = entries.find(entry => Number(entry?.layerIndex) === normalizedIndex)
      if (direct) return direct

      for (const entry of entries) {
        if (!entry || !Array.isArray(entry.subLayers)) continue
        const sub = entry.subLayers.find(item => Number(item?.layerIndex) === normalizedIndex)
        if (sub) return sub
      }

      return null
    },

    _deriveLayerDeltas(previousEntries = [], nextEntries = []) {
      if (!Array.isArray(previousEntries) || !Array.isArray(nextEntries)) return null
      if (previousEntries.length !== nextEntries.length) return null

      const deltas = []

      for (const nextEntry of nextEntries) {
        const layerIndex = Number(nextEntry?.layerIndex)
        if (!Number.isFinite(layerIndex)) return null

        const previousEntry = this._findLayerEntryByIndex(previousEntries, layerIndex)
        if (!previousEntry) return null

        const delta = { layerIndex }
        let changed = false

        if ((previousEntry.colorText ?? '') !== (nextEntry?.colorText ?? '')) {
          delta.colorText = nextEntry?.colorText ?? ''
          changed = true
        }

        if ((previousEntry.opacity ?? 1) !== (nextEntry?.opacity ?? 1)) {
          delta.opacity = nextEntry?.opacity ?? 1
          changed = true
        }

        if ((previousEntry.drawingLeft ?? null) !== (nextEntry?.drawingLeft ?? null)) {
          delta.drawingLeft = nextEntry?.drawingLeft ?? null
          changed = true
        }

        if ((previousEntry.drawingTop ?? null) !== (nextEntry?.drawingTop ?? null)) {
          delta.drawingTop = nextEntry?.drawingTop ?? null
          changed = true
        }

        if (
          (previousEntry.isOverridePriority ?? false) !== (nextEntry?.isOverridePriority ?? false) ||
          (previousEntry.overridePriority ?? null) !== (nextEntry?.overridePriority ?? null)
        ) {
          delta.isOverridePriority = !!nextEntry?.isOverridePriority
          delta.overridePriority = nextEntry?.overridePriority ?? null
          changed = true
        }

        const previousSubLayers = Array.isArray(previousEntry.subLayers) ? previousEntry.subLayers : []
        const nextSubLayers = Array.isArray(nextEntry?.subLayers) ? nextEntry.subLayers : []
        if (previousSubLayers.length !== nextSubLayers.length) return null

        const subLayerDeltas = []
        for (const nextSub of nextSubLayers) {
          const subLayerIndex = Number(nextSub?.layerIndex)
          if (!Number.isFinite(subLayerIndex)) return null

          const previousSub = previousSubLayers.find(item => Number(item?.layerIndex) === subLayerIndex)
          if (!previousSub) return null

          const subDelta = { layerIndex: subLayerIndex }
          let subChanged = false

          if ((previousSub.opacity ?? 1) !== (nextSub?.opacity ?? 1)) {
            subDelta.opacity = nextSub?.opacity ?? 1
            subChanged = true
          }
          if ((previousSub.drawingLeft ?? null) !== (nextSub?.drawingLeft ?? null)) {
            subDelta.drawingLeft = nextSub?.drawingLeft ?? null
            subChanged = true
          }
          if ((previousSub.drawingTop ?? null) !== (nextSub?.drawingTop ?? null)) {
            subDelta.drawingTop = nextSub?.drawingTop ?? null
            subChanged = true
          }

          if (subChanged) subLayerDeltas.push(subDelta)
        }

        if (subLayerDeltas.length > 0) {
          delta.subLayers = subLayerDeltas
          changed = true
        }

        if (changed) deltas.push(delta)
      }

      return deltas
    },

    _applyLayerDeltasToEntries(entries = [], deltas = []) {
      if (!Array.isArray(entries) || !Array.isArray(deltas) || deltas.length === 0) return false

      let changed = false

      for (const delta of deltas) {
        const layerIndex = Number(delta?.layerIndex)
        if (!Number.isFinite(layerIndex)) continue

        const entry = this._findLayerEntryByIndex(entries, layerIndex)
        if (!entry) continue

        if (Object.prototype.hasOwnProperty.call(delta, 'colorText')) {
          const nextColorText = delta.colorText === undefined || delta.colorText === null ? '' : String(delta.colorText)
          entry.colorText = nextColorText
          try {
            entry.colorCss = this._resolveColorCssFromText(nextColorText)
          } catch (e) {
            entry.colorCss = null
          }
          changed = true
        }

        if (Object.prototype.hasOwnProperty.call(delta, 'opacity')) {
          const numericOpacity = Number(delta.opacity)
          entry.opacity = Number.isFinite(numericOpacity) ? numericOpacity : 1
          changed = true
        }

        if (Object.prototype.hasOwnProperty.call(delta, 'drawingLeft')) {
          const numericLeft = Number(delta.drawingLeft)
          entry.drawingLeft = delta.drawingLeft === null || delta.drawingLeft === undefined
            ? null
            : (Number.isFinite(numericLeft) ? numericLeft : null)
          changed = true
        }

        if (Object.prototype.hasOwnProperty.call(delta, 'drawingTop')) {
          const numericTop = Number(delta.drawingTop)
          entry.drawingTop = delta.drawingTop === null || delta.drawingTop === undefined
            ? null
            : (Number.isFinite(numericTop) ? numericTop : null)
          changed = true
        }

        if (Object.prototype.hasOwnProperty.call(delta, 'isOverridePriority')) {
          entry.isOverridePriority = !!delta.isOverridePriority
          changed = true
        }

        if (Object.prototype.hasOwnProperty.call(delta, 'overridePriority')) {
          const numericPriority = Number(delta.overridePriority)
          entry.overridePriority = delta.overridePriority === null || delta.overridePriority === undefined
            ? entry.defaultPriority
            : (Number.isFinite(numericPriority) ? numericPriority : entry.defaultPriority)
          changed = true
        }

        const subLayerDeltas = Array.isArray(delta.subLayers) ? delta.subLayers : []
        if (subLayerDeltas.length > 0 && Array.isArray(entry.subLayers)) {
          for (const subDelta of subLayerDeltas) {
            const subLayerIndex = Number(subDelta?.layerIndex)
            if (!Number.isFinite(subLayerIndex)) continue

            const sub = entry.subLayers.find(item => Number(item?.layerIndex) === subLayerIndex)
            if (!sub) continue

            if (Object.prototype.hasOwnProperty.call(subDelta, 'opacity')) {
              const numericOpacity = Number(subDelta.opacity)
              sub.opacity = Number.isFinite(numericOpacity) ? numericOpacity : 1
              changed = true
            }

            if (Object.prototype.hasOwnProperty.call(subDelta, 'drawingLeft')) {
              const numericLeft = Number(subDelta.drawingLeft)
              sub.drawingLeft = subDelta.drawingLeft === null || subDelta.drawingLeft === undefined
                ? null
                : (Number.isFinite(numericLeft) ? numericLeft : null)
              changed = true
            }

            if (Object.prototype.hasOwnProperty.call(subDelta, 'drawingTop')) {
              const numericTop = Number(subDelta.drawingTop)
              sub.drawingTop = subDelta.drawingTop === null || subDelta.drawingTop === undefined
                ? null
                : (Number.isFinite(numericTop) ? numericTop : null)
              changed = true
            }
          }
        }
      }

      return changed
    },

    _resolvePartLocation(part = null) {
      const coreStore = this._getCoreStore()
      return coreStore.resolvePartLocation(this, part)
    },

    _applyPartLayerDeltasInternal(part, deltas = []) {
      const coreStore = this._getCoreStore()
      return coreStore.applyPartLayerDeltasInternal(this, part, deltas)
    },

    applyPartLayerDeltas(part, deltas = [], options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'part.applyLayerDeltas',
          payload: { part, deltas },
          meta: { deferCommit: options?.deferCommit === true }
        })
      }

      const coreStore = this._getCoreStore()
      return coreStore.applyPartLayerDeltas(this, part, deltas, options)
    },

    batchApplyPartLayerDeltas(updates = [], options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'layer.batchApplyLayerDeltas',
          payload: { updates },
          meta: { deferCommit: options?.deferCommit === true }
        })
      }

      const coreStore = this._getCoreStore()
      return coreStore.batchApplyPartLayerDeltas(this, updates, options)
    },

    /**
     * Apply edited layer entries back to the focused part and to any matching parts in stacks. 
     */
    updatePartFromLayerEntries(entries, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        const fp = this.focusedPart
        if (entries && fp) {
          const previousEntries = this.getLayerEntriesForPart(fp, { forceRebuild: false, clone: true })
          const deltas = this._deriveLayerDeltas(previousEntries, entries)
          if (Array.isArray(deltas)) {
            if (deltas.length === 0) return this.focusedPart
            return this.execute({
              type: 'part.applyLayerDeltas',
              payload: { part: fp, deltas },
              meta: { deferCommit: options?.deferCommit === true }
            })
          }
        }

        return this.updatePartFromLayerEntries(entries, {
          deferCommit: options?.deferCommit === true,
          _fromFacade: true
        })
      }

      const coreStore = this._getCoreStore()
      return coreStore.updatePartFromLayerEntries(this, entries, options)
    },

    /**
     * NEW: Update a specific part's layer entries and apply changes to the stack.
     * This is critical for LayerManagerWidget to update parts that may not be focused.
     */
    updatePartLayerEntries(part, entries, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        if (part && Array.isArray(entries)) {
          const previousEntries = this.getLayerEntriesForPart(part, { forceRebuild: false, clone: true })
          const deltas = this._deriveLayerDeltas(previousEntries, entries)
          if (Array.isArray(deltas)) {
            if (deltas.length === 0) return false
            return this.execute({
              type: 'part.applyLayerDeltas',
              payload: { part, deltas },
              meta: { deferCommit: options?.deferRefresh === true }
            })
          }
        }

        return this.updatePartLayerEntries(part, entries, {
          deferRefresh: options?.deferRefresh === true,
          _fromFacade: true
        })
      }

      const coreStore = this._getCoreStore()
      return coreStore.updatePartLayerEntries(this, part, entries, options)
    },

    UpdateSpecificPartFromLayerEntries(part, entries = []) {
      const coreStore = this._getCoreStore()
      return coreStore.updateSpecificPartFromLayerEntries(this, part, entries)
    },

    /**
     * Schedule part update from layer entries (batched)
     */
    _schedulePartUpdate() {
      const coreStore = this._getCoreStore()
      return coreStore.schedulePartUpdate(this)
    },

    UpdateAllStacksPartFromLayerEntries() {
      const coreStore = this._getCoreStore()
      return coreStore.updateAllStacksPartFromLayerEntries(this)
    },

    _doUpdateAllStacksPartFromLayerEntries() {
      const coreStore = this._getCoreStore()
      return coreStore.doUpdateAllStacksPartFromLayerEntries(this)
    },

    _buildLayerEntryReuseKey(part, stackIndex, partIndex) {
      if (part && typeof part === 'object' && part._uid) {
        return `uid:${part._uid}`
      }
      const safeName = String(part?.Name || '')
      const safeGroup = String(part?.Group || '')
      return `idx:${stackIndex}:${partIndex}:${safeName}:${safeGroup}`
    },

    _createLayerEntriesReuseMap(stacks = []) {
      const map = new Map()
      if (!Array.isArray(stacks)) return map

      for (let stackIndex = 0; stackIndex < stacks.length; stackIndex++) {
        const stack = stacks[stackIndex]
        if (!stack || !Array.isArray(stack.data)) continue

        for (let partIndex = 0; partIndex < stack.data.length; partIndex++) {
          const part = stack.data[partIndex]
          if (!part || !Array.isArray(part.layerEntries)) continue

          const key = this._buildLayerEntryReuseKey(part, stackIndex, partIndex)
          map.set(key, {
            hash: hashPartForCache(part),
            layerEntries: part.layerEntries
          })
        }
      }

      return map
    },

    _restorePartLayerEntries(part, stackIndex, partIndex, reuseMap = null) {
      if (!part) return { reused: false, rebuilt: false }

      if (reuseMap instanceof Map) {
        const key = this._buildLayerEntryReuseKey(part, stackIndex, partIndex)
        const previous = reuseMap.get(key)
        const currentHash = hashPartForCache(part)

        if (previous && previous.hash === currentHash && Array.isArray(previous.layerEntries)) {
          const reusedEntries = fastClone(previous.layerEntries)
          this._updateLayerEntriesColorCss(reusedEntries)
          part.layerEntries = reusedEntries

          layerEntriesCache.set(part, {
            entries: reusedEntries,
            hash: currentHash,
            paletteVersion: this._paletteVersion
          })

          return { reused: true, rebuilt: false }
        }
      }

      part.layerEntries = this._buildLayerEntriesWithCache(part, true) || []
      return { reused: false, rebuilt: true }
    },

    RebuildAllStacksLayerEntriesFromParts(options = {}) {
      const invalidateRendererCache = options?.invalidateRendererCache !== false
      const cloneStacks = options?.cloneStacks !== false
      const preferIncremental = options?.preferIncremental === true
      const reuseMap = preferIncremental
        ? this._createLayerEntriesReuseMap(options?.previousStacks)
        : null

      const stats = {
        totalParts: 0,
        reusedParts: 0,
        rebuiltParts: 0,
        incremental: preferIncremental
      }

      if (invalidateRendererCache) {
        try {
          this.previewRenderer?.invalidateFastPathCaches?.({ clearAppearanceCache: true })
        } catch (e) { console.warn(e) }
      }

      try {
        const targetStacks = cloneStacks
          ? this.stacks.map(el => fastClone(el))
          : this.stacks

        for (let stackIndex = 0; stackIndex < targetStacks.length; stackIndex++) {
          const stack = targetStacks[stackIndex]
          if (!stack || !Array.isArray(stack.data)) continue

          for (let partIndex = 0; partIndex < stack.data.length; partIndex++) {
            const part = stack.data[partIndex]
            if (!part) continue

            stats.totalParts += 1
            try {
              const result = this._restorePartLayerEntries(part, stackIndex, partIndex, reuseMap)
              if (result.reused) stats.reusedParts += 1
              if (result.rebuilt) stats.rebuiltParts += 1
            } catch (e) {
              try {
                part.layerEntries = this._buildLayerEntriesWithCache(part, true) || []
                stats.rebuiltParts += 1
              } catch (innerError) {
                console.warn(innerError)
              }
            }
          }
        }

        if (cloneStacks) {
          this.stacks = targetStacks
        }

        this._scheduleRefresh()
      }
      catch (e) {
        console.error('[studioStore] RebuildAllStacksLayerEntriesFromParts failed', e)
      }

      const fp = this.focusedPart
      if (fp && !Array.isArray(fp.layerEntries)) {
        try {
          const entries = this._buildLayerEntriesWithCache(fp, true) || []
          this._updateFocusedPartProperty('layerEntries', entries)
        } catch (e) { console.warn(e) }
      }

      return stats
    },

    triggerFocusedPartUpdate() {
      this.focusedPartUpdateFlag++
    },

    // -------------------------
    // Helper: Update focused part in place via index
    // -------------------------
    _updateFocusedPartInPlace(newPartData) {
      const coreStore = this._getCoreStore()
      return coreStore.updateFocusedPartInPlace(this, newPartData)
    },

    _updateFocusedPartProperty(propName, value) {
      const coreStore = this._getCoreStore()
      return coreStore.updateFocusedPartProperty(this, propName, value)
    },

    // -------------------------
    // PRIORITY ARRANGEMENT helpers
    // -------------------------
    getPriorityListForSelected() {
      return PriorityActions.getPriorityListForSelected(this, this.getGroupDescriptionForPart.bind(this))
    },

    updatePrioritiesForSelected(updates = []) {
      const result = PriorityActions.updatePrioritiesForSelected(this, updates, this.getGroupDescriptionForPart.bind(this))
      if (result.stacks) {
        this.stacks = result.stacks
        this._scheduleRefresh()
        return true
      }
      return false
    },

    recomputePrioritiesForSelected() {
      return PriorityActions.recomputePrioritiesForSelected(this, this.getGroupDescriptionForPart.bind(this))
    },

    getSelectedPrioritiesSnapshot() {
      return PriorityActions.getSelectedPrioritiesSnapshot(this)
    },

    // -------------------------
    // Helper: resolve CSS color or tag value
    // -------------------------
    _resolveColorCssFromText(text) {
      if (text === undefined || text === null) return null
      try {
        const t = String(text)
        if (t in this.paletteMap) {
          const v = this.paletteMap[t]
          return this._extractPrimaryCssColor(v)
        }
        const resolvedTagOffset = Palette.resolveTagOffsetColor(t, this.paletteMap)
        if (resolvedTagOffset?.ok) {
          return resolvedTagOffset.color
        }
        if (this._looksLikeCssColor(t)) return t
        return null
      } catch (e) { return null }
    },

    _looksLikeCssColor(s) {
      if (!s || typeof s !== 'string') return false
      const str = s.trim().toLowerCase()
      if (!str) return false
      if (str.startsWith('#')) return true
      if (str.startsWith('rgb') || str.startsWith('hsl')) return true
      const basic = ['red', 'blue', 'green', 'black', 'white', 'gray', 'grey', 'yellow', 'orange', 'purple', 'pink', 'brown']
      if (basic.includes(str)) return true
      return false
    },

    _extractPrimaryCssColor(v) {
      if (!v) return null
      if (typeof v === 'string') return v
      if (Array.isArray(v)) {
        for (const el of v) {
          if (typeof el === 'string') return el
          if (typeof el === 'number') return String(el)
        }
        return v.length ? String(v[0]) : null
      }
      return String(v)
    },

    /**
     * Update colorCss for layer entries in-place (efficient)
     */
    _updateLayerEntriesColorCss(layerEntries) {
      if (!Array.isArray(layerEntries)) return
      for (const entry of layerEntries) {
        if (!entry) continue
        if (entry.colorText !== undefined && entry.colorText !== null) {
          entry.colorCss = this._resolveColorCssFromText(entry.colorText)
        }
      }
    },

    /**
     * Schedule layer refresh (batched)
     */
    _scheduleLayerRefresh() {
      const renderStore = this._getRenderStore()
      return renderStore.scheduleLayerRefresh(this)
    },

    /**
     * Refresh color fields for all colorable layer entries (OPTIMIZED)
     */
    _refreshAllLayerEntriesFromPalette() {
      const renderStore = this._getRenderStore()
      return renderStore.refreshAllLayerEntriesFromPalette(this)
    },

    _doRefreshAllLayerEntriesFromPalette() {
      const renderStore = this._getRenderStore()
      return renderStore.doRefreshAllLayerEntriesFromPalette(this)
    },

    // -------------------------
    // Apply asset to selected stack
    // -------------------------
    async applyAssetToSelectedStack(asset, replaceTarget = null, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'asset.apply',
          payload: { asset, replaceTarget },
          meta: {}
        })
      }

      const assetStore = this._getAssetStore()
      return assetStore.applyAssetToSelectedStack(this, asset, replaceTarget, options)
    },

    // -------------------------
    // PERSISTENCE helpers
    // -------------------------
    _localStorageKeyForStacks() { return 'studio_stacks_v1' },
    _localStorageKeyForPalette() { return 'studio_palette_v1' },

    persistStacksToLocalStorage() {
      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.persistStacksToLocalStorage(this)
    },

    loadStacksFromLocalStorage() {
      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.loadStacksFromLocalStorage(this)
    },

    persistPaletteToLocalStorage() {
      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.persistPaletteToLocalStorage(this)
    },

    loadPaletteFromLocalStorage() {
      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.loadPaletteFromLocalStorage(this)
    },

    exportStacksToJsonFile(filename = 'stacks.json') {
      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.exportStacksToJsonFile(this, filename)
    },

    async importStacksFromJsonFile(file) {
      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.importStacksFromJsonFile(this, file)
    },

    exportPaletteToJsonFile(filename = 'palette.json') {
      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.exportPaletteToJsonFile(this, filename)
    },

    async importPaletteFromJsonFile(file) {
      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.importPaletteFromJsonFile(this, file)
    },

    exportStudioSnapshot(filename = 'studio_snapshot.json') {
      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.exportStudioSnapshot(this, filename)
    },

    async importStudioSnapshotFromFile(file) {
      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.importStudioSnapshotFromFile(this, file)
    },

    getMergedAppearanceForExport() {
      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.getMergedAppearanceForExport(this)
    },

    // -------------------------
    // Multi-layer selection methods
    // -------------------------

    /**
     * Generate unique key for layer identification
     */
    _buildLayerKey(stackIndex, partIndex, layerIndex) {
      return `${stackIndex}-${partIndex}-${layerIndex}`
    },

    _syncFocusStateScopeFromFocusedPart() {
      const stackIndex = this.focusedPartIndex?.stackIndex
      const partIndex = this.focusedPartIndex?.partIndex
      let partUid = null
      if (typeof stackIndex === 'number' && typeof partIndex === 'number') {
        const stack = this.stacks[stackIndex]
        const part = stack && Array.isArray(stack.data) ? stack.data[partIndex] : null
        partUid = part?._uid || null
      }

      this.focusState.scope = {
        stackIndex: (typeof stackIndex === 'number') ? stackIndex : null,
        partIndex: (typeof partIndex === 'number') ? partIndex : null,
        partUid
      }
      this._syncFocusedPartIndexToSelectionDomain()
    },

    _syncFocusStateSelectionFromLegacy() {
      const selected = Array.isArray(this.selectedLayers) ? this.selectedLayers : []
      this.focusState.selection = {
        mode: this.selectionMode,
        layerKeys: selected.map(s => this._buildLayerKey(s.stackIndex, s.partIndex, s.layerIndex)),
        anchorLayerKey: selected.length > 0
          ? this._buildLayerKey(selected[selected.length - 1].stackIndex, selected[selected.length - 1].partIndex, selected[selected.length - 1].layerIndex)
          : null
      }
    },

    _syncFocusStateEditorFromLegacy() {
      this.focusState.editor = {
        property: this.activeFocusContext?.property || null,
        subLayerIndex: this.activeFocusContext?.subLayerIndex ?? null,
        timestamp: this.activeFocusContext?.timestamp || 0
      }
    },

    _syncLegacyFromFocusState() {
      const selectionStore = this._getSelectionStore()
      selectionStore.applyFocusState(this.focusState)
      this.focusedPartIndex = {
        stackIndex: selectionStore.focusedPartIndex?.stackIndex ?? null,
        partIndex: selectionStore.focusedPartIndex?.partIndex ?? null
      }
      this._syncFocusedPartIndexToSelectionDomain()
    },

    setSelectionMode(mode = 'single') {
      const normalizedMode = mode === 'multiple' ? 'multiple' : 'single'
      this.selectionMode = normalizedMode

      if (normalizedMode === 'single' && this.selectedLayers.length > 1) {
        const firstLayer = this.selectedLayers[0]
        this.selectedLayers = firstLayer ? [firstLayer] : []
      }

      this._syncFocusStateSelectionFromLegacy()
    },

    /**
     * Toggle selection mode between single and multiple
     * Now with smooth focus state transition
     */
    toggleSelectionMode() {
      const wasSingleMode = this.selectionMode === 'single'
      const result = SelectionActions.toggleSelectionMode(this)
      this.selectionMode = result.selectionMode
      const isNowMultiMode = this.selectionMode === 'multiple'

      // Handle focus state transition
      if (wasSingleMode && isNowMultiMode) {
        // Single 鈫?Multi: preserve current selection
        // selectedLayers is already populated, no action needed
      } else if (!wasSingleMode && !isNowMultiMode) {
        // Multi 鈫?Single: keep only the first selected layer
        if (this.selectedLayers.length > 1) {
          const firstLayer = this.selectedLayers[0]
          this.selectedLayers = [firstLayer]
        }
      }

      this._syncFocusStateSelectionFromLegacy()
    },

    /**
     * Toggle layer selection (add or remove)
     */
    toggleLayerSelection(layerInfo) {
      const result = SelectionActions.toggleLayerSelection(this, layerInfo)
      this.selectedLayers = result.selectedLayers
      this._syncFocusStateSelectionFromLegacy()
    },

    /**
     * Check if a layer is currently selected
     */
    isLayerSelected(layerInfo) {
      return SelectionActions.isLayerSelected(this, layerInfo)
    },

    /**
     * Select all layers in the focused part
     */
    selectAllLayers() {
      const result = SelectionActions.selectAllLayers(this)
      this.selectedLayers = result.selectedLayers
      this._syncFocusStateSelectionFromLegacy()
    },

    /**
     * Clear all layer selections
     */
    clearLayerSelection() {
      const result = SelectionActions.clearLayerSelection()
      this.selectedLayers = result.selectedLayers
      this._syncFocusStateSelectionFromLegacy()
    },

    /**
     * Select a range of layers (Shift+Click)
     */
    selectLayerRange(fromIndex, toIndex) {
      const result = SelectionActions.selectLayerRange(this, fromIndex, toIndex)
      this.selectedLayers = result.selectedLayers
      this._syncFocusStateSelectionFromLegacy()
    },

    /**
     * Get full data for selected layers
     */
    getSelectedLayersData() {
      return SelectionActions.getSelectedLayersData(this)
    },

    /**
     * Get primary layer index for single-layer move operations.
     * Priority: selected layer in focused part -> focused subLayerIndex -> first layer.
     */
    getPrimaryMoveLayerIndex(part = this.focusedPart) {
      if (!part || !Array.isArray(part.layerEntries) || part.layerEntries.length === 0) return 0

      let idx = null
      const primarySelection = Array.isArray(this.selectedLayers) && this.selectedLayers.length > 0
        ? this.selectedLayers[0]
        : null

      if (primarySelection &&
          primarySelection.stackIndex === this.focusedPartIndex?.stackIndex &&
          primarySelection.partIndex === this.focusedPartIndex?.partIndex &&
          typeof primarySelection.layerIndex === 'number') {
        idx = primarySelection.layerIndex
      }

      if (idx === null && typeof this.activeFocusContext?.subLayerIndex === 'number') {
        idx = this.activeFocusContext.subLayerIndex
      }

      if (typeof idx !== 'number' || idx < 0 || idx >= part.layerEntries.length) {
        return 0
      }
      return idx
    },

    /**
     * Build palette targets from current layer selection.
     */
    getPaletteTargetsForCurrentSelection() {
      const data = this.getSelectedLayersData()
      return data
        .filter(d => d.layer && d.layer.isColorable)
        .map(d => ({
          uid: d.part?._uid || null,
          stackIndex: d.selection?.stackIndex,
          partIndex: d.selection?.partIndex,
          layerIndex: (typeof d.layer?.colorableIndex === 'number') ? d.layer.colorableIndex : d.selection?.layerIndex,
          currentColorText: d.layer?.colorText || null
        }))
    },

    /**
     * Build a palette target for a specific layer in UI panels.
     */
    getPaletteTargetForLayer({ stackIndex, partIndex, layerIndex, part = null, layer = null } = {}) {
      if (typeof stackIndex !== 'number' || typeof partIndex !== 'number' || typeof layerIndex !== 'number') {
        return null
      }

      const stack = this.stacks[stackIndex]
      const resolvedPart = part || (stack && Array.isArray(stack.data) ? stack.data[partIndex] : null)
      const entries = resolvedPart && Array.isArray(resolvedPart.layerEntries) ? resolvedPart.layerEntries : []
      const resolvedLayer = layer || entries.find(l => l.layerIndex === layerIndex)
      if (!resolvedLayer || !resolvedLayer.isColorable) return null

      return {
        uid: resolvedPart?._uid || null,
        stackIndex,
        partIndex,
        layerIndex: (typeof resolvedLayer.colorableIndex === 'number') ? resolvedLayer.colorableIndex : layerIndex,
        currentColorText: resolvedLayer.colorText || null
      }
    },

    /**
     * Check whether a palette target is currently active.
     */
    isPaletteTargetActive(target) {
      if (!target || typeof target.layerIndex !== 'number') return false
      const targets = Array.isArray(this.activePaletteTargets) ? this.activePaletteTargets : []
      return targets.some(t => {
        const sameLayer = t.layerIndex === target.layerIndex
        const sameScope =
          (t.uid && target.uid)
            ? t.uid === target.uid
            : (t.stackIndex === target.stackIndex && t.partIndex === target.partIndex)
        return sameLayer && sameScope
      })
    },

    _resolveLayerIndexFromPaletteTarget(part, targetLayerIndex) {
      if (!part || typeof targetLayerIndex !== 'number') return null

      const entries = this.getLayerEntriesForPart(part, { forceRebuild: false, clone: false })
      if (!Array.isArray(entries) || entries.length === 0) return null

      const byColorableIndex = entries.find(le => le && le.isColorable && le.colorableIndex === targetLayerIndex)
      if (byColorableIndex && typeof byColorableIndex.layerIndex === 'number') {
        return byColorableIndex.layerIndex
      }

      let colorableCounter = -1
      for (const entry of entries) {
        if (!entry || !entry.isColorable) continue
        colorableCounter += 1
        if (colorableCounter === targetLayerIndex) return entry.layerIndex
      }

      const byLayerIndex = entries.find(le => le && le.layerIndex === targetLayerIndex)
      return byLayerIndex ? byLayerIndex.layerIndex : null
    },

    _applyPaletteTargetsToSelection(targets = []) {
      const arr = Array.isArray(targets) ? targets : []
      if (!arr.length) return

      const nextSelection = []
      for (const t of arr) {
        let stackIndex = (typeof t?.stackIndex === 'number') ? t.stackIndex : null
        let partIndex = (typeof t?.partIndex === 'number') ? t.partIndex : null
        let partRef = null

        if (t?.uid) {
          const found = this.findPartByUid(t.uid)
          if (found) {
            partRef = found.partRef
            if (stackIndex === null) stackIndex = found.stackIndex
            if (partIndex === null) partIndex = found.partIndex
          }
        }

        if (!partRef && typeof stackIndex === 'number' && typeof partIndex === 'number') {
          const stack = this.stacks[stackIndex]
          partRef = stack && Array.isArray(stack.data) ? stack.data[partIndex] : null
        }

        if (!partRef || typeof stackIndex !== 'number' || typeof partIndex !== 'number') continue

        const resolvedLayerIndex = this._resolveLayerIndexFromPaletteTarget(partRef, t?.layerIndex)
        if (typeof resolvedLayerIndex !== 'number') continue

        const key = this._buildLayerKey(stackIndex, partIndex, resolvedLayerIndex)
        if (nextSelection.some(s => s._key === key)) continue
        nextSelection.push({ stackIndex, partIndex, layerIndex: resolvedLayerIndex, _key: key })
      }

      if (!nextSelection.length) return

      this.selectedLayers = nextSelection
      this.selectionMode = nextSelection.length > 1 ? 'multiple' : 'single'

      const primary = nextSelection[0]
      this.focusedPartIndex = {
        stackIndex: primary.stackIndex,
        partIndex: primary.partIndex
      }

      this._syncFocusStateScopeFromFocusedPart()
      this._syncFocusStateSelectionFromLegacy()
    },

    /**
     * Validate if a batch operation can be performed on targets
     */
    validateBatchOperation(operation, targets) {
      return SelectionActions.validateBatchOperation(operation, targets)
    },

    // ===== NEW UNIFIED FOCUS API =====
    // These methods provide a unified interface for layer focus management
    // that automatically adapts to single/multi selection modes

    /**
     * Focus on a layer (unified method that adapts to selection mode)
     * In single mode: replaces selection with this layer
     * In multi mode: toggles selection of this layer
     * @param {Object} layerInfo - { stackIndex, partIndex, layerIndex }
     */
    focusLayer(layerInfo) {
      if (!layerInfo || typeof layerInfo.stackIndex !== 'number' ||
          typeof layerInfo.partIndex !== 'number' ||
          typeof layerInfo.layerIndex !== 'number') {
        console.warn('[studioStore] focusLayer: invalid layerInfo', layerInfo)
        return
      }

      if (this.selectionMode === 'multiple') {
        // Multi mode: toggle selection
        this.toggleLayerSelection(layerInfo)
      } else {
        // Single mode: replace selection with this layer
        const key = this._buildLayerKey(layerInfo.stackIndex, layerInfo.partIndex, layerInfo.layerIndex)
        this.selectedLayers = [{
          stackIndex: layerInfo.stackIndex,
          partIndex: layerInfo.partIndex,
          layerIndex: layerInfo.layerIndex,
          _key: key
        }]
        this._syncFocusStateSelectionFromLegacy()
      }

      this.focusedPartIndex = {
        stackIndex: layerInfo.stackIndex,
        partIndex: layerInfo.partIndex
      }
      this._syncFocusStateScopeFromFocusedPart()

      // Clear property focus when switching layers
      this.activeFocusContext.property = null
      this.activeFocusContext.subLayerIndex = null
      this.activeFocusContext.timestamp = Date.now()
      this._syncFocusStateEditorFromLegacy()
    },

    /**
     * Set property focus (applies to all currently selected layers)
     * @param {string} property - 'color' | 'opacity' | 'drawing' | 'priority' | null
     * @param {number} subLayerIndex - Optional sublayer index
     */
    setPropertyFocus(property, subLayerIndex = null) {
      if (this.selectedLayers.length === 0) {
        console.warn('[studioStore] setPropertyFocus: no layers selected')
        return
      }

      this.activeFocusContext = {
        property: property || null,
        subLayerIndex: subLayerIndex,
        timestamp: Date.now()
      }
      this._syncFocusStateEditorFromLegacy()
    },

    /**
     * Clear all focus state (layers and property)
     */
    clearFocus() {
      this.focusClear({ keepScope: false })
    },

    /**
     * Unified focus clear action (single source + dual write)
     * @param {Object} options
     * @param {boolean} options.keepScope - keep part scope while clearing selection/editor
     */
    focusClear({ keepScope = false } = {}) {
      if (!keepScope) {
        this.focusState.scope = {
          stackIndex: null,
          partIndex: null,
          partUid: null
        }
      }

      this.focusState.selection = {
        mode: this.focusState.selection?.mode === 'multiple' ? 'multiple' : 'single',
        layerKeys: [],
        anchorLayerKey: null
      }

      this.focusState.editor = {
        property: null,
        subLayerIndex: null,
        timestamp: 0
      }

      this._syncLegacyFromFocusState()
    },

    /**
     * Clear property focus only (keeps selected layers)
     */
    clearPropertyFocus() {
      this.activeFocusContext = {
        property: null,
        subLayerIndex: null,
        timestamp: Date.now()
      }
      this._syncFocusStateEditorFromLegacy()
    },

    /**
     * Check if a specific layer is focused (selected)
     * @param {Object} layerInfo - { stackIndex, partIndex, layerIndex }
     * @returns {boolean}
     */
    isLayerFocused(layerInfo) {
      return this.isLayerSelected(layerInfo)
    },

    /**
     * Check if a specific layer's property is focused
     * @param {Object} layerInfo - { stackIndex, partIndex, layerIndex }
     * @param {string} property - 'color' | 'opacity' | 'drawing' | 'priority'
     * @returns {boolean}
     */
    isLayerPropertyFocused(layerInfo, property) {
      return this.isLayerSelected(layerInfo) && 
             this.activeFocusContext.property === property
    },

    /**
     * Get data for all focused (selected) layers
     * @returns {Array} Array of layer data objects
     */
    getFocusedLayersData() {
      return this.getSelectedLayersData()
    },

    // ===== END UNIFIED FOCUS API =====

    /**
     * Batch update opacity for selected layers
     * @param {number} value - Opacity value (0-100)
     * @param {string} mode - 'absolute' or 'relative'
     */
    batchUpdateOpacity(value, mode = 'absolute', options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'batch.updateOpacity',
          payload: { value, mode },
          meta: { deferCommit: options?.deferCommit === true }
        })
      }

      const deferCommit = options?.deferCommit === true || this._editorRealtimeMode === true

      const result = SelectionActions.batchUpdateOpacity(this, value, mode)
      if (!result.success) return result

      const updates = Array.isArray(result.updates) ? result.updates : []
      if (updates.length === 0) {
        return result
      }

      const historyMeta = this._normalizeHistoryMeta(
        options?.historyMeta,
        'batch.updateOpacity',
        {
          interactionKind: this._editorRealtimeInteractionKind,
          changedParts: updates.length
        }
      )

      const applyResult = this.batchApplyPartLayerDeltas(updates, {
        deferCommit,
        historyMeta,
        _fromFacade: true
      })

      if (!applyResult?.success) {
        return {
          ...result,
          success: false,
          reason: applyResult?.reason || 'Failed to apply opacity updates'
        }
      }

      return result
    },

    /**
     * Batch update offset for selected layers
     * @param {number} x - X offset
     * @param {number} y - Y offset
     * @param {string} mode - 'absolute' or 'relative'
     */
    batchUpdateOffset(x, y, mode = 'absolute', options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'batch.updateOffset',
          payload: { x, y, mode },
          meta: { deferCommit: options?.deferCommit === true }
        })
      }

      const deferCommit = options?.deferCommit === true || this._editorRealtimeMode === true

      const result = SelectionActions.batchUpdateOffset(this, x, y, mode)
      if (!result.success) return result

      const updates = Array.isArray(result.updates) ? result.updates : []
      if (updates.length === 0) {
        return result
      }

      const historyMeta = this._normalizeHistoryMeta(
        options?.historyMeta,
        'batch.updateOffset',
        {
          interactionKind: this._editorRealtimeInteractionKind,
          changedParts: updates.length
        }
      )

      const applyResult = this.batchApplyPartLayerDeltas(updates, {
        deferCommit,
        historyMeta,
        _fromFacade: true
      })

      if (!applyResult?.success) {
        return {
          ...result,
          success: false,
          reason: applyResult?.reason || 'Failed to apply offset updates'
        }
      }

      return result
    },

    /**
     * Batch update color for selected layers
     * @param {string} colorValue - Color value or tag
     */
    batchUpdateColor(colorValue, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'batch.updateColor',
          payload: { colorValue },
          meta: { deferCommit: options?.deferCommit === true }
        })
      }

      const deferCommit = options?.deferCommit === true || this._editorRealtimeMode === true

      const result = SelectionActions.batchUpdateColor(this, colorValue, this._resolveColorCssFromText.bind(this))
      if (!result.success) return result

      const updates = Array.isArray(result.updates) ? result.updates : []
      if (updates.length === 0) {
        return result
      }

      const historyMeta = this._normalizeHistoryMeta(
        options?.historyMeta,
        'batch.updateColor',
        {
          interactionKind: this._editorRealtimeInteractionKind,
          changedParts: updates.length
        }
      )

      const applyResult = this.batchApplyPartLayerDeltas(updates, {
        deferCommit,
        historyMeta,
        _fromFacade: true
      })

      if (!applyResult?.success) {
        return {
          ...result,
          success: false,
          reason: applyResult?.reason || 'Failed to apply color updates'
        }
      }

      return result
    },

    /**
     * Batch update priority for selected layers
     * @param {number} value - Priority value
     * @param {string} mode - 'absolute' or 'relative'
     */
    batchUpdatePriority(value, mode = 'absolute', options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'batch.updatePriority',
          payload: { value, mode },
          meta: { deferCommit: options?.deferCommit === true }
        })
      }

      const deferCommit = options?.deferCommit === true || this._editorRealtimeMode === true

      const result = SelectionActions.batchUpdatePriority(this, value, mode)
      if (!result.success) return result

      const updates = Array.isArray(result.updates) ? result.updates : []
      if (updates.length === 0) {
        return result
      }

      const historyMeta = this._normalizeHistoryMeta(
        options?.historyMeta,
        'batch.updatePriority',
        {
          interactionKind: this._editorRealtimeInteractionKind,
          changedParts: updates.length
        }
      )

      const applyResult = this.batchApplyPartLayerDeltas(updates, {
        deferCommit,
        historyMeta,
        _fromFacade: true
      })

      if (!applyResult?.success) {
        return {
          ...result,
          success: false,
          reason: applyResult?.reason || 'Failed to apply priority updates'
        }
      }

      return result
    },

    /**
     * Generic batch operation handler
     */
    applyBatchEdit(operation, payload, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        const normalizedOperation = String(operation || '').trim().toLowerCase()
        const deferCommit = options?.deferCommit === true

        if (normalizedOperation === 'opacity') {
          return this.execute({
            type: 'batch.updateOpacity',
            payload: { value: payload?.value, mode: payload?.mode },
            meta: { deferCommit }
          })
        }

        if (normalizedOperation === 'offset') {
          return this.execute({
            type: 'batch.updateOffset',
            payload: { x: payload?.x, y: payload?.y, mode: payload?.mode },
            meta: { deferCommit }
          })
        }

        if (normalizedOperation === 'color') {
          return this.execute({
            type: 'batch.updateColor',
            payload: { colorValue: payload?.colorValue ?? payload?.value },
            meta: { deferCommit }
          })
        }

        if (normalizedOperation === 'priority') {
          return this.execute({
            type: 'batch.updatePriority',
            payload: { value: payload?.value, mode: payload?.mode },
            meta: { deferCommit }
          })
        }

        return { success: false, reason: 'Unknown operation', selectedLayers: this.selectedLayers }
      }

      const deferCommit = options?.deferCommit === true || this._editorRealtimeMode === true
      const result = SelectionActions.applyBatchEdit(this, operation, payload, this._resolveColorCssFromText.bind(this))
      if (!result.success) return result

      const updates = Array.isArray(result.updates) ? result.updates : []
      if (updates.length === 0) {
        return result
      }

      const normalizedOperation = String(operation || '').trim().toLowerCase()
      const fallbackActionByOperation = {
        opacity: 'batch.updateOpacity',
        offset: 'batch.updateOffset',
        color: 'batch.updateColor',
        priority: 'batch.updatePriority'
      }

      const historyMeta = this._normalizeHistoryMeta(
        options?.historyMeta,
        fallbackActionByOperation[normalizedOperation] || null,
        {
          interactionKind: this._editorRealtimeInteractionKind,
          changedParts: updates.length
        }
      )

      const applyResult = this.batchApplyPartLayerDeltas(updates, {
        deferCommit,
        historyMeta,
        _fromFacade: true
      })

      if (!applyResult?.success) {
        return {
          ...result,
          success: false,
          reason: applyResult?.reason || 'Failed to apply batch updates'
        }
      }

      return result
    },

    /**
     * Cleanup resources (call when store is destroyed)
     */
    destroy() {
      const renderStore = this._getRenderStore()
      return renderStore.destroy(this)
    },

    /**
     * Toggle between optimized and legacy renderer
     */
    toggleRendererMode(useOptimized = true) {
      const renderStore = this._getRenderStore()
      return renderStore.toggleRendererMode(this, useOptimized)
    },

    // -------------------------
    // Undo/Redo Management
    // -------------------------

    /**
     * Start a history transaction (for high-frequency operations)
     * @param {string} [tag] Optional tag to identify the transaction
     */
    startHistoryTransaction(tag = null) {
      const historyStore = this._getHistoryStore()
      historyStore.startHistoryTransaction(this, tag)
    },

    /**
     * End the current history transaction
     */
    endHistoryTransaction() {
      const historyStore = this._getHistoryStore()
      historyStore.endHistoryTransaction(this)
    },

    /**
     * Cancel the current history transaction without recording
     */
    cancelHistoryTransaction() {
      const historyStore = this._getHistoryStore()
      historyStore.cancelHistoryTransaction(this)
    },

    /**
     * Push current state to history (for discrete operations)
     */
    pushHistorySnapshot(historyMeta = null) {
      const historyStore = this._getHistoryStore()
      historyStore.pushHistorySnapshot(this, historyMeta)
    },

    /**
     * Push current state to history with throttling (for keyboard input, etc.)
     * @param {number} [delay] Optional custom delay in ms
     */
    pushHistorySnapshotThrottled(delay = null, historyMeta = null) {
      const historyStore = this._getHistoryStore()
      historyStore.pushHistorySnapshotThrottled(this, delay, historyMeta)
    },

    /**
     * Undo the last action
     * @returns {boolean} True if undo was performed
     */
    undo() {
      const historyStore = this._getHistoryStore()
      return historyStore.undo(this)

    },

    /**
     * Redo the last undone action
     * @returns {boolean} True if redo was performed
     */
    redo() {
      const historyStore = this._getHistoryStore()
      return historyStore.redo(this)
    },

    /**
     * Clear all history
     */
    clearHistory(options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'history.clear',
          payload: {},
          meta: {}
        })
      }

      const historyStore = this._getHistoryStore()
      return historyStore.clearHistory(this)
    },

    /**
     * Get history information
     * @returns {Object} History info
     */
    getHistory() {
      const historyStore = this._getHistoryStore()
      return historyStore.getHistory(this)
    },

    /**
     * Get full history stacks with metadata
     * @returns {Object} Full history info with undo and redo stacks
     */
    getFullHistory() {
      const historyStore = this._getHistoryStore()
      return historyStore.getFullHistory(this)
    },

    getHistoryView(options = {}) {
      const historyStore = this._getHistoryStore()
      return historyStore.getHistoryView(this, options)
    },

    /**
     * Jump to a specific state in history
     * @param {number} steps - Number of steps to jump
     * @returns {boolean} True if jump was performed
     */
    jumpToHistoryState(steps, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'history.jump',
          payload: { steps },
          meta: {}
        })
      }

      const historyStore = this._getHistoryStore()
      return historyStore.jumpToHistoryState(this, steps)
    },

    jumpToHistoryTimestamp(timestamp, policy = 'latest', options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'history.jump',
          payload: { timestamp, policy },
          meta: {}
        })
      }

      const historyStore = this._getHistoryStore()
      return historyStore.jumpToHistoryTimestamp(this, timestamp, policy)
    },

    /**
     * Toggle history panel visibility
     */
    toggleHistoryPanel(visible) {
      const panelStore = this._getPanelStore()
      panelStore.toggleHistoryPanel(visible)
      this._syncPanelDomainState()
    },

    /**
     * Check if undo is available
     */
    canUndo() {
      const historyStore = this._getHistoryStore()
      return historyStore.canUndo(this)
    },

    /**
     * Check if redo is available
     */
    canRedo() {
      const historyStore = this._getHistoryStore()
      return historyStore.canRedo(this)
    },

    // -------------------------
    // Auto-save Management
    // -------------------------

    /**
     * Enable auto-save with debounce
     */
    enableAutoSave() {
      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.enableAutoSave(this)
    },

    /**
     * Disable auto-save
     */
    disableAutoSave() {
      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.disableAutoSave(this)
    },

    /**
     * Save state to localStorage with compression
     */
    async saveToLocalStorage() {
      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.saveToLocalStorage(this)
    },

    /**
     * Restore state from localStorage
     */
    async restoreFromLocalStorage() {
      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.restoreFromLocalStorage(this)
    },

    /**
     * Clear auto-saved data from localStorage
     */
    clearLocalStorage() {
      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.clearLocalStorage(this)
    },

    /**
     * Get information about auto-saved data
     */
    async getAutoSaveInfo() {
      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.getAutoSaveInfo()
    },

    // -------------------------
    // Multi-file Storage Management
    // -------------------------

    /**
     * Auto-save to quick save slot using StudioStorageService
     */
    async autoSave() {
      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.autoSave(this)
    },

    /**
     * Manual save with custom name
     */
    async saveStudioSession(name, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'saves.save',
          payload: { name },
          meta: {}
        })
      }

      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.saveStudioSession(this, name)
    },

    /**
     * Load a save by ID
     */
    async loadStudioSession(id, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'saves.load',
          payload: { id },
          meta: {}
        })
      }

      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.loadStudioSession(this, id)
    },

    renameStudioSession(id, newName, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'saves.rename',
          payload: { id, newName },
          meta: {}
        })
      }

      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.renameStudioSession(this, id, newName)
    },

    deleteStudioSession(id, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'saves.delete',
          payload: { id },
          meta: {}
        })
      }

      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.deleteStudioSession(this, id)
    },

    /**
     * Auto-restore from quick save on studio open
     */
    async autoRestoreSession() {
      const persistenceStore = this._getPersistenceStore()
      return persistenceStore.autoRestoreSession(this)
    }
  }
})

export function useStudioStore(...args) {
  const store = useStudioStoreBase(...args)
  ensureRenderProxyBindings(store)
  ensureSelectionProxyBindings(store)
  ensurePaletteProxyBindings(store)
  return store
}

export default useStudioStore
