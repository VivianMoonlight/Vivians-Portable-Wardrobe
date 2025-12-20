import LZString from 'lz-string'
import { hostWindow } from '@/utils/host-window.js'

const SAVES_LIST_KEY = 'studio-saves-list'
const SAVE_DATA_PREFIX = 'studio-save-'
const AUTOSAVE_ID = '__autosave__'
const MAX_SAVES = 50 // Limit number of saves

export class StudioStorageService {
  /**
   * Get list of all saves
   */
  static getSavesList() {
    try {
      const raw = hostWindow.localStorage.getItem(SAVES_LIST_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed.saves) ? parsed.saves : []
    } catch (e) {
      console.warn('Failed to load saves list', e)
      return []
    }
  }

  /**
   * Save saves list to localStorage
   */
  static _saveSavesList(saves) {
    try {
      const data = { version: '1.0', saves }
      hostWindow.localStorage.setItem(SAVES_LIST_KEY, JSON.stringify(data))
      return true
    } catch (e) {
      console.error('Failed to save saves list', e)
      return false
    }
  }

  /**
   * Generate unique ID
   */
  static _generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 11)
  }

  /**
   * Create a new save
   */
  static createSave(name, studioData, isAutoSave = false) {
    try {
      const saves = this.getSavesList()
      
      // Check limit (excluding autosave)
      const userSaves = saves.filter(s => !s.isAutoSave)
      if (!isAutoSave && userSaves.length >= MAX_SAVES) {
        throw new Error(`Maximum ${MAX_SAVES} saves reached`)
      }

      // For autosave, reuse same ID
      const id = isAutoSave ? AUTOSAVE_ID : this._generateId()
      
      // Remove existing autosave entry if creating new autosave
      let updatedSaves = saves
      if (isAutoSave) {
        updatedSaves = saves.filter(s => s.id !== AUTOSAVE_ID)
      }

      // Prepare save entry
      const dataStr = JSON.stringify(studioData)
      const compressed = LZString.compress(dataStr)
      const dataSize = new Blob([compressed]).size

      const saveEntry = {
        id,
        name: name || (isAutoSave ? 'Quick Save' : 'Untitled'),
        timestamp: Date.now(),
        isAutoSave,
        dataSize
      }

      // Save data
      const saveKey = SAVE_DATA_PREFIX + id
      hostWindow.localStorage.setItem(saveKey, compressed)

      // Update saves list
      updatedSaves.push(saveEntry)
      this._saveSavesList(updatedSaves)

      return { success: true, id }
    } catch (e) {
      console.error('Failed to create save', e)
      return { success: false, error: e.message }
    }
  }

  /**
   * Load save data by ID
   */
  static loadSave(id) {
    try {
      const saveKey = SAVE_DATA_PREFIX + id
      const compressed = hostWindow.localStorage.getItem(saveKey)
      if (!compressed) {
        throw new Error('Save not found')
      }
      const decompressed = LZString.decompress(compressed)
      const data = JSON.parse(decompressed)
      return { success: true, data }
    } catch (e) {
      console.error('Failed to load save', e)
      return { success: false, error: e.message }
    }
  }

  /**
   * Rename a save
   */
  static renameSave(id, newName) {
    try {
      const saves = this.getSavesList()
      const save = saves.find(s => s.id === id)
      if (!save) throw new Error('Save not found')
      
      save.name = newName
      this._saveSavesList(saves)
      return { success: true }
    } catch (e) {
      console.error('Failed to rename save', e)
      return { success: false, error: e.message }
    }
  }

  /**
   * Delete a save
   */
  static deleteSave(id) {
    try {
      const saves = this.getSavesList()
      const updatedSaves = saves.filter(s => s.id !== id)
      
      // Remove data
      const saveKey = SAVE_DATA_PREFIX + id
      hostWindow.localStorage.removeItem(saveKey)
      
      // Update list
      this._saveSavesList(updatedSaves)
      return { success: true }
    } catch (e) {
      console.error('Failed to delete save', e)
      return { success: false, error: e.message }
    }
  }

  /**
   * Get autosave (if exists)
   */
  static getAutoSave() {
    const saves = this.getSavesList()
    return saves.find(s => s.isAutoSave) || null
  }

  /**
   * Get total storage usage
   */
  static getStorageInfo() {
    const saves = this.getSavesList()
    const totalSize = saves.reduce((sum, s) => sum + (s.dataSize || 0), 0)
    return {
      totalSaves: saves.length,
      totalSize,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2)
    }
  }
}
