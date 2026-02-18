/**
 * Priority Actions Module
 * Pure functions for priority management operations
 * These functions handle layer priority and arrangement
 */
import PriorityService from '@/services/PriorityService'

/**
 * Get priority list for selected element
 * @param {Object} state - Current store state
 * @param {Function} getGroupDescriptionForPart - Function to get group description
 * @returns {Array} Priority list
 */
export function getPriorityListForSelected(state, getGroupDescriptionForPart) {
  const el = state.selectedElement
  if (!el) return []
  return PriorityService.buildPriorityListForStackObject(el, {
    getGroupDescriptionForPart: (p) => getGroupDescriptionForPart(p)
  })
}

/**
 * Update priorities for selected element
 * @param {Object} state - Current store state
 * @param {Array} updates - Array of priority updates
 * @param {Function} getGroupDescriptionForPart - Function to get group description
 * @returns {Object} Updated state
 */
export function updatePrioritiesForSelected(state, updates = [], getGroupDescriptionForPart) {
  const idx = state.selectedIndex
  if (idx < 0 || idx >= state.stacks.length) {
    return { stacks: state.stacks }
  }

  try {
    const el = state.stacks[idx]
    const newEl = PriorityService.applyPriorityUpdatesToStackObject(el, updates)
    const newStacks = [...state.stacks]
    newStacks[idx] = newEl

    return { stacks: newStacks }
  } catch (e) {
    console.error('[priority-actions] updatePrioritiesForSelected failed', e)
    return { stacks: state.stacks }
  }
}

/**
 * Recompute priorities for selected element (alias for getPriorityListForSelected)
 * @param {Object} state - Current store state
 * @param {Function} getGroupDescriptionForPart - Function to get group description
 * @returns {Array} Priority list
 */
export function recomputePrioritiesForSelected(state, getGroupDescriptionForPart) {
  return getPriorityListForSelected(state, getGroupDescriptionForPart)
}

/**
 * Get selected priorities snapshot
 * @param {Object} state - Current store state
 * @returns {Object} Priority snapshot { mapping, ungrouped }
 */
export function getSelectedPrioritiesSnapshot(state) {
  const sel = state.selectedElement
  if (!sel) {
    return { mapping: {}, ungrouped: [] }
  }
  return {
    mapping: sel.PrioritiesMapping || {},
    ungrouped: sel.PrioritiesUngrouped || []
  }
}
