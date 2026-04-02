/**
 * NOTE:
 * This file manages the studio state with unified focus system (focusState) and
 * per-part _uid bookkeeping so components can refer to parts by reference or uid.
 */
import { defineStore } from 'pinia'
import { RenderService } from '@/services/RenderService'
import OptimizedRenderService from '@/services/OptimizedRenderService'
import { RenderApi } from '@/utils/RenderApi'
import { AssetApi } from '@/utils/AssetApi'
import { toRaw } from 'vue'

import { hostWindow } from '@/utils/host-window.js'

// Clone utilities
import { fastClone, shallowClone } from '@/utils/clone.js'

// Action modules
import * as StackActions from '@/studio/stack-actions.js'
import * as PaletteActions from '@/studio/palette-actions.js'
import * as FocusActions from '@/studio/focus-actions.js'
import * as RenderingActions from '@/studio/rendering-actions.js'
import * as LayerActions from '@/studio/layer-actions.js'
import * as SelectionActions from '@/studio/selection-actions.js'
import * as PreviewActions from '@/studio/preview-actions.js'
import * as PriorityActions from '@/studio/priority-actions.js'
import * as AssetActions from '@/studio/asset-actions.js'
import { resolveCraftForAssetSlot } from '@/studio/craft-resolver.js'
import { getStudioFacade } from '@/studio/StudioFacade'
import { createStudioRenderPipeline } from '@/studio/StudioRenderPipeline'
import {
  PANEL_HOST,
  PANEL_VISIBILITY,
  createHostActiveDefaults,
  createPanelRuntimeDefaults
} from '@/studio/panel-system'
import {
  isStudioFacadeEnabled,
  isStudioRenderPipelineEnabled,
  isRenderReconstructFromLayerEntriesEnabled
} from '@/config/featureFlags'

/*
  NOTE:
  - Palette functions: '@/services/PaletteService'
  - Asset index functions: '@/services/AssetIndexService'
  - Layer translator functions: '@/services/LayerTranslator'
*/
import * as Palette from '@/services/PaletteService'
import * as AssetIndex from '@/services/AssetIndexService'
import * as LayerTranslator from '@/services/LayerTranslator'
import { applyLayerDeltasToPart } from '@/services/PartPatchApplier'
import { useStudioPanelStore } from '@/stores/studio/panelStore'
import { useStudioHistoryStore } from '@/stores/studio/historyStore'
import { useStudioPersistenceStore } from '@/stores/studio/persistenceStore'
import { useStudioSelectionStore } from '@/stores/studio/selectionStore'
import { useStudioPaletteStore } from '@/stores/studio/paletteStore'

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

/**
 * Batch update scheduler using requestAnimationFrame
 */
class RefreshScheduler {
  constructor() {
    this._pendingRefresh = false
    this._pendingLayerRefresh = false
    this._rafId = null
    this._callbacks = []
  }

  scheduleRefresh(callback) {
    this._callbacks.push(callback)
    if (!this._rafId) {
      this._rafId = requestAnimationFrame(() => {
        this._rafId = null
        const cbs = this._callbacks.slice()
        this._callbacks = []
        for (const cb of cbs) {
          try { cb() } catch (e) { console.warn(e) }
        }
      })
    }
  }

  cancel() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }
    this._callbacks = []
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

const useStudioStoreBase = defineStore('studio', {
  state: () => ({
    stacks: [],
    mergedAppearanceData: { data: [] }, // preview data (may contain tags)
    selectedIndex: -1,

    // Legacy renderer for thumbnails (backward compatibility)
    renderer: new RenderService({ drawCallbacks: RenderApi, thumbwidth: 500, thumbheight: 1000, previewwidth: 500, previewheight: 1000 }),

    // Optimized renderer for main preview
    previewRenderer: new OptimizedRenderService({
      drawCallbacks: RenderApi,
      previewwidth: 500,
      previewheight: 1000
    }),

    // Config flag to toggle between renderers (for testing/fallback)
    useOptimizedRenderer: true,

    renderPipeline: createStudioRenderPipeline({
      assetApi: AssetApi,
      paletteService: Palette
    }),
    _renderPipelineLastStats: null,

    // NEW: Only use focusedPartIndex to locate the focused part
    focusedPartIndex: {
      stackIndex: null,
      partIndex: null
    },
    layerManagerActive: false,

    assetGroupsRaw: [],
    assetIndex: {},

    // last translated layer entries
    translatedLayerEntries: [],

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

    // Performance: refresh scheduler instance
    _refreshScheduler: new RefreshScheduler(),

    // Performance: track if refresh is pending
    _pendingMergedRefresh: false,
    _pendingLayerRefresh: false,

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

    // Preview stack management: coordinates hover previews between components
    // Structure: [{ id, priority, preview, source, timestamp }, ...]
    // Higher priority previews take precedence over lower ones
    _previewStack: [],
    _activePreviewId: null // ID of currently active preview
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
    StackActions,
    PaletteActions,
    FocusActions,
    RenderingActions,
    LayerActions,
    SelectionActions,
    PreviewActions,
    PriorityActions,
    AssetActions,

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
      if (!id || typeof priority !== 'number') return

      // Remove if already exists (to update)
      this._previewStack = this._previewStack.filter(p => p.id !== id)

      // Add new preview entry
      this._previewStack.push({
        id,
        priority,
        preview: previewData,
        source,
        timestamp: Date.now()
      })

      // Update active preview
      this._updateActivePreview()
    },

    /**
     * Remove a preview from the stack
     * @param {string} id - ID of preview to remove
     */
    popPreview(id) {
      if (!id) return

      const nextStack = this._previewStack.filter(p => p.id !== id)
      if (nextStack.length === this._previewStack.length) {
        return
      }

      this._previewStack = nextStack

      // Update active preview
      this._updateActivePreview()
    },

    /**
     * Internal: Update active preview based on max priority
     */
    _updateActivePreview() {
      if (this._previewStack.length === 0) {
        // No previews active: restore original merged appearance
        this._activePreviewId = null
        this.refreshMergedAppearanceData()
        return
      }

      // Find highest priority preview
      let highestPriority = -1
      let activePreview = null

      for (const preview of this._previewStack) {
        if (preview.priority > highestPriority) {
          highestPriority = preview.priority
          activePreview = preview
        }
      }

      if (!activePreview) return

      // Re-render when active preview id changes or the preview payload is updated.
      const shouldRender =
        this._activePreviewId !== activePreview.id ||
        this.mergedAppearanceData !== activePreview.preview

      if (shouldRender) {
        this._activePreviewId = activePreview.id
        this.mergedAppearanceData = activePreview.preview

        // Render preview
        try {
          const activeRenderer = this.useOptimizedRenderer ? this.previewRenderer : this.renderer
          if (activeRenderer && typeof activeRenderer.renderPreviewWithItem === 'function') {
            activeRenderer.renderPreviewWithItem(activePreview.preview)
          }
        } catch (e) {
          console.warn('[studioStore] Failed to render preview:', e)
        }
      }
    },

    /**
     * Check if a preview source is currently active
     * @param {string} id - Preview ID to check
     * @returns {boolean}
     */
    isPreviewActive(id) {
      return this._activePreviewId === id
    },

    // -------------------------
    // Preview tool management
    // -------------------------
    ensurePartUid(part) {
      if (!part || typeof part !== 'object') return null
      if (part._uid) return part._uid
      const uid = 'p' + (this._partUidCounter++)
      try { part._uid = uid } catch (e) { /* non-writable?  ignore */ }
      return uid
    },

    findPartByUid(uid) {
      if (!uid) return null
      for (let si = 0; si < this.stacks.length; si++) {
        const el = this.stacks[si]
        if (!el || !Array.isArray(el.data)) continue
        for (let pi = 0; pi < el.data.length; pi++) {
          const part = el.data[pi]
          if (part && part._uid === uid) return { partRef: part, stackIndex: si, partIndex: pi }
        }
      }
      return null
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
      if (this._pendingMergedRefresh) return
      this._pendingMergedRefresh = true

      this._refreshScheduler.scheduleRefresh(() => {
        this._pendingMergedRefresh = false
        this._doRefreshMergedAppearanceData()
      })
    },

    /**
     * Immediate refresh (for critical paths like initial load)
     */
    refreshMergedAppearanceData() {
      // Cancel any pending scheduled refresh
      this._pendingMergedRefresh = false
      this._doRefreshMergedAppearanceData()
    },

    /**
     * Internal: actual refresh logic
     */
    _doRefreshMergedAppearanceData() {
      // Choose renderer based on config
      const activeRenderer = this.useOptimizedRenderer ? this.previewRenderer : this.renderer

      if (isStudioRenderPipelineEnabled() && this.renderPipeline) {
        const result = this.renderPipeline.render({
          stacks: this.stacks,
          paletteMap: this.paletteMap,
          activeRenderer,
          previousMergedAppearanceData: this.mergedAppearanceData,
          reconstructStacks: (stacks) => this._reconstructStacksForRender(stacks)
        })

        this._renderPipelineLastStats = result?.stats || null
        if (result?.mergedAppearanceData) {
          this.mergedAppearanceData = result.mergedAppearanceData
        }
        return
      }

      this._renderPipelineLastStats = null
      try { activeRenderer.removeCanvas(this.mergedAppearanceData) } catch (e) { console.warn(e) }
      const unexpanded = {
        data: AssetApi.stackOutfitData(this._reconstructStacksForRender(this.stacks)),
        type: 'outfit'
      }
      this.mergedAppearanceData = Palette.expandedAppearanceForRendering(unexpanded, this.paletteMap)
      activeRenderer.renderPreviewWithItem(this.mergedAppearanceData)
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
      if (!this.assetIndex || Object.keys(this.assetIndex).length === 0 ||
          !this.assetGroupsRaw || this.assetGroupsRaw.length === 0) {
        await this.loadAssetData()
      }

      const result = StackActions.addElementToStacks(this, el, {
        fastClone,
        ensurePartUid: this.ensurePartUid.bind(this),
        _buildLayerEntriesWithCache: this._buildLayerEntriesWithCache.bind(this),
        _updateLayerEntriesColorCss: this._updateLayerEntriesColorCss.bind(this),
        refreshMergedAppearanceData: this.refreshMergedAppearanceData.bind(this),
        pushHistorySnapshot: this.pushHistorySnapshot.bind(this)
      })

      if (result.element !== null) {
        // Element is already in the returned stacks, just assign
        this.stacks = result.stacks
        this.selectedIndex = result.selectedIndex
        this.paletteMap = result.paletteMap
        this._paletteNextCounter = result._paletteNextCounter
        this._paletteVersion = result._paletteVersion
        this.refreshMergedAppearanceData()
        this.pushHistorySnapshot(this._normalizeHistoryMeta(null, 'stack.add'))
      }
    },

    removeElement(idx) {
      if (idx < 0 || idx >= this.stacks.length) return

      const result = StackActions.removeElementFromStacks(this, idx, {
        renderer: this.renderer,
        stacks: this.stacks,
        selectedIndex: this.selectedIndex,
        focusedPartIndex: this.focusedPartIndex,
        pushHistorySnapshot: () => this.pushHistorySnapshot(this._normalizeHistoryMeta(null, 'stack.remove'))
      })

      this.stacks = result.stacks
      this.selectedIndex = result.selectedIndex
      this.focusedPartIndex = result.focusedPartIndex
      this._syncFocusStateScopeFromFocusedPart()
      this._scheduleRefresh()
    },

    moveElement(fromIdx, toIdx) {
      if (fromIdx === toIdx) return
      if (fromIdx < 0 || fromIdx >= this.stacks.length) return
      if (toIdx < 0 || toIdx >= this.stacks.length) return

      const result = StackActions.moveElementInStacks(this, fromIdx, toIdx, {
        stacks: this.stacks,
        selectedIndex: this.selectedIndex,
        focusedPartIndex: this.focusedPartIndex,
        _scheduleRefresh: this._scheduleRefresh.bind(this)
      })

      this.stacks = result.stacks
      this.selectedIndex = result.selectedIndex
      this.focusedPartIndex = result.focusedPartIndex
      this._syncFocusStateScopeFromFocusedPart()
      this._scheduleRefresh()
      this.pushHistorySnapshot(this._normalizeHistoryMeta(null, 'stack.move'))
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
      const result = StackActions.selectElementInStacks(this, idx, {
        focusedPartIndex: this.focusedPartIndex
      })

      this.selectedIndex = result.selectedIndex
      if (result.focusedPartIndex) {
        this.focusedPartIndex = result.focusedPartIndex
        this._syncFocusStateScopeFromFocusedPart()
      }
      if (result.clearPropertyFocus) {
        this.clearPropertyFocus()
      }
    },

    clear() {
      if (!Array.isArray(this.stacks) || this.stacks.length === 0) return

      this.pushHistorySnapshot(this._normalizeHistoryMeta(null, 'stack.clear'))

      const result = StackActions.clearAllStacks(this, {
        renderer: this.renderer,
        focusedPartIndex: this.focusedPartIndex
      })

      this.stacks = result.stacks
      this.selectedIndex = result.selectedIndex
      this.mergedAppearanceData = result.mergedAppearanceData
      this.focusedPartIndex = result.focusedPartIndex
      this._syncFocusStateScopeFromFocusedPart()
      if (result.clearPropertyFocus) {
        this.clearPropertyFocus()
      }
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
      const res = await AssetIndex.loadAssetData()
      this.assetGroupsRaw = res.assetGroupsRaw
      this.assetIndex = res.assetIndex
      return res.assetGroupsRaw
    },

    findAssetsGroupForPart(part) {
      return AssetIndex.getAssetCandidatesForPart(this.assetIndex, this.assetGroupsRaw, part)
    },

    findAssetGroupEntryForPart(part) {
      return AssetIndex.findAssetGroupEntryForPart(this.assetGroupsRaw, this.assetIndex, part)
    },

    _normalizeAssetsFromGroupData(groupData) {
      return AssetIndex.normalizeAssetsFromGroupData(groupData)
    },

    getAssetCandidatesForPart(part) {
      return AssetIndex.getAssetCandidatesForPart(this.assetIndex, this.assetGroupsRaw, part)
    },

    resolveAssetForPart(part) {
      return AssetIndex.resolveAssetForPart(this.assetIndex, this.assetGroupsRaw, part)
    },

    getGroupDescriptionForPart(part) {
      return AssetIndex.getGroupDescriptionForPart(this.assetGroupsRaw, this.assetIndex, part)
    },

    matchesSearchForPart(part, term) {
      return AssetIndex.matchesSearchForPart(this.assetIndex, this.assetGroupsRaw, part, term)
    },

    // -------------------------
    // Palette helpers (pure)
    // -------------------------
    createTagAndReplaceInStacks(value) {
      try {
        const createRes = Palette.createTagForValue(this.paletteMap, this._paletteNextCounter, value)
        this.paletteMap = createRes.paletteMap
        this._paletteNextCounter = createRes.paletteCounter
        this._paletteVersion++
        let tag = createRes.tag

        if (!tag) {
          try {
            const want = (value === undefined) ? null : JSON.stringify(value)
            for (const k of Object.keys(this.paletteMap || {})) {
              try {
                const v = this.paletteMap[k]
                if (JSON.stringify(v) === want) { tag = k; break }
              } catch (e) { continue }
            }
          } catch (e) { /* ignore fallback failure */ }
        }

        if (!tag) return null

        this.stacks = Palette.replaceValueInStacks(this.stacks, value, tag)

        const fp = this.focusedPart
        if (fp) {
          const replaced = Palette.replaceValueInPart(fp, value, tag)
          this._updateFocusedPartInPlace(replaced)
        }

        this._scheduleLayerRefresh()
        this._scheduleRefresh()
        this._finalizeMutation({
          changed: true,
          scope: 'palette',
          historyMode: 'immediate',
          historyMeta: this._normalizeHistoryMeta(null, 'palette.createTagAndReplace'),
          scheduleLayer: false,
          scheduleRefresh: false,
          schedulePart: false,
          touchFocusedPart: false
        })
        return tag
      } catch (e) {
        console.warn('[studioStore] createTagAndReplaceInStacks failed', e)
        return null
      }
    },

    renamePaletteTagAndReferences(oldTag, newTag) {
      const fromTag = String(oldTag || '').trim()
      const toTag = String(newTag || '').trim()
      if (!fromTag || !toTag || fromTag === toTag) return false
      if (this.paletteMap && Object.prototype.hasOwnProperty.call(this.paletteMap, toTag)) return false

      try {
        const renameTagRefText = (text) => {
          if (typeof text !== 'string') return text
          if (text === fromTag) return toTag

          const parsed = Palette.parseTagOffsetRef(text)
          if (parsed.isTagOffsetRef && parsed.tag === fromTag) {
            return Palette.formatTagOffsetRef(toTag, parsed.offset)
          }
          return text
        }

        const replaceTagRefsDeep = (node) => {
          if (!node || typeof node !== 'object') return

          if (Array.isArray(node)) {
            for (let i = 0; i < node.length; i++) {
              if (typeof node[i] === 'string') {
                node[i] = renameTagRefText(node[i])
              } else {
                replaceTagRefsDeep(node[i])
              }
            }
            return
          }

          if (typeof node.Color === 'string') {
            node.Color = renameTagRefText(node.Color)
          } else if (Array.isArray(node.Color)) {
            for (let i = 0; i < node.Color.length; i++) {
              if (typeof node.Color[i] === 'string') {
                node.Color[i] = renameTagRefText(node.Color[i])
              }
            }
          }

          if (typeof node.colorText === 'string') {
            node.colorText = renameTagRefText(node.colorText)
          }
          if (typeof node.currentColorText === 'string') {
            node.currentColorText = renameTagRefText(node.currentColorText)
          }

          for (const key of Object.keys(node)) {
            if (key === 'Color' || key === 'colorText' || key === 'currentColorText') continue
            const value = node[key]
            if (value && typeof value === 'object') {
              replaceTagRefsDeep(value)
            }
          }
        }

        const newStacks = fastClone(this.stacks || [])
        for (const el of newStacks) {
          if (!el || !Array.isArray(el.data)) continue
          for (const part of el.data) {
            replaceTagRefsDeep(part)
          }
        }

        const newFocused = fastClone(this.focusedPart)
        if (newFocused) replaceTagRefsDeep(newFocused)

        const newTargets = fastClone(this.activePaletteTargets || [])
        replaceTagRefsDeep(newTargets)

        const pm = fastClone(this.paletteMap || {})
        pm[toTag] = pm[fromTag]
        delete pm[fromTag]

        this.stacks = newStacks
        if (newFocused) this._updateFocusedPartInPlace(newFocused)
        this.activePaletteTargets = newTargets
        this.paletteMap = pm
        this._paletteVersion++

        this._refreshAllLayerEntriesFromPalette()
        this.refreshMergedAppearanceData()
        this._finalizeMutation({
          changed: true,
          scope: 'palette',
          historyMode: 'immediate',
          historyMeta: this._normalizeHistoryMeta(null, 'palette.renameTagReferences'),
          scheduleLayer: false,
          scheduleRefresh: false,
          schedulePart: false,
          touchFocusedPart: false
        })
        return true
      } catch (e) {
        console.warn('[studioStore] renamePaletteTagAndReferences failed', e)
        return false
      }
    },

    /**
     * Set palette mode state and register active palette targets. 
     */
    setPaletteMode(active = false, targets = []) {
      this.paletteModeActive = !!active
      if (!this.paletteModeActive) {
        this.paletteUpdateFlag++
        return
      }

      if (Array.isArray(targets) && targets.length > 0) {
        this._applyPaletteTargetsToSelection(targets)
      }

      if (this.selectedLayers.length > 0) {
        this.setPropertyFocus('color')
      }

      this.paletteUpdateFlag++
    },

    clearPaletteMode() {
      this.paletteModeActive = false
      this.paletteUpdateFlag++
    },

    openPalettePanel(targets = []) {
      try {
        this._syncPanelDomainState()
        this.setPaletteMode(true, targets)
        this.paletteWorkMode = 'external'
        const nextState = (this.panelRuntime?.palette?.state === PANEL_VISIBILITY.PINNED)
          ? PANEL_VISIBILITY.PINNED
          : PANEL_VISIBILITY.PEEK
        this.openPanel('palette', {
          host: PANEL_HOST.TOOL_DOCK,
          state: nextState,
          reason: 'open-palette-panel'
        })
      } catch (e) {
        this.palettePanelVisible = true
      }
      this.persistUiLayout()
    },

    setPaletteWorkMode(mode = 'external') {
      this.paletteWorkMode = mode
    },

    closePalettePanel(options = {}) {
      const forceClose = options?.forceClose === true
      const reason = String(options?.reason || 'close-palette-panel')
      try {
        this._syncPanelDomainState()
        if (forceClose || this.panelRuntime?.palette?.state !== PANEL_VISIBILITY.PINNED) {
          this.closePanel('palette', { reason })
        }
      } finally {
        try {
          const committed = this.commitInteraction()
          if (!committed) {
            this.forceEndRealtimeScope('palette', {
              commit: true,
              interactionKind: 'palette'
            })
          }
        } catch (e) { console.warn(e) }
        try { this.clearPaletteMode() } catch (e) { console.warn(e) }
      }
      this.persistUiLayout()
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

      if (!Array.isArray(this.stacks) || stackIndex < 0 || stackIndex >= this.stacks.length) return false

      const normalizedName = String(newName || '').trim()
      const currentName = String(this.stacks[stackIndex]?.name || '').trim()
      if (!normalizedName || currentName === normalizedName) return false

      const nextStacks = this.stacks.slice()
      nextStacks[stackIndex] = { ...nextStacks[stackIndex], name: normalizedName }
      this.stacks = nextStacks

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

      if (!Array.isArray(updates) || updates.length === 0) return false

      let changedCount = 0
      for (const update of updates) {
        const changed = this.updatePartLayerEntries(update?.part, update?.entries, {
          deferRefresh: true,
          historyMeta: options?.historyMeta,
          _fromFacade: true
        })
        if (changed) changedCount++
      }

      const normalizedHistoryMeta = this._normalizeHistoryMeta(
        options?.historyMeta,
        'layer.batchApplyLayerDeltas',
        {
          interactionKind: this._editorRealtimeInteractionKind,
          changedParts: changedCount
        }
      )

      const historyMode = options?.deferCommit === true ? 'throttled' : 'immediate'

      return this._finalizeMutation({
        changed: changedCount > 0,
        deferCommit: options?.deferCommit === true,
        scope: 'editor',
        historyMode,
        historyMeta: normalizedHistoryMeta,
        schedulePart: false,
        touchFocusedPart: false
      })
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
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'palette.applyColor',
          payload: { newColor },
          meta: { deferCommit: options?.deferCommit === true }
        })
      }

      const deferCommit = options?.deferCommit === true || this._paletteRealtimeMode === true
      const normalizedColorText = newColor === undefined || newColor === null ? '' : String(newColor)

      let changed = this._applyPaletteColorViaLayerDeltas(normalizedColorText).changed

      if (!changed) {
        changed = PaletteActions.applyColorToTargets(this, normalizedColorText, {
          paletteModeActive: this.paletteModeActive,
          activePaletteTargets: this.activePaletteTargets,
          stacks: this.stacks,
          findPartByUid: this.findPartByUid.bind(this),
          _buildLayerEntriesWithCache: this._buildLayerEntriesWithCache.bind(this),
          _scheduleLayerRefresh: this._scheduleLayerRefresh.bind(this),
          _schedulePartUpdate: (() => {}),
          triggerFocusedPartUpdate: this.triggerFocusedPartUpdate.bind(this),
          pushHistorySnapshotThrottled: (() => {}),
          _resolveColorCssFromText: this._resolveColorCssFromText.bind(this)
        })
      }

      const historyMeta = this._normalizeHistoryMeta(
        options?.historyMeta,
        'palette.applyColor',
        { interactionKind: this._paletteRealtimeInteractionKind }
      )

      return this._finalizePaletteMutation(changed, {
        deferCommit,
        throttleHistory: deferCommit,
        historyMeta
      })
    },

    applyTagToActivePaletteTargets(tag, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'palette.applyTag',
          payload: { tag }
        })
      }

      return this.applyColorToActivePaletteTargets(tag, {
        deferCommit: options?.deferCommit === true,
        historyMeta: this._normalizeHistoryMeta(
          options?.historyMeta,
          'palette.applyTag',
          { interactionKind: this._paletteRealtimeInteractionKind }
        ),
        _fromFacade: true
      })
    },

    applyTagOffsetToActivePaletteTargets(payload = {}, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'palette.applyTagOffset',
          payload,
          meta: { deferCommit: options?.deferCommit === true }
        })
      }

      const tag = String(payload?.tag || '').trim()
      if (!tag) return false

      const ref = Palette.formatTagOffsetRef(tag, payload?.offset || {})
      if (!ref) return false

      return this.applyColorToActivePaletteTargets(ref, {
        deferCommit: options?.deferCommit === true,
        historyMeta: this._normalizeHistoryMeta(
          options?.historyMeta,
          'palette.applyTagOffset',
          { interactionKind: this._paletteRealtimeInteractionKind }
        ),
        _fromFacade: true
      })
    },

    resetTagOffsetToTag(tag, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'palette.resetTagOffset',
          payload: { tag },
          meta: { deferCommit: options?.deferCommit === true }
        })
      }

      const normalizedTag = String(tag || '').trim()
      if (!normalizedTag) return false

      return this.applyColorToActivePaletteTargets(normalizedTag, {
        deferCommit: options?.deferCommit === true,
        historyMeta: this._normalizeHistoryMeta(
          options?.historyMeta,
          'palette.resetTagOffset',
          { interactionKind: this._paletteRealtimeInteractionKind }
        ),
        _fromFacade: true
      })
    },

    detachTagOffsetToRaw(payload = {}) {
      const ref = String(payload?.ref || '').trim()
      if (!ref) return false

      const resolved = Palette.resolveTagOffsetColor(ref, this.paletteMap)
      if (!resolved?.ok || !resolved.color) return false
      return this.applyColorToActivePaletteTargets(resolved.color, {
        historyMeta: this._normalizeHistoryMeta(null, 'palette.applyColor')
      })
    },

    deletePaletteTag(tag) {
      const result = PaletteActions.deleteTagFromPalette(this, tag, {
        paletteMap: this.paletteMap,
        focusedPart: this.focusedPart,
        stacks: this.stacks,
        findPartByUid: this.findPartByUid.bind(this),
        _updateFocusedPartInPlace: this._updateFocusedPartInPlace.bind(this),
        _scheduleLayerRefresh: this._scheduleLayerRefresh.bind(this),
        RebuildAllStacksLayerEntriesFromParts: this.RebuildAllStacksLayerEntriesFromParts.bind(this),
        _scheduleRefresh: this._scheduleRefresh.bind(this),
        pushHistorySnapshot: this.pushHistorySnapshot.bind(this)
      })

      if (result.stacks) this.stacks = result.stacks
      if (result.paletteMap) this.paletteMap = result.paletteMap
      this._paletteVersion++

      if (result._scheduleLayerRefresh) {
        this._scheduleLayerRefresh()
        this.RebuildAllStacksLayerEntriesFromParts()
        this._scheduleRefresh()
        this.pushHistorySnapshot(this._normalizeHistoryMeta(null, 'palette.deleteTag'))
      }
      return result._scheduleLayerRefresh
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
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'palette.updateTag',
          payload: { tag, newValue }
        })
      }

      const deferCommit = options?.deferCommit === true || this._paletteRealtimeMode === true

      const result = PaletteActions.updatePaletteTag(this, tag, newValue, {
        paletteMap: this.paletteMap,
        stacks: this.stacks,
        focusedPart: this.focusedPart,
        findPartByUid: this.findPartByUid.bind(this),
        _buildLayerEntriesWithCache: this._buildLayerEntriesWithCache.bind(this),
        _scheduleLayerRefresh: this._scheduleLayerRefresh.bind(this),
        _schedulePartUpdate: (() => {}),
        triggerFocusedPartUpdate: this.triggerFocusedPartUpdate.bind(this),
        pushHistorySnapshotThrottled: (() => {})
      })

      this.paletteMap = result.paletteMap
      if (result._scheduleLayerRefresh) {
        this._scheduleLayerRefresh()
        const historyMeta = this._normalizeHistoryMeta(
          options?.historyMeta,
          'palette.updateTag',
          { interactionKind: this._paletteRealtimeInteractionKind }
        )
        this._finalizePaletteMutation(true, {
          deferCommit,
          throttleHistory: deferCommit,
          historyMeta
        })
      }
      return true
    },

    // -------------------------
    // Saved colors management
    // -------------------------
    addSavedColor(value) {
      const result = PaletteActions.addSavedColor(this, value)
      this.savedColors = result.savedColors
      this._paletteVersion = result._paletteVersion
      this.pushHistorySnapshot(this._normalizeHistoryMeta(null, 'palette.savedColor.add'))
      return true
    },

    updateSavedColor(idx, newValue) {
      if (typeof idx !== 'number' || idx < 0 || idx >= (this.savedColors || []).length) return false
      const result = PaletteActions.updateSavedColor(this, idx, newValue)
      this.savedColors = result.savedColors
      this._paletteVersion = result._paletteVersion
      this.pushHistorySnapshot(this._normalizeHistoryMeta(null, 'palette.savedColor.update'))
      return true
    },

    deleteSavedColor(idx) {
      if (typeof idx !== 'number' || idx < 0 || idx >= (this.savedColors || []).length) return false
      const result = PaletteActions.deleteSavedColor(this, idx)
      this.savedColors = result.savedColors
      this._paletteVersion = result._paletteVersion
      this.pushHistorySnapshot(this._normalizeHistoryMeta(null, 'palette.savedColor.delete'))
      return true
    },

    clearSavedColors() {
      if (!this.savedColors || this.savedColors.length === 0) return false
      this.savedColors = []
      this._paletteVersion++
      this.pushHistorySnapshot(this._normalizeHistoryMeta(null, 'palette.savedColor.clear'))
      return true
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
      if (!part) {
        const stackIndex = Number(this.focusedPartIndex?.stackIndex)
        const partIndex = Number(this.focusedPartIndex?.partIndex)
        if (!Number.isFinite(stackIndex) || !Number.isFinite(partIndex)) return null

        const stack = this.stacks[stackIndex]
        const partRef = stack && Array.isArray(stack.data) ? stack.data[partIndex] : null
        if (!partRef) return null

        return { partRef, stackIndex, partIndex }
      }

      const uid = part._uid || this.ensurePartUid(part)
      if (uid) {
        const found = this.findPartByUid(uid)
        if (found?.partRef) {
          return {
            partRef: found.partRef,
            stackIndex: found.stackIndex,
            partIndex: found.partIndex
          }
        }
      }

      for (let stackIndex = 0; stackIndex < this.stacks.length; stackIndex++) {
        const stack = this.stacks[stackIndex]
        if (!stack || !Array.isArray(stack.data)) continue
        for (let partIndex = 0; partIndex < stack.data.length; partIndex++) {
          if (stack.data[partIndex] === part) {
            return { partRef: part, stackIndex, partIndex }
          }
        }
      }

      return null
    },

    _applyPartLayerDeltasInternal(part, deltas = []) {
      if (!Array.isArray(deltas) || deltas.length === 0) return null

      const location = this._resolvePartLocation(part)
      if (!location?.partRef) return null

      const sourcePart = location.partRef
      const asset = this.resolveAssetForPart(sourcePart)
      let rebuilt = null

      try {
        const patchResult = applyLayerDeltasToPart(sourcePart, deltas, { asset })
        if (patchResult?.changed && patchResult?.part) {
          rebuilt = patchResult.part
        }
      } catch (e) {
        console.warn('[studioStore] Part patch applier failed, using legacy layer translator fallback', e)
      }

      if (!rebuilt) {
        const sourceEntries = this.getLayerEntriesForPart(sourcePart, { forceRebuild: false, clone: true })
        if (!Array.isArray(sourceEntries) || sourceEntries.length === 0) return null

        const nextEntries = fastClone(sourceEntries)
        const changed = this._applyLayerDeltasToEntries(nextEntries, deltas)
        if (!changed) return null

        rebuilt = LayerTranslator.reconstructPartFromLayerEntries(nextEntries, sourcePart, { originalAsset: asset })
      }

      if (!rebuilt) return null

      const uid = sourcePart._uid || this.ensurePartUid(sourcePart)
      try { rebuilt._uid = uid } catch (e) { console.warn(e) }

      const rebuiltClone = fastClone(rebuilt)
      rebuiltClone.layerEntries = this.getLayerEntriesForPart(rebuiltClone, { forceRebuild: true, clone: true })

      const stack = this.stacks[location.stackIndex]
      if (!stack || !Array.isArray(stack.data)) return null

      const nextStack = { ...stack, data: stack.data.slice() }
      nextStack.data[location.partIndex] = rebuiltClone

      const nextStacks = this.stacks.slice()
      nextStacks[location.stackIndex] = nextStack
      this.stacks = nextStacks

      return { location, updatedPart: rebuiltClone }
    },

    applyPartLayerDeltas(part, deltas = [], options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'part.applyLayerDeltas',
          payload: { part, deltas },
          meta: { deferCommit: options?.deferCommit === true }
        })
      }

      const result = this._applyPartLayerDeltasInternal(part, deltas)
      if (!result) return false

      const isFocusedTarget =
        this.focusedPartIndex?.stackIndex === result.location.stackIndex &&
        this.focusedPartIndex?.partIndex === result.location.partIndex

      if (isFocusedTarget) {
        this.triggerFocusedPartUpdate()
      }

      const normalizedHistoryMeta = this._normalizeHistoryMeta(
        options?.historyMeta,
        'part.applyLayerDeltas',
        {
          interactionKind: this._editorRealtimeInteractionKind,
          changedParts: 1,
          deltaCount: Array.isArray(deltas) ? deltas.length : 0
        }
      )

      const historyMode = options?.deferCommit === true ? 'throttled' : 'immediate'

      this._finalizeMutation({
        changed: true,
        deferCommit: options?.deferCommit === true,
        scope: 'editor',
        historyMode,
        historyMeta: normalizedHistoryMeta,
        schedulePart: false,
        touchFocusedPart: false
      })

      if (isFocusedTarget) {
        this.translateFocusedPartToLayers()
        return this.focusedPart
      }

      return result.updatedPart
    },

    batchApplyPartLayerDeltas(updates = [], options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'layer.batchApplyLayerDeltas',
          payload: { updates },
          meta: { deferCommit: options?.deferCommit === true }
        })
      }

      if (!Array.isArray(updates) || updates.length === 0) {
        return {
          success: false,
          updatedCount: 0,
          changedParts: 0,
          reason: 'No updates provided'
        }
      }

      let changedCount = 0
      let totalDeltaCount = 0
      for (const update of updates) {
        const result = this._applyPartLayerDeltasInternal(update?.part, update?.deltas)
        if (result) {
          const isFocusedTarget =
            this.focusedPartIndex?.stackIndex === result.location.stackIndex &&
            this.focusedPartIndex?.partIndex === result.location.partIndex
          if (isFocusedTarget) {
            this.triggerFocusedPartUpdate()
          }
          changedCount += 1
          totalDeltaCount += Array.isArray(update?.deltas) ? update.deltas.length : 0
        }
      }

      const normalizedHistoryMeta = this._normalizeHistoryMeta(
        options?.historyMeta,
        'layer.batchApplyLayerDeltas',
        {
          interactionKind: this._editorRealtimeInteractionKind,
          changedParts: changedCount,
          deltaCount: totalDeltaCount
        }
      )

      const historyMode = options?.deferCommit === true ? 'throttled' : 'immediate'

      this._finalizeMutation({
        changed: changedCount > 0,
        deferCommit: options?.deferCommit === true,
        scope: 'editor',
        historyMode,
        historyMeta: normalizedHistoryMeta,
        schedulePart: false,
        touchFocusedPart: false
      })

      if (changedCount > 0) {
        this.translateFocusedPartToLayers()
      }

      return {
        success: changedCount > 0,
        updatedCount: changedCount,
        changedParts: changedCount,
        reason: changedCount > 0 ? null : 'No part was updated'
      }
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

      const fp = this.focusedPart
      if (!entries || !fp) return null

      const previousEntries = this.getLayerEntriesForPart(fp, { forceRebuild: false, clone: true })
      const deltas = this._deriveLayerDeltas(previousEntries, entries)
      if (Array.isArray(deltas)) {
        if (deltas.length === 0) return this.focusedPart
        const updated = this.applyPartLayerDeltas(fp, deltas, {
          deferCommit: options?.deferCommit === true,
          historyMeta: options?.historyMeta,
          _fromFacade: true
        })
        if (updated) return this.focusedPart
      }

      try {
        const newPartClone = this.UpdateSpecificPartFromLayerEntries(fp, entries)
        if (!newPartClone) return null

        const uid = fp._uid || this.ensurePartUid(fp)

        const origJson = JSON.stringify(fp)

        // Use more efficient update
        const newStacks = this.stacks.map(el => {
          const copy = fastClone(el)
          if (Array.isArray(copy.data)) {
            copy.data = copy.data.map(p => {
              try {
                if (p && p._uid && p._uid === uid) return fastClone(newPartClone)
                if (JSON.stringify(p) === origJson) return fastClone(newPartClone)
              } catch (e) { /* ignore */ }
              return p
            })
          }
          return copy
        })

        this.stacks = newStacks
        this._updateFocusedPartInPlace(newPartClone)

        const normalizedHistoryMeta = this._normalizeHistoryMeta(
          options?.historyMeta,
          'part.applyLayerDeltas',
          {
            interactionKind: this._editorRealtimeInteractionKind,
            changedParts: 1,
            deltaCount: Array.isArray(entries) ? entries.length : 0
          }
        )

        const historyMode = options?.deferCommit === true ? 'throttled' : 'immediate'

        this._finalizeMutation({
          changed: true,
          deferCommit: options?.deferCommit === true,
          scope: 'editor',
          historyMode,
          historyMeta: normalizedHistoryMeta,
          schedulePart: false,
          touchFocusedPart: false
        })
        this.translateFocusedPartToLayers()
        return this.focusedPart
      } catch (e) {
        console.error('[studioStore] updatePartFromLayerEntries failed', e)
        return null
      }
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

      if (!part || !entries) return

      const previousEntries = this.getLayerEntriesForPart(part, { forceRebuild: false, clone: true })
      const deltas = this._deriveLayerDeltas(previousEntries, entries)
      if (Array.isArray(deltas)) {
        if (deltas.length === 0) return false
        return this.applyPartLayerDeltas(part, deltas, {
          deferCommit: options?.deferRefresh === true,
          historyMeta: options?.historyMeta,
          _fromFacade: true
        })
      }

      // 1. Calculate new part data
      const newPart = this.UpdateSpecificPartFromLayerEntries(part, entries)
      if (!newPart) return

      // 2. Find and replace in the selected stack
      const sidx = this.selectedIndex
      if (sidx < 0 || sidx >= this.stacks.length) return

      const stack = this.stacks[sidx]
      if (!stack || !Array.isArray(stack.data)) return

      const uid = part._uid || this.ensurePartUid(part)
      let foundIndex = -1

      const newStackData = stack.data.map((p, idx) => {
        if (p === part || (uid && p._uid === uid)) {
          foundIndex = idx
          return newPart
        }
        return p
      })

      if (foundIndex === -1) {
        // Not found?
        return
      }

      // 3. Update Stack
      const newStack = { ...stack, data: newStackData }
      const newStacks = [...this.stacks]
      newStacks[sidx] = newStack
      this.stacks = newStacks

      // 4. Update focused part if it matches
      if (this.focusedPartIndex.stackIndex === sidx && this.focusedPartIndex.partIndex === foundIndex) {
        this.triggerFocusedPartUpdate()
      }

      const normalizedHistoryMeta = this._normalizeHistoryMeta(
        options?.historyMeta,
        'part.applyLayerDeltas',
        {
          interactionKind: this._editorRealtimeInteractionKind,
          changedParts: 1,
          deltaCount: Array.isArray(entries) ? entries.length : 0
        }
      )

      const historyMode = options?.deferRefresh === true ? 'throttled' : 'immediate'

      return this._finalizeMutation({
        changed: true,
        deferCommit: options?.deferRefresh === true,
        scope: 'editor',
        historyMode,
        historyMeta: normalizedHistoryMeta,
        schedulePart: false,
        touchFocusedPart: false
      })
    },

    UpdateSpecificPartFromLayerEntries(part, entries = []) {
      if (!entries && !part.layerEntries) {
        return null
      }
      if (!part) {
        return null
      }
      try {
        const asset = this.resolveAssetForPart(part)
        const previousEntries = this.getLayerEntriesForPart(part, { forceRebuild: false, clone: true })
        const deltas = this._deriveLayerDeltas(previousEntries, entries)

        if (Array.isArray(deltas) && deltas.length > 0) {
          const patchResult = applyLayerDeltasToPart(part, deltas, { asset })
          if (patchResult?.changed && patchResult?.part) {
            const patchedPart = patchResult.part
            const uid = part._uid || this.ensurePartUid(part)
            patchedPart.layerEntries = fastClone(entries)
            try { patchedPart._uid = uid } catch (e) { console.warn(e) }
            return patchedPart
          }
        }

        const newPart = LayerTranslator.reconstructPartFromLayerEntries(entries, part, { originalAsset: asset })
        if (!newPart) return null
        const uid = part._uid || this.ensurePartUid(part)
        newPart.layerEntries = fastClone(entries)
        try { newPart._uid = uid } catch (e) { console.warn(e) }
        return newPart
      } catch (e) {
        console.error('[studioStore] UpdateSpecificPartFromLayerEntries failed', e)
        return null
      }
    },

    /**
     * Schedule part update from layer entries (batched)
     */
    _schedulePartUpdate() {
      if (this._pendingPartUpdate) return
      this._pendingPartUpdate = true

      this._refreshScheduler.scheduleRefresh(() => {
        this._pendingPartUpdate = false
        this._doUpdateAllStacksPartFromLayerEntries()
      })
    },

    UpdateAllStacksPartFromLayerEntries() {
      this._pendingPartUpdate = false
      this._doUpdateAllStacksPartFromLayerEntries()
    },

    _doUpdateAllStacksPartFromLayerEntries() {
      try {
        const newStacks = this.stacks.map(el => {
          const copy = fastClone(el)
          if (Array.isArray(copy.data)) {
            copy.data = copy.data.map(p => {
              try {
                if (p && Array.isArray(p.layerEntries)) {
                  const updatedPart = this.UpdateSpecificPartFromLayerEntries(p, p.layerEntries)
                  if (updatedPart) return updatedPart
                }
              } catch (e) { /* ignore */ }
              return p
            })
          }
          return copy
        })

        this.stacks = newStacks
        this._scheduleRefresh()
      } catch (e) {
        console.error('[studioStore] UpdateAllStacksPartFromLayerEntries failed', e)
      }

      const fp = this.focusedPart
      if (fp && Array.isArray(fp.layerEntries)) {
        try {
          const updatedFocusedPart = this.UpdateSpecificPartFromLayerEntries(fp, fp.layerEntries)
          if (updatedFocusedPart) {
            this._updateFocusedPartInPlace(updatedFocusedPart)
          }
        }
        catch (e) {
          console.error('[studioStore] UpdateAllStacksPartFromLayerEntries failed for focusedPart', e)
        }
      }
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
      const idx = this.focusedPartIndex
      if (idx.stackIndex === null || idx.partIndex === null) return false
      if (idx.stackIndex < 0 || idx.stackIndex >= this.stacks.length) return false

      const stack = this.stacks[idx.stackIndex]
      if (!stack || !Array.isArray(stack.data)) return false
      if (idx.partIndex < 0 || idx.partIndex >= stack.data.length) return false

      try {
        const copy = fastClone(newPartData)
        stack.data[idx.partIndex] = copy
        this.triggerFocusedPartUpdate()
        return true
      } catch (e) {
        console.warn('[studioStore] _updateFocusedPartInPlace failed', e)
        return false
      }
    },

    _updateFocusedPartProperty(propName, value) {
      const idx = this.focusedPartIndex
      if (idx.stackIndex === null || idx.partIndex === null) return false
      if (idx.stackIndex < 0 || idx.partIndex < 0) return false
      if (idx.stackIndex >= this.stacks.length) return false

      const stack = this.stacks[idx.stackIndex]
      if (!stack || !Array.isArray(stack.data)) return false
      if (idx.partIndex < 0 || idx.partIndex >= stack.data.length) return false

      try {
        stack.data[idx.partIndex][propName] = value
        this.triggerFocusedPartUpdate()
        return true
      } catch (e) {
        console.warn('[studioStore] _updateFocusedPartProperty failed', e)
        return false
      }
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
      if (this._pendingLayerRefresh) return
      this._pendingLayerRefresh = true

      this._refreshScheduler.scheduleRefresh(() => {
        this._pendingLayerRefresh = false
        this._doRefreshAllLayerEntriesFromPalette()
      })
    },

    /**
     * Refresh color fields for all colorable layer entries (OPTIMIZED)
     */
    _refreshAllLayerEntriesFromPalette() {
      this._pendingLayerRefresh = false
      this._doRefreshAllLayerEntriesFromPalette()
    },

    _doRefreshAllLayerEntriesFromPalette() {
      try {
        // Instead of deep cloning entire stacks, update in-place where possible
        for (const stack of this.stacks) {
          if (!stack || !Array.isArray(stack.data)) continue
          for (const part of stack.data) {
            if (!part) continue
            if (!Array.isArray(part.layerEntries)) {
              part.layerEntries = this._buildLayerEntriesWithCache(part) || []
            } else {
              // Just update colorCss in-place
              this._updateLayerEntriesColorCss(part.layerEntries)
            }
          }
        }

        // Update focused part's layer entries
        const fp = this.focusedPart
        if (fp && Array.isArray(fp.layerEntries)) {
          this._updateLayerEntriesColorCss(fp.layerEntries)
        }
      } catch (e) {
        // swallow errors
      }
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

      const result = AssetActions.applyAssetToSelectedStack(this, asset, replaceTarget, {
        ensurePartUid: this.ensurePartUid.bind(this),
        _buildLayerEntriesWithCache: this._buildLayerEntriesWithCache.bind(this),
        fastClone: fastClone,
        resolveCraftForAssetSlot: ({ assetName, groupName }) => resolveCraftForAssetSlot({
          assetName,
          groupName,
          player: hostWindow?.Player,
          assetGet: typeof hostWindow?.AssetGet === 'function' ? hostWindow.AssetGet.bind(hostWindow) : null,
          cloneFn: fastClone
        })
      })

      if (result.stacks) {
        this.stacks = result.stacks
        this.focusedPartIndex = result.focusedPartIndex
        this._syncFocusStateScopeFromFocusedPart()
        try { this.translateFocusedPartToLayers && this.translateFocusedPartToLayers() } catch (e) { }
        this._finalizeMutation({
          changed: true,
          scope: 'asset',
          historyMode: 'immediate',
          historyMeta: this._normalizeHistoryMeta(options?.historyMeta, 'asset.apply')
        })
        this.onReplaceApplied()
        return this.focusedPart || null
      }
      return null
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
      try {
        if (this.previewRenderer && typeof this.previewRenderer.destroy === 'function') {
          this.previewRenderer.destroy();
        }
      } catch (e) {
        console.warn('[studioStore] Preview renderer cleanup error:', e);
      }

      try {
        if (this.renderer) {
          this.stacks.forEach(it => {
            this.renderer.removeCanvas({ data: it.data, type: 'outfit' })
          });
        }
      } catch (e) {
        console.warn('[studioStore] Renderer cleanup error:', e);
      }
    },

    /**
     * Toggle between optimized and legacy renderer
     */
    toggleRendererMode(useOptimized = true) {
      const result = PreviewActions.toggleRendererMode(useOptimized)
      this.useOptimizedRenderer = result.useOptimizedRenderer
      // Force refresh with new renderer
      this.refreshMergedAppearanceData()
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
  ensureSelectionProxyBindings(store)
  ensurePaletteProxyBindings(store)
  return store
}

export default useStudioStore
