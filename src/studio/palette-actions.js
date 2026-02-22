/**
 * Palette Actions Module
 * Pure functions for palette and color operations
 * These functions modify store state but are organized here for clarity
 */
import * as Palette from '@/services/PaletteService'

/**
 * Apply color to active palette targets
 * @param {Object} state - Current store state
 * @param {string} newColor - Color to apply
 * @param {Function} helpers - Helper functions from store
 * @returns {boolean} True if changes were made
 */
export function applyColorToTargets(state, newColor, helpers) {
  const { paletteModeActive, activePaletteTargets, stacks, findPartByUid,
          _buildLayerEntriesWithCache, _scheduleLayerRefresh, _schedulePartUpdate,
          triggerFocusedPartUpdate, pushHistorySnapshotThrottled } = helpers

  if (!paletteModeActive) return false
  const targets = Array.isArray(activePaletteTargets) ? [...activePaletteTargets] : []
  if (!targets.length) return false

  let changed = false

  for (const t of targets) {
    try {
      let found = null
      if (t.uid) {
        const res = findPartByUid(t.uid)
        found = res?.partRef || null
      }
      if (!found && (typeof t.stackIndex === 'number' && typeof t.partIndex === 'number')) {
        const s = stacks[t.stackIndex]
        if (s && Array.isArray(s.data) && s.data[t.partIndex]) {
          found = s.data[t.partIndex]
        }
      }
      if (!found) continue

      const layerIdx = t.layerIndex
      if (!found.layerEntries) {
        found.layerEntries = _buildLayerEntriesWithCache(found) || []
      }
      if (found && Array.isArray(found.layerEntries) && layerIdx !== null && layerIdx !== undefined && layerIdx >= 0) {
        const entry = found.layerEntries.find((le, i) => {
          if (!le || !le.isColorable) return false
          return found.layerEntries.slice(0, i).filter(e => e?.isColorable).length === layerIdx
        })
        if (entry) {
          try {
            entry.colorText = newColor === undefined || newColor === null ? '' : String(newColor)
            try {
              const resolvedCss = helpers._resolveColorCssFromText(entry.colorText)
              entry.colorCss = resolvedCss
            } catch (e) { entry.colorCss = null }
            changed = true
          } catch (e) { }
        }
      }
    } catch (e) { console.warn(e) }
  }

  if (changed) {
    _scheduleLayerRefresh()
    _schedulePartUpdate()
    triggerFocusedPartUpdate()
    pushHistorySnapshotThrottled()
  }

  return changed
}

/**
 * Apply tag to active palette targets
 * @param {Object} state - Current store state
 * @param {string} tag - Tag to apply
 * @param {Function} helpers - Helper functions from store
 * @returns {boolean} True if changes were made
 */
export function applyTagToTargets(state, tag, helpers) {
  return applyColorToTargets(state, tag, helpers)
}

/**
 * Apply Tag + HLS offset to active palette targets
 * @param {Object} state
 * @param {{tag:string, offset:{h?:number,l?:number,s?:number}}} payload
 * @param {Function} helpers
 * @returns {boolean}
 */
export function applyTagOffsetToTargets(state, payload = {}, helpers) {
  const tag = String(payload?.tag || '').trim()
  if (!tag) return false
  const ref = Palette.formatTagOffsetRef(tag, payload?.offset || {})
  if (!ref) return false
  return applyColorToTargets(state, ref, helpers)
}

/**
 * Reset active targets to plain tag (clear offset)
 * @param {Object} state
 * @param {{tag:string}} payload
 * @param {Function} helpers
 * @returns {boolean}
 */
export function clearTagOffsetOnTargets(state, payload = {}, helpers) {
  const tag = String(payload?.tag || '').trim()
  if (!tag) return false
  return applyColorToTargets(state, tag, helpers)
}

/**
 * Delete palette tag
 * @param {Object} state - Current store state
 * @param {string} tag - Tag to delete
 * @param {Function} helpers - Helper functions from store
 * @returns {boolean} True if tag was removed
 */
export function deleteTagFromPalette(state, tag, helpers) {
  const { paletteMap, focusedPart, stacks, findPartByUid, _updateFocusedPartInPlace,
          _scheduleLayerRefresh, RebuildAllStacksLayerEntriesFromParts,
          _scheduleRefresh, pushHistorySnapshot } = helpers

  if (!tag || !(tag in (paletteMap || {}))) return false

  const fp = focusedPart
  const res = Palette.deletePaletteTagFromStacks(stacks, paletteMap, fp, tag)

  return {
    stacks: res.stacks,
    paletteMap: res.paletteMap,
    _updateFocusedPartInPlace: fp && res.focusedPart,
    _scheduleLayerRefresh: res.removed,
    RebuildAllStacksLayerEntriesFromParts: res.removed,
    _scheduleRefresh: res.removed,
    pushHistorySnapshot: res.removed
  }
}

/**
 * Add saved color
 * @param {Object} state - Current store state
 * @param {string} value - Color value to add
 * @returns {Object} Updated savedColors array
 */
export function addSavedColor(state, value) {
  const { savedColors, _paletteVersion } = state

  return {
    savedColors: [...savedColors, value],
    _paletteVersion: _paletteVersion + 1
  }
}

/**
 * Update saved color
 * @param {Object} state - Current store state
 * @param {number} idx - Index to update
 * @param {string} newValue - New color value
 * @returns {Object} Updated savedColors array
 */
export function updateSavedColor(state, idx, newValue) {
  const { savedColors, _paletteVersion } = state

  const newSavedColors = [...savedColors]
  newSavedColors[idx] = newValue

  return {
    savedColors: newSavedColors,
    _paletteVersion: _paletteVersion + 1
  }
}

/**
 * Delete saved color
 * @param {Object} state - Current store state
 * @param {number} idx - Index to delete
 * @returns {Object} Updated savedColors array
 */
export function deleteSavedColor(state, idx) {
  const { savedColors, _paletteVersion } = state

  const newSavedColors = savedColors.filter((_, i) => i !== idx)

  return {
    savedColors: newSavedColors,
    _paletteVersion: _paletteVersion + 1
  }
}

/**
 * Update palette tag
 * @param {Object} state - Current store state
 * @param {string} tag - Tag to update
 * @param {string} newValue - New tag value
 * @returns {Object} Updated paletteMap
 */
export function updatePaletteTag(state, tag, newValue, helpers) {
  const { paletteMap } = helpers

  if (!tag || !(tag in paletteMap)) return { paletteMap }

  const updatedPaletteMap = Palette.updatePaletteTag(paletteMap, tag, newValue)

  return {
    paletteMap: updatedPaletteMap,
    _scheduleLayerRefresh: true,
    _schedulePartUpdate: true,
    triggerFocusedPartUpdate: true,
    pushHistorySnapshotThrottled: true
  }
}

/**
 * Clear palette
 * @param {Object} state - Current store state
 * @param {Function} helpers - Helper functions from store
 * @returns {Object} Updated state
 */
export function clearPalette(state, helpers) {
  const { paletteMap, _paletteNextCounter, _paletteVersion, pushHistorySnapshot } = helpers

  const newPaletteMap = {}
  const newPaletteNextCounter = _paletteNextCounter

  return {
    paletteMap: newPaletteMap,
    _paletteNextCounter: newPaletteNextCounter,
    _paletteVersion: _paletteVersion + 1,
    pushHistorySnapshot: true
  }
}
