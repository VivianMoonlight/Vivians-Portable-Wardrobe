/**
 * Save Actions Module
 * Pure functions for auto-save operations
 * These functions handle save status and studio storage
 */
import { toRaw } from 'vue'
import LZString from 'lz-string'
import { hostWindow, setTimeoutHost, clearTimeoutHost } from '@/utils/host-window.js'
import { StudioStorageService } from '@/services/StudioStorageService'
import { SAVE_STATUS_IDLE, SAVE_STATUS_SAVING, SAVE_STATUS_SAVED, SAVE_STATUS_ERROR } from './constants.js'

/**
 * Enable auto-save
 * @returns {Object} Updated state
 */
export function enableAutoSave() {
  return { autoSaveEnabled: true }
}

/**
 * Disable auto-save
 * @returns {Object} Updated state
 */
export function disableAutoSave() {
  return { autoSaveEnabled: false }
}

/**
 * Save state to localStorage with compression
 * @param {Object} state - Current store state
 * @returns {Promise<Object>} Save result { success, saveStatus, lastSaveTime }
 */
export async function saveToLocalStorage(state) {
  try {
    const dataToSave = {
      version: '1.0',
      timestamp: Date.now(),
      data: {
        stacks: toRaw(state.stacks),
        paletteMap: toRaw(state.paletteMap),
        _paletteNextCounter: state._paletteNextCounter,
        _partUidCounter: state._partUidCounter,
        selectedIndex: state.selectedIndex,
        focusedPartIndex: state.focusedPartIndex
      }
    }

    const jsonString = JSON.stringify(dataToSave)
    const compressed = LZString.compress(jsonString)

    hostWindow.localStorage.setItem('studio-autosave', compressed)

    return {
      success: true,
      saveStatus: SAVE_STATUS_SAVED,
      lastSaveTime: Date.now()
    }
  } catch (error) {
    console.error('[save-actions] saveToLocalStorage failed', error)

    // If quota exceeded, try to provide fallback
    if (error.name === 'QuotaExceededError') {
      console.warn('[save-actions] LocalStorage quota exceeded, falling back to download')
    }

    return {
      success: false,
      saveStatus: SAVE_STATUS_ERROR,
      error: error.message
    }
  }
}

/**
 * Restore state from localStorage
 * @returns {Promise<Object>} Restore result { restored, reason, data, timestamp, age }
 */
export async function restoreFromLocalStorage() {
  try {
    const compressed = hostWindow.localStorage.getItem('studio-autosave')
    if (!compressed) {
      return { restored: false, reason: 'no-data' }
    }

    const jsonString = LZString.decompress(compressed)
    if (!jsonString) {
      throw new Error('Failed to decompress data')
    }

    const savedData = JSON.parse(jsonString)

    // Check version compatibility
    if (savedData.version !== '1.0') {
      console.warn('[save-actions] Incompatible autosave version:', savedData.version)
      return { restored: false, reason: 'incompatible-version' }
    }

    // Check if data is too old (>7 days)
    const age = Date.now() - savedData.timestamp
    const maxAge = 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
    if (age > maxAge) {
      console.log('[save-actions] Autosave data is too old, ignoring')
      return { restored: false, reason: 'too-old', age }
    }

    return {
      restored: true,
      data: savedData.data,
      timestamp: savedData.timestamp,
      age
    }
  } catch (error) {
    console.error('[save-actions] restoreFromLocalStorage failed', error)

    // Clear corrupted data
    try {
      hostWindow.localStorage.removeItem('studio-autosave')
    } catch (e) {
      console.error('[save-actions] Failed to clear corrupted data', e)
    }

    return { restored: false, reason: 'error', error: error.message }
  }
}

/**
 * Clear auto-saved data from localStorage
 * @returns {boolean} True if successful
 */
export function clearLocalStorage() {
  try {
    hostWindow.localStorage.removeItem('studio-autosave')
    return true
  } catch (error) {
    console.error('[save-actions] clearLocalStorage failed', error)
    return false
  }
}

/**
 * Get information about auto-saved data
 * @returns {Promise<Object>} Auto-save info { exists, timestamp, age, version, size, stackCount }
 */
export async function getAutoSaveInfo() {
  try {
    const compressed = hostWindow.localStorage.getItem('studio-autosave')
    if (!compressed) {
      return { exists: false }
    }

    const jsonString = LZString.decompress(compressed)
    if (!jsonString) {
      return { exists: false, error: 'Failed to decompress' }
    }

    const savedData = JSON.parse(jsonString)

    return {
      exists: true,
      timestamp: savedData.timestamp,
      age: Date.now() - savedData.timestamp,
      version: savedData.version,
      size: compressed.length,
      stackCount: savedData.data?.stacks?.length || 0
    }
  } catch (error) {
    console.error('[save-actions] getAutoSaveInfo failed', error)
    return { exists: false, error: error.message }
  }
}

/**
 * Auto-save to quick save slot using StudioStorageService
 * @param {Object} state - Current store state
 * @returns {Object} Save result { success, saveStatus, lastSaveTime, error }
 */
export function autoSave(state) {
  const data = {
    stacks: toRaw(state.stacks),
    paletteMap: toRaw(state.paletteMap),
    _paletteNextCounter: state._paletteNextCounter,
    _partUidCounter: state._partUidCounter,
    selectedIndex: state.selectedIndex
  }

  const result = StudioStorageService.createSave('Quick Save', data, true)
  if (result.success) {
    return {
      success: true,
      saveStatus: SAVE_STATUS_SAVED,
      lastSaveTime: Date.now()
    }
  } else {
    return {
      success: false,
      saveStatus: SAVE_STATUS_ERROR,
      error: result.error
    }
  }
}

/**
 * Manual save with custom name
 * @param {Object} state - Current store state
 * @param {string} name - Save name
 * @returns {Object} Save result { success, id, saveStatus, lastSaveTime, error }
 */
export function saveStudioSession(state, name) {
  const data = {
    stacks: toRaw(state.stacks),
    paletteMap: toRaw(state.paletteMap),
    _paletteNextCounter: state._paletteNextCounter,
    _partUidCounter: state._partUidCounter,
    selectedIndex: state.selectedIndex
  }

  const result = StudioStorageService.createSave(name, data, false)
  if (result.success) {
    return {
      success: true,
      id: result.id,
      saveStatus: SAVE_STATUS_SAVED,
      lastSaveTime: Date.now()
    }
  } else {
    return {
      success: false,
      saveStatus: SAVE_STATUS_ERROR,
      error: result.error
    }
  }
}

/**
 * Load a save by ID
 * @param {string} id - Save ID
 * @returns {Object} Load result { success, error, data }
 */
export function loadStudioSession(id) {
  const result = StudioStorageService.loadSave(id)
  if (result.success) {
    return {
      success: true,
      data: result.data
    }
  } else {
    return {
      success: false,
      error: result.error
    }
  }
}

/**
 * Auto-restore from quick save on studio open
 * @returns {Object} Restore result { restored, save, reason }
 */
export function autoRestoreSession() {
  const autoSave = StudioStorageService.getAutoSave()
  if (!autoSave) return { restored: false }

  // Check if save is recent (< 7 days)
  const ageMs = Date.now() - autoSave.timestamp
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  if (ageDays > 7) return { restored: false, reason: 'too-old' }

  const result = loadStudioSession(autoSave.id)
  if (result.success) {
    return { restored: true, save: autoSave }
  }
  return { restored: false }
}

/**
 * Get merged appearance for export
 * @param {Object} state - Current store state
 * @returns {Object} Merged appearance data
 */
export function getMergedAppearanceForExport(state) {
  try {
    return { data: state.mergedAppearanceData.data || [] }
  } catch (e) {
    return { data: [] }
  }
}
