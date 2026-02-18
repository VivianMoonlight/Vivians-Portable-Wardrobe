/**
 * Layer Actions Module
 * Pure functions for layer operations
 * These functions handle layer entries and layer-related transformations
 */
import * as LayerTranslator from '@/services/LayerTranslator'
import { fastClone } from '@/utils/clone.js'

/**
 * Simple hash for part content (used for caching layer entries)
 */
function hashPartForCache(part) {
  if (!part) return ''
  try {
    const relevant = {
      Name: part.Name,
      Group: part.Group,
      Color: part.Color,
      Property: part.Property
    }
    return JSON.stringify(relevant)
  } catch (e) {
    return ''
  }
}

/**
 * Build layer entries for a part with caching support
 * @param {Object} part - Part to build layer entries for
 * @param {Object} cache - Cache map (WeakMap)
 * @param {number} paletteVersion - Current palette version for cache invalidation
 * @param {boolean} forceRebuild - Force rebuild regardless of cache
 * @param {Function} deps - Dependency functions
 * @returns {Array} Layer entries
 */
export function buildLayerEntriesWithCache(part, cache, paletteVersion, forceRebuild = false, deps) {
  if (!part) return []

  const { paletteSnapshot, resolveAssetForPart, getAssetCandidatesForPart, findAssetGroupEntryForPart } = deps

  // Check cache
  if (!forceRebuild) {
    const cached = cache.get(part)
    if (cached && cached.paletteVersion === paletteVersion) {
      const currentHash = hashPartForCache(part)
      if (cached.hash === currentHash) {
        return cached.entries
      }
    }
  }

  // Build new entries
  const entryDeps = {
    paletteSnapshot: () => paletteSnapshot,
    resolveAssetForPart: (p) => resolveAssetForPart(p),
    getAssetCandidatesForPart: (p) => getAssetCandidatesForPart(p),
    findAssetGroupEntryForPart: (p) => findAssetGroupEntryForPart(p)
  }
  const entries = LayerTranslator.buildLayerEntriesForPart(part, entryDeps)

  // Store in cache
  cache.set(part, {
    entries: entries,
    hash: hashPartForCache(part),
    paletteVersion: paletteVersion
  })

  return entries
}

/**
 * Update a specific part's layer entries
 * @param {Object} part - Part to update
 * @param {Array} entries - New layer entries
 * @param {Function} resolveAssetForPart - Function to resolve asset
 * @returns {Object|null} Updated part or null
 */
export function updatePartFromLayerEntries(part, entries, resolveAssetForPart) {
  if (!entries || !part) return null

  try {
    const asset = resolveAssetForPart(part)
    const newPart = LayerTranslator.reconstructPartFromLayerEntries(entries, part, { originalAsset: asset })
    if (!newPart) return null

    const uid = part._uid
    if (uid) {
      try { newPart._uid = uid } catch (e) { console.warn(e) }
    }

    return newPart
  } catch (e) {
    console.error('[layer-actions] updatePartFromLayerEntries failed', e)
    return null
  }
}

/**
 * Update all stacks' parts from their layer entries
 * @param {Object} state - Current store state
 * @param {Function} helpers - Helper functions
 * @returns {Object} Updated state
 */
export function updateAllStacksFromLayerEntries(state, helpers) {
  const { stacks, resolveAssetForPart, _buildLayerEntriesWithCache } = helpers

  try {
    const newStacks = stacks.map(el => {
      const copy = fastClone(el)
      if (Array.isArray(copy.data)) {
        copy.data = copy.data.map(p => {
          try {
            if (p && Array.isArray(p.layerEntries)) {
              const updatedPart = updatePartFromLayerEntries(p, p.layerEntries, resolveAssetForPart)
              if (updatedPart) {
                updatedPart.layerEntries = _buildLayerEntriesWithCache(p, true)
                return updatedPart
              }
            }
          } catch (e) { /* ignore */ }
          return p
        })
      }
      return copy
    })

    return { stacks: newStacks }
  } catch (e) {
    console.error('[layer-actions] updateAllStacksFromLayerEntries failed', e)
    return { stacks }
  }
}

/**
 * Rebuild all layer entries from parts
 * @param {Object} state - Current store state
 * @param {Function} helpers - Helper functions
 * @returns {Object} Updated state
 */
export function rebuildAllLayerEntries(state, helpers) {
  const { stacks, _buildLayerEntriesWithCache } = helpers

  try {
    const newStacks = stacks.map(el => {
      const copy = fastClone(el)
      if (Array.isArray(copy.data)) {
        copy.data = copy.data.map(p => {
          try {
            if (p) {
              p.layerEntries = _buildLayerEntriesWithCache(p, true) || []
            }
          } catch (e) { /* ignore */ }
          return p
        })
      }
      return copy
    })

    return { stacks: newStacks }
  } catch (e) {
    console.error('[layer-actions] rebuildAllLayerEntries failed', e)
    return { stacks }
  }
}

/**
 * Update colorCss for layer entries in-place
 * @param {Array} layerEntries - Layer entries to update
 * @param {Function} _resolveColorCssFromText - Function to resolve color
 */
export function updateLayerEntriesColorCss(layerEntries, _resolveColorCssFromText) {
  if (!Array.isArray(layerEntries)) return
  for (const entry of layerEntries) {
    if (!entry) continue
    if (entry.colorText !== undefined && entry.colorText !== null) {
      entry.colorCss = _resolveColorCssFromText(entry.colorText)
    }
  }
}

/**
 * Schedule layer refresh flag
 * @returns {Object} State update with refresh flag
 */
export function scheduleLayerRefresh() {
  return { _scheduleLayerRefresh: true }
}

/**
 * Schedule part update flag
 * @returns {Object} State update with update flag
 */
export function schedulePartUpdate() {
  return { _schedulePartUpdate: true }
}

/**
 * Trigger focused part update flag
 * @returns {Object} State update with update flag
 */
export function triggerFocusedPartUpdateFlag() {
  return { triggerFocusedPartUpdate: true }
}
