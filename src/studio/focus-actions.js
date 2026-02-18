/**
 * Focus Actions Module
 * Pure functions for part and property focus operations
 * These functions modify store state but are organized here for clarity
 */

/**
 * Focus on a specific part
 * @param {Object} state - Current store state
 * @param {Object} part - Part to focus
 * @param {Function} helpers - Helper functions from store
 * @returns {Object} Updated state
 */
export function focusOnPart(state, part, helpers) {
  const { focusedPartIndex, findPartByUid, ensurePartUid, clearLayerSelection } = helpers

  if (!part) {
    return {
      focusedPartIndex: { stackIndex: null, partIndex: null }
    }
  }

  const uid = ensurePartUid(part)
  const found = findPartByUid(uid)

  if (found) {
    // Check if focusing a different part
    const isDifferentPart = focusedPartIndex.stackIndex !== found.stackIndex ||
      focusedPartIndex.partIndex !== found.partIndex

    const newFocusedPartIndex = {
      stackIndex: found.stackIndex,
      partIndex: found.partIndex
    }

    // Clear selections when switching parts
    if (isDifferentPart) {
      return {
        focusedPartIndex: newFocusedPartIndex,
        clearLayerSelection: true
      }
    }

    return { focusedPartIndex: newFocusedPartIndex }
  }

  // Try to find by structure if not found by uid
  const partJson = JSON.stringify(part)
  for (let si = 0; si < state.stacks.length; si++) {
    const stack = state.stacks[si]
    if (!stack || !Array.isArray(stack.data)) continue
    for (let pi = 0; pi < stack.data.length; pi++) {
      try {
        if (JSON.stringify(stack.data[pi]) === partJson) {
          const isDifferentPart = focusedPartIndex.stackIndex !== si ||
            focusedPartIndex.partIndex !== pi

          return {
            focusedPartIndex: { stackIndex: si, partIndex: pi },
            clearLayerSelection: isDifferentPart
          }
        }
      } catch (e) { continue }
    }
  }

  console.warn('[focus-actions] focusPart: part not found in stacks')
  return {
    focusedPartIndex: { stackIndex: null, partIndex: null }
  }
}

/**
 * Clear all focus
 * @param {Function} helpers - Helper functions from store
 * @returns {Object} Updated state
 */
export function clearFocusState(helpers) {
  const { clearFocusedProperty, focusedPartIndex, clearLayerSelection } = helpers

  return {
    focusedPartIndex: { stackIndex: null, partIndex: null },
    clearFocusedProperty: true,
    clearLayerSelection: true
  }
}

/**
 * Set focused property
 * @param {Object} state - Current store state
 * @param {Object} payload - Property to focus
 * @returns {Object} Updated state
 */
export function setFocusedProperty(state, payload, helpers) {
  const { focusedPartIndex, triggerFocusedPartUpdate } = helpers

  const newFocusedProperty = payload && Object.keys(payload).length > 0 ? payload : null

  return {
    focusedProperty: newFocusedProperty,
    triggerFocusedPartUpdate: true
  }
}

/**
 * Clear focused property
 * @returns {Object} Updated state
 */
export function clearFocusedPropertyState() {
  return {
    focusedProperty: null
  }
}

/**
 * Set replace target
 * @param {Object} state - Current store state
 * @param {Object} item - Item to replace
 * @param {string} key - Property key
 * @param {boolean} isEmpty - Whether it's an empty slot
 * @returns {Object} Updated state
 */
export function setReplaceTargetState(state, item, key, isEmpty = false) {
  return {
    replaceTarget: {
      active: true,
      key,
      item,
      isEmpty
    }
  }
}

/**
 * Clear replace target
 * @returns {Object} Updated state
 */
export function clearReplaceTargetState() {
  return {
    replaceTarget: {
      active: false,
      key: null,
      item: null,
      isEmpty: false
    }
  }
}

/**
 * Toggle layer manager
 * @param {Object} state - Current store state
 * @param {boolean} val - New active state
 * @returns {Object} Updated state
 */
export function toggleLayerManagerState(state, val) {
  return {
    layerManagerActive: typeof val === 'boolean' ? val : !state.layerManagerActive
  }
}
