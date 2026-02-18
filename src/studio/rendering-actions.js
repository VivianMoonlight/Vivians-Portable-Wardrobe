/**
 * Rendering Actions Module
 * Pure functions for rendering and refresh operations
 * These functions modify store state but are organized here for clarity
 */

/**
 * Trigger merged appearance refresh
 * @param {Object} state - Current store state
 * @param {Function} helpers - Helper functions from store
 * @returns {Object} Updated state
 */
export function triggerMergedRefresh(state, helpers) {
  const { _pendingMergedRefresh, _doRefreshMergedAppearanceData,
          renderer, previewRenderer, useOptimizedRenderer,
          _scheduleRefresh } = helpers

  // Cancel any pending scheduled refresh
  _pendingMergedRefresh = false

  _doRefreshMergedAppearanceData()

  return { _pendingMergedRefresh }
}

/**
 * Internal: actual refresh logic
 * @param {Object} state - Current store state
 * @param {Function} helpers - Helper functions from store
 */
export function doRefreshMergedData(state, helpers) {
  const { renderer, previewRenderer, useOptimizedRenderer,
          translatedLayerEntries, stacks, paletteMap,
          expandedAppearanceForRendering, refreshMergedAppearanceData: triggerRefresh } = helpers

  // Choose renderer based on config
  const activeRenderer = useOptimizedRenderer ? previewRenderer : renderer

  try {
    // Remove canvas before re-rendering
    activeRenderer.removeCanvas(refreshMergedAppearanceData)
  } catch (e) {
    console.warn(e)
  }

  // Reconstruct parts from attached layerEntries (if present) before stacking
  const reconstructedStacks = stacks.map(el => {
    const data = Array.isArray(el.data) ? el.data : []
    return {
      ...el,
      data: data.map(p => ({
        ...p,
        layerEntries: Array.isArray(p.layerEntries) && p.layerEntries.length > 0
          ? p.layerEntries
          : (translatedLayerEntries[p._uid] || [])
      }))
    }
  })

  refreshMergedAppearanceData.data = expandedAppearanceForRendering(reconstructedStacks, paletteMap)
}

/**
 * Rebuild layer entries from parts
 * @param {Object} state - Current store state
 * @returns {Object} Updated state with rebuilt layer entries
 */
export function rebuildLayerEntries(state, helpers) {
  const { stacks, _scheduleLayerRefresh, _schedulePartUpdate, triggerFocusedPartUpdate } = helpers

  return {
    _scheduleLayerRefresh: true,
    _schedulePartUpdate: true,
    triggerFocusedPartUpdate: true
  }
}
