/**
 * Performance utilities - Lightweight replacements for lodash functions
 * Reduces dependency on lodash for better tree-shaking
 */

/**
 * Debounce function execution
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} Debounced function
 */
export function debounce(func, wait = 0) {
  let timeout = null
  let lastArgs = null
  let lastThis = null

  const debounced = function executedFunction(...args) {
    lastArgs = args
    lastThis = this
    const later = () => {
      timeout = null
      if (lastArgs) {
        func.apply(lastThis, lastArgs)
        lastArgs = null
        lastThis = null
      }
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }

  debounced.cancel = () => {
    if (timeout !== null) {
      clearTimeout(timeout)
      timeout = null
    }
    lastArgs = null
    lastThis = null
  }

  debounced.flush = () => {
    if (timeout === null || !lastArgs) return
    clearTimeout(timeout)
    timeout = null
    func.apply(lastThis, lastArgs)
    lastArgs = null
    lastThis = null
  }

  return debounced
}

/**
 * Throttle function execution
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in ms
 * @returns {Function} Throttled function
 */
export function throttle(func, limit = 100) {
  let inThrottle = false
  let timeoutId = null

  const throttled = function executedFunction(...args) {
    if (inThrottle) return
    func.apply(this, args)
    inThrottle = true
    timeoutId = setTimeout(() => {
      inThrottle = false
      timeoutId = null
    }, limit)
  }

  throttled.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    inThrottle = false
  }

  throttled.flush = () => {
    throttled.cancel()
  }

  return throttled
}

/**
 * Deep equality check (simplified version)
 * For full deep equality, consider using lodash-es/isEqual where needed
 */
export function isEqual(a, b) {
  if (a === b) return true
  if (a == null || b == null) return false
  if (typeof a !== typeof b) return false

  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}
