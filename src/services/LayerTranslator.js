// src/services/LayerTranslator.js

/**
 * LayerTranslator (pure function) - OPTIMIZED
 *
 * Exports:
 *   - buildLayerEntriesForPart(part, deps)
 *   - reconstructPartFromLayerEntries(entries, originalPart, extra)
 *
 * PERFORMANCE OPTIMIZATIONS:
 *   - Uses structuredClone when available
 *   - Caches layer display names per asset
 *   - Pre-builds index maps for O(1) lookups
 *   - Reduces redundant array. indexOf() calls
 */

import { hostWindow, doc } from '@/utils/host-window';
import { deepClone } from '@/utils/clone.js'

function looksLikeCssColor(s) {
  if (!s || typeof s !== 'string') return false
  const str = s.trim().toLowerCase()
  if (!str) return false
  if (str.startsWith('#')) return true
  if (str.startsWith('rgb') || str.startsWith('hsl')) return true
  const basic = ['red', 'blue', 'green', 'black', 'white', 'gray', 'grey', 'yellow', 'orange', 'purple', 'pink', 'brown']
  if (basic.includes(str)) return true
  return false
}

function extractPrimaryCssColor(v) {
  if (!v) return null
  if (typeof v === 'string') return v
  if (Array.isArray(v)) {
    for (const el of v) {
      if (typeof el === 'string') return el
      if (typeof el === 'number') return String(el)
    }
    return v.length ? String(v[0]) : null
  }
  return String(v)
}

function getLayerOverridesArray(propertyLayerOverrides) {
  if (!propertyLayerOverrides) return []
  if (Array.isArray(propertyLayerOverrides)) return propertyLayerOverrides
  if (typeof propertyLayerOverrides === 'object' && propertyLayerOverrides !== null) {
    return [propertyLayerOverrides]
  }
  return []
}

function extractDrawingValue(val, layerName) {
  if (val === undefined || val === null) return null
  if (typeof val === 'object') {
    if ('' in val) return val['']
    if (layerName && layerName in val) return val[layerName]
    const vs = Object.values(val)
    return vs.length ? vs[0] : null
  }
  return val
}

// =============================================
// Layer Display Name Cache
// =============================================

/**
 * Cache for layer display names
 * Key format: `${assetDynamicGroupName}::${assetName}::${layerName}`
 */
let layerDisplayNameCache = {}
let layerDisplayGroupNameCache = {}
let itemColorLayerNamesInitialized = false
let openedColorLayerNamesApi = false

/**
 * Initialize ItemColorLayerNames cache (called once)
 */
export async function ensureItemColorLayerNamesLoaded() {
  //if (itemColorLayerNamesInitialized) return

  try {
    if (typeof hostWindow.ItemColorLoad === 'function') {
      if (hostWindow.Player && Array.isArray(hostWindow.Player.Appearance) && hostWindow.Player.Appearance.length > 0) {
        if (typeof ItemColorLayerNames === 'undefined' || !ItemColorLayerNames || !ItemColorLayerNames.cache || Object.keys(ItemColorLayerNames.cache).length === 0) {
          try {
            openedColorLayerNamesApi = true
            await hostWindow.ItemColorLoad(hostWindow.Player, hostWindow.Player.Appearance[0], 10000, 10000, 0, 0, true)
            await ItemColorLayerNames.buildCache()
            await ItemColorGroupNames.buildCache()
            layerDisplayNameCache= structuredClone(ItemColorLayerNames.cache || {})
            layerDisplayGroupNameCache= structuredClone(ItemColorGroupNames.cache || {})
          } catch (e) { }
        }
      }
    }
    itemColorLayerNamesInitialized = true
  } catch (e) {
    itemColorLayerNamesInitialized = true
  }
}


export function cleanUpItemColorLayerNamesLoad() {
  hostWindow.ItemColorFireExit(false)
}
/**
 * Get layer display name with caching
 * @param {Object} asset 
 * @param {Object} layer 
 * @returns {string}
 */

function getLayerDisplayName(asset, layer) {
  const layerName = layer.Name || layer.name || ''

  if (!asset) return layerName

  const cacheKey = `${asset.DynamicGroupName || ''}::${asset.Name || ''}::${layerName}`
  const externalKey = (asset.DynamicGroupName || '') + (asset.Name || '') + (layerName)

  const displayName = layerDisplayNameCache[externalKey] || layerName

  // Check our cache first
  /* if (layerDisplayNameCache.has(cacheKey)) {
    return layerDisplayNameCache.get(cacheKey)
  } */

  // Ensure external cache is loaded
  // The process shoule be handled by caller to avoid multiple calls
  // ensureItemColorLayerNamesLoaded()

  // Try to get from ItemColorLayerNames
  /* let displayName = layerName
  try {
    const externalKey = (asset.DynamicGroupName || '') + (asset.Name || '') + (layerName)
    if (typeof ItemColorLayerNames !== 'undefined' && ItemColorLayerNames && ItemColorLayerNames.cache) {
      const v = ItemColorLayerNames.cache[externalKey]
      if (v) displayName = v
    }
  } catch (e) { }

  // Store in our cache
  layerDisplayNameCache.set(cacheKey, displayName)
 */

  return displayName
}

function getLayerDisplayGroupName(asset, layer) {
  if (!layer.ColorGroup) return null
  const groupName = layer.ColorGroup
  const externalKey = (asset.DynamicGroupName || '') + (asset.Name || '') + (groupName)

  const displayName = layerDisplayGroupNameCache[externalKey] || groupName
  return displayName
}

function getLayerDisplayNameWithGroup(asset, layer) {
  const layerDisplayName = getLayerDisplayName(asset, layer)
  const groupDisplayName = getLayerDisplayGroupName(asset, layer)
  if (groupDisplayName) {
    return `${groupDisplayName} - ${layerDisplayName}`
  }
  return layerDisplayName
}

/**
 * Clear the display name cache (call when asset data changes)
 */
export function clearLayerDisplayNameCache() {
  layerDisplayNameCache.clear()
  itemColorLayerNamesInitialized = false
}

// =============================================
// Drawing Left/Top extraction
// =============================================

function getDrawingLTforLayer(layerIdx, layerName, part, assetLayers) {
  const LOs = getLayerOverridesArray(part?.Property?.LayerOverrides)
  let left = null
  let top = null

  const L = (layerIdx >= 0 && Array.isArray(LOs) && layerIdx < LOs.length) ? LOs[layerIdx] : null
  if (L) {
    if ('DrawingLeft' in L) {
      left = extractDrawingValue(L.DrawingLeft, layerName)
    }
    if ('DrawingTop' in L) {
      top = extractDrawingValue(L.DrawingTop, layerName)
    }
  }

  if ((left == null || top == null) && layerName) {
    for (const O of LOs) {
      if (O && typeof O === 'object') {
        if (O.DrawingLeft && typeof O.DrawingLeft === 'object' && layerName in O.DrawingLeft) left = O.DrawingLeft[layerName]
        if (O.DrawingTop && typeof O.DrawingTop === 'object' && layerName in O.DrawingTop) top = O.DrawingTop[layerName]
      }
    }
  }

  try {
    if ((left == null || top == null) && Array.isArray(assetLayers)) {
      const layerObj = (layerIdx >= 0 && layerIdx < assetLayers.length) ? assetLayers[layerIdx] : null
      if (layerObj) {
        if (left == null && 'DrawingLeft' in layerObj) {
          left = extractDrawingValue(layerObj.DrawingLeft, layerName)
        }
        if (top == null && 'DrawingTop' in layerObj) {
          top = extractDrawingValue(layerObj.DrawingTop, layerName)
        }
      }

      if ((left == null || top == null) && layerName) {
        for (const Ls of assetLayers) {
          if (Ls && typeof Ls === 'object') {
            if (left == null && Ls.DrawingLeft && typeof Ls.DrawingLeft === 'object' && ('' in Ls.DrawingLeft || layerName in Ls.DrawingLeft)) {
              left = extractDrawingValue(Ls.DrawingLeft, layerName)
            }
            if (top == null && Ls.DrawingTop && typeof Ls.DrawingTop === 'object' && ('' in Ls.DrawingTop || layerName in Ls.DrawingTop)) {
              top = extractDrawingValue(Ls.DrawingTop, layerName)
            }
            if (left != null && top != null) break
          }
        }
      }
    }
  } catch (e) { }

  return { drawingLeft: left, drawingTop: top }
}

// =============================================
// Main build function - OPTIMIZED
// =============================================

export function buildLayerEntriesForPart(part, deps = {}) {
  if (!part) return []

  // Get palette snapshot once (cached by caller)
  const paletteSnapshot = (typeof deps.paletteSnapshot === 'function') ? deps.paletteSnapshot() : {}

  // Helper to resolve tag color
  const resolveTagColorIfAny = (text) => {
    if (!text || typeof text !== 'string') return null
    if (text in paletteSnapshot) {
      const v = paletteSnapshot[text]
      return extractPrimaryCssColor(v)
    }
    return null
  }

  // Resolve asset
  let asset = null
  try {
    if (typeof deps.resolveAssetForPart === 'function') {
      asset = deps.resolveAssetForPart(part)
    }
  } catch (e) { asset = null }

  if (!asset || !Array.isArray(asset.Layer)) {
    return []
  }

  const layers = asset.Layer
  const layerCount = layers.length

  // Pre-build layer index map for O(1) lookup
  const layerIndexMap = new Map()
  for (let i = 0; i < layerCount; i++) {
    layerIndexMap.set(layers[i], i)
  }

  // Separate main and sub layers
  const mainLayers = []
  const subLayers = []
  for (let i = 0; i < layerCount; i++) {
    const l = layers[i]
    if (l.CopyLayerColor) {
      subLayers.push(l)
    } else {
      mainLayers.push(l)
    }
  }

  // Build colorable main layers list
  const colorableMainLayers = mainLayers.filter(l => l.AllowColorize && !l.HideColoring)

  // Build mainMap with pre-computed indices
  const mainMap = new Map()
  for (const ml of mainLayers) {
    const name = ml.Name || ml.name || ''
    mainMap.set(name, {
      layer: ml,
      name,
      displayName: getLayerDisplayNameWithGroup(asset, ml),
      groupDisplayName: getLayerDisplayGroupName(asset, ml),
      isColorable: ! !(ml.AllowColorize && !ml.HideColoring),
      subLayers: [],
      layerIndex: layerIndexMap.get(ml)
    })
  }

  

  // Also create lowercase lookup for case-insensitive matching
  const mainMapLower = new Map()
  for (const [k, v] of mainMap.entries()) {
    mainMapLower.set(k.toLowerCase(), v)
  }

  // Associate sublayers with main layers
  const orphanSubLayers = []
  for (const sl of subLayers) {
    const parentNameRaw = String(sl.CopyLayerColor || '')
    const entry = {
      layer: sl,
      name: sl.Name || sl.name || '',
      displayName: sl.Name || sl.name || '',
      layerIndex: layerIndexMap.get(sl)
    }

    if (mainMap.has(parentNameRaw)) {
      mainMap.get(parentNameRaw).subLayers.push(entry)
    } else {
      // Try case-insensitive match
      const found = mainMapLower.get(parentNameRaw.toLowerCase())
      if (found) {
        found.subLayers.push(entry)
      } else {
        orphanSubLayers.push(entry)
      }
    }
  }

  // Process colors
  const partColors = Array.isArray(part.Color) ? part.Color : (part.Color ? [part.Color] : [])

  // Process opacities
  const rawOpacities = (part.Property && Array.isArray(part.Property.Opacity))
    ? part.Property.Opacity
    : (part.Property && part.Property.Opacity !== undefined ? [part.Property.Opacity] : [])

  const opacities = new Array(layerCount)
  if (rawOpacities.length === 1) {
    const v = rawOpacities[0]
    for (let i = 0; i < layerCount; i++) opacities[i] = v
  } else {
    for (let i = 0; i < layerCount; i++) {
      if (i < rawOpacities.length && rawOpacities[i] !== undefined && rawOpacities[i] !== null) {
        opacities[i] = rawOpacities[i]
      } else {
        opacities[i] = 1
      }
    }
  }

  // Parse OverridePriority into a Map for O(1) lookup
  const rawOverride = part?.Property?.OverridePriority
  const overrideMap = new Map()
  const overrideMapLower = new Map()
  const globalOverrideIsNumber = (typeof rawOverride === 'number' || (typeof rawOverride === 'string' && String(rawOverride).trim() !== '' && !isNaN(Number(rawOverride))))
  const globalOverrideNumber = globalOverrideIsNumber ? Number(rawOverride) : null
  try {
    if (rawOverride !== undefined && rawOverride !== null) {
      if (typeof rawOverride === 'number' || (typeof rawOverride === 'string' && String(rawOverride).trim() !== '' && !isNaN(Number(rawOverride)))) {
        const num = Number(rawOverride)
        if (mainLayers.length === 1) {
          const name = mainLayers[0].Name || mainLayers[0].name || ''
          overrideMap.set(name, num)
          overrideMapLower.set(name.toLowerCase(), num)
        } else if (layerCount === 1) {
          const name = layers[0].Name || layers[0].name || ''
          overrideMap.set(name, num)
          overrideMapLower.set(name.toLowerCase(), num)
        }
      } else if (typeof rawOverride === 'object') {
        for (const k of Object.keys(rawOverride)) {
          const v = rawOverride[k]
          if (v === undefined || v === null) continue
          const num = Number(v)
          if (!Number.isNaN(num)) {
            overrideMap.set(String(k), num)
            overrideMapLower.set(String(k).toLowerCase(), num)
          }
        }
      }
    }
  } catch (e) { }

  // Helper to get override priority - O(1) lookup
  function getOverrideForLayerName(name) {
    if (globalOverrideIsNumber) {
      return { has: true, value: globalOverrideNumber }
    }
    if (name === undefined || name === null) return { has: false, value: null }
    if (overrideMap.has(name)) return { has: true, value: overrideMap.get(name) }
    const lname = name.toLowerCase()
    if (overrideMapLower.has(lname)) return { has: true, value: overrideMapLower.get(lname) }
    return { has: false, value: null }
  }

  function getDefaultPriority(layer) {
    if (layer && typeof layer.Priority !== 'undefined' && layer.Priority !== null) {
      return layer.Priority
    }
    return null
  }

  // Distribute colors to layers
  const layerColorByIndex = new Array(layerCount).fill(null)
  const colorableCount = colorableMainLayers.length

  if (partColors.length > 0) {
    if (partColors.length === layerCount) {
      for (let i = 0; i < layerCount; i++) layerColorByIndex[i] = partColors[i]
    } else if (partColors.length === colorableCount) {
      let ci = 0
      for (const ml of mainLayers) {
        const li = layerIndexMap.get(ml)
        if (ml.AllowColorize && !ml.HideColoring) {
          layerColorByIndex[li] = partColors[ci++]
        }
      }
    } else {
      let ci = 0
      for (const ml of mainLayers) {
        const li = layerIndexMap.get(ml)
        if (ml.AllowColorize && !ml.HideColoring) {
          layerColorByIndex[li] = (ci < partColors.length) ? partColors[ci++] : null
        }
      }
    }
  }

  // Build colorable index map for main layers
  const colorableIndexMap = new Map()
  for (let i = 0; i < colorableMainLayers.length; i++) {
    colorableIndexMap.set(colorableMainLayers[i], i)
  }

  // Build entries
  const entries = []

  for (const ml of mainLayers) {
    const miFlat = layerIndexMap.get(ml)
    const isColorable = !!(ml.AllowColorize && !ml.HideColoring)
    const rawColor = layerColorByIndex[miFlat]
    let colorText = null
    let colorCss = null

    if (isColorable && rawColor !== undefined && rawColor !== null) {
      if (Array.isArray(rawColor)) {
        colorText = rawColor.map(c => String(c)).join(', ')
        if (rawColor.length === 1) {
          const single = String(rawColor[0])
          if (looksLikeCssColor(single)) {
            colorCss = single
          } else {
            const resolved = resolveTagColorIfAny(single)
            if (resolved && looksLikeCssColor(resolved)) colorCss = resolved
          }
        }
      } else {
        colorText = String(rawColor)
        if (looksLikeCssColor(colorText)) {
          colorCss = colorText
        } else {
          const resolved = resolveTagColorIfAny(colorText)
          if (resolved && looksLikeCssColor(resolved)) colorCss = resolved
        }
      }
    }

    const layerName = ml.Name || ml.name || ''
    const ovInfo = getOverrideForLayerName(layerName)
    const hasOverride = ovInfo.has
    const ovValue = hasOverride ? ovInfo.value : null
    const defaultPriority = getDefaultPriority(ml)

    let usedPriority = null
    let isOverridePriority = false
    if (hasOverride) {
      usedPriority = ovValue
      isOverridePriority = true
    } else {
      usedPriority = defaultPriority
      isOverridePriority = false
    }

    const { drawingLeft, drawingTop } = getDrawingLTforLayer(miFlat, layerName, part, layers)

    // Get colorable index
    let colorableIndex = undefined
    if (isColorable) {
      colorableIndex = colorableIndexMap.get(ml)
      if (colorableIndex === undefined || colorableIndex < 0) colorableIndex = undefined
    }

    const mainEntry = {
      _key: 'm_' + (layerName || miFlat),
      name: layerName,
      displayName: mainMap.get(layerName)?.displayName || layerName,
      groupDisplayName: mainMap.get(layerName)?.groupDisplayName || null,
      isColorable,
      colorCss,
      colorText,
      opacity: opacities[miFlat] !== undefined ? opacities[miFlat] : 1,
      subLayers: [],
      isOverridePriority,
      overridePriority: hasOverride ? ovValue : defaultPriority,
      defaultPriority,
      usedPriority,
      drawingLeft,
      drawingTop,
      layerIndex: miFlat,
      colorableIndex
    }

    // Add sublayers
    const subs = mainMap.get(layerName)?.subLayers || []
    for (const sl of subs) {
      const slFlatIdx = sl.layerIndex
      const { drawingLeft, drawingTop } = getDrawingLTforLayer(slFlatIdx, sl.name, part, layers)
      mainEntry.subLayers.push({
        _key: 's_' + (sl.name || sl.displayName || slFlatIdx),
        name: sl.name,
        displayName: sl.displayName || sl.name || (sl.layer?.Name || sl.layer?.name) || ('sub#' + slFlatIdx),
        opacity: opacities[slFlatIdx] !== undefined ? opacities[slFlatIdx] : 1,
        drawingLeft,
        drawingTop,
        layerIndex: slFlatIdx
      })
    }

    entries.push(mainEntry)
  }

  // Add orphan sublayers
  for (const orphan of orphanSubLayers) {
    const idxFlat = orphan.layerIndex
    const { drawingLeft, drawingTop } = getDrawingLTforLayer(idxFlat, orphan.name, part, layers)
    entries.push({
      _key: 'orphan_' + (orphan.name || idxFlat),
      name: orphan.name,
      displayName: orphan.displayName || orphan.name || (orphan.layer?.Name || orphan.layer?.name) || ('orphan#' + idxFlat),
      opacity: opacities[idxFlat] !== undefined ? opacities[idxFlat] : 1,
      subLayers: [],
      drawingLeft,
      drawingTop,
      layerIndex: idxFlat
    })
  }

  return entries
}

// =============================================
// Reconstruct Part - OPTIMIZED
// =============================================

export function reconstructPartFromLayerEntries(entries, originalPart, extra = {}) {
  if (!Array.isArray(entries) || !originalPart) return null

  const asset = extra.originalAsset || (originalPart.Asset && originalPart.Asset.Layer ? originalPart.Asset : null)
  if (!asset || !Array.isArray(asset.Layer)) return null

  const layers = asset.Layer
  const layerCount = layers.length
  const mainLayers = layers.filter(l => !l.CopyLayerColor)
  const colorableMainLayers = mainLayers.filter(l => l.AllowColorize && !l.HideColoring)

  // Pre-build entry lookup by layerIndex for O(1) access
  const entryByLayerIndex = new Map()
  for (const m of entries) {
    if (m.layerIndex !== undefined) {
      entryByLayerIndex.set(m.layerIndex, m)
    }
    for (const s of (m.subLayers || [])) {
      if (s.layerIndex !== undefined) {
        entryByLayerIndex.set(s.layerIndex, s)
      }
    }
  }

  // 1. Color
  const colors = []
  for (let i = 0; i < colorableMainLayers.length; i++) {
    const ent = entries.find(e => e.colorableIndex === i)
    if (ent && ent.colorText !== undefined) {
      colors.push(ent.colorText)
    } else {
      if (Array.isArray(originalPart.Color) && i < originalPart.Color.length) {
        colors.push(originalPart.Color[i])
      } else {
        colors.push(null)
      }
    }
  }

  // 2. Opacity - use pre-built map
  const opacities = []
  for (let li = 0; li < layerCount; li++) {
    const found = entryByLayerIndex.get(li)
    if (found && found.opacity !== undefined) {
      opacities.push(found.opacity)
    } else if (originalPart?.Property?.Opacity && Array.isArray(originalPart.Property.Opacity) && li < originalPart.Property.Opacity.length) {
      opacities.push(originalPart.Property.Opacity[li])
    } else {
      opacities.push(1)
    }
  }

  // 3. OverridePriority
  let overridePriority = undefined
  for (const m of entries) {
    if (m.isOverridePriority && m.overridePriority !== undefined && m.name !== null) {
      if (!overridePriority) overridePriority = {}
      overridePriority[m.name] = m.overridePriority
    }
  }
  if (overridePriority && Object.keys(overridePriority).length === 1 && colorableMainLayers.length <= 1) {
    overridePriority = Object.values(overridePriority)[0]
  }

  // Helper: get asset defaults
  function getAssetLayerDefaults(li) {
    const out = { drawingLeft: undefined, drawingTop: undefined }
    if (li < 0 || li >= layerCount) return out
    const layerObj = layers[li]
    if (!layerObj || typeof layerObj !== 'object') return out
    if ('DrawingLeft' in layerObj) out.drawingLeft = extractDrawingValue(layerObj.DrawingLeft, layerObj.Name || layerObj.name)
    if ('DrawingTop' in layerObj) out.drawingTop = extractDrawingValue(layerObj.DrawingTop, layerObj.Name || layerObj.name)
    return out
  }

  // 4. LayerOverrides - use pre-built map
  const layerOverrides = []
  for (let li = 0; li < layerCount; li++) {
    const found = entryByLayerIndex.get(li)
    const ly = {}

    if (found && found.drawingLeft !== undefined && found.drawingLeft !== null) {
      ly.DrawingLeft = { "": found.drawingLeft }
    }
    if (found && found.drawingTop !== undefined && found.drawingTop !== null) {
      ly.DrawingTop = { "": found.drawingTop }
    }

    if (Object.keys(ly).length === 0) {
      const oldLO = (originalPart?.Property?.LayerOverrides && Array.isArray(originalPart.Property.LayerOverrides))
        ? originalPart.Property.LayerOverrides[li]
        : undefined
      if (oldLO && typeof oldLO === 'object') {
        layerOverrides.push(deepClone(oldLO))
        continue
      }
      layerOverrides.push({})
    } else {
      layerOverrides.push(ly)
    }
  }

  // Build Property object
  const propOut = {}
  if (opacities.length && opacities.some(v => v !== undefined && v !== 1)) {
    propOut.Opacity = opacities
  }
  if (overridePriority !== undefined) {
    propOut.OverridePriority = overridePriority
  }
  if (layerOverrides.length && layerOverrides.some(lo => lo && Object.keys(lo).length > 0)) {
    propOut.LayerOverrides = layerOverrides
  }
  if (originalPart.Property && originalPart.Property.TypeRecord) {
    propOut.TypeRecord = deepClone(originalPart.Property.TypeRecord)
  }

  // Assemble output part
  const out = {}
  for (const k of ['Name', 'Group', 'Asset', 'Craft', 'IsItem', 'Description']) {
    if (originalPart[k] !== undefined) out[k] = deepClone(originalPart[k])
  }
  if (colors.length && colors.some(v => v !== undefined && v !== null)) {
    out.Color = colors
  }
  if (Object.keys(propOut).length > 0) {
    out.Property = propOut
  }
  if (originalPart.Craft) {
    out.Craft = deepClone(originalPart.Craft)
  }

  return out
}

export default {
  buildLayerEntriesForPart,
  reconstructPartFromLayerEntries,
  clearLayerDisplayNameCache,
  ensureItemColorLayerNamesLoaded,
  cleanUpItemColorLayerNamesLoad
}