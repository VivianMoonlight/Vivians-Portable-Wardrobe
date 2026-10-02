import { isHiddenBodySlot } from './hidden-body-slots.js'

function editorError(code, message) {
  return Object.assign(new Error(message), { code })
}

function cloneBundle(bundle) {
  if (!Array.isArray(bundle)) throw editorError('invalid-bundle', 'Outfit data must be an array')
  return structuredClone(bundle)
}

function getGroup(groupName, resolveGroup) {
  if (typeof groupName !== 'string' || !groupName.trim() || groupName !== groupName.trim()) {
    throw editorError('invalid-group', 'Choose a valid appearance group')
  }
  if (isHiddenBodySlot(groupName)) {
    throw editorError('protected-group', 'This body group cannot be edited')
  }
  const group = typeof resolveGroup === 'function' ? resolveGroup(groupName) : null
  if (!group || (group.Name && group.Name !== groupName)) {
    throw editorError('invalid-group', 'Appearance group is unavailable')
  }
  return group
}

function getAsset(groupName, assetName, group, resolveAsset) {
  if (typeof assetName !== 'string' || !assetName.trim() || assetName !== assetName.trim()) {
    throw editorError('invalid-asset', 'Choose a valid asset')
  }
  const asset = typeof resolveAsset === 'function'
    ? resolveAsset(groupName, assetName)
    : group.Asset?.find(candidate => candidate?.Name === assetName)
  if (!asset || asset.Name !== assetName || (asset.Group?.Name && asset.Group.Name !== groupName)) {
    throw editorError('invalid-asset', 'Asset is unavailable in this group')
  }
  return asset
}

function isItemGroup(group) {
  return group.Category === 'Item' || (typeof group.IsItem === 'function' && group.IsItem())
}

function replaceGroup(bundle, groupName, replacement) {
  const result = []
  let found = false
  for (const part of bundle) {
    if (part?.Group !== groupName) {
      result.push(part)
    } else if (!found) {
      if (replacement) result.push(replacement)
      found = true
    }
  }
  if (!found && replacement) result.push(replacement)
  return result
}

function validColor(color, schema) {
  return typeof color === 'string'
    && (schema.includes(color) || /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color))
}

/** Create an isolated JSON-compatible draft of a saved appearance bundle. */
export function createOutfitDraft(bundle) {
  return cloneBundle(bundle)
}

/** List the editable saved parts, with one visible record per BC group. */
export function listOutfitParts(bundle) {
  const seen = new Set()
  return cloneBundle(bundle).filter(part => {
    if (typeof part?.Group !== 'string' || isHiddenBodySlot(part.Group) || seen.has(part.Group)) return false
    seen.add(part.Group)
    return true
  })
}

/** Add or replace a group asset. New assets must not inherit the old asset's settings. */
export function setOutfitAsset(bundle, groupName, assetName, { resolveGroup, resolveAsset } = {}) {
  const group = getGroup(groupName, resolveGroup)
  getAsset(groupName, assetName, group, resolveAsset)
  const replacement = { Group: groupName, Name: assetName, IsItem: isItemGroup(group) }
  return replaceGroup(cloneBundle(bundle), groupName, replacement)
}

/** Remove an optional appearance group from a saved outfit. */
export function removeOutfitAsset(bundle, groupName, { resolveGroup } = {}) {
  const group = getGroup(groupName, resolveGroup)
  if (group.AllowNone === false) throw editorError('required-group', 'This appearance group cannot be empty')
  return replaceGroup(cloneBundle(bundle), groupName, null)
}

/** Change one saved group's color without discarding its Property or Craft data. */
export function setOutfitColor(bundle, groupName, color, { resolveGroup, resolveAsset } = {}) {
  const group = getGroup(groupName, resolveGroup)
  const draft = cloneBundle(bundle)
  const part = draft.find(item => item?.Group === groupName)
  if (!part) throw editorError('missing-part', 'Add an asset to this group before setting its color')
  const asset = getAsset(groupName, part.Name, group, resolveAsset)
  const schema = Array.isArray(group.ColorSchema)
    ? group.ColorSchema
    : [group.DefaultColor || 'Default']

  if (color !== null) {
    const valid = Array.isArray(color)
      ? color.length > 0
        && (!Number.isInteger(asset.ColorableLayerCount) || color.length <= asset.ColorableLayerCount)
        && color.every(value => validColor(value, schema))
      : validColor(color, schema)
    if (!valid) throw editorError('invalid-color', 'Color is not accepted for this asset')
  }

  const replacement = { ...part }
  if (color === null) delete replacement.Color
  else replacement.Color = structuredClone(color)
  return replaceGroup(draft, groupName, replacement)
}
