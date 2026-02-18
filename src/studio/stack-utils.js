/**
 * Stack Utilities
 * Reusable functions for stack operations
 * These are designed to be used by studioStore without requiring full module extraction
 */

/**
 * Clone a stack element deeply
 * @param {Object} element - Stack element to clone
 * @returns {Object} Cloned element
 */
export function cloneStackElement(element) {
  if (!element) return null
  const clone = { ...element, data: Array.isArray(element.data) ? [...element.data] : element.data }
  return clone
}

/**
 * Validate stack element index
 * @param {Array} stacks - Stacks array
 * @param {number} idx - Index to validate
 * @returns {boolean} True if index is valid
 */
export function isValidStackIndex(stacks, idx) {
  return idx >= 0 && idx < stacks.length
}

/**
 * Find stack by element
 * @param {Array} stacks - Stacks array
 * @param {Object} element - Element to find
 * @returns {number|null} Index or null
 */
export function findStackIndex(stacks, element) {
  if (!element || !Array.isArray(stacks)) return null
  return stacks.findIndex(s => s === element)
}

/**
 * Calculate new selected index after element removal
 * @param {number} currentSelectedIndex - Current selection
 * @param {number} removedIndex - Index being removed
 * @param {number} stacksLength - Current stacks length
 * @returns {number} New selected index
 */
export function calculateSelectedIndexAfterRemoval(currentSelectedIndex, removedIndex, stacksLength) {
  if (currentSelectedIndex === removedIndex) {
    return stacksLength === 0 ? -1 : Math.max(0, Math.min(currentSelectedIndex, stacksLength - 1))
  } else if (currentSelectedIndex > removedIndex) {
    return Math.max(-1, currentSelectedIndex - 1)
  }
  return currentSelectedIndex
}

/**
 * Calculate new selected index after element move
 * @param {number} currentSelectedIndex - Current selection
 * @param {number} fromIdx - From index
 * @param {number} toIdx - To index
 * @returns {number} New selected index
 */
export function calculateSelectedIndexAfterMove(currentSelectedIndex, fromIdx, toIdx) {
  if (currentSelectedIndex === fromIdx) {
    return toIdx
  } else if (fromIdx < currentSelectedIndex && toIdx >= currentSelectedIndex) {
    return currentSelectedIndex - 1
  } else if (fromIdx > currentSelectedIndex && toIdx <= currentSelectedIndex) {
    return currentSelectedIndex + 1
  }
  return currentSelectedIndex
}
