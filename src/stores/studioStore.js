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

import { setTimeoutHost, clearTimeoutHost } from '@/utils/host-window.js'

// Clone utilities
import { fastClone, shallowClone } from '@/utils/clone.js'

// Action modules
import * as StackActions from '@/studio/stack-actions.js'
import * as PaletteActions from '@/studio/palette-actions.js'
import * as FocusActions from '@/studio/focus-actions.js'
import * as RenderingActions from '@/studio/rendering-actions.js'
import * as UndoActions from '@/studio/undo-redo-actions.js'
import * as LayerActions from '@/studio/layer-actions.js'
import * as SelectionActions from '@/studio/selection-actions.js'
import * as PreviewActions from '@/studio/preview-actions.js'
import * as PriorityActions from '@/studio/priority-actions.js'
import * as AssetActions from '@/studio/asset-actions.js'
import * as StorageActions from '@/studio/storage-actions.js'
import * as SaveActions from '@/studio/save-actions.js'
import { getStudioFacade } from '@/studio/StudioFacade'
import { createStudioRenderPipeline } from '@/studio/StudioRenderPipeline'
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

// PriorityService (refactored)
import PriorityService from '@/services/PriorityService'

// Undo/Redo Manager
import UndoRedoManager from '@/utils/undo_redo'

// Studio Storage Service
import { StudioStorageService } from '@/services/StudioStorageService'

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

export const useStudioStore = defineStore('studio', {
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

    // palette: tag -> color
    paletteMap: {},

    // saved colors: simple array of color values (strings or basic values)
    savedColors: [],

    // internal counter for generating human-readable tags
    _paletteNextCounter: 1,

    // last translated layer entries
    translatedLayerEntries: [],

    // replaceTarget: used to indicate "replace mode" (mutually exclusive with simple focus)
    replaceTarget: { active: false, key: null, item: null, isEmpty: false },

    // internal per-part uid counter and mapping
    _partUidCounter: 1,

    // Palette editing mode
    paletteModeActive: false,

    // NEW: central palette panel visibility (UI-level)
    palettePanelVisible: false,

    focusedPartUpdateFlag: 0,

    paletteWorkMode: 'external',

    paletteUpdateFlag: 0,

    // Palette realtime update session (used for drag interactions)
    _paletteRealtimeMode: false,
    _paletteRealtimeDirty: false,

    // Editor realtime update session (used for preview-move, layer-edit, batch-edit, priority-drag)
    _editorRealtimeMode: false,
    _editorRealtimeDirty: false,

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
      lastWasDeferred: false,
      lastMutationAt: 0
    },


    // Performance: palette map version for cache invalidation
    _paletteVersion: 0,

    // Multi-selection state
    selectedLayers: [],  // Array of selected layer info
    // Structure: [{ stackIndex, partIndex, layerIndex, _key }, ...]
    selectionMode: 'single', // 'single' | 'multiple'
    batchEditBuffer: {
      opacity: null,
      offsetX: null,
      offsetY: null,
      color: null,
      priority: null
    },

    // NEW: Active focus context (meta information for selected layers)
    activeFocusContext: {
      property: null,      // 'color' | 'opacity' | 'drawing' | 'priority' | null
      subLayerIndex: null, // For sublayers
      timestamp: 0         // Last focus timestamp
    },

    // Preview tool state
    previewTool: 'view', // 'view' | 'move'

    // Single source of truth for focus (Phase 0/1)
    focusState: {
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
    },

    // Undo/Redo Manager
    _undoRedoManager: null,

    // History panel visibility
    historyPanelVisible: false,
    // Studio V2 UI state
    workspaceMode: 'pro', // fixed to 'pro'
    // Deprecated: legacy stage state machine is no longer used for UI gating.
    // Keep this field only for backward compatibility with older callers.
    taskStage: 'assemble', // legacy: 'assemble' | 'replace' | 'polish' | 'commit'
    activeContextPanel: 'inspector', // 'inspector' | 'asset' | 'palette'
    panelStates: {
      inspector: 'pinned',
      asset: 'hidden',
      palette: 'hidden',
      layer: 'hidden',
      history: 'hidden',
      saves: 'hidden'
    }, // 'pinned' | 'peek' | 'hidden'
    pinnedPanel: null,
    mobileTab: 'structure', // 'structure' | 'replace' | 'property' | 'history'
    firstRunGuideDone: false,
    // Auto-save state
    autoSaveEnabled: true,
    lastSaveTime: null,
    saveStatus: 'idle', // 'idle' | 'saving' | 'saved' | 'error'
    _saveStatusTimeout: null, // Track timeout for status indicator
    currentSaveId: null, // ID of currently loaded save

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
      const selected = SelectionActions.getSelectedLayersData(state)
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
    focusedLayersData(state) {
      return SelectionActions.getSelectedLayersData(state)
    },

    // Check if move tool can be used (requires focused part)
    canUseMoveTool(state) {
      return PreviewActions.canUseMoveTool(state)
    }
  },

  actions: {
    // Action modules imported from separate files
    StackActions,
    PaletteActions,
    FocusActions,
    RenderingActions,
    UndoActions,
    LayerActions,
    SelectionActions,
    PreviewActions,
    PriorityActions,
    AssetActions,
    StorageActions,
    SaveActions,

    // -------------------------
    // Layer manager toggle
    // -------------------------

    toggleLayerManager(val) {
      const result = FocusActions.toggleLayerManagerState(this, val)
      this.layerManagerActive = result.layerManagerActive
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
      this.clearPropertyFocus()
      this.onReplaceEnter({ key, isEmpty })
    },

    clearReplaceTarget() {
      const result = FocusActions.clearReplaceTargetState()
      this.replaceTarget = result.replaceTarget
      // Deprecated flow: clearing replace target no longer mutates taskStage.
      if (this.activeContextPanel === 'asset' && this.pinnedPanel !== 'asset') {
        this.openContextPanel('inspector', 'replace-cleared')
      }
    },

    setWorkspaceMode() {
      this.workspaceMode = 'pro'
      this.persistUiLayout()
    },

    setTaskStage(stage = 'assemble') {
      // Deprecated no-op: keep API shape for old call sites but disable stage-driven UI branching.
      // Preserve a stable value to avoid leaking stale persisted states.
      this.taskStage = 'assemble'
      this.persistUiLayout()
    },

    openContextPanel(panel, reason = 'manual') {
      if (!['inspector', 'asset', 'palette'].includes(panel)) return

      if (this.pinnedPanel && this.pinnedPanel !== panel) {
        const pinned = this.pinnedPanel
        if (['inspector', 'asset', 'palette'].includes(pinned)) {
          this.activeContextPanel = pinned
          return
        }
      }

      this.activeContextPanel = panel

      if (panel === 'asset') {
        this.panelStates.asset = 'pinned'
        if (this.panelStates.inspector !== 'pinned') this.panelStates.inspector = 'hidden'
      }
      if (panel === 'inspector') {
        this.panelStates.inspector = 'pinned'
        if (this.panelStates.asset !== 'pinned') this.panelStates.asset = 'hidden'
      }
      if (panel === 'palette') {
        if (this.panelStates.palette === 'hidden') this.panelStates.palette = 'peek'
      }

      if (panel === 'palette') {
        this.palettePanelVisible = true
      } else if (this.panelStates.palette !== 'pinned') {
        this.palettePanelVisible = false
      }

      // Deprecated flow: part selection should not mutate legacy taskStage.

      this.persistUiLayout()
    },

    pinPanel(panel) {
      if (!panel || !(panel in this.panelStates)) return
      this.panelStates[panel] = 'pinned'
      this.pinnedPanel = panel

      if (panel === 'palette') {
        this.palettePanelVisible = true
        this.activeContextPanel = 'palette'
      }
      if (panel === 'asset') this.activeContextPanel = 'asset'
      if (panel === 'inspector') this.activeContextPanel = 'inspector'
      if (panel === 'history') this.historyPanelVisible = true
      if (panel === 'layer') this.layerManagerActive = true

      this.persistUiLayout()
    },

    unpinPanel(panel) {
      if (!panel || !(panel in this.panelStates)) return
      if (this.pinnedPanel === panel) this.pinnedPanel = null
      this.panelStates[panel] = 'hidden'

      if (panel === 'palette') this.palettePanelVisible = false
      if (panel === 'history') this.historyPanelVisible = false
      if (panel === 'layer') this.layerManagerActive = false

      this.persistUiLayout()
    },

    setPanelState(panel, state) {
      if (!panel || !(panel in this.panelStates)) return
      if (!['pinned', 'peek', 'hidden'].includes(state)) return

      this.panelStates[panel] = state

      if (state === 'pinned') {
        this.pinnedPanel = panel
      } else if (this.pinnedPanel === panel) {
        this.pinnedPanel = null
      }

      if (panel === 'palette') {
        this.palettePanelVisible = state !== 'hidden'
      }
      if (panel === 'history') {
        this.historyPanelVisible = state !== 'hidden'
      }
      if (panel === 'layer') {
        this.layerManagerActive = state !== 'hidden'
      }

      this.persistUiLayout()
    },

    onReplaceEnter(payload = {}) {
      this.setTaskStage('replace')
      this.openContextPanel('asset', payload?.isEmpty ? 'replace-enter-empty' : 'replace-enter-part')
      if (this.mobileTab !== 'replace') {
        this.mobileTab = 'replace'
      }
    },

    onReplaceApplied() {
      this.setTaskStage('polish')
      if (this.pinnedPanel !== 'asset') {
        this.openContextPanel('inspector', 'replace-applied')
      }
      if (this.mobileTab === 'replace') {
        this.mobileTab = 'property'
      }
    },

    enterPeekPanel(panel) {
      if (!panel || !(panel in this.panelStates)) return
      if (this.panelStates[panel] === 'pinned') return
      this.panelStates[panel] = 'peek'
      if (panel === 'palette') this.palettePanelVisible = true
      this.persistUiLayout()
    },

    exitPeekPanel(panel) {
      if (!panel || !(panel in this.panelStates)) return
      if (this.panelStates[panel] === 'pinned') return
      this.panelStates[panel] = 'hidden'
      if (panel === 'palette') this.palettePanelVisible = false
      this.persistUiLayout()
    },

    hydrateUiLayout() {
      try {
        this.workspaceMode = 'pro'

        const statesRaw = localStorage.getItem('studio.ui.panelStates')
        if (statesRaw) {
          const parsed = JSON.parse(statesRaw)
          if (parsed && typeof parsed === 'object') {
            this.panelStates = {
              ...this.panelStates,
              ...parsed
            }
          }
        }

        const pinned = localStorage.getItem('studio.ui.pinnedPanel')
        this.pinnedPanel = pinned || null

        // Deprecated: ignore persisted legacy task stage.
        this.taskStage = 'assemble'

        if (this.panelStates.palette !== 'hidden') this.palettePanelVisible = true
        if (this.panelStates.history !== 'hidden') this.historyPanelVisible = true
        if (this.panelStates.layer !== 'hidden') this.layerManagerActive = true

        if (['inspector', 'asset', 'palette'].includes(this.pinnedPanel)) {
          this.activeContextPanel = this.pinnedPanel
        }
      } catch (e) {
        // ignore malformed persisted ui state
      }
    },

    persistUiLayout() {
      try {
        localStorage.setItem('studio.ui.workspaceMode', this.workspaceMode)
        localStorage.setItem('studio.ui.panelStates', JSON.stringify(this.panelStates))
        localStorage.setItem('studio.ui.pinnedPanel', this.pinnedPanel || '')
        // Deprecated: no longer persist taskStage.
      } catch (e) {
        // ignore storage write failures
      }
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
      const sourceStacks = Array.isArray(stacks) ? stacks : []
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
        this.pushHistorySnapshot()
      }
    },

    removeElement(idx) {
      const result = StackActions.removeElementFromStacks(this, idx, {
        renderer: this.renderer,
        stacks: this.stacks,
        selectedIndex: this.selectedIndex,
        focusedPartIndex: this.focusedPartIndex,
        pushHistorySnapshot: this.pushHistorySnapshot.bind(this)
      })

      this.stacks = result.stacks
      this.selectedIndex = result.selectedIndex
      this.focusedPartIndex = result.focusedPartIndex
      this._scheduleRefresh()
    },

    moveElement(fromIdx, toIdx) {
      const result = StackActions.moveElementInStacks(this, fromIdx, toIdx, {
        stacks: this.stacks,
        selectedIndex: this.selectedIndex,
        focusedPartIndex: this.focusedPartIndex,
        _scheduleRefresh: this._scheduleRefresh.bind(this)
      })

      this.stacks = result.stacks
      this.selectedIndex = result.selectedIndex
      this.focusedPartIndex = result.focusedPartIndex
      this._scheduleRefresh()
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
      }
      if (result.clearPropertyFocus) {
        this.clearPropertyFocus()
      }
    },

    clear() {
      const result = StackActions.clearAllStacks(this, {
        renderer: this.renderer,
        focusedPartIndex: this.focusedPartIndex
      })

      this.stacks = result.stacks
      this.selectedIndex = result.selectedIndex
      this.mergedAppearanceData = result.mergedAppearanceData
      this.focusedPartIndex = result.focusedPartIndex
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
        this.setPaletteMode(true, targets)
        this.palettePanelVisible = true
        this.paletteWorkMode = 'external'
        if (this.panelStates.palette !== 'pinned') {
          this.panelStates.palette = 'peek'
        }
        this.activeContextPanel = 'palette'
      } catch (e) {
        this.palettePanelVisible = true
      }
      this.persistUiLayout()
    },

    setPaletteWorkMode(mode = 'external') {
      this.paletteWorkMode = mode
    },

    closePalettePanel() {
      try {
        this.palettePanelVisible = false
        if (this.panelStates.palette !== 'pinned') {
          this.panelStates.palette = 'hidden'
          if (this.activeContextPanel === 'palette') {
            this.activeContextPanel = this.pinnedPanel === 'asset' ? 'asset' : 'inspector'
          }
        }
      } finally {
        try {
          const committed = this.commitInteraction()
          if (!committed) this.endPaletteRealtimeUpdate({ commit: true })
        } catch (e) { console.warn(e) }
        try { this.clearPaletteMode() } catch (e) { console.warn(e) }
      }
      this.persistUiLayout()
    },

    beginPaletteRealtimeUpdate() {
      this._paletteRealtimeMode = true
    },

    _finalizeMutation({
      changed = false,
      deferCommit = false,
      scope = 'generic',
      historyMode = 'throttled',
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
          schedulePart: true,
          scheduleRefresh: true,
          refreshMerged: false,
          touchFocusedPart: false,
          deferDirty: 'palette'
        },
        editor: {
          scheduleLayer: false,
          schedulePart: true,
          scheduleRefresh: true,
          refreshMerged: false,
          touchFocusedPart: false,
          deferDirty: 'editor'
        },
        batch: {
          scheduleLayer: true,
          schedulePart: true,
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
          lastWasDeferred: false,
          lastMutationAt: 0
        }
      }

      const stats = this._mutationStats
      stats.totalCalls += 1
      stats.scopeCalls[scope] = (stats.scopeCalls[scope] || 0) + 1
      stats.lastScope = scope
      stats.lastHistoryMode = historyMode
      stats.lastWasDeferred = deferCommit === true
      stats.lastMutationAt = Date.now()

      if (deferCommit) {
        stats.deferredCalls += 1

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
        this.pushHistorySnapshot()
      } else if (historyMode === 'throttled') {
        stats.historyThrottledCalls += 1
        this.pushHistorySnapshotThrottled()
      } else {
        stats.historyNoneCalls += 1
      }

      return true
    },

    _finalizePaletteMutation(changed, { deferCommit = false, throttleHistory = true } = {}) {
      return this._finalizeMutation({
        changed,
        deferCommit,
        scope: 'palette',
        historyMode: throttleHistory ? 'throttled' : 'immediate'
      })
    },

    _finalizeEditorMutation(changed, { deferCommit = false, throttleHistory = true } = {}) {
      return this._finalizeMutation({
        changed,
        deferCommit,
        scope: 'editor',
        historyMode: throttleHistory ? 'throttled' : 'immediate'
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

    endPaletteRealtimeUpdate({ commit = true } = {}) {
      const shouldCommit = !!commit && this._paletteRealtimeDirty
      this._paletteRealtimeMode = false
      this._paletteRealtimeDirty = false

      if (!shouldCommit) return false

      // Commit deferred heavy work once after interaction settles.
      return this._finalizePaletteMutation(true, { deferCommit: false, throttleHistory: false })
    },

    beginEditorRealtimeUpdate() {
      this._editorRealtimeMode = true
    },

    endEditorRealtimeUpdate({ commit = true } = {}) {
      const shouldCommit = !!commit && this._editorRealtimeDirty
      this._editorRealtimeMode = false
      this._editorRealtimeDirty = false

      if (!shouldCommit) return false

      // Commit deferred heavy work once after interaction settles.
      return this._finalizeEditorMutation(true, { deferCommit: false, throttleHistory: true })
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
      return this._finalizeMutation({
        changed: true,
        scope: 'stack',
        historyMode: 'immediate'
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

      if (options?.rebuildLayers !== false) {
        this.RebuildAllStacksLayerEntriesFromParts()
      } else if (options?.refresh !== false) {
        this._scheduleRefresh()
      }

      return true
    },

    batchUpdatePartLayerEntries(updates = [], options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'layer.batchUpdatePartEntries',
          payload: { updates },
          meta: { deferCommit: options?.deferCommit === true }
        })
      }

      if (!Array.isArray(updates) || updates.length === 0) return false

      let changedCount = 0
      for (const update of updates) {
        const changed = this.updatePartLayerEntries(update?.part, update?.entries, {
          deferRefresh: true,
          _fromFacade: true
        })
        if (changed) changedCount++
      }

      return this._finalizeMutation({
        changed: changedCount > 0,
        deferCommit: options?.deferCommit === true,
        scope: 'editor',
        historyMode: 'none',
        schedulePart: false
      })
    },

    // -------------------------
    // apply/modify palette targets (OPTIMIZED)
    // -------------------------
    applyColorToActivePaletteTargets(newColor, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'palette.applyColor',
          payload: { newColor },
          meta: { deferCommit: options?.deferCommit === true }
        })
      }

      const deferCommit = options?.deferCommit === true || this._paletteRealtimeMode === true

      const changed = PaletteActions.applyColorToTargets(this, newColor, {
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

      return this._finalizePaletteMutation(changed, { deferCommit })
    },

    applyTagToActivePaletteTargets(tag, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'palette.applyTag',
          payload: { tag }
        })
      }

      const deferCommit = options?.deferCommit === true || this._paletteRealtimeMode === true

      const changed = PaletteActions.applyTagToTargets(this, tag, {
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

      return this._finalizePaletteMutation(changed, { deferCommit })
    },

    applyTagOffsetToActivePaletteTargets(payload = {}, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'palette.applyTagOffset',
          payload,
          meta: { deferCommit: options?.deferCommit === true }
        })
      }

      const deferCommit = options?.deferCommit === true || this._paletteRealtimeMode === true

      const changed = PaletteActions.applyTagOffsetToTargets(this, payload, {
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

      return this._finalizePaletteMutation(changed, { deferCommit })
    },

    resetTagOffsetToTag(tag, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'palette.resetTagOffset',
          payload: { tag },
          meta: { deferCommit: options?.deferCommit === true }
        })
      }

      const deferCommit = options?.deferCommit === true || this._paletteRealtimeMode === true

      const changed = PaletteActions.clearTagOffsetOnTargets(this, { tag }, {
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

      return this._finalizePaletteMutation(changed, { deferCommit })
    },

    detachTagOffsetToRaw(payload = {}) {
      const ref = String(payload?.ref || '').trim()
      if (!ref) return false

      const resolved = Palette.resolveTagOffsetColor(ref, this.paletteMap)
      if (!resolved?.ok || !resolved.color) return false
      return this.applyColorToActivePaletteTargets(resolved.color)
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
        this.pushHistorySnapshot()
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
        this._finalizePaletteMutation(true, { deferCommit })
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
      return true
    },

    updateSavedColor(idx, newValue) {
      if (typeof idx !== 'number' || idx < 0 || idx >= (this.savedColors || []).length) return false
      const result = PaletteActions.updateSavedColor(this, idx, newValue)
      this.savedColors = result.savedColors
      this._paletteVersion = result._paletteVersion
      return true
    },

    deleteSavedColor(idx) {
      if (typeof idx !== 'number' || idx < 0 || idx >= (this.savedColors || []).length) return false
      const result = PaletteActions.deleteSavedColor(this, idx)
      this.savedColors = result.savedColors
      this._paletteVersion = result._paletteVersion
      this.pushHistorySnapshot()
      return true
    },

    clearSavedColors() {
      if (!this.savedColors || this.savedColors.length === 0) return false
      this.savedColors = []
      this._paletteVersion++
      this.pushHistorySnapshot()
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
      const sourceEntries = this.getLayerEntriesForPart(sourcePart, { forceRebuild: false, clone: true })
      if (!Array.isArray(sourceEntries) || sourceEntries.length === 0) return null

      const nextEntries = fastClone(sourceEntries)
      const changed = this._applyLayerDeltasToEntries(nextEntries, deltas)
      if (!changed) return null

      const asset = this.resolveAssetForPart(sourcePart)
      const rebuilt = LayerTranslator.reconstructPartFromLayerEntries(nextEntries, sourcePart, { originalAsset: asset })
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

      this._finalizeMutation({
        changed: true,
        deferCommit: options?.deferCommit === true,
        scope: 'editor',
        historyMode: 'none',
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
        }
      }

      this._finalizeMutation({
        changed: changedCount > 0,
        deferCommit: options?.deferCommit === true,
        scope: 'editor',
        historyMode: 'none',
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
        return this.execute({
          type: 'part.updateLayerEntries',
          payload: { entries },
          meta: { deferCommit: options?.deferCommit === true }
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
          _fromFacade: true
        })
        if (updated) return this.focusedPart
      }

      try {
        const asset = this.resolveAssetForPart(fp)
        const newPart = LayerTranslator.reconstructPartFromLayerEntries(entries, fp, { originalAsset: asset })
        if (!newPart) return null

        const uid = fp._uid || this.ensurePartUid(fp)
        try { newPart._uid = uid } catch (e) { console.warn(e) }

        const newPartClone = fastClone(newPart)
        newPartClone.layerEntries = this._buildLayerEntriesWithCache(newPartClone, true)

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

        this._finalizeMutation({
          changed: true,
          deferCommit: options?.deferCommit === true,
          scope: 'editor',
          historyMode: 'none',
          schedulePart: false
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
        return this.execute({
          type: 'layer.updatePartEntries',
          payload: { part, entries },
          meta: { deferCommit: options?.deferRefresh === true }
        })
      }

      if (!part || !entries) return

      const previousEntries = this.getLayerEntriesForPart(part, { forceRebuild: false, clone: true })
      const deltas = this._deriveLayerDeltas(previousEntries, entries)
      if (Array.isArray(deltas)) {
        if (deltas.length === 0) return false
        return this.applyPartLayerDeltas(part, deltas, {
          deferCommit: options?.deferRefresh === true,
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

      return this._finalizeMutation({
        changed: true,
        deferCommit: options?.deferRefresh === true,
        scope: 'editor',
        historyMode: 'none',
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

    RebuildAllStacksLayerEntriesFromParts() {
      try {
        this.previewRenderer?.invalidateFastPathCaches?.({ clearAppearanceCache: true })
      } catch (e) { console.warn(e) }

      try {
        const newStacks = this.stacks.map(el => {
          const copy = fastClone(el)
          if (Array.isArray(copy.data)) {
            copy.data = copy.data.map(p => {
              try {
                if (p) {
                  p.layerEntries = this._buildLayerEntriesWithCache(p, true) || []
                }
              } catch (e) { /* ignore */ }
              return p
            })
          }
          return copy
        })

        this.stacks = newStacks
        this._scheduleRefresh()
      }
      catch (e) {
        console.error('[studioStore] RebuildAllStacksLayerEntriesFromParts failed', e)
      }

      const fp = this.focusedPart
      if (fp) {
        try {
          const entries = this._buildLayerEntriesWithCache(fp, true) || []
          this._updateFocusedPartProperty('layerEntries', entries)
        } catch (e) { console.warn(e) }
      }
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
        fastClone: fastClone
      })

      if (result.stacks) {
        this.stacks = result.stacks
        this.focusedPartIndex = result.focusedPartIndex
        try { this.translateFocusedPartToLayers && this.translateFocusedPartToLayers() } catch (e) { }
        this._finalizeMutation({
          changed: true,
          scope: 'asset',
          historyMode: 'immediate'
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
      return StorageActions.persistStacksToLocalStorage(this)
    },

    loadStacksFromLocalStorage() {
      const result = StorageActions.loadStacksFromLocalStorage()
      if (result) {
        this.stacks = this._sanitizeStacksForPersistence(result.stacks)
        if (result._partUidCounter) {
          this._partUidCounter = result._partUidCounter
        }
        this.RebuildAllStacksLayerEntriesFromParts()
        this._refreshAllLayerEntriesFromPalette()
        this.refreshMergedAppearanceData()
        return true
      }
      return false
    },

    persistPaletteToLocalStorage() {
      return StorageActions.persistPaletteToLocalStorage(this)
    },

    loadPaletteFromLocalStorage() {
      const result = StorageActions.loadPaletteFromLocalStorage()
      if (result) {
        this.paletteMap = result.paletteMap || {}
        this._paletteVersion++
        if (result._paletteNextCounter) {
          this._paletteNextCounter = result._paletteNextCounter
        }
        this._refreshAllLayerEntriesFromPalette()
        this.refreshMergedAppearanceData()
        return true
      }
      return false
    },

    exportStacksToJsonFile(filename = 'stacks.json') {
      return StorageActions.exportStacksToJsonFile(this, filename)
    },

    importStacksFromJsonFile(file) {
      return new Promise(async (resolve) => {
        const result = await StorageActions.importStacksFromJsonFile(file)
        if (!result.success) {
          resolve(false)
          return
        }
        this.stacks = this._sanitizeStacksForPersistence(result.stacks)
        if (result._partUidCounter) {
          this._partUidCounter = result._partUidCounter
        }
        this.RebuildAllStacksLayerEntriesFromParts()
        this._refreshAllLayerEntriesFromPalette()
        this.refreshMergedAppearanceData()
        resolve(true)
      })
    },

    exportPaletteToJsonFile(filename = 'palette.json') {
      return StorageActions.exportPaletteToJsonFile(this, filename)
    },

    importPaletteFromJsonFile(file) {
      return new Promise(async (resolve) => {
        const result = await StorageActions.importPaletteFromJsonFile(file)
        if (!result.success) {
          resolve(false)
          return
        }
        this.paletteMap = result.paletteMap
        this._paletteVersion++
        if (result._paletteNextCounter) {
          this._paletteNextCounter = result._paletteNextCounter
        }
        this._refreshAllLayerEntriesFromPalette()
        this.refreshMergedAppearanceData()
        resolve(true)
      })
    },

    exportStudioSnapshot(filename = 'studio_snapshot.json') {
      return StorageActions.exportStudioSnapshot(this, filename)
    },

    importStudioSnapshotFromFile(file) {
      return new Promise(async (resolve) => {
        const result = await StorageActions.importStudioSnapshotFromFile(file)
        if (!result.success) {
          resolve(false)
          return
        }
        const { data } = result
        if (data.stacks) {
          this.stacks = this._sanitizeStacksForPersistence(data.stacks)
        }
        if (data.paletteMap) {
          this.paletteMap = data.paletteMap
          this._paletteVersion++
        }
        if (data._paletteNextCounter) {
          this._paletteNextCounter = data._paletteNextCounter
        }
        if (data._partUidCounter) {
          this._partUidCounter = data._partUidCounter
        }
        this.RebuildAllStacksLayerEntriesFromParts()
        this._refreshAllLayerEntriesFromPalette()
        this.refreshMergedAppearanceData()
        resolve(true)
      })
    },

    getMergedAppearanceForExport() {
      return SaveActions.getMergedAppearanceForExport(this)
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
      const scope = this.focusState?.scope || {}
      const selection = this.focusState?.selection || {}
      const editor = this.focusState?.editor || {}
      const tool = this.focusState?.tool || {}

      this.focusedPartIndex = {
        stackIndex: (typeof scope.stackIndex === 'number') ? scope.stackIndex : null,
        partIndex: (typeof scope.partIndex === 'number') ? scope.partIndex : null
      }

      this.selectionMode = selection.mode === 'multiple' ? 'multiple' : 'single'
      const layerKeys = Array.isArray(selection.layerKeys) ? selection.layerKeys : []
      this.selectedLayers = layerKeys
        .map((key) => {
          const [stackRaw, partRaw, layerRaw] = String(key).split('-')
          const stackIndex = Number(stackRaw)
          const partIndex = Number(partRaw)
          const layerIndex = Number(layerRaw)
          if (!Number.isFinite(stackIndex) || !Number.isFinite(partIndex) || !Number.isFinite(layerIndex)) return null
          return { stackIndex, partIndex, layerIndex, _key: key }
        })
        .filter(Boolean)

      this.activeFocusContext = {
        property: editor.property || null,
        subLayerIndex: editor.subLayerIndex ?? null,
        timestamp: editor.timestamp || 0
      }

      const preview = tool.preview === 'move' ? 'move' : 'view'
      this.previewTool = preview
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
        // Single → Multi: preserve current selection
        // selectedLayers is already populated, no action needed
      } else if (!wasSingleMode && !isNowMultiMode) {
        // Multi → Single: keep only the first selected layer
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
      if (!part || !Array.isArray(part.layerEntries) || typeof targetLayerIndex !== 'number') return null

      const byColorableIndex = part.layerEntries.find(le => le && le.isColorable && le.colorableIndex === targetLayerIndex)
      if (byColorableIndex && typeof byColorableIndex.layerIndex === 'number') {
        return byColorableIndex.layerIndex
      }

      let colorableCounter = -1
      for (const entry of part.layerEntries) {
        if (!entry || !entry.isColorable) continue
        colorableCounter += 1
        if (colorableCounter === targetLayerIndex) return entry.layerIndex
      }

      const byLayerIndex = part.layerEntries.find(le => le && le.layerIndex === targetLayerIndex)
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

      const applyResult = this.batchApplyPartLayerDeltas(updates, {
        deferCommit,
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

      const applyResult = this.batchApplyPartLayerDeltas(updates, {
        deferCommit,
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

      const applyResult = this.batchApplyPartLayerDeltas(updates, {
        deferCommit,
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

      const applyResult = this.batchApplyPartLayerDeltas(updates, {
        deferCommit,
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

      const applyResult = this.batchApplyPartLayerDeltas(updates, {
        deferCommit,
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
     * Initialize the undo/redo manager (called during store initialization)
     */
    _initUndoRedo() {
      if (this._undoRedoManager) {
        return // Already initialized
      }

      this._undoRedoManager = new UndoRedoManager({
        captureState: () => {
          // Capture minimal necessary state for undo/redo
          // mergedAppearanceData is derived and will be regenerated on restore
          return {
            stacks: this._sanitizeStacksForPersistence(this.stacks),
            paletteMap: fastClone(this.paletteMap),
            _paletteNextCounter: this._paletteNextCounter,
            focusedPartIndex: fastClone(this.focusedPartIndex),
            selectedLayers: fastClone(this.selectedLayers),
            selectionMode: this.selectionMode,
            activeFocusContext: fastClone(this.activeFocusContext),
            previewTool: this.previewTool,
            focusState: fastClone(this.focusState)
          }
        },
        restoreState: (snapshot) => {
          // Restore state from snapshot
          this.stacks = this._sanitizeStacksForPersistence(snapshot.stacks)
          this.paletteMap = fastClone(snapshot.paletteMap)
          this._paletteNextCounter = snapshot._paletteNextCounter || 1
          this.focusedPartIndex = fastClone(snapshot.focusedPartIndex)

          if (snapshot.focusState) {
            this.focusState = fastClone(snapshot.focusState)
            this._syncLegacyFromFocusState()
          } else {
            if (Array.isArray(snapshot.selectedLayers)) {
              this.selectedLayers = fastClone(snapshot.selectedLayers)
            }
            if (snapshot.selectionMode === 'single' || snapshot.selectionMode === 'multiple') {
              this.selectionMode = snapshot.selectionMode
            }
            if (snapshot.activeFocusContext) {
              this.activeFocusContext = fastClone(snapshot.activeFocusContext)
            }
            if (snapshot.previewTool === 'view' || snapshot.previewTool === 'move') {
              this.previewTool = snapshot.previewTool
            }
            this._syncFocusStateScopeFromFocusedPart()
            this._syncFocusStateSelectionFromLegacy()
            this._syncFocusStateEditorFromLegacy()
            this.focusState.tool.preview = this.previewTool
          }

          // Increment palette version to invalidate caches
          this._paletteVersion++

          // Rebuild layer entries and refresh
          this.RebuildAllStacksLayerEntriesFromParts()
          this._refreshAllLayerEntriesFromPalette()
          this.refreshMergedAppearanceData()

          // Update focused part
          if (this.focusedPartIndex.stackIndex !== null && this.focusedPartIndex.partIndex !== null) {
            this.triggerFocusedPartUpdate()
          }
        },
        maxHistory: 100,
        throttleInterval: 150,
        enableLogging: false // Set to true for debugging
      })
    },

    /**
     * Start a history transaction (for high-frequency operations)
     * @param {string} [tag] Optional tag to identify the transaction
     */
    startHistoryTransaction(tag = null) {
      if (!this._undoRedoManager) {
        this._initUndoRedo()
      }
      this._undoRedoManager.startTransaction(tag)
    },

    /**
     * End the current history transaction
     */
    endHistoryTransaction() {
      if (!this._undoRedoManager) return
      this._undoRedoManager.endTransaction()
    },

    /**
     * Cancel the current history transaction without recording
     */
    cancelHistoryTransaction() {
      if (!this._undoRedoManager) return
      this._undoRedoManager.cancelTransaction()
    },

    /**
     * Push current state to history (for discrete operations)
     */
    pushHistorySnapshot() {
      if (!this._undoRedoManager) {
        this._initUndoRedo()
      }
      this._undoRedoManager.pushSnapshot()
    },

    /**
     * Push current state to history with throttling (for keyboard input, etc.)
     * @param {number} [delay] Optional custom delay in ms
     */
    pushHistorySnapshotThrottled(delay = null) {
      if (!this._undoRedoManager) {
        this._initUndoRedo()
      }
      this._undoRedoManager.pushSnapshotThrottled(delay)
    },

    /**
     * Undo the last action
     * @returns {boolean} True if undo was performed
     */
    undo() {
      if (!this._undoRedoManager) {
        this._initUndoRedo()
      }
      return this._undoRedoManager.undo()

    },

    /**
     * Redo the last undone action
     * @returns {boolean} True if redo was performed
     */
    redo() {
      if (!this._undoRedoManager) {
        this._initUndoRedo()
      }
      return this._undoRedoManager.redo()
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

      if (!this._undoRedoManager) return false
      this._undoRedoManager.clearHistory()
      return true
    },

    /**
     * Get history information
     * @returns {Object} History info
     */
    getHistory() {
      if (!this._undoRedoManager) {
        this._initUndoRedo()
      }
      return this._undoRedoManager.getHistory()
    },

    /**
     * Get full history stacks with metadata
     * @returns {Object} Full history info with undo and redo stacks
     */
    getFullHistory() {
      if (!this._undoRedoManager) {
        this._initUndoRedo()
      }
      return this._undoRedoManager.getFullHistory()
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

      if (!this._undoRedoManager) {
        this._initUndoRedo()
      }
      return this._undoRedoManager.jumpToState(steps)
    },

    /**
     * Toggle history panel visibility
     */
    toggleHistoryPanel(visible) {
      if (typeof visible === 'boolean') {
        this.historyPanelVisible = visible
      } else {
        this.historyPanelVisible = !this.historyPanelVisible
      }
      this.panelStates.history = this.historyPanelVisible ? 'pinned' : 'hidden'
      this.persistUiLayout()
    },

    /**
     * Check if undo is available
     */
    canUndo() {
      if (!this._undoRedoManager) return false
      return this._undoRedoManager.canUndo()
    },

    /**
     * Check if redo is available
     */
    canRedo() {
      if (!this._undoRedoManager) return false
      return this._undoRedoManager.canRedo()
    },

    // -------------------------
    // Auto-save Management
    // -------------------------

    /**
     * Enable auto-save with debounce
     */
    enableAutoSave() {
      const result = SaveActions.enableAutoSave()
      this.autoSaveEnabled = result.autoSaveEnabled
    },

    /**
     * Disable auto-save
     */
    disableAutoSave() {
      const result = SaveActions.disableAutoSave()
      this.autoSaveEnabled = result.autoSaveEnabled
    },

    /**
     * Save state to localStorage with compression
     */
    async saveToLocalStorage() {
      this.saveStatus = 'saving'
      const result = await SaveActions.saveToLocalStorage(this)

      if (result.success) {
        this.lastSaveTime = result.lastSaveTime
        this.saveStatus = result.saveStatus
      } else {
        this.saveStatus = result.saveStatus || 'error'
      }

      // Clear any existing timeout and set new one
      if (this._saveStatusTimeout) {
        clearTimeoutHost(this._saveStatusTimeout)
      }
      this._saveStatusTimeout = setTimeoutHost(() => {
        if (this.saveStatus === 'saved' || this.saveStatus === 'error') {
          this.saveStatus = 'idle'
        }
        this._saveStatusTimeout = null
      }, 2000)

      return result.success
    },

    /**
     * Restore state from localStorage
     */
    async restoreFromLocalStorage() {
      const result = await SaveActions.restoreFromLocalStorage()

      if (!result.restored) {
        return result
      }

      // Restore data from result
      const data = result.data
      if (data.stacks) {
        this.stacks = this._sanitizeStacksForPersistence(data.stacks)
      }
      if (data.paletteMap) {
        this.paletteMap = data.paletteMap
      }
      if (typeof data._paletteNextCounter === 'number') {
        this._paletteNextCounter = data._paletteNextCounter
      }
      if (typeof data._partUidCounter === 'number') {
        this._partUidCounter = data._partUidCounter
      }
      if (typeof data.selectedIndex === 'number') {
        this.selectedIndex = data.selectedIndex
      }
      if (typeof data.focusedPartIndex === 'object' && data.focusedPartIndex !== null) {
        this.focusedPartIndex = fastClone(data.focusedPartIndex)
      }

      if (data.focusState && typeof data.focusState === 'object') {
        this.focusState = fastClone(data.focusState)
        this._syncLegacyFromFocusState()
      } else {
        if (Array.isArray(data.selectedLayers)) {
          this.selectedLayers = fastClone(data.selectedLayers)
        }
        if (data.selectionMode === 'single' || data.selectionMode === 'multiple') {
          this.selectionMode = data.selectionMode
        }
        if (data.activeFocusContext && typeof data.activeFocusContext === 'object') {
          this.activeFocusContext = fastClone(data.activeFocusContext)
        }
        if (data.previewTool === 'view' || data.previewTool === 'move') {
          this.previewTool = data.previewTool
        }
        this._syncFocusStateScopeFromFocusedPart()
        this._syncFocusStateSelectionFromLegacy()
        this._syncFocusStateEditorFromLegacy()
        this.focusState.tool.preview = this.previewTool
      }

      this._paletteVersion++
      // Rebuild layer entries and refresh
      this.RebuildAllStacksLayerEntriesFromParts()
      this._refreshAllLayerEntriesFromPalette()
      this.refreshMergedAppearanceData()

      this.lastSaveTime = result.timestamp
      if (this.focusedPartIndex.stackIndex !== null && this.focusedPartIndex.partIndex !== null) {
        this.triggerFocusedPartUpdate()
      }

      return {
        restored: true,
        timestamp: result.timestamp,
        age: result.age
      }
    },

    /**
     * Clear auto-saved data from localStorage
     */
    clearLocalStorage() {
      const result = SaveActions.clearLocalStorage()
      if (result) {
        this.lastSaveTime = null
        this.saveStatus = 'idle'
      }
      return result
    },

    /**
     * Get information about auto-saved data
     */
    async getAutoSaveInfo() {
      return SaveActions.getAutoSaveInfo()
    },

    // -------------------------
    // Multi-file Storage Management
    // -------------------------

    /**
     * Auto-save to quick save slot using StudioStorageService
     */
    async autoSave() {
      if (!this.autoSaveEnabled) return

      this.saveStatus = 'saving'
      const result = SaveActions.autoSave(this)

      if (result.success) {
        this.lastSaveTime = result.lastSaveTime
        this.saveStatus = result.saveStatus
      } else {
        this.saveStatus = result.saveStatus || 'error'
      }

      // Auto-hide status after delay
      if (this._saveStatusTimeout) {
        clearTimeoutHost(this._saveStatusTimeout)
      }
      this._saveStatusTimeout = setTimeoutHost(() => {
        if (this.saveStatus === 'saved' || this.saveStatus === 'error') {
          this.saveStatus = 'idle'
        }
        this._saveStatusTimeout = null
      }, result.success ? 2000 : 3000)
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

      this.saveStatus = 'saving'
      const result = SaveActions.saveStudioSession(this, name)

      if (result.success) {
        this.currentSaveId = result.id
        this.lastSaveTime = result.lastSaveTime
        this.saveStatus = result.saveStatus
      } else {
        this.saveStatus = result.saveStatus || 'error'
      }

      // Auto-hide status after delay
      if (this._saveStatusTimeout) {
        clearTimeoutHost(this._saveStatusTimeout)
      }
      this._saveStatusTimeout = setTimeoutHost(() => {
        if (this.saveStatus === 'saved' || this.saveStatus === 'error') {
          this.saveStatus = 'idle'
        }
        this._saveStatusTimeout = null
      }, result.success ? 2000 : 3000)

      return { success: result.success, error: result.error }
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

      const result = SaveActions.loadStudioSession(id)

      if (!result.success) {
        return { success: false, error: result.error }
      }

      const { data } = result
      this.stacks = this._sanitizeStacksForPersistence(data.stacks || [])
      this.paletteMap = data.paletteMap || {}
      this._paletteNextCounter = data._paletteNextCounter || 0
      this._partUidCounter = data._partUidCounter || 0
      this.selectedIndex = data.selectedIndex ?? -1
      this.currentSaveId = id

      // Increment palette version to invalidate caches
      this._paletteVersion++

      // Rebuild layer entries and refresh
      this.RebuildAllStacksLayerEntriesFromParts()
      this._refreshAllLayerEntriesFromPalette()
      this.refreshMergedAppearanceData()

      return { success: true }
    },

    renameStudioSession(id, newName, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'saves.rename',
          payload: { id, newName },
          meta: {}
        })
      }

      const normalizedName = String(newName || '').trim()
      if (!normalizedName) {
        return { success: false, error: 'Invalid save name' }
      }

      return StudioStorageService.renameSave(id, normalizedName)
    },

    deleteStudioSession(id, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return this.execute({
          type: 'saves.delete',
          payload: { id },
          meta: {}
        })
      }

      const result = StudioStorageService.deleteSave(id)
      if (result?.success && this.currentSaveId === id) {
        this.currentSaveId = null
      }
      return result
    },

    /**
     * Auto-restore from quick save on studio open
     */
    async autoRestoreSession() {
      const result = SaveActions.autoRestoreSession()
      if (!result.restored) {
        return result
      }

      // Load the auto-save
      return this.loadStudioSession(result.save.id).then(loadResult => {
        if (loadResult.success) {
          return { restored: true, save: result.save }
        }
        return { restored: false }
      })
    }
  }
})

export default useStudioStore