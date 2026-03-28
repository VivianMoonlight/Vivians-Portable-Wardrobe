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
 * @param {Object} options - Throttle options
 * @param {boolean} options.leading - Execute on the leading edge (default: true)
 * @param {boolean} options.trailing - Execute latest call on trailing edge (default: false)
 * @returns {Function} Throttled function
 */
export function throttle(func, limit = 100, options = {}) {
  const { leading = true, trailing = false } = options || {}
  let timeoutId = null
  let pendingArgs = null
  let pendingThis = null
  let hasPendingTrailingCall = false

  const clearPending = () => {
    pendingArgs = null
    pendingThis = null
    hasPendingTrailingCall = false
  }

  const timerHandler = () => {
    timeoutId = null

    if (trailing && hasPendingTrailingCall && pendingArgs) {
      const args = pendingArgs
      const ctx = pendingThis
      clearPending()
      func.apply(ctx, args)
      return
    }

    clearPending()
  }

  const throttled = function executedFunction(...args) {
    if (timeoutId === null) {
      if (leading) {
        func.apply(this, args)
        clearPending()
      } else if (trailing) {
        pendingArgs = args
        pendingThis = this
        hasPendingTrailingCall = true
      }

      timeoutId = setTimeout(timerHandler, limit)
      return
    }

    if (!trailing) return

    pendingArgs = args
    pendingThis = this
    hasPendingTrailingCall = true
  }

  throttled.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    clearPending()
  }

  throttled.flush = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }

    if (trailing && hasPendingTrailingCall && pendingArgs) {
      const args = pendingArgs
      const ctx = pendingThis
      clearPending()
      func.apply(ctx, args)
      return
    }

    clearPending()
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
