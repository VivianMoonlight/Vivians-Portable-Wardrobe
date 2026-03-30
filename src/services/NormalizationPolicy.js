function toFiniteNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizePrimitive(value) {
  if (value === undefined) return null
  if (value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  return null
}

function normalizeStructured(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeStructured)
  }

  if (!value || typeof value !== 'object') {
    return normalizePrimitive(value)
  }

  const keys = Object.keys(value).sort()
  const out = {}
  for (const key of keys) {
    out[key] = normalizeStructured(value[key])
  }
  return out
}

function normalizeColor(color) {
  return normalizeStructured(color)
}

function normalizeShift(shift) {
  if (shift === undefined || shift === null) return null

  if (Array.isArray(shift)) {
    return shift.map(v => toFiniteNumber(v, 0))
  }

  if (typeof shift === 'object') {
    return normalizeStructured(shift)
  }

  return toFiniteNumber(shift, 0)
}

function normalizeOpacity(opacity) {
  if (opacity === undefined || opacity === null) return 1
  return clamp(toFiniteNumber(opacity, 1), 0, 1)
}

function normalizeLayerOverrides(layerOverrides) {
  if (!Array.isArray(layerOverrides)) return null

  return layerOverrides.map((overrideEntry) => {
    if (!overrideEntry || typeof overrideEntry !== 'object') return null

    const normalizedEntry = {}
    if (Object.prototype.hasOwnProperty.call(overrideEntry, 'DrawingLeft')) {
      normalizedEntry.DrawingLeft = normalizeStructured(overrideEntry.DrawingLeft)
    }
    if (Object.prototype.hasOwnProperty.call(overrideEntry, 'DrawingTop')) {
      normalizedEntry.DrawingTop = normalizeStructured(overrideEntry.DrawingTop)
    }

    return Object.keys(normalizedEntry).length > 0 ? normalizedEntry : null
  })
}

function normalizeOverridePriority(overridePriority) {
  if (overridePriority === undefined || overridePriority === null) return null
  return normalizeStructured(overridePriority)
}

function normalizeBundleItemForComparator(bundleItem) {
  if (!bundleItem || typeof bundleItem !== 'object') return null

  const groupName = bundleItem.Group || bundleItem?.Asset?.Group?.Name || null
  if (!groupName) return null

  const property = bundleItem.Property || {}

  return {
    Group: String(groupName),
    Name: bundleItem.Name == null ? null : String(bundleItem.Name),
    Color: normalizeColor(bundleItem.Color),
    Property: {
      Shift: normalizeShift(property.Shift),
      Opacity: normalizeOpacity(property.Opacity),
      LayerOverrides: normalizeLayerOverrides(property.LayerOverrides),
      OverridePriority: normalizeOverridePriority(property.OverridePriority)
    }
  }
}

export function normalizeForFastPath(bundleData) {
  if (!Array.isArray(bundleData)) return []

  const normalized = []
  for (const item of bundleData) {
    const dto = normalizeBundleItemForComparator(item)
    if (dto) normalized.push(dto)
  }

  normalized.sort((a, b) => a.Group.localeCompare(b.Group))
  return normalized
}
