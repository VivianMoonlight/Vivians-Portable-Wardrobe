const schemaCache = new WeakMap()

function normalizeLayerName(value) {
  if (value === undefined || value === null) return ''
  return String(value)
}

function createMainLayerLookup(layers = []) {
  const byName = new Map()
  const byNameLower = new Map()

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    if (!layer || layer.CopyLayerColor) continue

    const layerName = normalizeLayerName(layer.Name || layer.name)
    if (!layerName) continue
    byName.set(layerName, i)
    byNameLower.set(layerName.toLowerCase(), i)
  }

  return { byName, byNameLower }
}

function resolveParentMainIndex(layers, layer, index, lookup) {
  if (!layer?.CopyLayerColor) return index

  const parentName = normalizeLayerName(layer.CopyLayerColor)
  if (!parentName) return index

  if (lookup.byName.has(parentName)) {
    return lookup.byName.get(parentName)
  }

  const parentLower = parentName.toLowerCase()
  if (lookup.byNameLower.has(parentLower)) {
    return lookup.byNameLower.get(parentLower)
  }

  return index
}

export function buildLayerSchemaForAsset(asset) {
  if (!asset || !Array.isArray(asset.Layer)) return null

  const layers = asset.Layer
  const layerCount = layers.length
  const lookup = createMainLayerLookup(layers)

  const mainLayerIndices = []
  const mainLayerNames = []
  const layerToMainIndex = new Array(layerCount)
  const subLayerIndicesByMain = new Map()

  for (let i = 0; i < layerCount; i++) {
    const layer = layers[i]
    const isMain = !layer?.CopyLayerColor
    if (isMain) {
      mainLayerIndices.push(i)
      mainLayerNames.push(normalizeLayerName(layer?.Name || layer?.name))
      layerToMainIndex[i] = i
      subLayerIndicesByMain.set(i, [])
      continue
    }

    const parentIndex = resolveParentMainIndex(layers, layer, i, lookup)
    layerToMainIndex[i] = parentIndex
    if (!subLayerIndicesByMain.has(parentIndex)) {
      subLayerIndicesByMain.set(parentIndex, [])
    }
    subLayerIndicesByMain.get(parentIndex).push(i)
  }

  const colorableMainLayerIndices = []
  for (const mainLayerIndex of mainLayerIndices) {
    const mainLayer = layers[mainLayerIndex]
    if (mainLayer?.AllowColorize && !mainLayer?.HideColoring) {
      colorableMainLayerIndices.push(mainLayerIndex)
    }
  }

  const mainToColorableIndex = new Map()
  for (let i = 0; i < colorableMainLayerIndices.length; i++) {
    mainToColorableIndex.set(colorableMainLayerIndices[i], i)
  }

  const layerToColorableIndex = new Map()
  for (let i = 0; i < layerCount; i++) {
    const mainIndex = layerToMainIndex[i]
    if (!Number.isFinite(mainIndex)) continue
    const colorableIndex = mainToColorableIndex.get(mainIndex)
    if (Number.isFinite(colorableIndex)) {
      layerToColorableIndex.set(i, colorableIndex)
    }
  }

  return {
    layerCount,
    layerNames: layers.map(layer => normalizeLayerName(layer?.Name || layer?.name)),
    mainLayerIndices,
    mainLayerNames,
    layerToMainIndex,
    colorableMainLayerIndices,
    colorableCount: colorableMainLayerIndices.length,
    mainToColorableIndex,
    layerToColorableIndex,
    subLayerIndicesByMain,
    singlePriorityLayer: mainLayerIndices.length <= 1 || colorableMainLayerIndices.length <= 1
  }
}

export function getLayerSchemaForAsset(asset) {
  if (!asset || !Array.isArray(asset.Layer)) return null

  const cached = schemaCache.get(asset)
  if (cached) return cached

  const schema = buildLayerSchemaForAsset(asset)
  if (schema) {
    schemaCache.set(asset, schema)
  }
  return schema
}

export function getMainLayerIndexForLayer(schema, layerIndex) {
  if (!schema || !Array.isArray(schema.layerToMainIndex)) return null
  const numericLayerIndex = Number(layerIndex)
  if (!Number.isFinite(numericLayerIndex)) return null
  const mainIndex = schema.layerToMainIndex[numericLayerIndex]
  return Number.isFinite(mainIndex) ? mainIndex : null
}

export function getColorableIndexForLayer(schema, layerIndex) {
  if (!schema?.layerToColorableIndex) return null
  const numericLayerIndex = Number(layerIndex)
  if (!Number.isFinite(numericLayerIndex)) return null
  const colorableIndex = schema.layerToColorableIndex.get(numericLayerIndex)
  return Number.isFinite(colorableIndex) ? colorableIndex : null
}
