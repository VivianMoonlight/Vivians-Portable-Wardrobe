const halfOffsetKey = 'vpw.halveLegacyOffsets'
export function halveLegacyOffsets(host) {
  try { return host.localStorage.getItem(halfOffsetKey) === 'true' } catch { return false }
}

export function setHalveLegacyOffsets(host, enabled) {
  host.localStorage.setItem(halfOffsetKey, String(enabled))
}

// Translate legacy absolute coordinates on the appearance bundle passed to BC.
export function prepareOutfitOffsets(data, host, character) {
  if (!Array.isArray(data) || !host.PropertyLayerOrigin?.getOriginal ||
      !host.ServerBundledItemToAppearanceItem) return data
  const divisor = halveLegacyOffsets(host) ? 2 : 1
  return data.map(bundle => prepareItem(bundle, host, character, divisor))
}

function prepareItem(bundle, host, character, divisor) {
  const prop = bundle?.Property
  const overrides = prop?.LayerOverrides
  if (!Array.isArray(overrides) || !overrides.length) return bundle
  const axes = [['DrawingLeft', 'X'], ['DrawingTop', 'Y']]
  if (overrides.some(layer => !layer || Object.keys(layer).some(
    key => key !== 'DrawingLeft' && key !== 'DrawingTop'))) return bundle

  try {
    const copy = JSON.parse(JSON.stringify(bundle))
    delete copy.Property.LayerOverrides
    const item = host.ServerBundledItemToAppearanceItem(character.AssetFamily, copy, { C: character })
    const layers = item?.Asset.Layer
    if (layers?.length !== overrides.length) return bundle
    const next = { ...prop }
    delete next.LayerOverrides
    for (const [field, axis] of axes) {
      const globalKey = 'Translation' + axis
      const layerKey = 'LayerTranslation' + axis
      if (prop[field] != null || prop[globalKey] != null || prop[layerKey] != null) continue
      const origins = host.PropertyLayerOrigin.getOriginal(item, field)
      const shifts = []
      for (const [index, override] of overrides.entries()) {
        const coord = override[field]
        if (coord == null) { shifts.push(0); continue }
        const layer = layers[index]
        const origin = origins[layer.Name ?? ''] ?? host.PropertyLayerOrigin.resolveLayer(layer, field, item.Property)
        if (Object.keys(coord).length !== 1 || !Number.isFinite(coord['']) ||
            !Number.isFinite(origin?.[''])) return bundle
        const offset = (coord[''] - origin['']) / divisor
        shifts.push(Math.sign(offset) * Math.round(Math.abs(offset)))
      }
      if (shifts.every(value => value === shifts[0])) {
        if (shifts[0]) next[globalKey] = shifts[0]
      } else {
        const named = {}
        for (const [i, value] of shifts.entries()) {
          if (!value) continue
          const name = layers[i].Name
          if (!name || layers.filter(layer => layer.Name === name).length !== 1) return bundle
          named[name] = value
        }
        next[layerKey] = named
      }
    }
    return { ...bundle, Property: next }
  } catch {
    // Custom assets may be unavailable while the game is loading.
    return bundle
  }
}
