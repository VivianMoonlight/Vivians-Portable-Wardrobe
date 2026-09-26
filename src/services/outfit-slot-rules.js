/** Shared, side-effect-free rules used by both the preview store and filter UI. */
/** @typedef {'original' | 'incoming' | 'empty'} SlotMode */
/** @typedef {'add' | 'replace' | 'full-replace'} GroupOperation */
/** @typedef {'none' | 'partial' | 'full'} ScopeState */
/** @typedef {{ Group?: string, Asset?: { Group?: { Name?: string, name?: string } } }} OutfitPart */
/** @typedef {Record<string, { mode?: string, locked?: boolean }>} SlotControlMap */

/** @type {SlotMode[]} */
export const SLOT_MODES = ['original', 'incoming', 'empty']
/** @type {GroupOperation[]} */
export const GROUP_OPERATIONS = ['add', 'replace', 'full-replace']

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
 * Group choices always resolve from the two source snapshots. Repeating the
 * cycle must restore the same result after a full replacement.
 * @param {SlotMode} source
 * @param {GroupOperation} operation
 * @param {boolean} inCharacter
 * @param {boolean} inIncoming
 * @returns {SlotMode}
 */
export function computeGroupSlotMode(source, operation, inCharacter, inIncoming) {
  if (source === 'empty') return 'empty'
  const fallback = source === 'incoming' ? 'original' : 'incoming'
  const sourcePresent = source === 'incoming' ? inIncoming : inCharacter
  const fallbackPresent = source === 'incoming' ? inCharacter : inIncoming
  if (operation === 'add') return fallbackPresent ? fallback : source
  if (operation === 'replace') return sourcePresent ? source : fallback
  return source
}

/**
 * @param {{ mode: string, operation: GroupOperation } | undefined} previous
 * @param {SlotMode} source
 * @returns {GroupOperation}
 */
export function nextGroupOperation(previous, source) {
  if (!previous || previous.mode !== source) return 'add'
  const index = GROUP_OPERATIONS.indexOf(previous.operation)
  return GROUP_OPERATIONS[(index + 1) % GROUP_OPERATIONS.length]
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
