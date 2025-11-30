/**
 * AssetIndexService (pure functions)
 *
 * Exposes pure helpers to build and query asset index data.
 * - loadAssetData: async helper to fetch and build index (returns data, index)
 * - buildAssetIndexFromGroups: build index from assetGroupsRaw
 * - findAssetGroupEntryForPart, getAssetCandidatesForPart, resolveAssetForPart, getGroupDescriptionForPart, matchesSearchForPart
 *
 * These functions do not modify any external store; they return values for caller to write into state.
 */

import { AssetApi } from '@/utils/AssetApi'

function deepClone(v) {
  try { return JSON.parse(JSON.stringify(v)) } catch (e) {
    if (Array.isArray(v)) return v.slice()
    if (v && typeof v === 'object') return Object.assign({}, v)
    return v
  }
}

/**
 * Build an assetIndex object from assetGroupsRaw
 * @param {Array} assetGroupsRaw
 * @returns {Object} assetIndex: { groupName: [assets...] }
 */
export function buildAssetIndexFromGroups(assetGroupsRaw = []) {
  const idx = {}
  for (const item of assetGroupsRaw || []) {
    let groupName = null
    if (item && item.data) {
      groupName = item.data.Name || item.data.name || item.key || null
    } else {
      groupName = item && item.key ? item.key : null
    }

    let assets = []
    if (item && item.data) {
      if (Array.isArray(item.data.Asset) && item.data.Asset.length) assets = item.data.Asset.slice()
      else if (Array.isArray(item.data)) assets = item.data.slice()
      else if (Array.isArray(item.data.Items)) assets = item.data.Items.slice()
      else {
        const cand = Object.values(item.data).find(v => Array.isArray(v))
        if (Array.isArray(cand)) assets = cand.slice()
      }
    }
    if (groupName) idx[groupName] = assets
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

/**
 * Find the raw asset group entry (key,data) that matches part's group
 * @param {Array} assetGroupsRaw
 * @param {Object} assetIndex
 * @param {Object} part
 * @returns {Object|null}
 */
export function findAssetGroupEntryForPart(assetGroupsRaw = [], assetIndex = {}, part) {
  if (!part) return null
  const rawGroup = part.Group || (part.Asset && part.Asset.Group && (part.Asset.Group.Name || part.Asset.Group.name)) || null
  if (!rawGroup) return null

  for (const entry of assetGroupsRaw || []) {
    if (!entry) continue
    const nameA = entry.key
    const nameB = entry.data?.Name || entry.data?.name
    if (String(nameA) === String(rawGroup) || String(nameB) === String(rawGroup)) return entry
  }
  if (assetIndex && assetIndex[rawGroup]) return { key: rawGroup, data: { Name: rawGroup } }
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
 * Get candidate assets for a part
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
    const rawGroupName = part.Group || (part.Asset && part.Asset.Group && (part.Asset.Group.Name || part.Asset.Group.name))
    if (rawGroupName && assetIndex && Array.isArray(assetIndex[rawGroupName])) return assetIndex[rawGroupName].slice()
    else return (groupEntry ? (normalizeAssetsFromGroupData(groupEntry.data) || []) : [])
  } catch (e) {
    return []
  }
}

/**
 * Resolve the best matching asset object for a part
 * @param {Object} assetIndex
 * @param {Array} assetGroupsRaw
 * @param {Object} part
 * @returns {Object|null}
 */
export function resolveAssetForPart(assetIndex = {}, assetGroupsRaw = [], part) {
  if (!part) return null
  const assets = getAssetCandidatesForPart(assetIndex, assetGroupsRaw, part)
  const partName = part.Name || part.Asset?.Name || null
  if (!Array.isArray(assets) || assets.length === 0) return null
  if (!partName) return null
  const match = assets.find(a => {
    if (!a) return false
    if (typeof a === 'string') return String(a) === String(partName)
    return String(a.Name || a.name || a.key || '') === String(partName)
  })
  return match || null
}

/**
 * Get group description
 */
export function getGroupDescriptionForPart(assetGroupsRaw = [], assetIndex = {}, part) {
  if (!part) return null
  const groupEntry = findAssetGroupEntryForPart(assetGroupsRaw, assetIndex, part)
  if (groupEntry && groupEntry.data) return groupEntry.data.Description || groupEntry.data.Desc || groupEntry.data.description || null
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

export default {
  buildAssetIndexFromGroups,
  loadAssetData,
  findAssetGroupEntryForPart,
  normalizeAssetsFromGroupData,
  getAssetCandidatesForPart,
  resolveAssetForPart,
  getGroupDescriptionForPart,
  matchesSearchForPart
}