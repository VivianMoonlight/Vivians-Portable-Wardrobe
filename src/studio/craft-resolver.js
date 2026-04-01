import { deepClone } from '@/utils/clone.js'
import { hostWindow } from '@/utils/host-window.js'

function normalizeText(value) {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

function extractGroupName(partLike) {
  if (!partLike || typeof partLike !== 'object') return ''
  return normalizeText(
    partLike.Group ||
    partLike.Asset?.Group?.Name ||
    partLike.Asset?.Group?.name ||
    partLike.ItemProperty?.Asset?.Group?.Name ||
    partLike.ItemProperty?.Asset?.Group?.name
  )
}

function extractCraftItemName(craftEntry) {
  if (!craftEntry || typeof craftEntry !== 'object') return ''
  return normalizeText(craftEntry.Item || craftEntry.Asset?.Name || craftEntry.ItemProperty?.Asset?.Name)
}

function resolveAssetGet(assetGet) {
  if (typeof assetGet === 'function') return assetGet
  if (typeof hostWindow?.AssetGet === 'function') return hostWindow.AssetGet.bind(hostWindow)
  return null
}

function normalizeCraftColor(rawColor, cloneFn) {
  const cloner = typeof cloneFn === 'function' ? cloneFn : deepClone
  if (rawColor === undefined || rawColor === null) return undefined

  if (Array.isArray(rawColor)) {
    return cloner(rawColor)
  }

  if (typeof rawColor === 'string') {
    const text = rawColor.trim()
    if (!text) return undefined
    if (!text.includes(',')) return text

    const list = text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    if (list.length === 0) return undefined
    if (list.length === 1) return list[0]
    return list
  }

  return cloner(rawColor)
}

function extractCraftTypeRecord(craftEntry, cloneFn) {
  if (!craftEntry || typeof craftEntry !== 'object') return null
  const cloner = typeof cloneFn === 'function' ? cloneFn : deepClone
  const candidates = [
    craftEntry.TypeRecord,
    craftEntry.Property?.TypeRecord,
    craftEntry.ItemProperty?.TypeRecord
  ]

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    return cloner(candidate)
  }

  return null
}

function validateGroupMatch(craftEntry, groupName, player, assetGetFn) {
  const expectedGroup = normalizeText(groupName)
  if (!expectedGroup) return false

  const directGroup = extractGroupName(craftEntry)
  if (directGroup && directGroup === expectedGroup) {
    return true
  }

  const itemName = extractCraftItemName(craftEntry)
  if (!itemName) return false

  const family = normalizeText(player?.AssetFamily)
  if (!family || !assetGetFn) return false

  try {
    const resolved = assetGetFn(family, expectedGroup, itemName)
    if (!resolved) return false
    const resolvedName = normalizeText(resolved.Name || resolved.name)
    const resolvedGroup = normalizeText(resolved.Group?.Name || resolved.Group?.name)
    return resolvedName === itemName && resolvedGroup === expectedGroup
  } catch (e) {
    return false
  }
}

export function readPlayerCrafting(player = null) {
  const target = player || hostWindow?.Player || null
  const list = target?.Crafting
  return Array.isArray(list) ? list : []
}

export function resolveCraftForAssetSlot({
  assetName,
  groupName,
  player = null,
  playerCrafting = null,
  assetGet = null,
  cloneFn = deepClone
} = {}) {
  const normalizedAssetName = normalizeText(assetName)
  const normalizedGroupName = normalizeText(groupName)
  if (!normalizedAssetName || !normalizedGroupName) return null

  const targetPlayer = player || hostWindow?.Player || null
  const craftingList = Array.isArray(playerCrafting) ? playerCrafting : readPlayerCrafting(targetPlayer)
  if (!Array.isArray(craftingList) || craftingList.length === 0) return null

  const assetGetFn = resolveAssetGet(assetGet)
  const cloner = typeof cloneFn === 'function' ? cloneFn : deepClone

  for (const entry of craftingList) {
    if (!entry || typeof entry !== 'object') continue
    const itemName = extractCraftItemName(entry)
    if (!itemName || itemName !== normalizedAssetName) continue
    if (!validateGroupMatch(entry, normalizedGroupName, targetPlayer, assetGetFn)) continue
    return cloner(entry)
  }

  return null
}

export function applyCraftVisualToPart(part, craftEntry, cloneFn = deepClone) {
  if (!part || typeof part !== 'object' || !craftEntry || typeof craftEntry !== 'object') {
    return part
  }

  const cloner = typeof cloneFn === 'function' ? cloneFn : deepClone
  const normalizedColor = normalizeCraftColor(craftEntry.Color, cloner)
  if (normalizedColor !== undefined) {
    part.Color = normalizedColor
  }

  const craftTypeRecord = extractCraftTypeRecord(craftEntry, cloner)
  if (craftTypeRecord) {
    const prevProperty = (part.Property && typeof part.Property === 'object' && !Array.isArray(part.Property))
      ? cloner(part.Property)
      : {}
    const prevTypeRecord = (prevProperty.TypeRecord && typeof prevProperty.TypeRecord === 'object' && !Array.isArray(prevProperty.TypeRecord))
      ? cloner(prevProperty.TypeRecord)
      : {}

    prevProperty.TypeRecord = {
      ...prevTypeRecord,
      ...craftTypeRecord
    }
    part.Property = prevProperty
  }

  return part
}

export function applyPlayerCraftingToBundle(bundle, {
  player = null,
  playerCrafting = null,
  assetGet = null,
  cloneFn = deepClone
} = {}) {
  const source = Array.isArray(bundle) ? bundle : []
  const cloner = typeof cloneFn === 'function' ? cloneFn : deepClone
  if (source.length === 0) return []

  const targetPlayer = player || hostWindow?.Player || null
  const craftingList = Array.isArray(playerCrafting) ? playerCrafting : readPlayerCrafting(targetPlayer)
  const out = []

  for (const part of source) {
    const nextPart = cloner(part)
    if (!nextPart || typeof nextPart !== 'object') {
      out.push(nextPart)
      continue
    }

    const assetName = normalizeText(nextPart.Name || nextPart.Asset?.Name)
    const groupName = extractGroupName(nextPart)
    if (!assetName || !groupName) {
      out.push(nextPart)
      continue
    }

    const resolvedCraft = resolveCraftForAssetSlot({
      assetName,
      groupName,
      player: targetPlayer,
      playerCrafting: craftingList,
      assetGet,
      cloneFn: cloner
    })

    if (resolvedCraft) {
      nextPart.Craft = resolvedCraft
      applyCraftVisualToPart(nextPart, resolvedCraft, cloner)
    }

    out.push(nextPart)
  }

  return out
}
