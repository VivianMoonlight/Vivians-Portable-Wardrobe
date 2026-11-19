export const compatibilityKey = 'vpw.halveLegacyOffsets'
export const patchedWebGLKey = 'vpw.patchedWebGL'
export function readOffsetSetting(host, key) {
  try { return host.localStorage.getItem(key) === 'true' } catch { return false }
}

const roundOffset = value => Math.sign(value) * Math.round(Math.abs(value))
const isScaled = value => Number.isFinite(value) && value !== 1

export function prepareOutfitOffsets(data, host, character) {
  if (!Array.isArray(data)) return data
  const enabled = readOffsetSetting(host, compatibilityKey)
  const patched = enabled && readOffsetSetting(host, patchedWebGLKey)
  return data.map(original => {
    const bundle = prepareItem(original, host, character)
    const prop = bundle?.Property
    if (!enabled || !prop) return bundle
    let transforms = prop
    // BC may serialize per-layer numeric records as strings in item bundles.
    if (['LayerScaleX', 'LayerScaleY', 'LayerTranslationX', 'LayerTranslationY']
      .some(key => typeof prop[key] === 'string')) {
      try {
        transforms = host.ServerBundledItemToAppearanceItem(character.AssetFamily,
          JSON.parse(JSON.stringify(bundle)), { C: character })?.Property
      } catch { return bundle }
      if (!transforms) return bundle
    }
    const scaled = [transforms.ScaleX, transforms.ScaleY,
      ...Object.values(transforms.LayerScaleX ?? {}), ...Object.values(transforms.LayerScaleY ?? {})].some(isScaled)
    const factor = (scaled ? 2 : 1) / (patched ? 1 : 2)
    if (factor === 1) return bundle
    const next = { ...prop }
    for (const axis of ['X', 'Y']) {
      const global = 'Translation' + axis
      const layer = 'LayerTranslation' + axis
      if (Number.isFinite(prop[global])) next[global] = roundOffset(prop[global] * factor)
      if (prop[layer] != null && transforms[layer] && typeof transforms[layer] === 'object') {
        next[layer] = Object.fromEntries(Object.entries(transforms[layer]).map(([name, value]) =>
          [name, Number.isFinite(value) ? roundOffset(value * factor) : value]))
      }
    }
    return { ...bundle, Property: next }
  })
}

function prepareItem(bundle, host, character) {
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
        const pose = character.DrawPose?.find(pose => origin?.[pose] != null) ?? ''
        const drawOrigin = origin?.[pose]
        if (Object.keys(coord).length !== 1 || !Number.isFinite(coord['']) ||
            !Number.isFinite(drawOrigin)) return bundle
        const offset = coord[''] - drawOrigin
        shifts.push(roundOffset(offset))
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
