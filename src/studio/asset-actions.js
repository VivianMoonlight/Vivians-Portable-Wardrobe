/**
 * Asset Actions Module
 * Pure functions for asset operations
 * These functions handle asset loading, searching, and resolving
 */
import * as AssetIndex from '@/services/AssetIndexService'

/**
 * Load asset data
 * @returns {Promise<Object>} Asset data { assetGroupsRaw, assetIndex }
 */
export async function loadAssetData() {
  const res = await AssetIndex.loadAssetData()
  return res
}

/**
 * Find assets group for a part
 * @param {Object} state - Current store state
 * @param {Object} part - Part to find group for
 * @returns {Array} Asset candidates
 */
export function findAssetsGroupForPart(state, part) {
  return AssetIndex.getAssetCandidatesForPart(
    state.assetIndex,
    state.assetGroupsRaw,
    part
  )
}

/**
 * Find asset group entry for a part
 * @param {Object} state - Current store state
 * @param {Object} part - Part to find entry for
 * @returns {Object|null} Asset group entry
 */
export function findAssetGroupEntryForPart(state, part) {
  return AssetIndex.findAssetGroupEntryForPart(
    state.assetGroupsRaw,
    state.assetIndex,
    part
  )
}

/**
 * Normalize assets from group data
 * @param {Object} groupData - Group data to normalize
 * @returns {Array} Normalized assets
 */
export function normalizeAssetsFromGroupData(groupData) {
  return AssetIndex.normalizeAssetsFromGroupData(groupData)
}

/**
 * Get asset candidates for a part
 * @param {Object} state - Current store state
 * @param {Object} part - Part to get candidates for
 * @returns {Array} Asset candidates
 */
export function getAssetCandidatesForPart(state, part) {
  return AssetIndex.getAssetCandidatesForPart(
    state.assetIndex,
    state.assetGroupsRaw,
    part
  )
}

/**
 * Resolve asset for a part
 * @param {Object} state - Current store state
 * @param {Object} part - Part to resolve asset for
 * @returns {Object|null} Resolved asset
 */
export function resolveAssetForPart(state, part) {
  return AssetIndex.resolveAssetForPart(
    state.assetIndex,
    state.assetGroupsRaw,
    part
  )
}

/**
 * Get group description for a part
 * @param {Object} state - Current store state
 * @param {Object} part - Part to get group description for
 * @returns {string} Group description
 */
export function getGroupDescriptionForPart(state, part) {
  return AssetIndex.getGroupDescriptionForPart(
    state.assetGroupsRaw,
    state.assetIndex,
    part
  )
}

/**
 * Check if part matches search term
 * @param {Object} state - Current store state
 * @param {Object} part - Part to check
 * @param {string} term - Search term
 * @returns {boolean} True if matches
 */
export function matchesSearchForPart(state, part, term) {
  return AssetIndex.matchesSearchForPart(
    state.assetIndex,
    state.assetGroupsRaw,
    part,
    term
  )
}

/**
 * Apply asset to selected stack
 * @param {Object} state - Current store state
 * @param {Object} asset - Asset to apply
 * @param {Object} replaceTarget - Optional replace target { active, key, item, isEmpty }
 * @param {Function} helpers - Helper functions
 * @returns {Object} Updated state
 */
export function applyAssetToSelectedStack(state, asset, replaceTarget = null, helpers) {
  const { ensurePartUid, _buildLayerEntriesWithCache, fastClone } = helpers

  if (!asset) {
    return { stacks: state.stacks, focusedPartIndex: state.focusedPartIndex }
  }

  const sidx = state.selectedIndex
  if (typeof sidx !== 'number' || sidx < 0 || sidx >= state.stacks.length) {
    console.warn('[asset-actions] applyAssetToSelectedStack: no selected stack')
    return { stacks: state.stacks, focusedPartIndex: state.focusedPartIndex }
  }

  try {
    const newPart = {
      Name: asset.Name,
      Group: (asset.Group && (typeof asset.Group === 'string'
        ? asset.Group
        : (asset.Group.Name || asset.Group.name))) || undefined,
      Color: asset.DefaultColor ?? asset.DefaultColour ?? asset.Default ?? null
    }

    try { ensurePartUid(newPart) } catch (e) { console.warn(e) }

    let entries = []
    try {
      entries = _buildLayerEntriesWithCache(newPart) || []
    } catch (e) {
      entries = []
    }
    newPart.layerEntries = fastClone(entries)

    const newStacks = fastClone(state.stacks)
    const sel = newStacks[sidx] || { data: [] }
    const parts = Array.isArray(sel.data) ? sel.data.slice() : []

    let replaced = false
    if (replaceTarget && !replaceTarget.isEmpty && replaceTarget.item) {
      try {
        const origJson = JSON.stringify(replaceTarget.item)
        for (let i = 0; i < parts.length; i++) {
          try {
            if (JSON.stringify(parts[i]) === origJson) {
              parts[i] = fastClone(newPart)
              replaced = true
              break
            }
          } catch (pe) { /* ignore */ }
        }
      } catch (e) { console.warn(e) }
    }

    if (!replaced) {
      parts.push(fastClone(newPart))
    }

    newStacks[sidx] = Object.assign({}, newStacks[sidx] || {}, { data: parts })

    const newFocused = parts.find(p => p.Name === newPart.Name && (p.Group === newPart.Group))
      || parts[parts.length - 1]
    const partIdx = parts.indexOf(newFocused)
    const newFocusedPartIndex = partIdx >= 0
      ? { stackIndex: sidx, partIndex: partIdx }
      : state.focusedPartIndex

    return {
      stacks: newStacks,
      focusedPartIndex: newFocusedPartIndex
    }
  } catch (err) {
    console.error('[asset-actions] applyAssetToSelectedStack failed', err)
    return { stacks: state.stacks, focusedPartIndex: state.focusedPartIndex }
  }
}
