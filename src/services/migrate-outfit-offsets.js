// Carry the outfit's explicit format through slot merging on temporary copies.
export function outfitRenderData(outfit) {
  return outfit?.offsetFormat === 'new'
    ? outfit.data.map(part => ({ ...part, vpwSkipOffsetConversion: true }))
    : outfit?.data
}

const roundOffset = value => Math.sign(value) * Math.round(Math.abs(value))
export function prepareOutfitOffsets(data, host, character, onProblem) {
  if (!Array.isArray(data)) return data
  return data.map(part => {
    if (part?.vpwSkipOffsetConversion) {
      const { vpwSkipOffsetConversion, ...original } = part
      return original
    }
    const result = prepareItem(part, host, character, onProblem)
    return result
  })
}

function hasLegacyCoordinates(prop) {
  if (prop?.LayerOverrides != null && !Array.isArray(prop.LayerOverrides)) return true
  return prop?.DrawingLeft != null || prop?.DrawingTop != null ||
    (Array.isArray(prop?.LayerOverrides) && prop.LayerOverrides.some(slot => slot?.DrawingLeft != null || slot?.DrawingTop != null))
}

/** @returns {{ data: any[], offsetFormat: "old" | "new" }} */
export function prepareSavedOutfit(data, host, character, format) {
  if (format === 'new') return { data, offsetFormat: 'new' }
  const problems = []
  const converted = prepareOutfitOffsets(data, host, character, (part, detail) => problems.push(part.Group + '/' + part.Name + ' — ' + detail))
  if (problems.length) host.alert((host.TranslationLanguage === 'CN' ? '无法换算位移，已保留原记录：' : 'Original offsets retained: ') + problems.join(', '))
  return { data: converted, offsetFormat: converted.some(part => hasLegacyCoordinates(part?.Property)) ? 'old' : 'new' }
}
function prepareItem(bundle, host, character, onProblem) {
  const prop = bundle?.Property
  const overrides = prop?.LayerOverrides
  if (!hasLegacyCoordinates(prop)) return bundle
  const axes = [['DrawingLeft', 'X'], ['DrawingTop', 'Y']]
  if (overrides != null && !Array.isArray(overrides)) return bundle
  if (axes.some(([, axis]) => prop["Translation" + axis] != null || prop["LayerTranslation" + axis] != null)) return bundle
  if (overrides?.some(layer => !layer || Object.keys(layer).some(
    key => key !== 'DrawingLeft' && key !== 'DrawingTop'))) return bundle

  try {
    const version = host.GameVersion ?? (typeof GameVersion !== "undefined" ? GameVersion : null)
    const glVersion = host.GLVersion ?? (typeof GLVersion !== "undefined" ? GLVersion : null)
    const canvas = host.GLDrawCanvas ?? (typeof GLDrawCanvas !== "undefined" ? GLDrawCanvas : null)
    if (!/^R134(?:$|[^0-9])/.test(version) || !glVersion) return bundle
    const factor = glVersion === "No WebGL" ? 1 : canvas?.GL && !canvas.GL.isContextLost() ? 2 : null
    if (!factor) return bundle
    const copy = JSON.parse(JSON.stringify(bundle))
    delete copy.Property.LayerOverrides
    for (const [field] of axes) delete copy.Property[field]
    const item = host.ServerBundledItemToAppearanceItem((character ?? host.Player).AssetFamily, copy, { C: character })
    const layers = item?.Asset.Layer
    if (!layers?.length || (overrides && layers.length !== overrides.length)) return bundle
    const next = { ...prop }
    delete next.LayerOverrides
    for (const [field, axis] of axes) {
      const absolute = prop[field]
      if (absolute != null && (typeof absolute !== 'object' || Array.isArray(absolute) ||
        Object.keys(absolute).some(name => !layers.some(layer => (layer.Name ?? '') === name)))) return bundle
      const shifts = Object.create(null)
      for (const [i, layer] of layers.entries()) {
        const name = layer.Name ?? ''
        const slot = overrides?.[i]?.[field]
        if (slot != null && (absolute != null || Object.keys(slot).length !== 1 || !Number.isFinite(slot['']))) return bundle
        const coordinate = slot?.[''] ?? absolute?.[name]
        if (coordinate === undefined) continue
        const origin = host.PropertyLayerOrigin.getOriginal(item, field)[name] ?? host.PropertyLayerOrigin.resolveLayer(layer, field, item.Property)
        if (!Number.isFinite(coordinate) || !Number.isFinite(origin?.['']) || Object.keys(origin).length !== 1 ||
            layers.filter(other => (other.Name ?? '') === name).length !== 1) return bundle
        const shift = roundOffset((coordinate - origin['']) / factor)
        if (Math.abs(shift) > 500) {
          onProblem?.(bundle, field + "[" + name + "] = " + coordinate + " → " + shift + " (±500)")
          return bundle
        }
        if (shift) shifts[name] = shift
      }
      delete next[field]
      if (Object.keys(shifts).length) next['LayerTranslation' + axis] = shifts
    }
    return { ...bundle, Property: next }
  } catch {
    // Custom assets may be unavailable while the game is loading.
    return bundle
  }
}
