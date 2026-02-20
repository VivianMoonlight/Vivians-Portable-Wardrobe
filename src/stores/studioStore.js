/**
 * NOTE:
 * This file is a modified version of the original store to add "focusedProperty"
 * management and per-part _uid bookkeeping so components can refer to parts by
 * reference or uid.  The rest of the store logic is preserved with minimal changes.
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

    // NEW: Only use focusedPartIndex to locate the focused part
    focusedPartIndex: {
      stackIndex: null,
      partIndex: null
    },
    layerManagerActive: false,

    // NEW: focusedProperty keeps a single focused attribute within a part
    focusedProperty: null,

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
    activePaletteTargets: [],

    // NEW: central palette panel visibility (UI-level)
    palettePanelVisible: false,

    focusedPartUpdateFlag: 0,

    paletteWorkMode: 'external',

    paletteUpdateFlag: 0,

    // Performance: refresh scheduler instance
    _refreshScheduler: new RefreshScheduler(),

    // Performance: track if refresh is pending
    _pendingMergedRefresh: false,
    _pendingLayerRefresh: false,


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

    // Preview tool state
    previewTool: 'view', // 'view' | 'move'

    // Undo/Redo Manager
    _undoRedoManager: null,

    // History panel visibility
    historyPanelVisible: false,
    // Auto-save state
    autoSaveEnabled: true,
    lastSaveTime: null,
    saveStatus: 'idle', // 'idle' | 'saving' | 'saved' | 'error'
    _saveStatusTimeout: null, // Track timeout for status indicator
    currentSaveId: null // ID of currently loaded save
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
    },

    /**
     * Toggle between view and move modes
     */
    togglePreviewTool() {
      const result = PreviewActions.togglePreviewTool(this)
      this.previewTool = result.previewTool
    },

    // -------------------------
    // Part UID utilities
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
      this.clearFocusedProperty()
    },

    clearReplaceTarget() {
      const result = FocusActions.clearReplaceTargetState()
      this.replaceTarget = result.replaceTarget
    },

    // -------------------------
    // Focused property helpers
    // -------------------------
    setFocusedProperty(payload = {}) {
      if (!payload) return
      const out = {
        uid: null,
        partRef: null,
        stackIndex: (typeof payload.stackIndex === 'number') ? payload.stackIndex : null,
        partIndex: (typeof payload.partIndex === 'number') ? payload.partIndex : null,
        layerIndex: (typeof payload.layerIndex === 'number') ? payload.layerIndex : null,
        subLayerIndex: (typeof payload.subLayerIndex === 'number') ? payload.subLayerIndex : null,
        property: payload.property || null
      }

      if (payload.part && typeof payload.part === 'object') {
        out.partRef = payload.part
        out.uid = this.ensurePartUid(payload.part)
      } else if (payload.uid) {
        out.uid = payload.uid
        const found = this.findPartByUid(out.uid)
        if (found) out.partRef = found.partRef
        if (found && out.stackIndex === null) out.stackIndex = found.stackIndex
        if (found && out.partIndex === null) out.partIndex = found.partIndex
      }

      this.focusedProperty = out
    },

    clearFocusedProperty() {
      this.focusedProperty = null
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
      const activeRenderer = this.useOptimizedRenderer ? this.previewRenderer : this.renderer;

      try { activeRenderer.removeCanvas(this.mergedAppearanceData) } catch (e) { console.warn(e) }

      // Reconstruct parts from attached layerEntries (if present) before stacking. 
      const reconstructedStacks = this.stacks.map(el => {
        const data = Array.isArray(el.data) ? el.data : []
        const reconstructed = data.map(p => {
          try {
            if (p && Array.isArray(p.layerEntries) && p.layerEntries.length) {
              const asset = (typeof this.resolveAssetForPart === 'function') ? this.resolveAssetForPart(p) : null
              const newPart = LayerTranslator.reconstructPartFromLayerEntries(p.layerEntries, p, { originalAsset: asset })
              if (newPart) return newPart
            }
          } catch (e) {
            // fallback to original part if reconstruction fails
          }
          // Use fastClone instead of JSON.parse/stringify
          return fastClone(p)
        })
        return { data: reconstructed, filterList: el.filterList }
      })

      const unexpanded = {
        data: AssetApi.stackOutfitData(reconstructedStacks),
        type: 'outfit'
      }

      // expand tags using pure function
      this.mergedAppearanceData = Palette.expandedAppearanceForRendering(unexpanded, this.paletteMap)
      activeRenderer.renderPreviewWithItem(this.mergedAppearanceData)
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

    select(idx) {
      const result = StackActions.selectElementInStacks(this, idx, {
        clearFocusedProperty: this.clearFocusedProperty.bind(this),
        focusedPartIndex: this.focusedPartIndex
      })

      this.selectedIndex = result.selectedIndex
      if (result.focusedPartIndex) {
        this.focusedPartIndex = result.focusedPartIndex
      }
      if (result.clearFocusedProperty) {
        this.clearFocusedProperty()
      }
    },

    clear() {
      const result = StackActions.clearAllStacks(this, {
        renderer: this.renderer,
        clearFocusedProperty: this.clearFocusedProperty.bind(this),
        focusedPartIndex: this.focusedPartIndex
      })

      this.stacks = result.stacks
      this.selectedIndex = result.selectedIndex
      this.mergedAppearanceData = result.mergedAppearanceData
      this.focusedPartIndex = result.focusedPartIndex
      if (result.clearFocusedProperty) {
        this.clearFocusedProperty()
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
      if (result.clearLayerSelection) {
        this.clearLayerSelection()
      }

      this.clearReplaceTarget()
      this.triggerFocusedPartUpdate()
    },

    clearFocus() {
      const result = FocusActions.clearFocusState({
        clearFocusedProperty: this.clearFocusedProperty.bind(this),
        focusedPartIndex: this.focusedPartIndex,
        clearLayerSelection: this.clearLayerSelection.bind(this)
      })

      this.focusedPartIndex = result.focusedPartIndex
      if (result.clearFocusedProperty) {
        this.clearFocusedProperty()
      }
      if (result.clearLayerSelection) {
        this.clearLayerSelection()
      }
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

    /**
     * Set palette mode state and register active palette targets. 
     */
    setPaletteMode(active = false, targets = []) {
      this.paletteModeActive = !!active
      if (!this.paletteModeActive) {
        this.activePaletteTargets = []
        return
      }
      const arr = Array.isArray(targets) ? targets.slice() : []
      this.activePaletteTargets = arr.map(t => {
        return {
          uid: t && t.uid ? t.uid : null,
          stackIndex: (typeof t.stackIndex === 'number') ? t.stackIndex : null,
          partIndex: (typeof t.partIndex === 'number') ? t.partIndex : null,
          layerIndex: (typeof t.layerIndex === 'number') ? t.layerIndex : null,
          currentColorText: (t && t.currentColorText !== undefined && t.currentColorText !== null) ? t.currentColorText : null,
          currentColorCss: this._resolveColorCssFromText(t && t.currentColorText ? t.currentColorText : null)
        }
      })
      this.paletteUpdateFlag++
    },

    clearPaletteMode() {
      this.paletteModeActive = false
      this.activePaletteTargets = []
    },

    openPalettePanel(targets = []) {
      try {
        this.setPaletteMode(true, targets)
        this.palettePanelVisible = true
        this.paletteWorkMode = 'external'
      } catch (e) {
        this.palettePanelVisible = true
      }
    },

    setPaletteWorkMode(mode = 'external') {
      this.paletteWorkMode = mode
    },

    closePalettePanel() {
      try {
        this.palettePanelVisible = false
      } finally {
        try { this.clearPaletteMode() } catch (e) { console.warn(e) }
      }
    },

    // -------------------------
    // apply/modify palette targets (OPTIMIZED)
    // -------------------------
    applyColorToActivePaletteTargets(newColor) {
      const changed = PaletteActions.applyColorToTargets(this, newColor, {
        paletteModeActive: this.paletteModeActive,
        activePaletteTargets: this.activePaletteTargets,
        stacks: this.stacks,
        findPartByUid: this.findPartByUid.bind(this),
        _buildLayerEntriesWithCache: this._buildLayerEntriesWithCache.bind(this),
        _scheduleLayerRefresh: this._scheduleLayerRefresh.bind(this),
        _schedulePartUpdate: this._schedulePartUpdate.bind(this),
        triggerFocusedPartUpdate: this.triggerFocusedPartUpdate.bind(this),
        pushHistorySnapshotThrottled: this.pushHistorySnapshotThrottled.bind(this),
        _resolveColorCssFromText: this._resolveColorCssFromText.bind(this)
      })

      if (changed) {
        this._scheduleRefresh()
      }
      return changed
    },

    applyTagToActivePaletteTargets(tag) {
      return PaletteActions.applyTagToTargets(this, tag, {
        paletteModeActive: this.paletteModeActive,
        activePaletteTargets: this.activePaletteTargets,
        stacks: this.stacks,
        findPartByUid: this.findPartByUid.bind(this),
        _buildLayerEntriesWithCache: this._buildLayerEntriesWithCache.bind(this),
        _scheduleLayerRefresh: this._scheduleLayerRefresh.bind(this),
        _schedulePartUpdate: this._schedulePartUpdate.bind(this),
        triggerFocusedPartUpdate: this.triggerFocusedPartUpdate.bind(this),
        pushHistorySnapshotThrottled: this.pushHistorySnapshotThrottled.bind(this),
        _resolveColorCssFromText: this._resolveColorCssFromText.bind(this)
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

    updatePaletteTag(tag, newValue) {
      const result = PaletteActions.updatePaletteTag(this, tag, newValue, {
        paletteMap: this.paletteMap,
        stacks: this.stacks,
        focusedPart: this.focusedPart,
        findPartByUid: this.findPartByUid.bind(this),
        _buildLayerEntriesWithCache: this._buildLayerEntriesWithCache.bind(this),
        _scheduleLayerRefresh: this._scheduleLayerRefresh.bind(this),
        _schedulePartUpdate: this._schedulePartUpdate.bind(this),
        triggerFocusedPartUpdate: this.triggerFocusedPartUpdate.bind(this),
        pushHistorySnapshotThrottled: this.pushHistorySnapshotThrottled.bind(this)
      })

      this.paletteMap = result.paletteMap
      if (result._scheduleLayerRefresh) {
        this._scheduleLayerRefresh()
        this._scheduleRefresh()
        this.pushHistorySnapshotThrottled()
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

    buildLayerEntriesForPart(part) {
      const entries = this._buildLayerEntriesWithCache(part)
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

    /**
     * Apply edited layer entries back to the focused part and to any matching parts in stacks. 
     */
    updatePartFromLayerEntries(entries) {
      const fp = this.focusedPart
      if (!entries || !fp) return null

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

        this._scheduleRefresh()
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
    updatePartLayerEntries(part, entries) {
      if (!part || !entries) return

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

      // 5. Trigger Refresh
      this._scheduleRefresh()
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
    async applyAssetToSelectedStack(asset, replaceTarget = null) {
      const result = AssetActions.applyAssetToSelectedStack(this, asset, replaceTarget, {
        ensurePartUid: this.ensurePartUid.bind(this),
        _buildLayerEntriesWithCache: this._buildLayerEntriesWithCache.bind(this),
        fastClone: fastClone
      })

      if (result.stacks) {
        this.stacks = result.stacks
        this.focusedPartIndex = result.focusedPartIndex
        try { this.translateFocusedPartToLayers && this.translateFocusedPartToLayers() } catch (e) { }
        this._scheduleRefresh()
        this.pushHistorySnapshot()
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
        this.stacks = result.stacks
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
        this.stacks = result.stacks
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
          this.stacks = data.stacks
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

    /**
     * Toggle selection mode between single and multiple
     */
    toggleSelectionMode() {
      const result = SelectionActions.toggleSelectionMode(this)
      this.selectionMode = result.selectionMode
    },

    /**
     * Toggle layer selection (add or remove)
     */
    toggleLayerSelection(layerInfo) {
      const result = SelectionActions.toggleLayerSelection(this, layerInfo)
      this.selectedLayers = result.selectedLayers
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
    },

    /**
     * Clear all layer selections
     */
    clearLayerSelection() {
      const result = SelectionActions.clearLayerSelection()
      this.selectedLayers = result.selectedLayers
    },

    /**
     * Select a range of layers (Shift+Click)
     */
    selectLayerRange(fromIndex, toIndex) {
      const result = SelectionActions.selectLayerRange(this, fromIndex, toIndex)
      this.selectedLayers = result.selectedLayers
    },

    /**
     * Get full data for selected layers
     */
    getSelectedLayersData() {
      return SelectionActions.getSelectedLayersData(this)
    },

    /**
     * Validate if a batch operation can be performed on targets
     */
    validateBatchOperation(operation, targets) {
      return SelectionActions.validateBatchOperation(operation, targets)
    },

    /**
     * Batch update opacity for selected layers
     * @param {number} value - Opacity value (0-100)
     * @param {string} mode - 'absolute' or 'relative'
     */
    batchUpdateOpacity(value, mode = 'absolute') {
      const result = SelectionActions.batchUpdateOpacity(this, value, mode)

      if (result.success) {
        this._scheduleLayerRefresh()
        this._schedulePartUpdate()
        this._scheduleRefresh()
        this.triggerFocusedPartUpdate()
        this.pushHistorySnapshot()
      }

      return result
    },

    /**
     * Batch update offset for selected layers
     * @param {number} x - X offset
     * @param {number} y - Y offset
     * @param {string} mode - 'absolute' or 'relative'
     */
    batchUpdateOffset(x, y, mode = 'absolute') {
      const result = SelectionActions.batchUpdateOffset(this, x, y, mode)

      if (result.success) {
        this._scheduleLayerRefresh()
        this._schedulePartUpdate()
        this._scheduleRefresh()
        this.triggerFocusedPartUpdate()
        this.pushHistorySnapshot()
      }

      return result
    },

    /**
     * Batch update color for selected layers
     * @param {string} colorValue - Color value or tag
     */
    batchUpdateColor(colorValue) {
      const result = SelectionActions.batchUpdateColor(this, colorValue, this._resolveColorCssFromText.bind(this))

      if (result.success) {
        this._scheduleLayerRefresh()
        this._schedulePartUpdate()
        this._scheduleRefresh()
        this.triggerFocusedPartUpdate()
        this.pushHistorySnapshot()
      }

      return result
    },

    /**
     * Batch update priority for selected layers
     * @param {number} value - Priority value
     * @param {string} mode - 'absolute' or 'relative'
     */
    batchUpdatePriority(value, mode = 'absolute') {
      const result = SelectionActions.batchUpdatePriority(this, value, mode)

      if (result.success) {
        this._scheduleLayerRefresh()
        this._schedulePartUpdate()
        this._scheduleRefresh()
        this.triggerFocusedPartUpdate()
        this.pushHistorySnapshot()
      }

      return result
    },

    /**
     * Generic batch operation handler
     */
    applyBatchEdit(operation, payload) {
      const result = SelectionActions.applyBatchEdit(this, operation, payload, this._resolveColorCssFromText.bind(this))

      if (result.success) {
        this._scheduleLayerRefresh()
        this._schedulePartUpdate()
        this._scheduleRefresh()
        this.triggerFocusedPartUpdate()
        this.pushHistorySnapshot()
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
            stacks: fastClone(this.stacks),
            paletteMap: fastClone(this.paletteMap),
            _paletteNextCounter: this._paletteNextCounter,
            focusedPartIndex: fastClone(this.focusedPartIndex)
          }
        },
        restoreState: (snapshot) => {
          // Restore state from snapshot
          this.stacks = fastClone(snapshot.stacks)
          this.paletteMap = fastClone(snapshot.paletteMap)
          this._paletteNextCounter = snapshot._paletteNextCounter || 1
          this.focusedPartIndex = fastClone(snapshot.focusedPartIndex)

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
    clearHistory() {
      if (!this._undoRedoManager) return
      this._undoRedoManager.clearHistory()
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
    jumpToHistoryState(steps) {
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
        this.stacks = data.stacks
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
    async saveStudioSession(name) {
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
    async loadStudioSession(id) {
      const result = SaveActions.loadStudioSession(id)

      if (!result.success) {
        return { success: false, error: result.error }
      }

      const { data } = result
      this.stacks = data.stacks || []
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