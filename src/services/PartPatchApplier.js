import { fastClone } from '@/utils/clone.js'
import {
  getLayerSchemaForAsset,
  getMainLayerIndexForLayer,
  getColorableIndexForLayer
} from '@/services/LayerSchemaService'

function toFiniteNumber(value, fallback = null) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeColorArray(partColor, colorableCount) {
  const count = Math.max(0, Number(colorableCount) || 0)
  if (count === 0) return []

  if (Array.isArray(partColor)) {
    const out = partColor.slice(0, count)
    while (out.length < count) out.push(null)
    return out
  }

  if (partColor === undefined || partColor === null) {
    return Array.from({ length: count }, () => null)
  }

  if (count === 1) {
    return [partColor]
  }

  return [partColor, ...Array.from({ length: count - 1 }, () => null)]
}

function normalizeOpacityArray(rawOpacity, layerCount) {
  const count = Math.max(0, Number(layerCount) || 0)
  if (count === 0) return []

  const fillWith = (value) => Array.from({ length: count }, () => value)

  if (rawOpacity === undefined || rawOpacity === null) {
    return fillWith(1)
  }

  if (Array.isArray(rawOpacity)) {
    const out = rawOpacity
      .slice(0, count)
      .map(entry => toFiniteNumber(entry, 1))
    while (out.length < count) out.push(1)
    return out
  }

  if (typeof rawOpacity === 'object') {
    const values = Object.values(rawOpacity).map(entry => toFiniteNumber(entry, 1))
    if (!values.length) return fillWith(1)
    if (values.length === 1) return fillWith(values[0])
    const out = values.slice(0, count)
    while (out.length < count) out.push(1)
    return out
  }

  return fillWith(toFiniteNumber(rawOpacity, 1))
}

function normalizeLayerOverrides(propertyLayerOverrides, layerCount) {
  const count = Math.max(0, Number(layerCount) || 0)
  if (count === 0) return []

  const source = Array.isArray(propertyLayerOverrides) ? propertyLayerOverrides : []
  const out = []

  for (let i = 0; i < count; i++) {
    const raw = source[i]
    out.push(raw && typeof raw === 'object' ? fastClone(raw) : {})
  }

  return out
}

function detectOverrideKey(overrideEntry, propertyKey, layerName = '') {
  const source = overrideEntry?.[propertyKey]
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    if (Object.prototype.hasOwnProperty.call(source, '')) return ''
    if (layerName && Object.prototype.hasOwnProperty.call(source, layerName)) return layerName
    const keys = Object.keys(source)
    if (keys.length > 0) return keys[0]
  }

  return ''
}

function setLayerOverrideNumeric(overrideEntry, propertyKey, value, layerName = '') {
  if (!overrideEntry || typeof overrideEntry !== 'object') return false

  if (value === null || value === undefined) {
    if (Object.prototype.hasOwnProperty.call(overrideEntry, propertyKey)) {
      delete overrideEntry[propertyKey]
      return true
    }
    return false
  }

  const numeric = toFiniteNumber(value, null)
  if (numeric === null) return false

  const key = detectOverrideKey(overrideEntry, propertyKey, layerName)
  const previous = overrideEntry[propertyKey]
  const nextObject = { [key]: numeric }

  const changed = JSON.stringify(previous || null) !== JSON.stringify(nextObject)
  if (changed) {
    overrideEntry[propertyKey] = nextObject
  }

  return changed
}

function cleanupProperty(part) {
  if (!part || typeof part !== 'object') return
  if (!part.Property || typeof part.Property !== 'object') {
    delete part.Property
    return
  }

  if (Array.isArray(part.Property.Opacity) && part.Property.Opacity.every(entry => Number(entry) >= 1)) {
    delete part.Property.Opacity
  }

  if (Array.isArray(part.Property.LayerOverrides)) {
    const hasOverrides = part.Property.LayerOverrides.some(entry => entry && Object.keys(entry).length > 0)
    if (!hasOverrides) {
      delete part.Property.LayerOverrides
    }
  }

  if (part.Property.OverridePriority && typeof part.Property.OverridePriority === 'object' && !Array.isArray(part.Property.OverridePriority)) {
    if (Object.keys(part.Property.OverridePriority).length === 0) {
      delete part.Property.OverridePriority
    }
  }

  if (Object.keys(part.Property).length === 0) {
    delete part.Property
  }
}

function ensureProperty(part) {
  if (!part.Property || typeof part.Property !== 'object' || Array.isArray(part.Property)) {
    part.Property = {}
  }
  return part.Property
}

function applyOverridePriorityDelta(part, schema, delta) {
  if (!Object.prototype.hasOwnProperty.call(delta, 'isOverridePriority')) {
    return false
  }

  const layerIndex = Number(delta.layerIndex)
  if (!Number.isFinite(layerIndex)) return false

  const mainLayerIndex = getMainLayerIndexForLayer(schema, layerIndex)
  if (!Number.isFinite(mainLayerIndex)) return false

  const targetLayerName = schema?.layerNames?.[mainLayerIndex] || ''
  const property = ensureProperty(part)
  const enableOverride = !!delta.isOverridePriority
  const priorityValue = toFiniteNumber(delta.overridePriority, null)

  if (!enableOverride || priorityValue === null) {
    if (schema?.singlePriorityLayer) {
      if (Object.prototype.hasOwnProperty.call(property, 'OverridePriority')) {
        delete property.OverridePriority
        return true
      }
      return false
    }

    if (!property.OverridePriority || typeof property.OverridePriority !== 'object' || Array.isArray(property.OverridePriority)) {
      return false
    }

    if (Object.prototype.hasOwnProperty.call(property.OverridePriority, targetLayerName)) {
      delete property.OverridePriority[targetLayerName]
      return true
    }

    return false
  }

  if (schema?.singlePriorityLayer) {
    if (property.OverridePriority !== priorityValue) {
      property.OverridePriority = priorityValue
      return true
    }
    return false
  }

  const current = property.OverridePriority
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    property.OverridePriority = {}
  }

  if (property.OverridePriority[targetLayerName] !== priorityValue) {
    property.OverridePriority[targetLayerName] = priorityValue
    return true
  }

  return false
}

function applySingleLayerDelta(part, schema, delta, layerIndex, layerName) {
  let changed = false

  if (Object.prototype.hasOwnProperty.call(delta, 'colorText')) {
    const colorableIndex = getColorableIndexForLayer(schema, layerIndex)
    if (Number.isFinite(colorableIndex)) {
      const nextColorText = delta.colorText === undefined || delta.colorText === null
        ? ''
        : String(delta.colorText)
      const colorArray = normalizeColorArray(part.Color, schema?.colorableCount || 0)
      if (colorArray[colorableIndex] !== nextColorText) {
        colorArray[colorableIndex] = nextColorText
        if ((schema?.colorableCount || 0) === 1 && !Array.isArray(part.Color)) {
          part.Color = colorArray[0]
        } else {
          part.Color = colorArray
        }
        changed = true
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(delta, 'opacity')) {
    const property = ensureProperty(part)
    const opacityValues = normalizeOpacityArray(property.Opacity, schema?.layerCount || 0)
    const nextOpacity = toFiniteNumber(delta.opacity, 1)
    if (opacityValues[layerIndex] !== nextOpacity) {
      opacityValues[layerIndex] = nextOpacity
      if (opacityValues.every(value => value >= 1)) {
        delete property.Opacity
      } else {
        property.Opacity = opacityValues
      }
      changed = true
    }
  }

  if (Object.prototype.hasOwnProperty.call(delta, 'drawingLeft') || Object.prototype.hasOwnProperty.call(delta, 'drawingTop')) {
    const property = ensureProperty(part)
    const overrides = normalizeLayerOverrides(property.LayerOverrides, schema?.layerCount || 0)
    const entry = overrides[layerIndex]

    if (Object.prototype.hasOwnProperty.call(delta, 'drawingLeft')) {
      changed = setLayerOverrideNumeric(entry, 'DrawingLeft', delta.drawingLeft, layerName) || changed
    }
    if (Object.prototype.hasOwnProperty.call(delta, 'drawingTop')) {
      changed = setLayerOverrideNumeric(entry, 'DrawingTop', delta.drawingTop, layerName) || changed
    }

    property.LayerOverrides = overrides
  }

  changed = applyOverridePriorityDelta(part, schema, delta) || changed
  return changed
}

export function applyLayerDeltasToPart(sourcePart, deltas = [], { asset = null } = {}) {
  if (!sourcePart || typeof sourcePart !== 'object') {
    return { changed: false, part: null }
  }
  if (!Array.isArray(deltas) || deltas.length === 0) {
    return { changed: false, part: null }
  }

  const schema = getLayerSchemaForAsset(asset)
  if (!schema || !Number.isFinite(schema.layerCount) || schema.layerCount <= 0) {
    return { changed: false, part: null }
  }

  const nextPart = fastClone(sourcePart)
  let changed = false

  for (const delta of deltas) {
    if (!delta || typeof delta !== 'object') continue

    const layerIndex = Number(delta.layerIndex)
    if (!Number.isFinite(layerIndex) || layerIndex < 0 || layerIndex >= schema.layerCount) continue

    const layerName = schema?.layerNames?.[layerIndex] || ''
    changed = applySingleLayerDelta(nextPart, schema, delta, layerIndex, layerName) || changed

    const subLayerDeltas = Array.isArray(delta.subLayers) ? delta.subLayers : []
    for (const subDelta of subLayerDeltas) {
      const subLayerIndex = Number(subDelta?.layerIndex)
      if (!Number.isFinite(subLayerIndex) || subLayerIndex < 0 || subLayerIndex >= schema.layerCount) continue
      const subLayerName = schema?.layerNames?.[subLayerIndex] || ''
      changed = applySingleLayerDelta(nextPart, schema, subDelta, subLayerIndex, subLayerName) || changed
    }
  }

  if (!changed) {
    return { changed: false, part: null }
  }

  cleanupProperty(nextPart)
  return {
    changed: true,
    part: nextPart
  }
}
