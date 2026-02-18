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
import LZString from 'lz-string'

import { hostWindow, setTimeoutHost, clearTimeoutHost, doc } from '@/utils/host-window.js'

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
      const idx = state.focusedPartIndex
      if (idx.stackIndex === null || idx.partIndex === null) return false
      if (idx.stackIndex < 0 || idx.stackIndex >= state.stacks.length) return false

      const stack = state.stacks[idx.stackIndex]
      if (!stack || !Array.isArray(stack.data)) return false
      if (idx.partIndex < 0 || idx.partIndex >= stack.data.length) return false

      return true
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
      this.layerManagerActive = typeof val === 'boolean' ? val : !this.layerManagerActive
    },

    // -------------------------
    // Preview tool management
    // -------------------------

    /**
     * Set the preview tool mode
     * @param {string} tool - 'view' or 'move'
     */
    setPreviewTool(tool) {
      if (tool === 'view' || tool === 'move') {
        this.previewTool = tool
      }
    },

    /**
     * Toggle between view and move modes
     */
    togglePreviewTool() {
      if (this.previewTool === 'view') {
        // Only switch to move if available
        if (this.canUseMoveTool) {
          this.previewTool = 'move'
        }
      } else {
        this.previewTool = 'view'
      }
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
      this.replaceTarget = {
        active: true,
        key: key || null,
        item: item ? (typeof item === 'object' ? fastClone(item) : item) : null,
        isEmpty: !!isEmpty
      }
      this.focusedPartIndex = { stackIndex: null, partIndex: null }
      this.clearFocusedProperty()
    },

    clearReplaceTarget() {
      this.replaceTarget = { active: false, key: null, item: null, isEmpty: false }
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
      let copy
      if (!this.assetIndex || Object.keys(this.assetIndex).length === 0 || !this.assetGroupsRaw || this.assetGroupsRaw.length === 0) {
        await this.loadAssetData()
      }

      copy = fastClone(el)

      try {
        const res = Palette.applyPaletteToElement(copy, this.paletteMap, this._paletteNextCounter)
        copy = res.element
        this.paletteMap = res.paletteMap
        this._paletteNextCounter = res.paletteCounter
        this._paletteVersion++
      } catch (e) {
        console.warn('[studioStore] applyPaletteToElement failed', e)
      }

      // Attach LayerEntries for each part
      try {
        if (Array.isArray(copy.data)) {
          copy.data = copy.data.map((p) => {
            try {
              if (!p) return p
              try { this.ensurePartUid(p) } catch (e) { console.warn(e) }

              if (!Array.isArray(p.layerEntries) || p.layerEntries.length === 0) {
                const entries = this._buildLayerEntriesWithCache(p) || []
                p.layerEntries = fastClone(entries)
              } else {
                // Update colorCss fields
                this._updateLayerEntriesColorCss(p.layerEntries)
              }
            } catch (e) { /* ignore per-item errors */ }
            return p
          })
        }
      } catch (e) { console.warn('[studioStore] attach layerEntries failed', e) }

      try {
        copy.PrioritiesMapping = {}
        copy.PrioritiesUngrouped = []
      } catch (e) { console.warn(e) }

      this.stacks.push(copy)
      this.selectedIndex = this.stacks.length - 1
      this.refreshMergedAppearanceData()

      // Push to history (discrete operation)
      this.pushHistorySnapshot()

      return copy
    },

    removeElement(idx) {
      if (idx < 0 || idx >= this.stacks.length) return

      // Push to history before removing (discrete operation)
      this.pushHistorySnapshot()

      try {
        const item = this.stacks[idx]
        if (item) this.renderer.removeCanvas({ data: item.data, type: 'outfit' })
      } catch (e) { console.warn(e) }

      this.stacks.splice(idx, 1)
      if (this.selectedIndex === idx) {
        if (this.stacks.length === 0) this.selectedIndex = -1
        else this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, this.stacks.length - 1))
      } else if (this.selectedIndex > idx) {
        this.selectedIndex = Math.max(-1, this.selectedIndex - 1)
      }

      if (this.focusedPartIndex.stackIndex === idx) {
        this.focusedPartIndex = { stackIndex: null, partIndex: null }
      } else if (this.focusedPartIndex.stackIndex > idx) {
        this.focusedPartIndex.stackIndex--
      }

      this._scheduleRefresh()
    },

    moveElement(fromIdx, toIdx) {
      if (fromIdx === toIdx) return
      if (fromIdx < 0 || fromIdx >= this.stacks.length) return
      if (toIdx < 0 || toIdx >= this.stacks.length) return
      const [item] = this.stacks.splice(fromIdx, 1)
      this.stacks.splice(toIdx, 0, item)
      if (this.selectedIndex === fromIdx) {
        this.selectedIndex = toIdx
      } else if (fromIdx < this.selectedIndex && toIdx >= this.selectedIndex) {
        this.selectedIndex--
      } else if (fromIdx > this.selectedIndex && toIdx <= this.selectedIndex) {
        this.selectedIndex++
      }

      if (this.focusedPartIndex.stackIndex === fromIdx) {
        this.focusedPartIndex.stackIndex = toIdx
      } else if (fromIdx < this.focusedPartIndex.stackIndex && toIdx >= this.focusedPartIndex.stackIndex) {
        this.focusedPartIndex.stackIndex--
      } else if (fromIdx > this.focusedPartIndex.stackIndex && toIdx <= this.focusedPartIndex.stackIndex) {
        this.focusedPartIndex.stackIndex++
      }

      this._scheduleRefresh()
    },

    select(idx) {
      if (idx === -1) {
        this.selectedIndex = -1
        return
      }
      if (idx < 0 || idx >= this.stacks.length) return
      this.selectedIndex = idx
      this.focusedPartIndex = { stackIndex: null, partIndex: null }
      this.clearFocusedProperty()
    },

    clear() {
      try {
        this.stacks.forEach(it => { this.renderer.removeCanvas({ data: it.data, type: 'outfit' }) })
      } catch (e) { console.warn(e) }
      this.stacks = []
      this.selectedIndex = -1
      this.mergedAppearanceData = []
      this.focusedPartIndex = { stackIndex: null, partIndex: null }
      this.clearFocusedProperty()
    },

    focusPart(part) {
      if (!part) {
        this.focusedPartIndex = { stackIndex: null, partIndex: null }
        // Clear selections when losing focus
        this.clearLayerSelection()
        return
      }

      const uid = this.ensurePartUid(part)
      const found = this.findPartByUid(uid)

      if (found) {
        // Check if focusing a different part
        const isDifferentPart = this.focusedPartIndex.stackIndex !== found.stackIndex ||
          this.focusedPartIndex.partIndex !== found.partIndex

        this.focusedPartIndex = {
          stackIndex: found.stackIndex,
          partIndex: found.partIndex
        }

        // Clear selections when switching parts
        if (isDifferentPart) {
          this.clearLayerSelection()
        }
      } else {
        let foundByStructure = false
        try {
          const partJson = JSON.stringify(part)
          for (let si = 0; si < this.stacks.length; si++) {
            const stack = this.stacks[si]
            if (!stack || !Array.isArray(stack.data)) continue
            for (let pi = 0; pi < stack.data.length; pi++) {
              try {
                if (JSON.stringify(stack.data[pi]) === partJson) {
                  // Check if focusing a different part
                  const isDifferentPart = this.focusedPartIndex.stackIndex !== si ||
                    this.focusedPartIndex.partIndex !== pi

                  this.focusedPartIndex = { stackIndex: si, partIndex: pi }
                  foundByStructure = true

                  // Clear selections when switching parts
                  if (isDifferentPart) {
                    this.clearLayerSelection()
                  }
                  break
                }
              } catch (e) { continue }
            }
            if (foundByStructure) break
          }
        } catch (e) { console.warn(e) }

        if (!foundByStructure) {
          console.warn('[studioStore] focusPart: part not found in stacks')
          this.focusedPartIndex = { stackIndex: null, partIndex: null }
          this.clearLayerSelection()
          return
        }
      }

      this.clearReplaceTarget()
      this.triggerFocusedPartUpdate()
    },

    clearFocus() {
      this.focusedPartIndex = { stackIndex: null, partIndex: null }
      this.clearFocusedProperty()
      this.clearLayerSelection()
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
      if (!this.paletteModeActive) return false
      const targets = Array.isArray(this.activePaletteTargets) ? this.activePaletteTargets.slice() : []
      if (!targets.length) return false

      let changed = false

      for (const t of targets) {
        try {
          let found = null
          if (t.uid) {
            const res = this.findPartByUid(t.uid)
            found = res?.partRef || null
          }
          if (!found && (typeof t.stackIndex === 'number' && typeof t.partIndex === 'number')) {
            const s = this.stacks[t.stackIndex]
            if (s && Array.isArray(s.data) && s.data[t.partIndex]) {
              found = s.data[t.partIndex]
            }
          }

          const layerIdx = t.layerIndex
          if (!found.layerEntries) {
            found.layerEntries = this._buildLayerEntriesWithCache(found) || []
          }

          if (found && Array.isArray(found.layerEntries) && layerIdx !== null && layerIdx !== undefined && layerIdx >= 0) {
            const entry = found.layerEntries.find((le, i) => {
              if (!le || !le.isColorable) return false
              return found.layerEntries.slice(0, i).filter(e => e?.isColorable).length === layerIdx
            })
            if (entry) {
              try { entry.colorText = newColor === undefined || newColor === null ? '' : String(newColor) } catch (e) { entry.colorText = newColor }

              try {
                const resolvedCss = this._resolveColorCssFromText(entry.colorText)
                entry.colorCss = resolvedCss
              } catch (e) { entry.colorCss = null }
              changed = true
            }
          }
        } catch (e) {
          console.warn(e)
        }
      }

      if (changed) {
        // Use scheduled refresh instead of immediate
        this._scheduleLayerRefresh()
        this._schedulePartUpdate()
        this._scheduleRefresh()
        this.triggerFocusedPartUpdate()

        // Push to history (throttled to avoid excessive entries during continuous updates)
        this.pushHistorySnapshotThrottled()
      }

      return changed
    },

    applyTagToActivePaletteTargets(tag) {
      return this.applyColorToActivePaletteTargets(tag)
    },

    deletePaletteTag(tag) {
      this.UpdateAllStacksPartFromLayerEntries()

      if (!tag || !(tag in (this.paletteMap || {}))) return false

      const fp = this.focusedPart
      const res = Palette.deletePaletteTagFromStacks(this.stacks, this.paletteMap, fp, tag)
      this.stacks = res.stacks

      if (fp && res.focusedPart) {
        this._updateFocusedPartInPlace(res.focusedPart)
      }

      this.paletteMap = res.paletteMap
      this._paletteVersion++

      if (res.removed) {
        this._scheduleLayerRefresh()
        this.RebuildAllStacksLayerEntriesFromParts()
        this._scheduleRefresh()

        // Push to history (discrete operation)
        this.pushHistorySnapshot()
      }
      return res.removed
    },

    clearPalette() {
      // Push to history before clearing (discrete operation)
      this.pushHistorySnapshot()

      const tags = Object.keys(this.paletteMap || {})
      let s = this.stacks
      let fp = this.focusedPart
      let pm = this.paletteMap
      for (const tag of tags) {
        const res = Palette.deletePaletteTagFromStacks(s, pm, fp, tag)
        s = res.stacks
        fp = res.focusedPart
        pm = res.paletteMap
      }
      this.stacks = s
      if (fp) {
        this._updateFocusedPartInPlace(fp)
      }
      this.paletteMap = {}
      this._paletteNextCounter = 1
      this._paletteVersion++

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
      if (!tag || !(tag in (this.paletteMap || {}))) return false
      this.paletteMap = Palette.updatePaletteTag(this.paletteMap, tag, newValue)
      this._paletteVersion++
      this._scheduleLayerRefresh()
      this._scheduleRefresh()

      // Push to history with throttling (can be called multiple times during tag editing)
      this.pushHistorySnapshotThrottled()

      return true
    },

    // -------------------------
    // Saved colors management
    // -------------------------
    addSavedColor(value) {
      try {
        const v = (value === undefined || value === null) ? '' : fastClone(value)
        this.savedColors = (this.savedColors || []).concat([v])
        return true
      } catch (e) {
        this.savedColors = (this.savedColors || []).concat([value])
        return true
      }
    },

    updateSavedColor(idx, newValue) {
      if (typeof idx !== 'number' || idx < 0 || idx >= (this.savedColors || []).length) return false
      try {
        const v = (newValue === undefined || newValue === null) ? '' : fastClone(newValue)
        const copy = (this.savedColors || []).slice()
        copy[idx] = v
        this.savedColors = copy
        return true
      } catch (e) {
        const copy = (this.savedColors || []).slice()
        copy[idx] = newValue
        this.savedColors = copy
        return true
      }
    },

    deleteSavedColor(idx) {
      if (typeof idx !== 'number' || idx < 0 || idx >= (this.savedColors || []).length) return false
      const copy = (this.savedColors || []).slice()
      copy.splice(idx, 1)
      this.savedColors = copy
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
      const el = this.selectedElement
      if (!el) return []
      return PriorityService.buildPriorityListForStackObject(el, { getGroupDescriptionForPart: (p) => this.getGroupDescriptionForPart(p) })
    },

    updatePrioritiesForSelected(updates = []) {
      const idx = this.selectedIndex
      if (idx < 0 || idx >= this.stacks.length) return false
      try {
        const el = this.stacks[idx]
        const newEl = PriorityService.applyPriorityUpdatesToStackObject(el, updates)
        const copyStacks = fastClone(this.stacks)
        copyStacks[idx] = newEl
        this.stacks = copyStacks
        this._scheduleRefresh()
        return true
      } catch (e) {
        console.error('[studioStore] updatePrioritiesForSelected failed', e)
        return false
      }
    },

    recomputePrioritiesForSelected() {
      return this.getPriorityListForSelected()
    },

    getSelectedPrioritiesSnapshot() {
      const sel = this.selectedElement
      if (!sel) return { mapping: {}, ungrouped: [] }
      return { mapping: sel.PrioritiesMapping || {}, ungrouped: sel.PrioritiesUngrouped || [] }
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
      if (!asset) return null

      const sidx = this.selectedIndex
      if (typeof sidx !== 'number' || sidx < 0 || sidx >= this.stacks.length) {
        console.warn('[studioStore] applyAssetToSelectedStack: no selected stack')
        return null
      }

      try {
        const newPart = {
          Name: asset.Name,
          Group: (asset.Group && (typeof asset.Group === 'string' ? asset.Group : (asset.Group.Name || asset.Group.name))) || undefined,
          Color: asset.DefaultColor ?? asset.DefaultColour ?? asset.Default ?? null
        }

        try { this.ensurePartUid(newPart) } catch (e) { console.warn(e) }

        let entries = []
        try {
          entries = this._buildLayerEntriesWithCache(newPart) || []
        } catch (e) {
          entries = []
        }
        newPart.layerEntries = fastClone(entries)

        let newStacks = fastClone(this.stacks)

        const sel = newStacks[sidx] || { data: [] }
        const parts = Array.isArray(sel.data) ? sel.data.slice() : []

        let replaced = false
        if (replaceTarget && !replaceTarget.isEmpty && replaceTarget.item) {
          try {
            const origJson = JSON.stringify(replaceTarget.item)
            for (let i = 0; i < parts.length; i++) {
              try {
                if (JSON.stringify(parts[i]) === origJson) {
                  parts[i] = fastClone(newPart)
                  replaced = true
                  break
                }
              } catch (pe) { /* ignore */ }
            }
          } catch (e) { console.warn(e) }
        }

        if (!replaced) {
          parts.push(fastClone(newPart))
        }

        newStacks[sidx] = Object.assign({}, newStacks[sidx] || {}, { data: parts })
        this.stacks = newStacks

        const newFocused = parts.find(p => p.Name === newPart.Name && (p.Group === newPart.Group)) || parts[parts.length - 1]
        const partIdx = parts.indexOf(newFocused)
        if (partIdx >= 0) {
          this.focusedPartIndex = { stackIndex: sidx, partIndex: partIdx }
        }

        try { this.translateFocusedPartToLayers && this.translateFocusedPartToLayers() } catch (e) { }
        this._scheduleRefresh()
        this.pushHistorySnapshot()

        return this.focusedPart || null
      } catch (err) {
        console.error('[studioStore] applyAssetToSelectedStack failed', err)
        return null
      }
    },

    // -------------------------
    // PERSISTENCE helpers
    // -------------------------
    _localStorageKeyForStacks() { return 'studio_stacks_v1' },
    _localStorageKeyForPalette() { return 'studio_palette_v1' },

    persistStacksToLocalStorage() {
      try {
        const payload = { stacks: this.stacks, _partUidCounter: this._partUidCounter }
        hostWindow.localStorage.setItem(this._localStorageKeyForStacks(), JSON.stringify(payload))
        return true
      } catch (e) {
        console.warn('[studioStore] persistStacksToLocalStorage failed', e)
        return false
      }
    },

    loadStacksFromLocalStorage() {
      try {
        const raw = hostWindow.localStorage.getItem(this._localStorageKeyForStacks())
        if (!raw) return false
        const parsed = JSON.parse(raw)
        if (!parsed || !Array.isArray(parsed.stacks)) return false
        this.stacks = parsed.stacks
        if (parsed._partUidCounter && typeof parsed._partUidCounter === 'number') {
          this._partUidCounter = parsed._partUidCounter
        }
        this.RebuildAllStacksLayerEntriesFromParts()
        this._refreshAllLayerEntriesFromPalette()
        this.refreshMergedAppearanceData()
        return true
      } catch (e) {
        console.warn('[studioStore] loadStacksFromLocalStorage failed', e)
        return false
      }
    },

    persistPaletteToLocalStorage() {
      try {
        const payload = { paletteMap: this.paletteMap, _paletteNextCounter: this._paletteNextCounter }
        hostWindow.localStorage.setItem(this._localStorageKeyForPalette(), JSON.stringify(payload))
        return true
      } catch (e) {
        console.warn('[studioStore] persistPaletteToLocalStorage failed', e)
        return false
      }
    },

    loadPaletteFromLocalStorage() {
      try {
        const raw = hostWindow.localStorage.getItem(this._localStorageKeyForPalette())
        if (!raw) return false
        const parsed = JSON.parse(raw)
        if (!parsed || !parsed.paletteMap) return false
        this.paletteMap = parsed.paletteMap || {}
        this._paletteVersion++
        if (parsed._paletteNextCounter && typeof parsed._paletteNextCounter === 'number') {
          this._paletteNextCounter = parsed._paletteNextCounter
        }
        this._refreshAllLayerEntriesFromPalette()
        this.refreshMergedAppearanceData()
        return true
      } catch (e) {
        console.warn('[studioStore] loadPaletteFromLocalStorage failed', e)
        return false
      }
    },

    exportStacksToJsonFile(filename = 'stacks. json') {
      try {
        const payload = { stacks: toRaw(this.stacks), _partUidCounter: this._partUidCounter }
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
        const url = hostWindow.URL.createObjectURL(blob)
        const a = doc.createElement('a')
        a.href = url
        a.download = filename
        doc.body.appendChild(a)
        a.click()
        a.remove()
        setTimeoutHost(() => hostWindow.URL.revokeObjectURL(url), 5000)
        return true
      } catch (e) {
        console.warn('[studioStore] exportStacksToJsonFile failed', e)
        return false
      }
    },

    importStacksFromJsonFile(file) {
      return new Promise((resolve) => {
        if (!file) return resolve(false)
        const reader = new FileReader()
        reader.onload = (ev) => {
          try {
            const parsed = JSON.parse(String(ev.target.result || ''))
            let stacksPayload = null
            if (Array.isArray(parsed)) stacksPayload = parsed
            else if (parsed && Array.isArray(parsed.stacks)) stacksPayload = parsed.stacks
            if (!stacksPayload) return resolve(false)
            this.stacks = stacksPayload
            if (parsed._partUidCounter && typeof parsed._partUidCounter === 'number') {
              this._partUidCounter = parsed._partUidCounter
            }
            this.RebuildAllStacksLayerEntriesFromParts()
            this._refreshAllLayerEntriesFromPalette()
            this.refreshMergedAppearanceData()
            resolve(true)
          } catch (e) {
            console.warn('[studioStore] importStacksFromJsonFile parse failed', e)
            resolve(false)
          }
        }
        reader.onerror = () => resolve(false)
        reader.readAsText(file)
      })
    },

    exportPaletteToJsonFile(filename = 'palette.json') {
      try {
        const payload = { paletteMap: toRaw(this.paletteMap), _paletteNextCounter: this._paletteNextCounter }
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
        const url = hostWindow.URL.createObjectURL(blob)
        const a = doc.createElement('a')
        a.href = url
        a.download = filename
        doc.body.appendChild(a)
        a.click()
        a.remove()
        setTimeoutHost(() => hostWindow.URL.revokeObjectURL(url), 5000)
        return true
      } catch (e) {
        console.warn('[studioStore] exportPaletteToJsonFile failed', e)
        return false
      }
    },

    importPaletteFromJsonFile(file) {
      return new Promise((resolve) => {
        if (!file) return resolve(false)
        const reader = new FileReader()
        reader.onload = (ev) => {
          try {
            const parsed = JSON.parse(String(ev.target.result || ''))
            let newMap = null
            if (parsed && parsed.paletteMap && typeof parsed.paletteMap === 'object') newMap = parsed.paletteMap
            else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) newMap = parsed
            if (!newMap) return resolve(false)
            this.paletteMap = newMap
            this._paletteVersion++
            if (parsed._paletteNextCounter && typeof parsed._paletteNextCounter === 'number') {
              this._paletteNextCounter = parsed._paletteNextCounter
            }
            this._refreshAllLayerEntriesFromPalette()
            this.refreshMergedAppearanceData()
            resolve(true)
          } catch (e) {
            console.warn('[studioStore] importPaletteFromJsonFile parse failed', e)
            resolve(false)
          }
        }
        reader.onerror = () => resolve(false)
        reader.readAsText(file)
      })
    },

    exportStudioSnapshot(filename = 'studio_snapshot.json') {
      try {
        const payload = {
          stacks: toRaw(this.stacks),
          paletteMap: toRaw(this.paletteMap),
          _paletteNextCounter: this._paletteNextCounter,
          _partUidCounter: this._partUidCounter
        }
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
        const url = hostWindow.URL.createObjectURL(blob)
        const a = doc.createElement('a')
        a.href = url
        a.download = filename
        doc.body.appendChild(a)
        a.click()
        a.remove()
        setTimeoutHost(() => hostWindow.URL.revokeObjectURL(url), 5000)
        return true
      } catch (e) {
        console.warn('[studioStore] exportStudioSnapshot failed', e)
        return false
      }
    },

    importStudioSnapshotFromFile(file) {
      return new Promise((resolve) => {
        if (!file) return resolve(false)
        const reader = new FileReader()
        reader.onload = (ev) => {
          try {
            const parsed = JSON.parse(String(ev.target.result || ''))
            if (!parsed) return resolve(false)
            if (Array.isArray(parsed.stacks)) {
              this.stacks = parsed.stacks
            }
            if (parsed.paletteMap && typeof parsed.paletteMap === 'object') {
              this.paletteMap = parsed.paletteMap
              this._paletteVersion++
            }
            if (parsed._paletteNextCounter && typeof parsed._paletteNextCounter === 'number') {
              this._paletteNextCounter = parsed._paletteNextCounter
            }
            if (parsed._partUidCounter && typeof parsed._partUidCounter === 'number') {
              this._partUidCounter = parsed._partUidCounter
            }
            this.RebuildAllStacksLayerEntriesFromParts()
            this._refreshAllLayerEntriesFromPalette()
            this.refreshMergedAppearanceData()
            resolve(true)
          } catch (e) {
            console.warn('[studioStore] importStudioSnapshotFromFile parse failed', e)
            resolve(false)
          }
        }
        reader.onerror = () => resolve(false)
        reader.readAsText(file)
      })
    },

    getMergedAppearanceForExport() {
      try {
        return fastClone(this.mergedAppearanceData || { data: [] })
      } catch (e) {
        try { return toRaw(this.mergedAppearanceData || { data: [] }) } catch (ee) { return { data: [] } }
      }
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
      if (this.selectionMode === 'single') {
        this.selectionMode = 'multiple'
      } else {
        this.selectionMode = 'single'
        // Clear selections when switching back to single mode
        this.clearLayerSelection()
      }
    },

    /**
     * Toggle layer selection (add or remove)
     */
    toggleLayerSelection(layerInfo) {
      if (!layerInfo || typeof layerInfo.stackIndex !== 'number' ||
        typeof layerInfo.partIndex !== 'number' ||
        typeof layerInfo.layerIndex !== 'number') {
        console.warn('[studioStore] toggleLayerSelection: invalid layerInfo', layerInfo)
        return
      }

      const key = this._buildLayerKey(layerInfo.stackIndex, layerInfo.partIndex, layerInfo.layerIndex)
      const existingIndex = this.selectedLayers.findIndex(l => l._key === key)

      if (existingIndex >= 0) {
        // Remove from selection
        this.selectedLayers = this.selectedLayers.filter((_, i) => i !== existingIndex)
      } else {
        // Add to selection
        this.selectedLayers = [...this.selectedLayers, {
          stackIndex: layerInfo.stackIndex,
          partIndex: layerInfo.partIndex,
          layerIndex: layerInfo.layerIndex,
          _key: key
        }]
      }
    },

    /**
     * Check if a layer is currently selected
     */
    isLayerSelected(layerInfo) {
      if (!layerInfo || typeof layerInfo.stackIndex !== 'number' ||
        typeof layerInfo.partIndex !== 'number' ||
        typeof layerInfo.layerIndex !== 'number') {
        return false
      }

      const key = this._buildLayerKey(layerInfo.stackIndex, layerInfo.partIndex, layerInfo.layerIndex)
      return this.selectedLayers.some(l => l._key === key)
    },

    /**
     * Select all layers in the focused part
     */
    selectAllLayers() {
      const fp = this.focusedPart
      if (!fp || !Array.isArray(fp.layerEntries)) {
        console.warn('[studioStore] selectAllLayers: no focused part or layer entries')
        return
      }

      const idx = this.focusedPartIndex
      if (idx.stackIndex === null || idx.partIndex === null) {
        console.warn('[studioStore] selectAllLayers: invalid focused part index')
        return
      }

      // Select all colorable layers in the focused part
      const newSelections = []
      fp.layerEntries.forEach((layer) => {
        const key = this._buildLayerKey(idx.stackIndex, idx.partIndex, layer.layerIndex)
        newSelections.push({
          stackIndex: idx.stackIndex,
          partIndex: idx.partIndex,
          layerIndex: layer.layerIndex,
          _key: key
        })
      })

      this.selectedLayers = newSelections
    },

    /**
     * Clear all layer selections
     */
    clearLayerSelection() {
      this.selectedLayers = []
    },

    /**
     * Select a range of layers (Shift+Click)
     */
    selectLayerRange(fromIndex, toIndex) {
      const fp = this.focusedPart
      if (!fp || !Array.isArray(fp.layerEntries)) {
        console.warn('[studioStore] selectLayerRange: no focused part or layer entries')
        return
      }

      const idx = this.focusedPartIndex
      if (idx.stackIndex === null || idx.partIndex === null) {
        console.warn('[studioStore] selectLayerRange: invalid focused part index')
        return
      }

      const start = Math.min(fromIndex, toIndex)
      const end = Math.max(fromIndex, toIndex)

      const newSelections = []
      for (let layerIndex = start; layerIndex <= end && layerIndex < fp.layerEntries.length; layerIndex++) {
        const key = this._buildLayerKey(idx.stackIndex, idx.partIndex, layerIndex)
        // Only add if not already selected
        if (!this.selectedLayers.some(l => l._key === key)) {
          newSelections.push({
            stackIndex: idx.stackIndex,
            partIndex: idx.partIndex,
            layerIndex: layerIndex,
            _key: key
          })
        }
      }

      this.selectedLayers = [...this.selectedLayers, ...newSelections]
    },

    /**
     * Get full data for selected layers
     */
    getSelectedLayersData() {
      const results = []

      for (const sel of this.selectedLayers) {
        try {
          if (sel.stackIndex < 0 || sel.stackIndex >= this.stacks.length) continue

          const stack = this.stacks[sel.stackIndex]
          if (!stack || !Array.isArray(stack.data)) continue

          if (sel.partIndex < 0 || sel.partIndex >= stack.data.length) continue

          const part = stack.data[sel.partIndex]
          if (!part || !Array.isArray(part.layerEntries)) continue

          //if (sel.layerIndex < 0 || sel.layerIndex >= part.layerEntries.length) continue

          const layer = part.layerEntries.find(l => l.layerIndex === sel.layerIndex)
          if (!layer) continue
          results.push({
            selection: sel,
            part: part,
            layer: layer
          })
        } catch (e) {
          console.warn('[studioStore] getSelectedLayersData: error processing selection', sel, e)
        }
      }

      return results
    },

    /**
     * Validate if a batch operation can be performed on targets
     */
    validateBatchOperation(operation, targets) {
      if (!targets || targets.length === 0) {
        return { valid: false, reason: 'No targets selected' }
      }

      if (operation === 'color') {
        // Check if at least one layer is colorable
        const hasColorable = targets.some(t => t.layer && t.layer.isColorable)
        if (!hasColorable) {
          return { valid: false, reason: 'No colorable layers selected' }
        }
      }

      return { valid: true }
    },

    /**
     * Batch update opacity for selected layers
     * @param {number} value - Opacity value (0-100)
     * @param {string} mode - 'absolute' or 'relative'
     */
    batchUpdateOpacity(value, mode = 'absolute') {
      const targets = this.getSelectedLayersData()
      const validation = this.validateBatchOperation('opacity', targets)

      if (!validation.valid) {
        console.warn('[studioStore] batchUpdateOpacity:', validation.reason)
        return { success: false, reason: validation.reason }
      }

      let updatedCount = 0

      for (const target of targets) {
        try {
          const { selection, part, layer } = target

          let newOpacity
          if (mode === 'relative') {
            // Relative adjustment
            const currentOpacity = (layer.opacity != null ? layer.opacity : 1) * 100
            newOpacity = Math.max(0, Math.min(100, currentOpacity + value)) / 100
          } else {
            // Absolute value
            newOpacity = Math.max(0, Math.min(100, value)) / 100
          }

          // Update the layer entry
          layer.opacity = newOpacity

          // Mark as changed
          updatedCount++
        } catch (e) {
          console.warn('[studioStore] batchUpdateOpacity: error updating layer', target, e)
        }
      }

      if (updatedCount > 0) {
        // Trigger refresh
        this._scheduleLayerRefresh()
        this._schedulePartUpdate()
        this._scheduleRefresh()
        this.triggerFocusedPartUpdate()

        // Push to history (single snapshot for entire batch operation)
        this.pushHistorySnapshot()
      }

      return { success: true, updatedCount }
    },

    /**
     * Batch update offset for selected layers
     * @param {number} x - X offset
     * @param {number} y - Y offset
     * @param {string} mode - 'absolute' or 'relative'
     */
    batchUpdateOffset(x, y, mode = 'absolute') {
      const targets = this.getSelectedLayersData()
      const validation = this.validateBatchOperation('offset', targets)

      if (!validation.valid) {
        console.warn('[studioStore] batchUpdateOffset:', validation.reason)
        return { success: false, reason: validation.reason }
      }

      let updatedCount = 0

      for (const target of targets) {
        try {
          const { layer } = target

          if (mode === 'relative') {
            // Relative adjustment
            const currentLeft = layer.drawingLeft != null ? layer.drawingLeft : 0
            const currentTop = layer.drawingTop != null ? layer.drawingTop : 0
            layer.drawingLeft = currentLeft + (x || 0)
            layer.drawingTop = currentTop + (y || 0)
            if (layer.subLayers && Array.isArray(layer.subLayers)) {
              for (const subLayer of layer.subLayers) {
                if (subLayer.drawingLeft != null) {
                  subLayer.drawingLeft += (x || 0)
                }
                if (subLayer.drawingTop != null) {
                  subLayer.drawingTop += (y || 0)
                }
              }
            }
          } else {
            // Absolute value
            layer.drawingLeft = x != null ? x : (layer.drawingLeft || 0)
            layer.drawingTop = y != null ? y : (layer.drawingTop || 0)
            if (layer.subLayers && Array.isArray(layer.subLayers)) {
              for (const subLayer of layer.subLayers) {
                if (subLayer.drawingLeft != null) {
                  subLayer.drawingLeft = x != null ? x : (subLayer.drawingLeft || 0)
                }
                if (subLayer.drawingTop != null) {
                  subLayer.drawingTop = y != null ? y : (subLayer.drawingTop || 0)
                }
              }
            }
          }

          updatedCount++
        } catch (e) {
          console.warn('[studioStore] batchUpdateOffset: error updating layer', target, e)
        }
      }

      if (updatedCount > 0) {
        this._scheduleLayerRefresh()
        this._schedulePartUpdate()
        this._scheduleRefresh()
        this.triggerFocusedPartUpdate()

        // Push to history (single snapshot for entire batch operation)
        this.pushHistorySnapshot()
      }

      return { success: true, updatedCount }
    },

    /**
     * Batch update color for selected layers
     * @param {string} colorValue - Color value or tag
     */
    batchUpdateColor(colorValue) {
      const targets = this.getSelectedLayersData()
      const validation = this.validateBatchOperation('color', targets)

      if (!validation.valid) {
        console.warn('[studioStore] batchUpdateColor:', validation.reason)
        return { success: false, reason: validation.reason }
      }

      let updatedCount = 0
      let skippedCount = 0

      for (const target of targets) {
        try {
          const { layer } = target

          // Only update colorable layers
          if (!layer.isColorable) {
            skippedCount++
            continue
          }

          // Update color
          layer.colorText = colorValue === undefined || colorValue === null ? '' : String(colorValue)

          // Update colorCss
          try {
            const resolvedCss = this._resolveColorCssFromText(layer.colorText)
            layer.colorCss = resolvedCss
          } catch (e) {
            layer.colorCss = null
          }

          updatedCount++
        } catch (e) {
          console.warn('[studioStore] batchUpdateColor: error updating layer', target, e)
        }
      }

      if (updatedCount > 0) {
        this._scheduleLayerRefresh()
        this._schedulePartUpdate()
        this._scheduleRefresh()
        this.triggerFocusedPartUpdate()

        // Push to history (single snapshot for entire batch operation)
        this.pushHistorySnapshot()
      }

      return { success: true, updatedCount, skippedCount }
    },

    /**
     * Batch update priority for selected layers
     * @param {number} value - Priority value
     * @param {string} mode - 'absolute' or 'relative'
     */
    batchUpdatePriority(value, mode = 'absolute') {
      const targets = this.getSelectedLayersData()
      const validation = this.validateBatchOperation('priority', targets)

      if (!validation.valid) {
        console.warn('[studioStore] batchUpdatePriority:', validation.reason)
        return { success: false, reason: validation.reason }
      }

      let updatedCount = 0

      for (const target of targets) {
        try {
          const { layer } = target

          if (mode === 'relative') {
            // Relative adjustment
            const currentPriority = layer.overridePriority != null ? layer.overridePriority : (layer.defaultPriority || 0)
            const newPriority = currentPriority + (value || 0)
            layer.overridePriority = newPriority
            layer.isOverridePriority = true
          } else {
            // Absolute value
            layer.overridePriority = value != null ? value : (layer.defaultPriority || 0)
            layer.isOverridePriority = true
          }

          updatedCount++
        } catch (e) {
          console.warn('[studioStore] batchUpdatePriority: error updating layer', target, e)
        }
      }

      if (updatedCount > 0) {
        this._scheduleLayerRefresh()
        this._schedulePartUpdate()
        this._scheduleRefresh()
        this.triggerFocusedPartUpdate()

        // Push to history (single snapshot for entire batch operation)
        this.pushHistorySnapshot()
      }

      return { success: true, updatedCount }
    },

    /**
     * Generic batch operation handler
     */
    applyBatchEdit(operation, payload) {
      switch (operation) {
        case 'opacity':
          return this.batchUpdateOpacity(payload.value, payload.mode)
        case 'offset':
          return this.batchUpdateOffset(payload.x, payload.y, payload.mode)
        case 'color':
          return this.batchUpdateColor(payload.value)
        case 'priority':
          return this.batchUpdatePriority(payload.value, payload.mode)
        default:
          console.warn('[studioStore] applyBatchEdit: unknown operation', operation)
          return { success: false, reason: 'Unknown operation' }
      }
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
      this.useOptimizedRenderer = !!useOptimized;
      // Force refresh with new renderer
      this.refreshMergedAppearanceData();
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
      this.autoSaveEnabled = true
    },

    /**
     * Disable auto-save
     */
    disableAutoSave() {
      this.autoSaveEnabled = false
    },

    /**
     * Save state to localStorage with compression
     */
    async saveToLocalStorage() {
      try {
        this.saveStatus = 'saving'

        const dataToSave = {
          version: '1.0',
          timestamp: Date.now(),
          data: {
            stacks: toRaw(this.stacks),
            paletteMap: toRaw(this.paletteMap),
            _paletteNextCounter: this._paletteNextCounter,
            _partUidCounter: this._partUidCounter,
            selectedIndex: this.selectedIndex
          }
        }

        // Compress data (LZString imported at module level)
        const jsonString = JSON.stringify(dataToSave)
        const compressed = LZString.compress(jsonString)

        // Save to localStorage
        hostWindow.localStorage.setItem('studio-autosave', compressed)

        this.lastSaveTime = Date.now()
        this.saveStatus = 'saved'

        // Clear any existing timeout and set new one
        if (this._saveStatusTimeout) {
          clearTimeoutHost(this._saveStatusTimeout)
        }
        this._saveStatusTimeout = setTimeoutHost(() => {
          if (this.saveStatus === 'saved') {
            this.saveStatus = 'idle'
          }
          this._saveStatusTimeout = null
        }, 2000)

        return true
      } catch (error) {
        console.error('[studioStore] saveToLocalStorage failed', error)
        this.saveStatus = 'error'

        // Clear any existing timeout and set new one
        if (this._saveStatusTimeout) {
          clearTimeoutHost(this._saveStatusTimeout)
        }
        this._saveStatusTimeout = setTimeoutHost(() => {
          if (this.saveStatus === 'error') {
            this.saveStatus = 'idle'
          }
          this._saveStatusTimeout = null
        }, 2000)

        // If quota exceeded, try to provide fallback
        if (error.name === 'QuotaExceededError') {
          console.warn('[studioStore] LocalStorage quota exceeded, falling back to download')
          // Could trigger a download as fallback
        }

        return false
      }
    },

    /**
     * Restore state from localStorage
     */
    async restoreFromLocalStorage() {
      try {
        const compressed = hostWindow.localStorage.getItem('studio-autosave')
        if (!compressed) {
          return { restored: false, reason: 'no-data' }
        }

        // Decompress data (LZString imported at module level)
        const jsonString = LZString.decompress(compressed)
        if (!jsonString) {
          throw new Error('Failed to decompress data')
        }

        const savedData = JSON.parse(jsonString)

        // Check version compatibility
        if (savedData.version !== '1.0') {
          console.warn('[studioStore] Incompatible autosave version:', savedData.version)
          return { restored: false, reason: 'incompatible-version' }
        }

        // Check if data is too old (>7 days)
        const age = Date.now() - savedData.timestamp
        const maxAge = 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
        if (age > maxAge) {
          console.log('[studioStore] Autosave data is too old, ignoring')
          return { restored: false, reason: 'too-old', age }
        }

        // Restore data
        const data = savedData.data
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
        if (typeof focusedPartIndex === 'object' && focusedPartIndex !== null) {
          this.focusedPartIndex = fastClone(focusedPartIndex)
        }

        this._paletteVersion++
        // Rebuild layer entries and refresh
        this.RebuildAllStacksLayerEntriesFromParts()
        this._refreshAllLayerEntriesFromPalette()
        this.refreshMergedAppearanceData()

        this.lastSaveTime = savedData.timestamp
        if (this.focusedPartIndex.stackIndex !== null && this.focusedPartIndex.partIndex !== null) {
          this.triggerFocusedPartUpdate()
        }

        return {
          restored: true,
          timestamp: savedData.timestamp,
          age
        }
      } catch (error) {
        console.error('[studioStore] restoreFromLocalStorage failed', error)

        // Clear corrupted data
        try {
          hostWindow.localStorage.removeItem('studio-autosave')
        } catch (e) {
          console.error('[studioStore] Failed to clear corrupted data', e)
        }

        return { restored: false, reason: 'error', error: error.message }
      }
    },

    /**
     * Clear auto-saved data from localStorage
     */
    clearLocalStorage() {
      try {
        hostWindow.localStorage.removeItem('studio-autosave')
        this.lastSaveTime = null
        this.saveStatus = 'idle'
        return true
      } catch (error) {
        console.error('[studioStore] clearLocalStorage failed', error)
        return false
      }
    },

    /**
     * Get information about auto-saved data
     */
    async getAutoSaveInfo() {
      try {
        const compressed = hostWindow.localStorage.getItem('studio-autosave')
        if (!compressed) {
          return { exists: false }
        }

        // Decompress data (LZString imported at module level)
        const jsonString = LZString.decompress(compressed)
        if (!jsonString) {
          return { exists: false, error: 'Failed to decompress' }
        }

        const savedData = JSON.parse(jsonString)

        return {
          exists: true,
          timestamp: savedData.timestamp,
          age: Date.now() - savedData.timestamp,
          version: savedData.version,
          size: compressed.length,
          stackCount: savedData.data?.stacks?.length || 0
        }
      } catch (error) {
        console.error('[studioStore] getAutoSaveInfo failed', error)
        return { exists: false, error: error.message }
      }
    },

    // -------------------------
    // Multi-file Storage Management
    // -------------------------

    /**
     * Auto-save to quick save slot using StudioStorageService
     */
    async autoSave() {
      if (!this.autoSaveEnabled) return

      try {
        this.saveStatus = 'saving'
        const data = {
          stacks: toRaw(this.stacks),
          paletteMap: toRaw(this.paletteMap),
          _paletteNextCounter: this._paletteNextCounter,
          _partUidCounter: this._partUidCounter,
          selectedIndex: this.selectedIndex
        }

        const result = StudioStorageService.createSave('Quick Save', data, true)
        if (result.success) {
          this.lastSaveTime = Date.now()
          this.saveStatus = 'saved'
          // Auto-hide after 2s
          if (this._saveStatusTimeout) {
            clearTimeoutHost(this._saveStatusTimeout)
          }
          this._saveStatusTimeout = setTimeoutHost(() => {
            if (this.saveStatus === 'saved') this.saveStatus = 'idle'
            this._saveStatusTimeout = null
          }, 2000)
        } else {
          this.saveStatus = 'error'
          if (this._saveStatusTimeout) {
            clearTimeoutHost(this._saveStatusTimeout)
          }
          this._saveStatusTimeout = setTimeoutHost(() => {
            if (this.saveStatus === 'error') this.saveStatus = 'idle'
            this._saveStatusTimeout = null
          }, 3000)
        }
      } catch (e) {
        console.error('Auto-save failed', e)
        this.saveStatus = 'error'
        if (this._saveStatusTimeout) {
          clearTimeoutHost(this._saveStatusTimeout)
        }
        this._saveStatusTimeout = setTimeoutHost(() => {
          if (this.saveStatus === 'error') this.saveStatus = 'idle'
          this._saveStatusTimeout = null
        }, 3000)
      }
    },

    /**
     * Manual save with custom name
     */
    async saveStudioSession(name) {
      try {
        this.saveStatus = 'saving'
        const data = {
          stacks: toRaw(this.stacks),
          paletteMap: toRaw(this.paletteMap),
          _paletteNextCounter: this._paletteNextCounter,
          _partUidCounter: this._partUidCounter,
          selectedIndex: this.selectedIndex
        }

        const result = StudioStorageService.createSave(name, data, false)
        if (result.success) {
          this.currentSaveId = result.id
          this.lastSaveTime = Date.now()
          this.saveStatus = 'saved'
          if (this._saveStatusTimeout) {
            clearTimeoutHost(this._saveStatusTimeout)
          }
          this._saveStatusTimeout = setTimeoutHost(() => {
            if (this.saveStatus === 'saved') this.saveStatus = 'idle'
            this._saveStatusTimeout = null
          }, 2000)
          return { success: true }
        } else {
          this.saveStatus = 'error'
          if (this._saveStatusTimeout) {
            clearTimeoutHost(this._saveStatusTimeout)
          }
          this._saveStatusTimeout = setTimeoutHost(() => {
            if (this.saveStatus === 'error') this.saveStatus = 'idle'
            this._saveStatusTimeout = null
          }, 3000)
          return { success: false, error: result.error }
        }
      } catch (e) {
        this.saveStatus = 'error'
        if (this._saveStatusTimeout) {
          clearTimeoutHost(this._saveStatusTimeout)
        }
        this._saveStatusTimeout = setTimeoutHost(() => {
          if (this.saveStatus === 'error') this.saveStatus = 'idle'
          this._saveStatusTimeout = null
        }, 3000)
        return { success: false, error: e.message }
      }
    },

    /**
     * Load a save by ID
     */
    async loadStudioSession(id) {
      try {
        const result = StudioStorageService.loadSave(id)
        if (result.success) {
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
        } else {
          return { success: false, error: result.error }
        }
      } catch (e) {
        console.error('Load session failed', e)
        return { success: false, error: e.message }
      }
    },

    /**
     * Auto-restore from quick save on studio open
     */
    async autoRestoreSession() {
      const autoSave = StudioStorageService.getAutoSave()
      if (!autoSave) return { restored: false }

      // Check if save is recent (< 7 days)
      const ageMs = Date.now() - autoSave.timestamp
      const ageDays = ageMs / (1000 * 60 * 60 * 24)
      if (ageDays > 7) return { restored: false, reason: 'too-old' }

      const result = await this.loadStudioSession(autoSave.id)
      if (result.success) {
        return { restored: true, save: autoSave }
      }
      return { restored: false }
    }
  }
})

export default useStudioStore