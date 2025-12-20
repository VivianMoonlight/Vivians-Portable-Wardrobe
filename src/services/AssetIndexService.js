/**
 * AssetIndexService (pure functions) - OPTIMIZED
 *
 * Exposes pure helpers to build and query asset index data. 
 * 
 * PERFORMANCE OPTIMIZATIONS:
 *  - Pre-builds group name index for O(1) lookup
 *  - Caches asset lookups per part
 *  - Uses Map for faster name matching
 *  - Normalizes group names once during index build
 */

import { AssetApi } from '@/utils/AssetApi'

// =============================================
// Performance utilities
// =============================================

function deepClone(v) {
  if (v === null || v === undefined) return v
  if (typeof v !== 'object') return v

  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(v)
    } catch (e) { }
  }

  try {
    return JSON.parse(JSON.stringify(v))
  } catch (e) {
    if (Array.isArray(v)) return v.slice()
    if (v && typeof v === 'object') return Object.assign({}, v)
    return v
  }
}

// =============================================
// Cached index structures
// =============================================

/**
 * Cache for group entry lookups
 * Key: normalized group name (lowercase)
 * Value: { key, data } entry from assetGroupsRaw
 */
let groupEntryCache = new Map()
let groupEntryCacheVersion = 0

/**
 * Cache for resolved assets per part
 * WeakMap allows GC of parts
 */
const resolvedAssetCache = new WeakMap()

/**
 * Cache version tracker - increment when asset data changes
 */
let assetDataVersion = 0

// =============================================
// Index building
// =============================================

/**
 * Build an assetIndex object from assetGroupsRaw
 * Also builds the group entry cache for O(1) lookups
 * @param {Array} assetGroupsRaw
 * @returns {Object} assetIndex: { groupName: [assets... ] }
 */
export function buildAssetIndexFromGroups(assetGroupsRaw = []) {
  const idx = {}

  // Clear and rebuild group entry cache
  groupEntryCache = new Map()
  groupEntryCacheVersion++
  assetDataVersion++

  for (const item of assetGroupsRaw || []) {
    let groupName = null
    if (item && item.data) {
      groupName = item.data.Name || item.data.name || item.key || null
    } else {
      groupName = item && item.key ? item.key : null
    }

    let assets = []
    if (item && item.data) {
      if (Array.isArray(item.data.Asset) && item.data.Asset.length) {
        assets = item.data.Asset.slice()
      } else if (Array.isArray(item.data)) {
        assets = item.data.slice()
      } else if (Array.isArray(item.data.Items)) {
        assets = item.data.Items.slice()
      } else {
        const cand = Object.values(item.data).find(v => Array.isArray(v))
        if (Array.isArray(cand)) assets = cand.slice()
      }
    }

    if (groupName) {
      idx[groupName] = assets

      // Add to group entry cache with multiple key formats
      const normalizedName = String(groupName).toLowerCase()
      groupEntryCache.set(normalizedName, item)
      groupEntryCache.set(groupName, item)

      // Also cache by data. Name if different from key
      if (item && item.data && item.data.Name && item.data.Name !== groupName) {
        groupEntryCache.set(String(item.data.Name).toLowerCase(), item)
        groupEntryCache.set(item.data.Name, item)
      }
    }
  }

  return idx
}

/**
 * Async loader: fetch asset data from global AssetGroupMap and build index
 * @returns {Promise<{assetGroupsRaw:Array, assetIndex:Object}>}
 */
export async function loadAssetData() {
  try {
    const arr = await AssetApi.fetchAssetData()
    const raw = Array.isArray(arr) ? arr : []
    const idx = buildAssetIndexFromGroups(raw)
    return { assetGroupsRaw: raw, assetIndex: idx }
  } catch (e) {
    console.warn('[AssetIndexService] loadAssetData failed', e)
    return { assetGroupsRaw: [], assetIndex: {} }
  }
}

// =============================================
// Group lookup - OPTIMIZED with O(1) cache
// =============================================

/**
 * Extract group name from a part
 * @param {Object} part
 * @returns {string|null}
 */
function extractGroupNameFromPart(part) {
  if (!part) return null
  return part.Group || (part.Asset && part.Asset.Group && (part.Asset.Group.Name || part.Asset.Group.name)) || null
}

/**
 * Find the raw asset group entry (key,data) that matches part's group - O(1)
 * @param {Array} assetGroupsRaw
 * @param {Object} assetIndex
 * @param {Object} part
 * @returns {Object|null}
 */
export function findAssetGroupEntryForPart(assetGroupsRaw = [], assetIndex = {}, part) {
  if (!part) return null

  const rawGroup = extractGroupNameFromPart(part)
  if (!rawGroup) return null

  // Try cache first (O(1))
  const cached = groupEntryCache.get(rawGroup) || groupEntryCache.get(String(rawGroup).toLowerCase())
  if (cached) return cached

  // Fallback to linear search (rare case - cache miss)
  for (const entry of assetGroupsRaw || []) {
    if (!entry) continue
    const nameA = entry.key
    const nameB = entry.data?.Name || entry.data?.name
    if (String(nameA) === String(rawGroup) || String(nameB) === String(rawGroup)) {
      // Add to cache for future lookups
      groupEntryCache.set(rawGroup, entry)
      groupEntryCache.set(String(rawGroup).toLowerCase(), entry)
      return entry
    }
  }

  // Check assetIndex as fallback
  if (assetIndex && assetIndex[rawGroup]) {
    const fallbackEntry = { key: rawGroup, data: { Name: rawGroup } }
    groupEntryCache.set(rawGroup, fallbackEntry)
    return fallbackEntry
  }

  return null
}

/**
 * Normalize group data to an array of assets
 */
export function normalizeAssetsFromGroupData(groupData) {
  if (!groupData) return []
  if (Array.isArray(groupData.Asset) && groupData.Asset.length) return groupData.Asset.slice()
  if (Array.isArray(groupData.Assets) && groupData.Assets.length) return groupData.Assets.slice()
  if (Array.isArray(groupData.Items) && groupData.Items.length) return groupData.Items.slice()
  if (Array.isArray(groupData)) return groupData.slice()
  const cand = Object.values(groupData).find(v => Array.isArray(v))
  if (Array.isArray(cand)) return cand.slice()
  return []
}

/**
 * Get candidate assets for a part - uses cached group lookup
 * @param {Object} assetIndex
 * @param {Array} assetGroupsRaw
 * @param {Object} part
 * @returns {Array}
 */
export function getAssetCandidatesForPart(assetIndex = {}, assetGroupsRaw = [], part) {
  if (!part) return []

  const groupEntry = findAssetGroupEntryForPart(assetGroupsRaw, assetIndex, part)
  if (groupEntry && groupEntry.data) {
    const assets = normalizeAssetsFromGroupData(groupEntry.data)
    if (Array.isArray(assets) && assets.length) return assets
  }

  try {
    const rawGroupName = extractGroupNameFromPart(part)
    if (rawGroupName && assetIndex && Array.isArray(assetIndex[rawGroupName])) {
      return assetIndex[rawGroupName].slice()
    }
    return groupEntry ? (normalizeAssetsFromGroupData(groupEntry.data) || []) : []
  } catch (e) {
    return []
  }
}

// =============================================
// Asset resolution - OPTIMIZED with caching
// =============================================

/**
 * Build a cache key for resolved asset lookup
 */
function buildAssetCacheKey(part) {
  if (!part) return null
  const group = extractGroupNameFromPart(part)
  const name = part.Name || part.Asset?.Name || null
  if (!group || !name) return null
  return `${group}::${name}`
}

/**
 * Resolve the best matching asset object for a part - with caching
 * @param {Object} assetIndex
 * @param {Array} assetGroupsRaw
 * @param {Object} part
 * @returns {Object|null}
 */
export function resolveAssetForPart(assetIndex = {}, assetGroupsRaw = [], part) {
  if (!part) return null

  // Check WeakMap cache first
  const cached = resolvedAssetCache.get(part)
  if (cached !== undefined) {
    // cached can be null (meaning we looked and found nothing)
    return cached
  }

  const assets = getAssetCandidatesForPart(assetIndex, assetGroupsRaw, part)
  const partName = part.Name || part.Asset?.Name || null

  if (!Array.isArray(assets) || assets.length === 0 || !partName) {
    resolvedAssetCache.set(part, null)
    return null
  }

  // Build a name lookup map for the assets in this group
  let match = null
  for (const a of assets) {
    if (!a) continue
    const assetName = typeof a === 'string' ? a : (a.Name || a.name || a.key || '')
    if (String(assetName) === String(partName)) {
      match = a
      break
    }
  }

  resolvedAssetCache.set(part, match)
  return match
}

/**
 * Get group description
 */
export function getGroupDescriptionForPart(assetGroupsRaw = [], assetIndex = {}, part) {
  if (!part) return null
  const groupEntry = findAssetGroupEntryForPart(assetGroupsRaw, assetIndex, part)
  if (groupEntry && groupEntry.data) {
    return groupEntry.data.Description || groupEntry.data.Desc || groupEntry.data.description || null
  }
  return part.Asset?.Group?.Description || null
}

/**
 * Search/match helper
 */
export function matchesSearchForPart(assetIndex = {}, assetGroupsRaw = [], part, term) {
  if (!term) return true
  const t = String(term).trim().toLowerCase()
  if (!t) return true

  const asset = resolveAssetForPart(assetIndex, assetGroupsRaw, part)
  const desc = (asset?.Description || asset?.Desc || asset?.description || '').toString().toLowerCase()
  const groupDesc = (getGroupDescriptionForPart(assetGroupsRaw, assetIndex, part) || '').toString().toLowerCase()
  const propStr = part?.Property ? JSON.stringify(part.Property).toLowerCase() : ''

  return desc.includes(t) || groupDesc.includes(t) || propStr.includes(t)
}

/**
 * Clear all caches (call when asset data is reloaded)
 */
export function clearAssetIndexCaches() {
  groupEntryCache = new Map()
  groupEntryCacheVersion++
  assetDataVersion++
  // Note: WeakMap (resolvedAssetCache) doesn't need clearing - 
  // it will GC naturally when parts are no longer referenced
}

/**
 * Get current cache version (for debugging/monitoring)
 */
export function getAssetDataVersion() {
  return assetDataVersion
}

export default {
  buildAssetIndexFromGroups,
  loadAssetData,
  findAssetGroupEntryForPart,
  normalizeAssetsFromGroupData,
  getAssetCandidatesForPart,
  resolveAssetForPart,
  getGroupDescriptionForPart,
  matchesSearchForPart,
  clearAssetIndexCaches,
  getAssetDataVersion
}