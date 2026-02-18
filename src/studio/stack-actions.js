/**
 * Stack Actions Module
 * Pure functions for stack element operations
 * These functions modify store state but are organized here for clarity
 */
import * as Palette from '@/services/PaletteService'

/**
 * Add element to stacks with palette and layer entries applied
 * @param {Object} state - Current store state
 * @param {Object} element - Element to add
 * @param {Function} helpers - Helper functions from store
 * @returns {Object} Updated state and the added element
 */
export function addElementToStacks(state, element, helpers) {
  const { fastClone, ensurePartUid, _buildLayerEntriesWithCache,
          _updateLayerEntriesColorCss, refreshMergedAppearanceData,
          pushHistorySnapshot } = helpers

  let copy
  if (!state.assetIndex || Object.keys(state.assetIndex).length === 0 ||
      !state.assetGroupsRaw || state.assetGroupsRaw.length === 0) {
    // Would need loadAssetData - cannot be pure function
    return { element: null, error: 'Assets not loaded' }
  }

  copy = fastClone(element)

  try {
    const res = Palette.applyPaletteToElement(copy, state.paletteMap, state._paletteNextCounter)
    copy = res.element
    const newPaletteMap = res.paletteMap
    const newPaletteNextCounter = res.paletteCounter
    const newPaletteVersion = state._paletteVersion + 1

    // Attach LayerEntries for each part
    try {
      if (Array.isArray(copy.data)) {
        copy.data = copy.data.map((p) => {
          try {
            if (!p) return p
            try { ensurePartUid(p) } catch (e) { console.warn(e) }

            if (!Array.isArray(p.layerEntries) || p.layerEntries.length === 0) {
              const entries = _buildLayerEntriesWithCache(p) || []
              p.layerEntries = fastClone(entries)
            } else {
              _updateLayerEntriesColorCss(p.layerEntries)
            }
          } catch (e) { /* ignore per-item errors */ }
          return p
        })
      }
    } catch (e) { console.warn('[stack-actions] attach layerEntries failed', e) }

    try {
      copy.PrioritiesMapping = {}
      copy.PrioritiesUngrouped = []
    } catch (e) { console.warn(e) }

    const newStacks = [...state.stacks, copy]
    const newSelectedIndex = newStacks.length - 1

    return {
      stacks: newStacks,
      selectedIndex: newSelectedIndex,
      paletteMap: newPaletteMap,
      _paletteNextCounter: newPaletteNextCounter,
      _paletteVersion: newPaletteVersion
    }
  } catch (e) {
    console.warn('[stack-actions] addElement failed', e)
    return { element: null, error: e.message }
  }
}

/**
 * Remove element from stacks
 * @param {Object} state - Current store state
 * @param {number} idx - Index to remove
 * @param {Function} helpers - Helper functions from store
 * @returns {Object} Updated state
 */
export function removeElementFromStacks(state, idx, helpers) {
  const { renderer, stacks, selectedIndex, focusedPartIndex, pushHistorySnapshot } = helpers

  if (idx < 0 || idx >= stacks.length) {
    return { stacks }
  }

  // Push to history before removing
  pushHistorySnapshot()

  try {
    const item = stacks[idx]
    if (item) renderer.removeCanvas({ data: item.data, type: 'outfit' })
  } catch (e) { console.warn(e) }

  const newStacks = stacks.filter((_, i) => i !== idx)

  let newSelectedIndex = selectedIndex
  if (selectedIndex === idx) {
    newSelectedIndex = newStacks.length === 0 ? -1 : Math.max(0, Math.min(selectedIndex, newStacks.length - 1))
  } else if (selectedIndex > idx) {
    newSelectedIndex = Math.max(-1, selectedIndex - 1)
  }

  let newFocusedPartIndex = focusedPartIndex
  if (focusedPartIndex.stackIndex === idx) {
    newFocusedPartIndex = { stackIndex: null, partIndex: null }
  } else if (focusedPartIndex.stackIndex > idx) {
    newFocusedPartIndex = { ...focusedPartIndex, stackIndex: focusedPartIndex.stackIndex - 1 }
  }

  return {
    stacks: newStacks,
    selectedIndex: newSelectedIndex,
    focusedPartIndex: newFocusedPartIndex
  }
}

/**
 * Move element between positions
 * @param {Object} state - Current store state
 * @param {number} fromIdx - From index
 * @param {number} toIdx - To index
 * @param {Function} helpers - Helper functions from store
 * @returns {Object} Updated state
 */
export function moveElementInStacks(state, fromIdx, toIdx, helpers) {
  const { stacks, selectedIndex, focusedPartIndex, _scheduleRefresh } = helpers

  if (fromIdx === toIdx) return { stacks }

  if (fromIdx < 0 || fromIdx >= stacks.length) return { stacks }
  if (toIdx < 0 || toIdx >= stacks.length) return { stacks }

  const [item] = stacks.splice(fromIdx, 1)
  const newStacks = [...stacks.slice(0, toIdx), item, ...stacks.slice(toIdx)]

  // Update selectedIndex
  let newSelectedIndex = selectedIndex
  if (selectedIndex === fromIdx) {
    newSelectedIndex = toIdx
  } else if (fromIdx < selectedIndex && toIdx >= selectedIndex) {
    newSelectedIndex = selectedIndex - 1
  } else if (fromIdx > selectedIndex && toIdx <= selectedIndex) {
    newSelectedIndex = selectedIndex + 1
  }

  // Update focusedPartIndex
  let newFocusedPartIndex = focusedPartIndex
  if (focusedPartIndex.stackIndex === fromIdx) {
    newFocusedPartIndex = { stackIndex: toIdx, partIndex: focusedPartIndex.partIndex }
  } else if (fromIdx < focusedPartIndex.stackIndex && toIdx >= focusedPartIndex.stackIndex) {
    newFocusedPartIndex = { ...focusedPartIndex, stackIndex: focusedPartIndex.stackIndex - 1 }
  } else if (fromIdx > focusedPartIndex.stackIndex && toIdx <= focusedPartIndex.stackIndex) {
    newFocusedPartIndex = { ...focusedPartIndex, stackIndex: focusedPartIndex.stackIndex + 1 }
  }

  return {
    stacks: newStacks,
    selectedIndex: newSelectedIndex,
    focusedPartIndex: newFocusedPartIndex
  }
}

/**
 * Select element by index
 * @param {Object} state - Current store state
 * @param {number} idx - Index to select
 * @returns {Object} Updated state
 */
export function selectElementInStacks(state, idx, helpers) {
  const { clearFocusedProperty, focusedPartIndex } = helpers

  if (idx === -1) {
    return {
      selectedIndex: -1,
      focusedPartIndex: { stackIndex: null, partIndex: null }
    }
  }

  if (idx < 0 || idx >= state.stacks.length) {
    return { selectedIndex: idx }
  }

  return {
    selectedIndex: idx,
    focusedPartIndex: { stackIndex: null, partIndex: null },
    clearFocusedProperty: true
  }
}

/**
 * Clear all stacks
 * @param {Object} state - Current store state
 * @param {Function} helpers - Helper functions from store
 * @returns {Object} Updated state
 */
export function clearAllStacks(state, helpers) {
  const { renderer, clearFocusedProperty, focusedPartIndex } = helpers

  try {
    state.stacks.forEach(it => { renderer.removeCanvas({ data: it.data, type: 'outfit' }) })
  } catch (e) { console.warn(e) }

  return {
    stacks: [],
    selectedIndex: -1,
    mergedAppearanceData: [],
    focusedPartIndex: { stackIndex: null, partIndex: null },
    clearFocusedProperty: true
  }
}
