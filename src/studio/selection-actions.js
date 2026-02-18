/**
 * Selection Actions Module
 * Pure functions for multi-layer selection operations
 * These functions handle batch operations on multiple layers
 */

/**
 * Generate unique key for layer identification
 * @param {number} stackIndex - Stack index
 * @param {number} partIndex - Part index
 * @param {number} layerIndex - Layer index
 * @returns {string} Unique key
 */
export function buildLayerKey(stackIndex, partIndex, layerIndex) {
  return `${stackIndex}-${partIndex}-${layerIndex}`
}

/**
 * Toggle layer selection (add or remove)
 * @param {Object} state - Current store state
 * @param {Object} layerInfo - Layer info { stackIndex, partIndex, layerIndex }
 * @returns {Object} Updated selectedLayers array
 */
export function toggleLayerSelection(state, layerInfo) {
  if (!layerInfo || typeof layerInfo.stackIndex !== 'number' ||
      typeof layerInfo.partIndex !== 'number' ||
      typeof layerInfo.layerIndex !== 'number') {
    console.warn('[selection-actions] toggleLayerSelection: invalid layerInfo', layerInfo)
    return { selectedLayers: state.selectedLayers }
  }

  const key = buildLayerKey(layerInfo.stackIndex, layerInfo.partIndex, layerInfo.layerIndex)
  const existingIndex = state.selectedLayers.findIndex(l => l._key === key)

  if (existingIndex >= 0) {
    // Remove from selection
    return { selectedLayers: state.selectedLayers.filter((_, i) => i !== existingIndex) }
  } else {
    // Add to selection
    return {
      selectedLayers: [...state.selectedLayers, {
        stackIndex: layerInfo.stackIndex,
        partIndex: layerInfo.partIndex,
        layerIndex: layerInfo.layerIndex,
        _key: key
      }]
    }
  }
}

/**
 * Check if a layer is currently selected
 * @param {Object} state - Current store state
 * @param {Object} layerInfo - Layer info { stackIndex, partIndex, layerIndex }
 * @returns {boolean} True if selected
 */
export function isLayerSelected(state, layerInfo) {
  if (!layerInfo || typeof layerInfo.stackIndex !== 'number' ||
      typeof layerInfo.partIndex !== 'number' ||
      typeof layerInfo.layerIndex !== 'number') {
    return false
  }

  const key = buildLayerKey(layerInfo.stackIndex, layerInfo.partIndex, layerInfo.layerIndex)
  return state.selectedLayers.some(l => l._key === key)
}

/**
 * Select all layers in the focused part
 * @param {Object} state - Current store state
 * @returns {Object} Updated selectedLayers array
 */
export function selectAllLayers(state) {
  const fp = state.focusedPart
  if (!fp || !Array.isArray(fp.layerEntries)) {
    console.warn('[selection-actions] selectAllLayers: no focused part or layer entries')
    return { selectedLayers: state.selectedLayers }
  }

  const idx = state.focusedPartIndex
  if (idx.stackIndex === null || idx.partIndex === null) {
    console.warn('[selection-actions] selectAllLayers: invalid focused part index')
    return { selectedLayers: state.selectedLayers }
  }

  // Select all layers in the focused part
  const newSelections = fp.layerEntries.map((layer) => {
    const key = buildLayerKey(idx.stackIndex, idx.partIndex, layer.layerIndex)
    return {
      stackIndex: idx.stackIndex,
      partIndex: idx.partIndex,
      layerIndex: layer.layerIndex,
      _key: key
    }
  })

  return { selectedLayers: newSelections }
}

/**
 * Clear all layer selections
 * @returns {Object} Updated selectedLayers array
 */
export function clearLayerSelection() {
  return { selectedLayers: [] }
}

/**
 * Select a range of layers (Shift+Click)
 * @param {Object} state - Current store state
 * @param {number} fromIndex - Starting layer index
 * @param {number} toIndex - Ending layer index
 * @returns {Object} Updated selectedLayers array
 */
export function selectLayerRange(state, fromIndex, toIndex) {
  const fp = state.focusedPart
  if (!fp || !Array.isArray(fp.layerEntries)) {
    console.warn('[selection-actions] selectLayerRange: no focused part or layer entries')
    return { selectedLayers: state.selectedLayers }
  }

  const idx = state.focusedPartIndex
  if (idx.stackIndex === null || idx.partIndex === null) {
    console.warn('[selection-actions] selectLayerRange: invalid focused part index')
    return { selectedLayers: state.selectedLayers }
  }

  const start = Math.min(fromIndex, toIndex)
  const end = Math.max(fromIndex, toIndex)

  const newSelections = []
  for (let layerIndex = start; layerIndex <= end && layerIndex < fp.layerEntries.length; layerIndex++) {
    const key = buildLayerKey(idx.stackIndex, idx.partIndex, layerIndex)
    // Only add if not already selected
    if (!state.selectedLayers.some(l => l._key === key)) {
      newSelections.push({
        stackIndex: idx.stackIndex,
        partIndex: idx.partIndex,
        layerIndex: layerIndex,
        _key: key
      })
    }
  }

  return { selectedLayers: [...state.selectedLayers, ...newSelections] }
}

/**
 * Get full data for selected layers
 * @param {Object} state - Current store state
 * @returns {Array} Selected layers with full data
 */
export function getSelectedLayersData(state) {
  const results = []

  for (const sel of state.selectedLayers) {
    try {
      if (sel.stackIndex < 0 || sel.stackIndex >= state.stacks.length) continue

      const stack = state.stacks[sel.stackIndex]
      if (!stack || !Array.isArray(stack.data)) continue

      if (sel.partIndex < 0 || sel.partIndex >= stack.data.length) continue

      const part = stack.data[sel.partIndex]
      if (!part || !Array.isArray(part.layerEntries)) continue

      const layer = part.layerEntries.find(l => l.layerIndex === sel.layerIndex)
      if (!layer) continue

      results.push({
        selection: sel,
        part: part,
        layer: layer
      })
    } catch (e) {
      console.warn('[selection-actions] getSelectedLayersData: error processing selection', sel, e)
    }
  }

  return results
}

/**
 * Validate if a batch operation can be performed on targets
 * @param {string} operation - Operation type
 * @param {Array} targets - Target layers
 * @returns {Object} Validation result { valid, reason }
 */
export function validateBatchOperation(operation, targets) {
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
}

/**
 * Batch update opacity for selected layers
 * @param {Object} state - Current store state
 * @param {number} value - Opacity value (0-100)
 * @param {string} mode - 'absolute' or 'relative'
 * @returns {Object} Updated state with changed count
 */
export function batchUpdateOpacity(state, value, mode = 'absolute') {
  const targets = getSelectedLayersData(state)
  const validation = validateBatchOperation('opacity', targets)

  if (!validation.valid) {
    console.warn('[selection-actions] batchUpdateOpacity:', validation.reason)
    return { success: false, reason: validation.reason, selectedLayers: state.selectedLayers }
  }

  let updatedCount = 0

  for (const target of targets) {
    try {
      const { layer } = target

      let newOpacity
      if (mode === 'relative') {
        const currentOpacity = (layer.opacity != null ? layer.opacity : 1) * 100
        newOpacity = Math.max(0, Math.min(100, currentOpacity + value)) / 100
      } else {
        newOpacity = Math.max(0, Math.min(100, value)) / 100
      }

      layer.opacity = newOpacity
      updatedCount++
    } catch (e) {
      console.warn('[selection-actions] batchUpdateOpacity: error updating layer', target, e)
    }
  }

  return { success: true, updatedCount, selectedLayers: state.selectedLayers }
}

/**
 * Batch update offset for selected layers
 * @param {Object} state - Current store state
 * @param {number} x - X offset
 * @param {number} y - Y offset
 * @param {string} mode - 'absolute' or 'relative'
 * @returns {Object} Updated state with changed count
 */
export function batchUpdateOffset(state, x, y, mode = 'absolute') {
  const targets = getSelectedLayersData(state)
  const validation = validateBatchOperation('offset', targets)

  if (!validation.valid) {
    console.warn('[selection-actions] batchUpdateOffset:', validation.reason)
    return { success: false, reason: validation.reason, selectedLayers: state.selectedLayers }
  }

  let updatedCount = 0

  for (const target of targets) {
    try {
      const { layer } = target

      if (mode === 'relative') {
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
      console.warn('[selection-actions] batchUpdateOffset: error updating layer', target, e)
    }
  }

  return { success: true, updatedCount, selectedLayers: state.selectedLayers }
}

/**
 * Batch update color for selected layers
 * @param {Object} state - Current store state
 * @param {string} colorValue - Color value or tag
 * @param {Function} _resolveColorCssFromText - Function to resolve color
 * @returns {Object} Updated state with changed count
 */
export function batchUpdateColor(state, colorValue, _resolveColorCssFromText) {
  const targets = getSelectedLayersData(state)
  const validation = validateBatchOperation('color', targets)

  if (!validation.valid) {
    console.warn('[selection-actions] batchUpdateColor:', validation.reason)
    return { success: false, reason: validation.reason, selectedLayers: state.selectedLayers }
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

      layer.colorText = colorValue === undefined || colorValue === null ? '' : String(colorValue)

      // Update colorCss
      try {
        const resolvedCss = _resolveColorCssFromText(layer.colorText)
        layer.colorCss = resolvedCss
      } catch (e) {
        layer.colorCss = null
      }

      updatedCount++
    } catch (e) {
      console.warn('[selection-actions] batchUpdateColor: error updating layer', target, e)
    }
  }

  return { success: true, updatedCount, skippedCount, selectedLayers: state.selectedLayers }
}

/**
 * Batch update priority for selected layers
 * @param {Object} state - Current store state
 * @param {number} value - Priority value
 * @param {string} mode - 'absolute' or 'relative'
 * @returns {Object} Updated state with changed count
 */
export function batchUpdatePriority(state, value, mode = 'absolute') {
  const targets = getSelectedLayersData(state)
  const validation = validateBatchOperation('priority', targets)

  if (!validation.valid) {
    console.warn('[selection-actions] batchUpdatePriority:', validation.reason)
    return { success: false, reason: validation.reason, selectedLayers: state.selectedLayers }
  }

  let updatedCount = 0

  for (const target of targets) {
    try {
      const { layer } = target

      if (mode === 'relative') {
        const currentPriority = layer.overridePriority != null ? layer.overridePriority : (layer.defaultPriority || 0)
        const newPriority = currentPriority + (value || 0)
        layer.overridePriority = newPriority
        layer.isOverridePriority = true
      } else {
        layer.overridePriority = value != null ? value : (layer.defaultPriority || 0)
        layer.isOverridePriority = true
      }

      updatedCount++
    } catch (e) {
      console.warn('[selection-actions] batchUpdatePriority: error updating layer', target, e)
    }
  }

  return { success: true, updatedCount, selectedLayers: state.selectedLayers }
}

/**
 * Generic batch operation handler
 * @param {Object} state - Current store state
 * @param {string} operation - Operation type
 * @param {Object} payload - Operation payload
 * @param {Function} _resolveColorCssFromText - Function to resolve color
 * @returns {Object} Operation result
 */
export function applyBatchEdit(state, operation, payload, _resolveColorCssFromText) {
  switch (operation) {
    case 'opacity':
      return batchUpdateOpacity(state, payload.value, payload.mode)
    case 'offset':
      return batchUpdateOffset(state, payload.x, payload.y, payload.mode)
    case 'color':
      return batchUpdateColor(state, payload.value, _resolveColorCssFromText)
    case 'priority':
      return batchUpdatePriority(state, payload.value, payload.mode)
    default:
      console.warn('[selection-actions] applyBatchEdit: unknown operation', operation)
      return { success: false, reason: 'Unknown operation', selectedLayers: state.selectedLayers }
  }
}

/**
 * Toggle selection mode between single and multiple
 * @param {Object} state - Current store state
 * @returns {Object} Updated state
 */
export function toggleSelectionMode(state) {
  const newMode = state.selectionMode === 'single' ? 'multiple' : 'single'
  const newSelections = newMode === 'single' ? [] : state.selectedLayers

  return {
    selectionMode: newMode,
    selectedLayers: newSelections
  }
}
