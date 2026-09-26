/** Shared, side-effect-free rules used by both the preview store and filter UI. */
/** @typedef {'original' | 'incoming' | 'empty'} SlotMode */
/** @typedef {'add' | 'replace' | 'full-replace'} GroupOperation */
/** @typedef {'none' | 'partial' | 'full'} ScopeState */
/** @typedef {{ Group?: string, Asset?: { Group?: { Name?: string, name?: string } } }} OutfitPart */
/** @typedef {Record<string, { mode?: string, locked?: boolean }>} SlotControlMap */

/** @type {SlotMode[]} */
export const SLOT_MODES = ['original', 'incoming', 'empty']
/** @param {unknown} mode @returns {SlotMode} */
export function normalizeSlotMode(mode) {
  return SLOT_MODES.includes(/** @type {SlotMode} */ (mode)) ? /** @type {SlotMode} */ (mode) : 'empty'
}

/** @param {OutfitPart | null | undefined} part */
export function getGroupNameFromPart(part) {
  return part?.Group || part?.Asset?.Group?.Name || part?.Asset?.Group?.name || ''
}

/** @template {OutfitPart} T @param {T[]} parts @returns {Map<string, T[]>} */
export function groupPartsBySlot(parts = []) {
  const grouped = new Map()
  for (const part of Array.isArray(parts) ? parts : []) {
    const key = getGroupNameFromPart(part)
    if (!key) continue
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(part)
  }
  return grouped
}

/** @param {OutfitPart[]} characterData @param {OutfitPart[]} incomingData */
export function buildPresenceSets(characterData = [], incomingData = []) {
  return {
    inCharacter: new Set((characterData || []).map(getGroupNameFromPart).filter(Boolean)),
    inIncoming: new Set((incomingData || []).map(getGroupNameFromPart).filter(Boolean)),
  }
}

/** @param {OutfitPart[]} characterData @param {OutfitPart[]} incomingData */
export function buildSlotPresenceMap(characterData = [], incomingData = []) {
  const { inCharacter, inIncoming } = buildPresenceSets(characterData, incomingData)
  /** @type {Record<string, { inCharacter: boolean, inHover: boolean }>} */
  const presence = {}
  for (const key of new Set([...inCharacter, ...inIncoming])) {
    presence[key] = { inCharacter: inCharacter.has(key), inHover: inIncoming.has(key) }
  }
  return presence
}

/**
 * Add and replace change only the slots they affect. A manually cleared slot
 * stays cleared unless the chosen source supplies it or full replacement runs.
 * @param {SlotMode} source
 * @param {GroupOperation} operation
 * @param {SlotMode} currentMode
 * @param {boolean} inCharacter
 * @param {boolean} inIncoming
 * @returns {SlotMode}
 */
export function computeGroupSlotMode(source, operation, currentMode, inCharacter, inIncoming) {
  if (source === 'empty') return 'empty'
  const sourcePresent = source === 'incoming' ? inIncoming : inCharacter
  const currentPresent = currentMode === 'original' ? inCharacter : currentMode === 'incoming' && inIncoming
  if (operation === 'add') return sourcePresent && !currentPresent ? source : currentMode
  if (operation === 'replace') return sourcePresent ? source : currentMode
  return source
}

// Bundles are JSON records. Compare all saved details while ignoring object-key
// order and undefined fields that do not survive the preview snapshot.
function equalBundleValue(left, right) {
  if (left === right) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => equalBundleValue(value, right[index]))
  }
  const leftKeys = Object.keys(left).filter(key => left[key] !== undefined)
  const rightKeys = Object.keys(right).filter(key => right[key] !== undefined)
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => Object.hasOwn(right, key) && equalBundleValue(left[key], right[key]))
}

/**
 * Choose the first operation that can still improve the current group. Empty
 * source groups proceed to full replacement so they can clear existing parts.
 * @param {string[]} keys
 * @param {OutfitPart[]} currentData
 * @param {OutfitPart[]} sourceData
 * @returns {GroupOperation}
 */
export function nextGroupOperation(keys, currentData, sourceData) {
  const current = groupPartsBySlot(currentData)
  const source = groupPartsBySlot(sourceData)
  const suppliedKeys = keys.filter(key => source.has(key))
  if (suppliedKeys.some(key => !current.has(key))) return 'add'
  if (suppliedKeys.some(key => !equalBundleValue(current.get(key), source.get(key)))) return 'replace'
  return 'full-replace'
}

/**
 * @param {string[]} keys
 * @param {SlotMode} targetMode
 * @param {SlotControlMap} controls
 * @param {Set<string>} inCharacter
 * @param {Set<string>} inIncoming
 * @returns {ScopeState}
 */
export function scopeModeState(keys, targetMode, controls, inCharacter, inIncoming) {
  if (keys.length === 0) return 'none'
  const isTarget = (key) => normalizeSlotMode(controls[key]?.mode) === targetMode
  if (keys.every(isTarget)) return 'full'
  if (targetMode === 'empty') return 'none'
  const presence = targetMode === 'original' ? inCharacter : inIncoming
  const relevant = keys.filter((key) => presence.has(key))
  return relevant.length > 0 && relevant.every(isTarget) ? 'partial' : 'none'
}

/**
 * Preserve character-slot order, append incoming-only slots, and retain every
 * part in a slot. Controls for absent slots cannot contribute any bundle items.
 * @template {OutfitPart} T
 * @param {T[]} characterData
 * @param {T[]} incomingData
 * @param {SlotControlMap} controls
 * @returns {T[]}
 */
export function buildOutfitBundle(characterData, incomingData, controls = {}) {
  const original = groupPartsBySlot(characterData)
  const incoming = groupPartsBySlot(incomingData)
  const bundle = []
  for (const key of new Set([...original.keys(), ...incoming.keys()])) {
    const mode = normalizeSlotMode(controls[key]?.mode)
    if (mode === 'original') bundle.push(...(original.get(key) || []))
    if (mode === 'incoming') bundle.push(...(incoming.get(key) || []))
  }
  return bundle
}
