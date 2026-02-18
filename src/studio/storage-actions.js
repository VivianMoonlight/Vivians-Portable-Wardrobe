/**
 * Storage Actions Module
 * Pure functions for import/export operations
 * These functions handle file I/O and localStorage operations
 */
import { toRaw } from 'vue'
import { hostWindow, setTimeoutHost } from '@/utils/host-window.js'

/**
 * Download JSON data as a file
 * @param {Object} data - Data to download
 * @param {string} filename - Default filename
 * @returns {boolean} True if successful
 */
export function downloadJsonFile(data, filename) {
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = hostWindow.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeoutHost(() => hostWindow.URL.revokeObjectURL(url), 5000)
    return true
  } catch (e) {
    console.warn('[storage-actions] downloadJsonFile failed', e)
    return false
  }
}

/**
 * Read JSON file
 * @param {File} file - File to read
 * @returns {Promise<Object>} Parsed JSON data
 */
export function readJsonFile(file) {
  return new Promise((resolve) => {
    if (!file) return resolve(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.target.result || ''))
        resolve(parsed)
      } catch (e) {
        console.warn('[storage-actions] readJsonFile parse failed', e)
        resolve(null)
      }
    }
    reader.onerror = () => resolve(null)
    reader.readAsText(file)
  })
}

/**
 * Export stacks to JSON file
 * @param {Object} state - Current store state
 * @param {string} filename - Default filename
 * @returns {boolean} True if successful
 */
export function exportStacksToJsonFile(state, filename = 'stacks.json') {
  const payload = { stacks: toRaw(state.stacks), _partUidCounter: state._partUidCounter }
  return downloadJsonFile(payload, filename)
}

/**
 * Import stacks from JSON file
 * @param {File} file - File to import
 * @returns {Promise<Object>} Import result { success, error }
 */
export async function importStacksFromJsonFile(file) {
  const parsed = await readJsonFile(file)
  if (!parsed) return { success: false, error: 'Failed to read file' }

  let stacksPayload = null
  if (Array.isArray(parsed)) {
    stacksPayload = parsed
  } else if (parsed && Array.isArray(parsed.stacks)) {
    stacksPayload = parsed.stacks
  }

  if (!stacksPayload) {
    return { success: false, error: 'Invalid stacks format' }
  }

  return {
    success: true,
    stacks: stacksPayload,
    _partUidCounter: parsed._partUidCounter
  }
}

/**
 * Export palette to JSON file
 * @param {Object} state - Current store state
 * @param {string} filename - Default filename
 * @returns {boolean} True if successful
 */
export function exportPaletteToJsonFile(state, filename = 'palette.json') {
  const payload = {
    paletteMap: toRaw(state.paletteMap),
    _paletteNextCounter: state._paletteNextCounter
  }
  return downloadJsonFile(payload, filename)
}

/**
 * Import palette from JSON file
 * @param {File} file - File to import
 * @returns {Promise<Object>} Import result { success, error, paletteMap, _paletteNextCounter }
 */
export async function importPaletteFromJsonFile(file) {
  const parsed = await readJsonFile(file)
  if (!parsed) return { success: false, error: 'Failed to read file' }

  let newMap = null
  if (parsed && parsed.paletteMap && typeof parsed.paletteMap === 'object') {
    newMap = parsed.paletteMap
  } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    newMap = parsed
  }

  if (!newMap) {
    return { success: false, error: 'Invalid palette format' }
  }

  return {
    success: true,
    paletteMap: newMap,
    _paletteNextCounter: parsed._paletteNextCounter
  }
}

/**
 * Export studio snapshot to JSON file
 * @param {Object} state - Current store state
 * @param {string} filename - Default filename
 * @returns {boolean} True if successful
 */
export function exportStudioSnapshot(state, filename = 'studio_snapshot.json') {
  const payload = {
    stacks: toRaw(state.stacks),
    paletteMap: toRaw(state.paletteMap),
    _paletteNextCounter: state._paletteNextCounter,
    _partUidCounter: state._partUidCounter
  }
  return downloadJsonFile(payload, filename)
}

/**
 * Import studio snapshot from JSON file
 * @param {File} file - File to import
 * @returns {Promise<Object>} Import result { success, error, data }
 */
export async function importStudioSnapshotFromFile(file) {
  const parsed = await readJsonFile(file)
  if (!parsed) return { success: false, error: 'Failed to read file' }

  if (!parsed) {
    return { success: false, error: 'Invalid snapshot format' }
  }

  return {
    success: true,
    data: {
      stacks: Array.isArray(parsed.stacks) ? parsed.stacks : [],
      paletteMap: (parsed.paletteMap && typeof parsed.paletteMap === 'object')
        ? parsed.paletteMap
        : {},
      _paletteNextCounter: parsed._paletteNextCounter || 1,
      _partUidCounter: parsed._partUidCounter || 1
    }
  }
}

/**
 * Persist stacks to localStorage
 * @param {Object} state - Current store state
 * @returns {boolean} True if successful
 */
export function persistStacksToLocalStorage(state) {
  try {
    const payload = {
      stacks: state.stacks,
      _partUidCounter: state._partUidCounter
    }
    hostWindow.localStorage.setItem('studio_stacks_v1', JSON.stringify(payload))
    return true
  } catch (e) {
    console.warn('[storage-actions] persistStacksToLocalStorage failed', e)
    return false
  }
}

/**
 * Load stacks from localStorage
 * @returns {Object|null} Loaded data or null
 */
export function loadStacksFromLocalStorage() {
  try {
    const raw = hostWindow.localStorage.getItem('studio_stacks_v1')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.stacks)) return null
    return {
      stacks: parsed.stacks,
      _partUidCounter: parsed._partUidCounter || 1
    }
  } catch (e) {
    console.warn('[storage-actions] loadStacksFromLocalStorage failed', e)
    return null
  }
}

/**
 * Persist palette to localStorage
 * @param {Object} state - Current store state
 * @returns {boolean} True if successful
 */
export function persistPaletteToLocalStorage(state) {
  try {
    const payload = {
      paletteMap: state.paletteMap,
      _paletteNextCounter: state._paletteNextCounter
    }
    hostWindow.localStorage.setItem('studio_palette_v1', JSON.stringify(payload))
    return true
  } catch (e) {
    console.warn('[storage-actions] persistPaletteToLocalStorage failed', e)
    return false
  }
}

/**
 * Load palette from localStorage
 * @returns {Object|null} Loaded data or null
 */
export function loadPaletteFromLocalStorage() {
  try {
    const raw = hostWindow.localStorage.getItem('studio_palette_v1')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !parsed.paletteMap) return null
    return {
      paletteMap: parsed.paletteMap || {},
      _paletteNextCounter: parsed._paletteNextCounter || 1
    }
  } catch (e) {
    console.warn('[storage-actions] loadPaletteFromLocalStorage failed', e)
    return null
  }
}
