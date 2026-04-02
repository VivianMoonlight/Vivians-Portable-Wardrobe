import { defineStore } from 'pinia'
import { fastClone } from '@/utils/clone.js'
import * as Palette from '@/services/PaletteService'

function createDefaultPaletteState() {
  return {
    paletteMap: {},
    savedColors: [],
    _paletteNextCounter: 1,
    _paletteVersion: 0,
    paletteModeActive: false,
    paletteWorkMode: 'external',
    paletteUpdateFlag: 0,
    _paletteRealtimeMode: false,
    _paletteRealtimeDirty: false,
    _paletteRealtimeHistoryMeta: null,
    _paletteRealtimeInteractionKind: null
  }
}

export const useStudioPaletteStore = defineStore('studioPalette', {
  state: () => createDefaultPaletteState(),

  getters: {
    paletteSnapshot(state) {
      return Palette.paletteSnapshot(state.paletteMap)
    }
  },

  actions: {
    syncFromLegacyState(payload = {}) {
      const defaults = createDefaultPaletteState()

      this.paletteMap = fastClone(payload.paletteMap || defaults.paletteMap)
      this.savedColors = Array.isArray(payload.savedColors) ? fastClone(payload.savedColors) : []
      this._paletteNextCounter = (typeof payload._paletteNextCounter === 'number' && payload._paletteNextCounter >= 1)
        ? payload._paletteNextCounter
        : defaults._paletteNextCounter
      this._paletteVersion = (typeof payload._paletteVersion === 'number' && payload._paletteVersion >= 0)
        ? payload._paletteVersion
        : defaults._paletteVersion
      this.paletteModeActive = payload.paletteModeActive === true
      this.paletteWorkMode = String(payload.paletteWorkMode || defaults.paletteWorkMode)
      this.paletteUpdateFlag = (typeof payload.paletteUpdateFlag === 'number' && payload.paletteUpdateFlag >= 0)
        ? payload.paletteUpdateFlag
        : defaults.paletteUpdateFlag
      this._paletteRealtimeMode = payload._paletteRealtimeMode === true
      this._paletteRealtimeDirty = payload._paletteRealtimeDirty === true
      this._paletteRealtimeHistoryMeta = payload._paletteRealtimeHistoryMeta || defaults._paletteRealtimeHistoryMeta
      this._paletteRealtimeInteractionKind = payload._paletteRealtimeInteractionKind || defaults._paletteRealtimeInteractionKind
    }
  }
})

export default useStudioPaletteStore
