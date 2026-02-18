/**
 * Clone utilities with structuredClone optimization
 * Provides deep and shallow cloning with fallback strategies
 */

/**
 * Fast deep clone using structuredClone when available, fallback to JSON
 * @param {any} v - Value to clone
 * @returns {any} Cloned value
 */
export function deepClone(v) {
  if (v === null || v === undefined) return v
  if (typeof v !== 'object') return v

  // Use structuredClone for modern browsers (much faster than JSON for large objects)
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(v)
    } catch (e) {
      // Fall through to JSON fallback
    }
  }

  // JSON fallback
  try {
    return JSON.parse(JSON.stringify(v))
  } catch (e) {
    // Shallow fallback for non-serializable
    if (Array.isArray(v)) return v.slice()
    if (v && typeof v === 'object') return Object.assign({}, v)
    return v
  }
}

/**
 * Shallow clone for objects where we only need top-level copy
 * @param {any} v - Value to clone
 * @returns {any} Shallow cloned value
 */
export function shallowClone(v) {
  if (v === null || v === undefined) return v
  if (Array.isArray(v)) return v.slice()
  if (typeof v === 'object') return Object.assign({}, v)
  return v
}

// Alias for backward compatibility
export { deepClone as fastClone }
