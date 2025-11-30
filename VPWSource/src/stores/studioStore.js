/**
 * NOTE:
 * This file is a modified version of the original store to add "focusedProperty"
 * management and per-part _uid bookkeeping so components can refer to parts by
 * reference or uid.  The rest of the store logic is preserved with minimal changes.
 *
 * Additional changes in this copy:
 * - Added savedColors array and methods to manage saved colors.
 * - Added applyTagToActivePaletteTargets(tag) to let UI apply an existing palette tag
 *   to active palette targets (analogous to applyColorToActivePaletteTargets).
 * - Added centralized palette panel visibility control: palettePanelVisible,
 *   openPalettePanel(targets) and closePalettePanel().
 *
 * - NEW: After any palette-modifying behavior, we refresh all colorable layer entries
 *   so UI components (ColorableLayer, PartInspectorPanel, etc.) have up-to-date
 *   colorCss / colorText representations consistent with current paletteMap.
 *
 * - REFACTORED: Removed focusedPart global copy, now use focusedPartIndex exclusively.
 *
 * - PERSISTENCE: Added methods to persist stacks and palette to localStorage and
 *   to import/export them as local JSON files. Also provided helpers to export
 *   mergedAppearanceData so UI can push it into the FileSystem store.
 */
import { defineStore } from 'pinia'
import { RenderService } from '@/services/RenderService'
import { RenderApi } from '@/utils/RenderApi'
import { AssetApi } from '@/utils/AssetApi'
import { toRaw } from 'vue'

import { hostWindow, setTimeoutHost, doc } from '@/utils/host-window.js'

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

export const useStudioStore = defineStore('studio', {
  state: () => ({
    stacks: [],
    mergedAppearanceData: { data: [] }, // preview data (may contain tags)
    selectedIndex: -1,

    renderer: new RenderService({ drawCallbacks: RenderApi, thumbwidth: 500, thumbheight: 1000, previewwidth: 500, previewheight: 1000 }),

    // NEW: Only use focusedPartIndex to locate the focused part
    focusedPartIndex: {
      stackIndex: null,
      partIndex: null
    },

    // NEW: focusedProperty keeps a single focused attribute within a part
    // Example:
    // {
    //   uid: 'p7',            // unique id assigned to part object (if available)
    //   partRef: <object>,    // actual part object reference (optional)
    //   partIndex: 2,         // index in stack element data (optional)
    //   stackIndex: 1,        // which stack element index (optional)
    //   layerIndex: 0,        // which main layer index (if applicable)
    //   subLayerIndex: null,  // which sub-layer index (if applicable)
    //   property: 'color'|'opacity'|'drawing'|'priority' // property type
    // }
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
    // structure: { active: boolean, key: string|null, item: object|null, isEmpty: boolean }
    replaceTarget: { active: false, key: null, item: null, isEmpty: false },

    // internal per-part uid counter and mapping
    _partUidCounter: 1,

    // Palette editing mode: when true, UI registers which layer entries are active targets
    paletteModeActive: false,
    // activePaletteTargets: array of { uid, stackIndex, partIndex, layerIndex } - layerIndex required
    activePaletteTargets: [],

    // NEW: central palette panel visibility (UI-level)
    palettePanelVisible: false,

    focusedPartUpdateFlag: 0,

    paletteWorkMode: 'external',

    paletteUpdateFlag: 0
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
    }
  },
  actions: {
    // -------------------------
    // Part UID utilities
    // -------------------------
    /**
     * Ensure the given part object has a stable _uid property and return it.
     * Attaches _uid directly to the part object so identity is preserved.
     */
    ensurePartUid(part) {
      if (!part || typeof part !== 'object') return null
      if (part._uid) return part._uid
      const uid = 'p' + (this._partUidCounter++)
      try { part._uid = uid } catch (e) { /* non-writable?  ignore */ }
      return uid
    },

    /**
     * Given a part uid, try to find a matching part object in current stacks.
     * Returns { partRef, stackIndex, partIndex } or null.
     */
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
    /**
     * Enter replace mode for a given item/slot.
     * item: the part-like object or slot object the user wants to replace
     * key: stable key identifying the target (string)
     * isEmpty: boolean indicating this is an empty slot
     */
    setReplaceTarget(item, key, isEmpty = false) {
      this.replaceTarget = {
        active: true,
        key: key || null,
        item: item ? (typeof item === 'object' ? JSON.parse(JSON.stringify(item)) : item) : null,
        isEmpty: !!isEmpty
      }
      // when entering replace mode we clear focusedPartIndex & focusedProperty to enforce exclusivity
      this.focusedPartIndex = { stackIndex: null, partIndex: null }
      this.clearFocusedProperty()
    },

    clearReplaceTarget() {
      this.replaceTarget = { active: false, key: null, item: null, isEmpty: false }
    },

    // -------------------------
    // Focused property helpers
    // -------------------------
    /**
     * Set a focused property in the store.
     * Accepts either a part object (preferred) or a uid string.  Other fields optional.
     * Example:
     *  setFocusedProperty({ part: <object>, stackIndex: 0, partIndex: 2, layerIndex: 1, property: 'color' })
     *  setFocusedProperty({ uid: 'p3', property: 'opacity' })
     */
    setFocusedProperty(payload = {}) {
      if (!payload) return
      // normalize to object
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

      // store focusedProperty
      this.focusedProperty = out
    },

    clearFocusedProperty() {
      this.focusedProperty = null
    },

    // -------------------------
    // Rendering / preview
    // -------------------------
    refreshMergedAppearanceData() {
      try { this.renderer.removeCanvas(this.mergedAppearanceData) } catch (e) { console.warn(e) }

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
          // clone original to avoid mutating state during rendering
          try { return JSON.parse(JSON.stringify(p)) } catch (e) { return Object.assign({}, p) }
        })
        return { data: reconstructed, filterList: el.filterList }
      })

      const unexpanded = {
        data: AssetApi.stackOutfitData(reconstructedStacks),
        type: 'outfit'
      }

      // expand tags using pure function
      this.mergedAppearanceData = Palette.expandedAppearanceForRendering(unexpanded, this.paletteMap)
      this.renderer.renderPreviewWithItem(toRaw(this.mergedAppearanceData))
    },

    // -------------------------
    // stack manipulation
    // -------------------------
    async addElement(el) {
      let copy
      if (!this.assetIndex || Object.keys(this.assetIndex).length === 0 || !this.assetGroupsRaw || this.assetGroupsRaw.length === 0) {
        await this.loadAssetData()
      }


      try { copy = JSON.parse(JSON.stringify(el)) } catch (e) { copy = Object.assign({}, el) }

      try {
        // apply palette rules: returns new element and potentially updated paletteMap/counter
        const res = Palette.applyPaletteToElement(copy, this.paletteMap, this._paletteNextCounter)
        copy = res.element
        this.paletteMap = res.paletteMap
        this._paletteNextCounter = res.paletteCounter
      } catch (e) {
        console.warn('[studioStore] applyPaletteToElement failed', e)
      }

      // Attach LayerEntries for each part (so the element holds editable layer data).
      // If part already has layerEntries, we keep them.
      try {
        if (Array.isArray(copy.data)) {
          copy.data = copy.data.map((p) => {
            try {
              if (!p) return p
              // Ensure each part has a stable uid for cross-component referencing
              try { this.ensurePartUid(p) } catch (e) { console.warn(e) }

              // Preserve existing entries unless missing.
              if (!Array.isArray(p.layerEntries) || p.layerEntries.length === 0) {
                const entries = this.buildLayerEntriesForPart(p) || []
                // attach a deep clone to avoid shared references
                try { p.layerEntries = JSON.parse(JSON.stringify(entries)) } catch (e) { p.layerEntries = entries.slice() }
              } else {
                // Ensure colorCss fields are up-to-date w. r.t. current paletteMap
                try {
                  for (const le of p.layerEntries) {
                    if (!le) continue
                    if (le.colorText !== undefined && le.colorText !== null) {
                      const resolved = this._resolveColorCssFromText(le.colorText)
                      le.colorCss = resolved
                    }
                  }
                } catch (e) { /* ignore per-part */ }
              }
            } catch (e) { /* ignore per-item errors */ }
            return p
          })
        }
      } catch (e) { console.warn('[studioStore] attach layerEntries failed', e) }

      // Initialize PrioritiesMapping as empty dict (do NOT coerce overridePriority to tags here)
      try {
        copy.PrioritiesMapping = {}
        copy.PrioritiesUngrouped = []
      } catch (e) { console.warn(e) }

      this.stacks.push(copy)
      this.selectedIndex = this.stacks.length - 1
      this.refreshMergedAppearanceData()
      return copy
    },

    removeElement(idx) {
      if (idx < 0 || idx >= this.stacks.length) return
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

      // Clear focusedPartIndex if the focused part was in the removed stack
      if (this.focusedPartIndex.stackIndex === idx) {
        this.focusedPartIndex = { stackIndex: null, partIndex: null }
      } else if (this.focusedPartIndex.stackIndex > idx) {
        // Adjust stackIndex if it was after the removed one
        this.focusedPartIndex.stackIndex--
      }

      this.refreshMergedAppearanceData()
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

      // Adjust focusedPartIndex if needed
      if (this.focusedPartIndex.stackIndex === fromIdx) {
        this.focusedPartIndex.stackIndex = toIdx
      } else if (fromIdx < this.focusedPartIndex.stackIndex && toIdx >= this.focusedPartIndex.stackIndex) {
        this.focusedPartIndex.stackIndex--
      } else if (fromIdx > this.focusedPartIndex.stackIndex && toIdx <= this.focusedPartIndex.stackIndex) {
        this.focusedPartIndex.stackIndex++
      }

      this.refreshMergedAppearanceData()
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
        return
      }

      // Find the part in stacks by comparing structure or uid
      const uid = this.ensurePartUid(part)
      const found = this.findPartByUid(uid)

      if (found) {
        this.focusedPartIndex = {
          stackIndex: found.stackIndex,
          partIndex: found.partIndex
        }
      } else {
        // Fallback: try structural comparison
        let foundByStructure = false
        try {
          const partJson = JSON.stringify(part)
          for (let si = 0; si < this.stacks.length; si++) {
            const stack = this.stacks[si]
            if (!stack || !Array.isArray(stack.data)) continue
            for (let pi = 0; pi < stack.data.length; pi++) {
              try {
                if (JSON.stringify(stack.data[pi]) === partJson) {
                  this.focusedPartIndex = { stackIndex: si, partIndex: pi }
                  foundByStructure = true
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
          return
        }
      }

      // entering a normal focus clears any replace state (mutual exclusion)
      this.clearReplaceTarget()
      this.triggerFocusedPartUpdate()
    },

    clearFocus() {
      this.focusedPartIndex = { stackIndex: null, partIndex: null }
      this.clearFocusedProperty()
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

        // Replace in focused part via index
        const fp = this.focusedPart
        if (fp) {
          const replaced = Palette.replaceValueInPart(fp, value, tag)
          this._updateFocusedPartInPlace(replaced)
        }

        this._refreshAllLayerEntriesFromPalette()
        this.refreshMergedAppearanceData()
        return tag
      } catch (e) {
        console.warn('[studioStore] createTagAndReplaceInStacks failed', e)
        return null
      }
    },

    /**
     * Set palette mode state and register active palette targets.
     * targets: array of { uid, stackIndex, partIndex, layerIndex }
     * When active === false we clear targets.
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

    /**
     * Open the palette panel and register active targets (also enters palette mode).
     * targets: array of { uid, stackIndex, partIndex, layerIndex }
     */
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

    /**
     * Close the palette panel and clear palette mode/targets.
     */
    closePalettePanel() {
      try {
        this.palettePanelVisible = false
      } finally {
        try { this.clearPaletteMode() } catch (e) { console.warn(e) }
      }
    },

    // -------------------------
    // apply/modify palette targets
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

          const isFocusedPart = this.focusedPartIndex.stackIndex === t.stackIndex &&
            this.focusedPartIndex.partIndex === t.partIndex

          const layerIdx = t.layerIndex
          if (!found.layerEntries) {
            found.layerEntries = this.buildLayerEntriesForPart(found) || []
          }

          if (found && Array.isArray(found.layerEntries) && layerIdx !== null && layerIdx !== undefined && layerIdx >= 0) {
            const entry = found.layerEntries[layerIdx]
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
        this._refreshAllLayerEntriesFromPalette()
        this.UpdateAllStacksPartFromLayerEntries()
        this.refreshMergedAppearanceData()
        this.triggerFocusedPartUpdate()
      }

      return changed
    },

    /**
     * Apply an existing palette tag (string key) to all registered activePaletteTargets.
     */
    applyTagToActivePaletteTargets(tag) {
      return this.applyColorToActivePaletteTargets(tag)
    },

    /**
     * Delete a palette tag: expand occurrences in stacks and focusedPart (pure).
     */
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
      if (res.removed) {
        this._refreshAllLayerEntriesFromPalette()
        this.RebuildAllStacksLayerEntriesFromParts()
        this.refreshMergedAppearanceData()
      }
      return res.removed
    },

    clearPalette() {
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

      try {
        for (const stack of this.stacks) {
          if (!stack || !Array.isArray(stack.data)) continue
          for (const part of stack.data) {
            if (!part) continue
            try { part.layerEntries = this.buildLayerEntriesForPart(part) || [] } catch (e) { console.warn(e) }
          }
        }
      } catch (e) { console.warn(e) }

      const focusedP = this.focusedPart
      if (focusedP) {
        try {
          const entries = this.buildLayerEntriesForPart(focusedP) || []
          this._updateFocusedPartProperty('layerEntries', entries)
        } catch (e) { console.warn(e) }
      }

      this._refreshAllLayerEntriesFromPalette()
      this.refreshMergedAppearanceData()
    },

    updatePaletteTag(tag, newValue) {
      if (!tag || !(tag in (this.paletteMap || {}))) return false
      this.paletteMap = Palette.updatePaletteTag(this.paletteMap, tag, newValue)
      this._refreshAllLayerEntriesFromPalette()
      this.refreshMergedAppearanceData()
      return true
    },

    // -------------------------
    // Saved colors management
    // -------------------------
    addSavedColor(value) {
      try {
        const v = (value === undefined || value === null) ? '' : JSON.parse(JSON.stringify(value))
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
        const v = (newValue === undefined || newValue === null) ? '' : JSON.parse(JSON.stringify(newValue))
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
    // Layer translation helpers (pure)
    // -------------------------
    buildLayerEntriesForPart(part) {
      const deps = {
        paletteSnapshot: () => this.paletteSnapshot,
        resolveAssetForPart: (p) => this.resolveAssetForPart(p),
        getAssetCandidatesForPart: (p) => this.getAssetCandidatesForPart(p),
        findAssetGroupEntryForPart: (p) => this.findAssetGroupEntryForPart(p)
      }
      const entries = LayerTranslator.buildLayerEntriesForPart(part, deps)
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

        const newPartClone = JSON.parse(JSON.stringify(newPart))
        newPartClone.layerEntries = this.buildLayerEntriesForPart(newPartClone)

        const origJson = JSON.stringify(fp)

        const newStacks = this.stacks.map(el => {
          try {
            const copy = JSON.parse(JSON.stringify(el))
            if (Array.isArray(copy.data)) {
              copy.data = copy.data.map(p => {
                try {
                  if (p && p._uid && p._uid === uid) return JSON.parse(JSON.stringify(newPartClone))
                  if (JSON.stringify(p) === origJson) return JSON.parse(JSON.stringify(newPartClone))
                } catch (e) { /* ignore */ }
                return p
              })
            }
            return copy
          } catch (e) {
            return el
          }
        })

        this.stacks = newStacks
        this._updateFocusedPartInPlace(newPartClone)

        this.refreshMergedAppearanceData()
        this.translateFocusedPartToLayers()
        return this.focusedPart
      } catch (e) {
        console.error('[studioStore] updatePartFromLayerEntries failed', e)
        return null
      }
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
        newPart.layerEntries = JSON.parse(JSON.stringify(entries))
        try { newPart._uid = uid } catch (e) { console.warn(e) }
        return newPart
      } catch (e) {
        console.error('[studioStore] UpdateSpecificPartFromLayerEntries failed', e)
        return null
      }
    },

    UpdateAllStacksPartFromLayerEntries() {
      try {
        const newStacks = this.stacks.map(el => {
          try {
            const copy = JSON.parse(JSON.stringify(el))
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
          }
          catch (e) {
            return el
          }
        })

        this.stacks = newStacks
        this.refreshMergedAppearanceData()
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
          try {
            const copy = JSON.parse(JSON.stringify(el))
            if (Array.isArray(copy.data)) {
              copy.data = copy.data.map(p => {
                try {
                  if (p) {
                    p.layerEntries = this.buildLayerEntriesForPart(p) || []
                  }
                } catch (e) { /* ignore */ }
                return p
              })
            }
            return copy
          }
          catch (e) {
            return el
          }
        })

        this.stacks = newStacks
        this.refreshMergedAppearanceData()
      }
      catch (e) {
        console.error('[studioStore] RebuildAllStacksLayerEntriesFromParts failed', e)
      }

      const fp = this.focusedPart
      if (fp) {
        try {
          const entries = this.buildLayerEntriesForPart(fp) || []
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
        const copy = JSON.parse(JSON.stringify(newPartData))
        stack.data[idx.partIndex] = copy
        this.triggerFocusedPartUpdate()
        return true
      } catch (e) {
        console.warn('[studioStore] _updateFocusedPartInPlace failed', e)
        return false
      }
    },

    /**
     * Update a single property of the focused part
     */
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
    // PRIORITY ARRANGEMENT helpers (delegated to PriorityService)
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
        try {
          const copyStacks = JSON.parse(JSON.stringify(this.stacks))
          copyStacks[idx] = newEl
          this.stacks = copyStacks
        } catch (e) {
          this.stacks.splice(idx, 1, newEl)
        }
        this.refreshMergedAppearanceData()
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
     * Refresh color fields for all colorable layer entries
     */
    _refreshAllLayerEntriesFromPalette() {
      try {
        let newStacks
        try { newStacks = JSON.parse(JSON.stringify(this.stacks)) } catch (e) { newStacks = this.stacks.map(s => JSON.parse(JSON.stringify(s))) }

        for (const stack of newStacks) {
          if (!stack || !Array.isArray(stack.data)) continue
          for (const part of stack.data) {
            if (!part) continue
            if (!Array.isArray(part.layerEntries)) {
              part.layerEntries = this.buildLayerEntriesForPart(part) || []
            }
            for (const entry of part.layerEntries) {
              if (!entry) continue
              try {
                if (entry.colorText !== undefined && entry.colorText !== null) {
                  const resolved = this._resolveColorCssFromText(entry.colorText)
                  entry.colorCss = resolved
                } else {
                  entry.colorCss = entry.colorCss || null
                }
              } catch (e) { /* ignore */ }
            }
          }
        }

        try { this.stacks = newStacks } catch (e) {
          try {
            for (let i = 0; i < newStacks.length; i++) this.stacks.splice(i, 1, newStacks[i])
          } catch (ee) { console.warn(e) }
        }

        // Update focused part's layer entries
        const fp = this.focusedPart
        if (fp && Array.isArray(fp.layerEntries)) {
          try {
            const fpClone = JSON.parse(JSON.stringify(fp))
            for (const entry of fpClone.layerEntries) {
              if (!entry) continue
              try {
                if (entry.colorText !== undefined && entry.colorText !== null) {
                  entry.colorCss = this._resolveColorCssFromText(entry.colorText)
                } else {
                  entry.colorCss = entry.colorCss || null
                }
              } catch (e) { console.warn(e) }
            }
            this._updateFocusedPartInPlace(fpClone)
          } catch (e) {
            // fallback: mutate in place
            try {
              for (const entry of fp.layerEntries) {
                if (!entry) continue
                if (entry.colorText !== undefined && entry.colorText !== null) {
                  const resolved = this._resolveColorCssFromText(entry.colorText)
                  this._updateFocusedPartProperty('layerEntries', fp.layerEntries.map((e, i) =>
                    i === fp.layerEntries.indexOf(entry) ? { ...e, colorCss: resolved } : e
                  ))
                } else {
                  entry.colorCss = entry.colorCss || null
                }
              }
            } catch (ee) { console.warn(e) }
          }
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
          const res = (typeof this.buildLayerEntriesForPart === 'function') ? this.buildLayerEntriesForPart(newPart) : null
          entries = res || []
        } catch (e) {
          entries = []
        }
        try { newPart.layerEntries = JSON.parse(JSON.stringify(entries || [])) } catch (e) { newPart.layerEntries = (entries || []).slice() }

        let newStacks
        try {
          newStacks = JSON.parse(JSON.stringify(this.stacks))
        } catch (e) {
          newStacks = this.stacks.slice()
        }

        const sel = newStacks[sidx] || { data: [] }
        const parts = Array.isArray(sel.data) ? sel.data.slice() : []

        let replaced = false
        if (replaceTarget && !replaceTarget.isEmpty && replaceTarget.item) {
          try {
            const origJson = JSON.stringify(replaceTarget.item)
            for (let i = 0; i < parts.length; i++) {
              try {
                if (JSON.stringify(parts[i]) === origJson) {
                  parts[i] = JSON.parse(JSON.stringify(newPart))
                  replaced = true
                  break
                }
              } catch (pe) { /* ignore */ }
            }
          } catch (e) { console.warn(e) }
        }

        if (!replaced) {
          parts.push(JSON.parse(JSON.stringify(newPart)))
        }

        try {
          const newSel = Object.assign({}, newStacks[sidx] || {}, { data: parts })
          newStacks[sidx] = newSel
        } catch (e) {
          try {
            this.stacks.splice(sidx, 1, Object.assign({}, this.stacks[sidx] || {}, { data: parts }))
          } catch (ee) {
            console.warn('[studioStore] applyAssetToSelectedStack commit fallback failed', ee)
          }

          const newFocused = parts.find(p => p.Name === newPart.Name && (p.Group === newPart.Group)) || parts[parts.length - 1]
          const partIdx = parts.indexOf(newFocused)
          if (partIdx >= 0) {
            this.focusedPartIndex = { stackIndex: sidx, partIndex: partIdx }
          }

          try { this.translateFocusedPartToLayers && this.translateFocusedPartToLayers() } catch (e) { }
          try { this.refreshMergedAppearanceData && this.refreshMergedAppearanceData() } catch (e) { }
          return this.focusedPart || null
        }

        try {
          this.stacks = newStacks
        } catch (e) {
          try { this.stacks.splice(sidx, 1, newStacks[sidx]) } catch (ee) { console.warn(e) }
        }

        const newFocused = parts.find(p => p.Name === newPart.Name && (p.Group === newPart.Group)) || parts[parts.length - 1]
        const partIdx = parts.indexOf(newFocused)
        if (partIdx >= 0) {
          this.focusedPartIndex = { stackIndex: sidx, partIndex: partIdx }
        }

        try { this.translateFocusedPartToLayers && this.translateFocusedPartToLayers() } catch (e) { }
        try { this.refreshMergedAppearanceData && this.refreshMergedAppearanceData() } catch (e) { }

        return this.focusedPart || null
      } catch (err) {
        console.error('[studioStore] applyAssetToSelectedStack failed', err)
        return null
      }
    },

    // -------------------------
    // PERSISTENCE helpers (localStorage + JSON file import/export)
    // -------------------------

    // LocalStorage keys
    _localStorageKeyForStacks() { return 'studio_stacks_v1' },
    _localStorageKeyForPalette() { return 'studio_palette_v1' },

    // Persist stacks to localStorage (stringified)
    persistStacksToLocalStorage() {
      try {
        const payload = { stacks: this.stacks, _partUidCounter: this._partUidCounter }
        window.localStorage.setItem(this._localStorageKeyForStacks(), JSON.stringify(payload))
        return true
      } catch (e) {
        console.warn('[studioStore] persistStacksToLocalStorage failed', e)
        return false
      }
    },

    // Load stacks from localStorage
    loadStacksFromLocalStorage() {
      try {
        const raw = window.localStorage.getItem(this._localStorageKeyForStacks())
        if (!raw) return false
        const parsed = JSON.parse(raw)
        if (!parsed || !Array.isArray(parsed.stacks)) return false
        this.stacks = parsed.stacks
        // restore counter if present
        if (parsed._partUidCounter && typeof parsed._partUidCounter === 'number') {
          this._partUidCounter = parsed._partUidCounter
        }
        // ensure layerEntries are consistent and css resolved
        this.RebuildAllStacksLayerEntriesFromParts()
        this._refreshAllLayerEntriesFromPalette()
        this.refreshMergedAppearanceData()
        return true
      } catch (e) {
        console.warn('[studioStore] loadStacksFromLocalStorage failed', e)
        return false
      }
    },

    // Persist paletteMap to localStorage
    persistPaletteToLocalStorage() {
      try {
        const payload = { paletteMap: this.paletteMap, _paletteNextCounter: this._paletteNextCounter }
        window.localStorage.setItem(this._localStorageKeyForPalette(), JSON.stringify(payload))
        return true
      } catch (e) {
        console.warn('[studioStore] persistPaletteToLocalStorage failed', e)
        return false
      }
    },

    // Load paletteMap from localStorage
    loadPaletteFromLocalStorage() {
      try {
        const raw = window.localStorage.getItem(this._localStorageKeyForPalette())
        if (!raw) return false
        const parsed = JSON.parse(raw)
        if (!parsed || !parsed.paletteMap) return false
        this.paletteMap = parsed.paletteMap || {}
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

    // Export stacks as downloadable JSON file
    exportStacksToJsonFile(filename = 'stacks.json') {
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

    // Import stacks from a File object (JSON). Returns a Promise that resolves true/false.
    importStacksFromJsonFile(file) {
      return new Promise((resolve) => {
        if (!file) return resolve(false)
        const reader = new FileReader()
        reader.onload = (ev) => {
          try {
            const parsed = JSON.parse(String(ev.target.result || ''))
            // Accept either raw stacks array or envelope { stacks, ... }
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

    // Export paletteMap as downloadable JSON file
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

    // Import palette file (File object / JSON). Returns Promise<boolean>
    importPaletteFromJsonFile(file) {
      return new Promise((resolve) => {
        if (!file) return resolve(false)
        const reader = new FileReader()
        reader.onload = (ev) => {
          try {
            const parsed = JSON.parse(String(ev.target.result || ''))
            // Accept either paletteMap object or envelope { paletteMap, ... }
            let newMap = null
            if (parsed && parsed.paletteMap && typeof parsed.paletteMap === 'object') newMap = parsed.paletteMap
            else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) newMap = parsed
            if (!newMap) return resolve(false)
            this.paletteMap = newMap
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

    // Convenience: export combined studio snapshot (stacks + palette) as file
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

    // Import combined snapshot file (useful to restore both stacks & palette)
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

    // -------------------------
    // Expose merged appearance for export (useful for UI to add into file store)
    // -------------------------
    getMergedAppearanceForExport() {
      try {
        // return deep clone safe for serialization
        return JSON.parse(JSON.stringify(this.mergedAppearanceData || { data: [] }))
      } catch (e) {
        try { return toRaw(this.mergedAppearanceData || { data: [] }) } catch (ee) { return { data: [] } }
      }
    }
  }
})

export default useStudioStore