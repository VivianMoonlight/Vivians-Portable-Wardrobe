// src/services/LayerTranslator.js

/**
 * LayerTranslator (pure function)
 *
 * Exports:
 *   - buildLayerEntriesForPart(part, deps)
 *   - reconstructPartFromLayerEntries(entries, originalPart, extra)  // extra: { originalAsset }
 * 
 *   每个layer输出:
 *     - layerIndex: 在asset.Layer里的下标
 *     - colorableIndex: (colorable主层专属) 在colorableMainLayers中的下标
 * 
 *   reconstructPartFromLayerEntries: 能恢复和原part完全一致的数据结构
 */

import { hostWindow, doc } from '@/utils/host-window.js';


function deepClone(v) {
  try { return JSON.parse(JSON.stringify(v)) } catch (e) {
    if (Array.isArray(v)) return v.slice()
    if (v && typeof v === 'object') return Object.assign({}, v)
    return v
  }
}
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

// Helper to extract drawing value from various shaped sources (object or primitive)
function extractDrawingValue(val, layerName) {
  if (val === undefined || val === null) return null
  if (typeof val === 'object') {
    // Prefer explicit empty-string key (default for all layers), then layerName, then first value
    if ('' in val) return val['']
    if (layerName && layerName in val) return val[layerName]
    const vs = Object.values(val)
    return vs.length ? vs[0] : null
  }
  return val
}

// Helper: extract drawingLeft / drawingTop for given layer index or name
// Now accepts assetLayers (array) to read default values from asset.Layer when part overrides absent.
function getDrawingLTforLayer(layerIdx, layerName, part, assetLayers) {
  const LOs = getLayerOverridesArray(part?.Property?.LayerOverrides)
  let left = null
  let top = null

  // Prefer to match by index first
  const L = (layerIdx >= 0 && Array.isArray(LOs) && layerIdx < LOs.length) ? LOs[layerIdx] : null
  if (L) {
    if ('DrawingLeft' in L) {
      left = extractDrawingValue(L.DrawingLeft, layerName)
    }
    if ('DrawingTop' in L) {
      top = extractDrawingValue(L.DrawingTop, layerName)
    }
  }
  // 如果index找不到或部分缺失，尝试name精准匹配（part overrides里按名字存的情况）
  if ((left == null || top == null) && layerName) {
    for (const O of LOs) {
      if (O && typeof O === 'object') {
        if (O.DrawingLeft && typeof O.DrawingLeft === 'object' && layerName in O.DrawingLeft) left = O.DrawingLeft[layerName]
        if (O.DrawingTop && typeof O.DrawingTop === 'object' && layerName in O.DrawingTop) top = O.DrawingTop[layerName]
      }
    }
  }

  // 如果在 part 的 LayerOverrides 找不到，则尝试读取 asset layers 中的默认值（和 Opacity 的 default 存储逻辑一致）
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
      // 如果仍然没有，那么也尝试在 asset layers 中按 name 查找（以防 asset layer list 顺序不可靠）
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
  } catch (e) { /* ignore asset read errors */ }

  return { drawingLeft: left, drawingTop: top }
}

export function buildLayerEntriesForPart(part, deps = {}) {
  if (!part) return []
  try {
    if (typeof hostWindow.ItemColorLoad === 'function') {
      if (hostWindow.Player && Array.isArray(hostWindow.Player.Appearance) && hostWindow.Player.Appearance.length > 0) {
        if (!ItemColorLayerNames || !ItemColorLayerNames.cache || Object.keys(ItemColorLayerNames.cache).length === 0) {
          try { hostWindow.ItemColorLoad(hostWindow.Player, hostWindow.Player.Appearance[0], 10000, 10000, 0, 0, true) } catch (e) { }
        }
      }
    }
  } catch (e) { }

  const resolveTagColorIfAny = (text) => {
    if (!text || typeof text !== 'string') return null
    const palette = (typeof deps.paletteSnapshot === 'function') ? deps.paletteSnapshot() : {}
    if (text in palette) {
      const v = palette[text]
      return extractPrimaryCssColor(v)
    }
    return null
  }
  const resolveLayerDisplayName = (asset, layer) => {
    let displayName = layer.Name || layer.name || ''
    try {
      const key = (asset.DynamicGroupName || '') + (asset.Name || '') + (layer.Name || '')
      if (typeof ItemColorLayerNames !== 'undefined' && ItemColorLayerNames && ItemColorLayerNames.cache) {
        const v = ItemColorLayerNames.cache[key]
        if (v) displayName = v
      }
    } catch (e) { }
    return displayName
  }

  let asset = null
  try {
    if (typeof deps.resolveAssetForPart === 'function') {
      asset = deps.resolveAssetForPart(part)
    }
  } catch (e) { asset = null }

  if (!asset || !Array.isArray(asset.Layer)) {
    return []
  }

  const layers = asset.Layer.slice()
  const mainLayers = layers.filter(l => !l.CopyLayerColor)
  const subLayers = layers.filter(l => !!l.CopyLayerColor)

  // 构建 colorable main layer 列表
  const colorableMainLayers = mainLayers.filter(l => l.AllowColorize && !l.HideColoring)

  // 建立name-index映射
  const colorableMainLayerIndexes = new Map()
  colorableMainLayers.forEach((layer, idx) => {
    colorableMainLayerIndexes.set(layer.Name || layer.name || '', idx)
  })

  // 构建 mainMap
  const mainMap = new Map()
  for (const ml of mainLayers) {
    const name = ml.Name || ml.name || ''
    mainMap.set(name, { layer: ml, name, displayName: ml.Name || ml.name || '', isColorable: !!(ml.AllowColorize && !ml.HideColoring), subLayers: [] })
  }

  const orphanSubLayers = []
  for (const sl of subLayers) {
    const parentNameRaw = String(sl.CopyLayerColor || '')
    const entry = { layer: sl, name: sl.Name || sl.name || '', displayName: sl.Name || sl.name || '' }
    if (mainMap.has(parentNameRaw)) {
      mainMap.get(parentNameRaw).subLayers.push(entry)
    } else {
      let found = null
      for (const [k, v] of mainMap.entries()) {
        if (String(k).toLowerCase() === parentNameRaw.toLowerCase()) { found = v; break }
      }
      if (found) found.subLayers.push(entry)
      else orphanSubLayers.push(entry)
    }
  }

  const partColors = Array.isArray(part.Color) ? part.Color.slice() : (part.Color ? [part.Color] : [])
  const rawOpacities = (part.Property && Array.isArray(part.Property.Opacity)) ? part.Property.Opacity.slice() : (part.Property && part.Property.Opacity !== undefined ? [part.Property.Opacity] : [])

  const opacities = []
  if (rawOpacities.length === 1) {
    const v = rawOpacities[0]
    for (let i = 0; i < layers.length; i++) opacities.push(v)
  } else {
    for (let i = 0; i < layers.length; i++) {
      if (i < rawOpacities.length && rawOpacities[i] !== undefined && rawOpacities[i] !== null) opacities.push(rawOpacities[i])
      else opacities.push(1)
    }
  }

  // 解析 OverridePriority
  const rawOverride = part?.Property?.OverridePriority
  const overrideMap = new Map()
  try {
    if (rawOverride !== undefined && rawOverride !== null) {
      if (typeof rawOverride === 'number' || (typeof rawOverride === 'string' && String(rawOverride).trim() !== '' && !isNaN(Number(rawOverride)))) {
        const num = Number(rawOverride)
        if (mainLayers.length === 1) {
          const name = mainLayers[0].Name || mainLayers[0].name || ''
          overrideMap.set(name, num)
        } else if (layers.length === 1) {
          const name = layers[0].Name || layers[0].name || ''
          overrideMap.set(name, num)
        }
      } else if (typeof rawOverride === 'object') {
        for (const k of Object.keys(rawOverride)) {
          try {
            const v = rawOverride[k]
            if (v === undefined || v === null) continue
            const num = Number(v)
            if (!Number.isNaN(num)) overrideMap.set(String(k), num)
          } catch (e) { }
        }
      }
    }
  } catch (e) { }

  function getOverrideForLayerName(name) {
    if (name === undefined || name === null) return { has: false, value: null }
    if (overrideMap.has(name)) return { has: true, value: overrideMap.get(name) }
    const lname = String(name).toLowerCase()
    for (const [k, v] of overrideMap.entries()) {
      if (String(k).toLowerCase() === lname) return { has: true, value: v }
    }
    return { has: false, value: null }
  }

  function getDefaultPriority(layer) {
    if (layer && typeof layer.Priority !== 'undefined' && layer.Priority !== null) {
      return layer.Priority
    }
    return null
  }

  // color分配: 映射原始各layer idx
  const layerColorByIndex = new Array(layers.length).fill(null)
  if (partColors.length > 0) {
    if (partColors.length === layers.length) {
      for (let i = 0; i < layers.length; i++) layerColorByIndex[i] = partColors[i]
    } else if (partColors.length === colorableMainLayers.length) {
      let ci = 0
      for (const ml of mainLayers) {
        const li = layers.indexOf(ml)
        if (ml.AllowColorize && !ml.HideColoring) {
          layerColorByIndex[li] = partColors[ci++]
        } else layerColorByIndex[li] = null
      }
    } else {
      let ci = 0
      for (const ml of mainLayers) {
        const li = layers.indexOf(ml)
        if (ml.AllowColorize && !ml.HideColoring) {
          layerColorByIndex[li] = (ci < partColors.length) ? partColors[ci++] : null
        } else layerColorByIndex[li] = null
      }
    }
  }

  const entries = []

  for (const ml of mainLayers) {
    const miFlat = layers.indexOf(ml)
    const isColorable = !!(ml.AllowColorize && !ml.HideColoring)
    let rawColor = layerColorByIndex[miFlat]
    let colorText = null
    let colorCss = null

    if (isColorable && rawColor !== undefined && rawColor !== null) {
      if (Array.isArray(rawColor)) {
        colorText = rawColor.map(c => String(c)).join(', ')
        if (rawColor.length === 1) {
          const single = String(rawColor[0])
          if (looksLikeCssColor(single)) colorCss = single
          else {
            const resolved = resolveTagColorIfAny(single)
            if (resolved && looksLikeCssColor(resolved)) colorCss = resolved
          }
        }
      } else {
        colorText = String(rawColor)
        if (looksLikeCssColor(colorText)) colorCss = colorText
        else {
          const resolved = resolveTagColorIfAny(colorText)
          if (resolved && looksLikeCssColor(resolved)) colorCss = resolved
        }
      }
    }

    const ovInfo = getOverrideForLayerName(ml.Name || ml.name || '')
    const hasOverride = ovInfo.has
    const ovValue = (hasOverride ? ovInfo.value : null)
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
    const { drawingLeft, drawingTop } = getDrawingLTforLayer(miFlat, ml.Name || ml.name, part, layers)
    // 主layer colorableIndex
    let colorableIndex = undefined
    if (isColorable) {
      colorableIndex = colorableMainLayers.indexOf(ml)
      if (colorableIndex < 0) colorableIndex = undefined
    }
    const mainEntry = {
      _key: 'm_' + (ml.Name || ml.name || miFlat),
      name: ml.Name || ml.name || '',
      displayName: resolveLayerDisplayName(asset, ml),
      isColorable,
      colorCss,
      colorText,
      opacity: (miFlat >= 0 && miFlat < opacities.length) ? opacities[miFlat] : 1,
      subLayers: [],
      isOverridePriority: isOverridePriority,
      overridePriority: hasOverride ? ovValue : defaultPriority,
      defaultPriority: defaultPriority,
      usedPriority: usedPriority,
      drawingLeft: drawingLeft,
      drawingTop: drawingTop,
      layerIndex: miFlat,
      colorableIndex: colorableIndex
    }
    const subs = mainMap.get(mainEntry.name)?.subLayers || []
    for (const sl of subs) {
      const slFlatIdx = layers.indexOf(sl.layer)
      const { drawingLeft, drawingTop } = getDrawingLTforLayer(slFlatIdx, sl.name, part, layers)
      mainEntry.subLayers.push({
        _key: 's_' + (sl.name || sl.displayName || slFlatIdx),
        name: sl.name,
        displayName: sl.displayName || sl.name || (sl.layer?.Name || sl.layer?.name) || ('sub#' + slFlatIdx),
        opacity: (slFlatIdx >= 0 && slFlatIdx < opacities.length) ? opacities[slFlatIdx] : 1,
        drawingLeft: drawingLeft,
        drawingTop: drawingTop,
        layerIndex: slFlatIdx
      })
    }
    entries.push(mainEntry)
  }
  // orphan sublayers
  for (const orphan of orphanSubLayers) {
    const idxFlat = layers.indexOf(orphan.layer)
    const { drawingLeft, drawingTop } = getDrawingLTforLayer(idxFlat, orphan.name, part, layers)
    entries.push({
      _key: 'orphan_' + (orphan.name || idxFlat),
      name: orphan.name,
      displayName: orphan.displayName || orphan.name || (orphan.layer?.Name || orphan.layer?.name) || ('orphan#' + idxFlat),
      opacity: (idxFlat >= 0 && idxFlat < opacities.length) ? opacities[idxFlat] : 1,
      subLayers: [],
      drawingLeft,
      drawingTop,
      layerIndex: idxFlat
    })
  }
  return entries
}

/**
 * reconstructPartFromLayerEntries
 * @param {Array} entries - buildLayerEntriesForPart 的输出
 * @param {Object} originalPart - 原part（需提供保留部分原字段，如 Name/Group/Asset/Craft/IsItem）
 * @param {Object} extra - { originalAsset }
 * @returns {Object} 新 part，能和原结构等价（所有字段完全还原，包括 .Color, .Property.Opacity, .Property.OverridePriority）
 */
export function reconstructPartFromLayerEntries(entries, originalPart, extra = {}) {
  if (!Array.isArray(entries) || !originalPart) return null
  const asset = extra.originalAsset || (originalPart.Asset && originalPart.Asset.Layer ? originalPart.Asset : null)
  if (!asset || !Array.isArray(asset.Layer)) return null
  const layers = asset.Layer.slice()
  const mainLayers = layers.filter(l => !l.CopyLayerColor)
  // 还原color
  // 可着色主layer
  const colorableMainLayers = mainLayers.filter(l => l.AllowColorize && !l.HideColoring)
  // 对应原Color数组
  const colors = []
  const opacities = []
  // 1. Color: 用 colorableIndex（保持顺序），数量来自 colorableMainLayers
  // 2. Opacity: 用 layerIndex
  // 3. OverridePriority: 用主层name
  // 4. DrawingLeft/Top: from每层, 但如果和 asset 默认相同，则不写入 Part.Property.LayerOverrides（和 Opacity 的 default 行为一致）

  // 1. Color
  for (let i = 0; i < colorableMainLayers.length; i++) {
    // 找到 entries 中 isColorable && colorableIndex==i 的layer
    const ent = entries.find(e => e.colorableIndex === i)
    if (ent && ent.colorText !== undefined) {
      // 直接存 表现/用 colorText
      colors.push(ent.colorText)
    } else {
      // 如果原part.Color有，且该index有值
      if (Array.isArray(originalPart.Color) && i < originalPart.Color.length) colors.push(originalPart.Color[i])
      else colors.push(null)
    }
  }
  // 2. Opacity，用layer顺序
  for (let li = 0; li < layers.length; li++) {
    // entry可以是主层或某sub/孤层
    let found = null
    for (const m of entries) {
      if (m.layerIndex === li) { found = m; break }
      for (const s of m.subLayers || []) {
        if (s.layerIndex === li) { found = s; break }
      }
      if (found) break
    }
    if (found && found.opacity !== undefined) opacities.push(found.opacity)
    else if (originalPart?.Property?.Opacity && Array.isArray(originalPart.Property.Opacity) && li < originalPart.Property.Opacity.length) opacities.push(originalPart.Property.Opacity[li])
    else opacities.push(1)
  }
  // 3. OverridePriority (优先级): 用主层name与entries比对
  let overridePriority = undefined
  for (const m of entries) {
    if (m.isOverridePriority && m.overridePriority !== undefined && m.name !== null) {
      if (!overridePriority) overridePriority = {}
      overridePriority[m.name] = m.overridePriority
    }
  }
  if (overridePriority && Object.keys(overridePriority).length === 1 && colorableMainLayers.length <= 1) {
    // 还原为number
    overridePriority = Object.values(overridePriority)[0]
  }

  // Helper: get asset defaults for a particular layer index
  function getAssetLayerDefaults(li) {
    const out = { drawingLeft: undefined, drawingTop: undefined }
    if (!Array.isArray(layers) || li < 0 || li >= layers.length) return out
    const layerObj = layers[li]
    if (!layerObj || typeof layerObj !== 'object') return out
    if ('DrawingLeft' in layerObj) out.drawingLeft = extractDrawingValue(layerObj.DrawingLeft, layerObj.Name || layerObj.name)
    if ('DrawingTop' in layerObj) out.drawingTop = extractDrawingValue(layerObj.DrawingTop, layerObj.Name || layerObj.name)
    return out
  }

  // Utility to compare values loosely but safely (stringify for comparison)
  function sameDrawingVal(a, b) {
    if (a === undefined && b === undefined) return true
    if (a === null && b === null) return true
    if (a === undefined || b === undefined) return false
    return String(a) === String(b)
  }

  // 4. drawingLeft/Top: 还原 LayerOverrides（数组，顺序与layers）
  const layerOverrides = []
  for (let li = 0; li < layers.length; li++) {
    let found = null
    for (const m of entries) {
      if (m.layerIndex === li) { found = m; break }
      for (const s of (m.subLayers || [])) {
        if (s.layerIndex === li) { found = s; break }
      }
      if (found) break
    }
    // 只写有效属性，并且当值与 asset 默认相同时，不写入 override（与 Opacity 的 default 行为一致）
    const ly = {}
    const assetDefaults = getAssetLayerDefaults(li)

    if (found && found.drawingLeft !== undefined && found.drawingLeft !== null) {
      // only include if different from asset default
      // if (!sameDrawingVal(found.drawingLeft, assetDefaults.drawingLeft)) {
      // Maintain same structure as original expectations: allow primitive or object values to be set directly.
      // We'll write primitive value directly.
      ly.DrawingLeft = { "": found.drawingLeft }
      //}
    }
    if (found && found.drawingTop !== undefined && found.drawingTop !== null) {
      //if (!sameDrawingVal(found.drawingTop, assetDefaults.drawingTop)) {
      ly.DrawingTop = { "": found.drawingTop }
      //}
    }

    // If there was no found entry but originalPart had explicit overrides different from asset defaults, preserve them
    if (Object.keys(ly).length === 0) {
      const oldLO = (originalPart?.Property?.LayerOverrides && Array.isArray(originalPart.Property.LayerOverrides)) ? originalPart.Property.LayerOverrides[li] : undefined
      if (oldLO && typeof oldLO === 'object') {
        layerOverrides.push(deepClone(oldLO))
        continue
      }
      layerOverrides.push({})
    } else {
      layerOverrides.push(ly)
    }
  }
  // 合并 Property: 仅保留必要还原
  const propOut = {}
  if (opacities.length && opacities.some(v => v !== undefined && v !== 1)) { propOut.Opacity = opacities }
  if (overridePriority !== undefined) propOut.OverridePriority = overridePriority
  if (layerOverrides.length && layerOverrides.some(lo => lo && Object.keys(lo).length > 0)) propOut.LayerOverrides = layerOverrides
  // 合并 TypeRecord 等其它字段（原样保留）
  if (originalPart.Property && originalPart.Property.TypeRecord) propOut.TypeRecord = deepClone(originalPart.Property.TypeRecord)
  // 组装 part
  const out = {}
  for (const k of ['Name', 'Group', 'Asset', 'Craft', 'IsItem', 'Description']) {
    if (originalPart[k] !== undefined) out[k] = deepClone(originalPart[k])
  }
  if (colors.length && colors.some(v => v !== undefined && v !== null)) out.Color = colors
  if (Object.keys(propOut).length > 0) out.Property = propOut
  if (originalPart.Craft) out.Craft = deepClone(originalPart.Craft)
  return out
}

export default {
  buildLayerEntriesForPart,
  reconstructPartFromLayerEntries,
}
