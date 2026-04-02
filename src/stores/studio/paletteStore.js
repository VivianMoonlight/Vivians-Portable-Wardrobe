import { defineStore } from 'pinia'
import { fastClone } from '@/utils/clone.js'
import * as Palette from '@/services/PaletteService'
import * as PaletteActions from '@/studio/palette-actions.js'
import { PANEL_HOST, PANEL_VISIBILITY } from '@/studio/panel-system'

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
    },

    beginInteraction(studio, source = 'PalettePanel') {
      return studio?.beginInteraction?.('palette', { source })
    },

    commitInteraction(studio) {
      try {
        return !!studio?.commitInteraction?.()
      } catch (e) {
        return false
      }
    },

    forceEndRealtimeScope(studio, payload = {}) {
      try {
        return !!studio?.forceEndRealtimeScope?.('palette', {
          commit: true,
          interactionKind: 'palette',
          ...payload
        })
      } catch (e) {
        return false
      }
    },

    applyDelta(studio, command) {
      return studio?.applyDelta?.(command)
    },

    applyColorToActivePaletteTargets(studio, newColor, options = {}) {
      return studio?.applyColorToActivePaletteTargets?.(newColor, options)
    },

    applyTagToActivePaletteTargets(studio, tag, options = {}) {
      return studio?.applyTagToActivePaletteTargets?.(tag, options)
    },

    applyTagOffsetToActivePaletteTargets(studio, payload = {}, options = {}) {
      return studio?.applyTagOffsetToActivePaletteTargets?.(payload, options)
    },

    resetTagOffsetToTag(studio, tag, options = {}) {
      return studio?.resetTagOffsetToTag?.(tag, options)
    },

    detachTagOffsetToRaw(studio, payload = {}) {
      return studio?.detachTagOffsetToRaw?.(payload)
    },

    updatePaletteTag(studio, tag, newValue, options = {}) {
      return studio?.updatePaletteTag?.(tag, newValue, options)
    },

    renamePaletteTagAndReferences(studio, oldTag, newTag) {
      return studio?.renamePaletteTagAndReferences?.(oldTag, newTag)
    },

    deletePaletteTag(studio, tag) {
      return studio?.deletePaletteTag?.(tag)
    },

    createTagAndReplaceInStacks(studio, value) {
      return studio?.createTagAndReplaceInStacks?.(value)
    },

    _normalizeHistoryMeta(studio, actionType) {
      if (!studio || typeof studio._normalizeHistoryMeta !== 'function') return null
      return studio._normalizeHistoryMeta(null, actionType)
    },

    addSavedColor(studio, value) {
      const result = PaletteActions.addSavedColor(this, value)
      this.savedColors = result.savedColors
      this._paletteVersion = result._paletteVersion
      studio?.pushHistorySnapshot?.(this._normalizeHistoryMeta(studio, 'palette.savedColor.add'))
      return true
    },

    updateSavedColor(studio, idx, value) {
      if (typeof idx !== 'number' || idx < 0 || idx >= (this.savedColors || []).length) return false
      const result = PaletteActions.updateSavedColor(this, idx, value)
      this.savedColors = result.savedColors
      this._paletteVersion = result._paletteVersion
      studio?.pushHistorySnapshot?.(this._normalizeHistoryMeta(studio, 'palette.savedColor.update'))
      return true
    },

    deleteSavedColor(studio, idx) {
      if (typeof idx !== 'number' || idx < 0 || idx >= (this.savedColors || []).length) return false
      const result = PaletteActions.deleteSavedColor(this, idx)
      this.savedColors = result.savedColors
      this._paletteVersion = result._paletteVersion
      studio?.pushHistorySnapshot?.(this._normalizeHistoryMeta(studio, 'palette.savedColor.delete'))
      return true
    },

    clearSavedColors(studio) {
      if (!this.savedColors || this.savedColors.length === 0) return false
      this.savedColors = []
      this._paletteVersion += 1
      studio?.pushHistorySnapshot?.(this._normalizeHistoryMeta(studio, 'palette.savedColor.clear'))
      return true
    },

    setPaletteMode(studio, active = false, targets = []) {
      this.paletteModeActive = !!active
      if (!this.paletteModeActive) {
        this.paletteUpdateFlag += 1
        return
      }

      if (Array.isArray(targets) && targets.length > 0) {
        studio?._applyPaletteTargetsToSelection?.(targets)
      }

      const selectedLayers = Array.isArray(studio?.selectedLayers) ? studio.selectedLayers : []
      if (selectedLayers.length > 0) {
        studio?.setPropertyFocus?.('color')
      }

      this.paletteUpdateFlag += 1
    },

    clearPaletteMode(studio) {
      this.paletteModeActive = false
      this.paletteUpdateFlag += 1
    },

    setPaletteWorkMode(studio, mode = 'external') {
      this.paletteWorkMode = mode
    },

    openPalettePanel(studio, targets = []) {
      try {
        studio?._syncPanelDomainState?.()
        this.setPaletteMode(studio, true, targets)
        this.setPaletteWorkMode(studio, 'external')
        const nextState = (studio?.panelRuntime?.palette?.state === PANEL_VISIBILITY.PINNED)
          ? PANEL_VISIBILITY.PINNED
          : PANEL_VISIBILITY.PEEK
        studio?.openPanel?.('palette', {
          host: PANEL_HOST.TOOL_DOCK,
          state: nextState,
          reason: 'open-palette-panel'
        })
      } catch (e) {
        studio.palettePanelVisible = true
      }
      studio?.persistUiLayout?.()
    },

    closePalettePanel(studio, options = {}) {
      const forceClose = options?.forceClose === true
      const reason = String(options?.reason || 'close-palette-panel')
      try {
        studio?._syncPanelDomainState?.()
        if (forceClose || studio?.panelRuntime?.palette?.state !== PANEL_VISIBILITY.PINNED) {
          studio?.closePanel?.('palette', { reason })
        }
      } finally {
        try {
          const committed = this.commitInteraction(studio)
          if (!committed) {
            this.forceEndRealtimeScope(studio, {
              commit: true,
              interactionKind: 'palette'
            })
          }
        } catch (e) { console.warn(e) }
        try { this.clearPaletteMode(studio) } catch (e) { console.warn(e) }
      }
      studio?.persistUiLayout?.()
    }
  }
})

export default useStudioPaletteStore
