import { defineStore } from 'pinia'
import { fastClone } from '@/utils/clone.js'
import * as Palette from '@/services/PaletteService'
import * as PaletteActions from '@/studio/palette-actions.js'
import { PANEL_HOST, PANEL_VISIBILITY } from '@/studio/panel-system'
import { isStudioFacadeEnabled } from '@/config/featureFlags'

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
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return studio.execute({
          type: 'palette.applyColor',
          payload: { newColor },
          meta: { deferCommit: options?.deferCommit === true }
        })
      }

      const deferCommit = options?.deferCommit === true || this._paletteRealtimeMode === true
      const normalizedColorText = newColor === undefined || newColor === null ? '' : String(newColor)

      let changed = studio._applyPaletteColorViaLayerDeltas(normalizedColorText).changed

      if (!changed) {
        changed = PaletteActions.applyColorToTargets(this, normalizedColorText, {
          paletteModeActive: this.paletteModeActive,
          activePaletteTargets: studio.activePaletteTargets,
          stacks: studio.stacks,
          findPartByUid: studio.findPartByUid.bind(studio),
          _buildLayerEntriesWithCache: studio._buildLayerEntriesWithCache.bind(studio),
          _scheduleLayerRefresh: studio._scheduleLayerRefresh.bind(studio),
          _schedulePartUpdate: (() => {}),
          triggerFocusedPartUpdate: studio.triggerFocusedPartUpdate.bind(studio),
          pushHistorySnapshotThrottled: (() => {}),
          _resolveColorCssFromText: studio._resolveColorCssFromText.bind(studio)
        })
      }

      const historyMeta = studio._normalizeHistoryMeta(
        options?.historyMeta,
        'palette.applyColor',
        { interactionKind: this._paletteRealtimeInteractionKind }
      )

      return studio._finalizePaletteMutation(changed, {
        deferCommit,
        throttleHistory: deferCommit,
        historyMeta
      })
    },

    applyTagToActivePaletteTargets(studio, tag, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return studio.execute({
          type: 'palette.applyTag',
          payload: { tag }
        })
      }

      return this.applyColorToActivePaletteTargets(studio, tag, {
        deferCommit: options?.deferCommit === true,
        historyMeta: studio._normalizeHistoryMeta(
          options?.historyMeta,
          'palette.applyTag',
          { interactionKind: this._paletteRealtimeInteractionKind }
        ),
        _fromFacade: true
      })
    },

    applyTagOffsetToActivePaletteTargets(studio, payload = {}, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return studio.execute({
          type: 'palette.applyTagOffset',
          payload,
          meta: { deferCommit: options?.deferCommit === true }
        })
      }

      const tag = String(payload?.tag || '').trim()
      if (!tag) return false

      const ref = Palette.formatTagOffsetRef(tag, payload?.offset || {})
      if (!ref) return false

      return this.applyColorToActivePaletteTargets(studio, ref, {
        deferCommit: options?.deferCommit === true,
        historyMeta: studio._normalizeHistoryMeta(
          options?.historyMeta,
          'palette.applyTagOffset',
          { interactionKind: this._paletteRealtimeInteractionKind }
        ),
        _fromFacade: true
      })
    },

    resetTagOffsetToTag(studio, tag, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return studio.execute({
          type: 'palette.resetTagOffset',
          payload: { tag },
          meta: { deferCommit: options?.deferCommit === true }
        })
      }

      const normalizedTag = String(tag || '').trim()
      if (!normalizedTag) return false

      return this.applyColorToActivePaletteTargets(studio, normalizedTag, {
        deferCommit: options?.deferCommit === true,
        historyMeta: studio._normalizeHistoryMeta(
          options?.historyMeta,
          'palette.resetTagOffset',
          { interactionKind: this._paletteRealtimeInteractionKind }
        ),
        _fromFacade: true
      })
    },

    detachTagOffsetToRaw(studio, payload = {}) {
      const ref = String(payload?.ref || '').trim()
      if (!ref) return false

      const resolved = Palette.resolveTagOffsetColor(ref, this.paletteMap)
      if (!resolved?.ok || !resolved.color) return false
      return this.applyColorToActivePaletteTargets(studio, resolved.color, {
        historyMeta: studio._normalizeHistoryMeta(null, 'palette.applyColor')
      })
    },

    updatePaletteTag(studio, tag, newValue, options = {}) {
      if (!options?._fromFacade && isStudioFacadeEnabled()) {
        return studio.execute({
          type: 'palette.updateTag',
          payload: { tag, newValue }
        })
      }

      const deferCommit = options?.deferCommit === true || this._paletteRealtimeMode === true

      const result = PaletteActions.updatePaletteTag(this, tag, newValue, {
        paletteMap: this.paletteMap,
        stacks: studio.stacks,
        focusedPart: studio.focusedPart,
        findPartByUid: studio.findPartByUid.bind(studio),
        _buildLayerEntriesWithCache: studio._buildLayerEntriesWithCache.bind(studio),
        _scheduleLayerRefresh: studio._scheduleLayerRefresh.bind(studio),
        _schedulePartUpdate: (() => {}),
        triggerFocusedPartUpdate: studio.triggerFocusedPartUpdate.bind(studio),
        pushHistorySnapshotThrottled: (() => {})
      })

      this.paletteMap = result.paletteMap
      if (result._scheduleLayerRefresh) {
        studio._scheduleLayerRefresh()
        const historyMeta = studio._normalizeHistoryMeta(
          options?.historyMeta,
          'palette.updateTag',
          { interactionKind: this._paletteRealtimeInteractionKind }
        )
        studio._finalizePaletteMutation(true, {
          deferCommit,
          throttleHistory: deferCommit,
          historyMeta
        })
      }
      return true
    },

    renamePaletteTagAndReferences(studio, oldTag, newTag) {
      const fromTag = String(oldTag || '').trim()
      const toTag = String(newTag || '').trim()
      if (!fromTag || !toTag || fromTag === toTag) return false
      if (this.paletteMap && Object.prototype.hasOwnProperty.call(this.paletteMap, toTag)) return false

      try {
        const renameTagRefText = (text) => {
          if (typeof text !== 'string') return text
          if (text === fromTag) return toTag

          const parsed = Palette.parseTagOffsetRef(text)
          if (parsed.isTagOffsetRef && parsed.tag === fromTag) {
            return Palette.formatTagOffsetRef(toTag, parsed.offset)
          }
          return text
        }

        const replaceTagRefsDeep = (node) => {
          if (!node || typeof node !== 'object') return

          if (Array.isArray(node)) {
            for (let i = 0; i < node.length; i++) {
              if (typeof node[i] === 'string') {
                node[i] = renameTagRefText(node[i])
              } else {
                replaceTagRefsDeep(node[i])
              }
            }
            return
          }

          if (typeof node.Color === 'string') {
            node.Color = renameTagRefText(node.Color)
          } else if (Array.isArray(node.Color)) {
            for (let i = 0; i < node.Color.length; i++) {
              if (typeof node.Color[i] === 'string') {
                node.Color[i] = renameTagRefText(node.Color[i])
              }
            }
          }

          if (typeof node.colorText === 'string') {
            node.colorText = renameTagRefText(node.colorText)
          }
          if (typeof node.currentColorText === 'string') {
            node.currentColorText = renameTagRefText(node.currentColorText)
          }

          for (const key of Object.keys(node)) {
            if (key === 'Color' || key === 'colorText' || key === 'currentColorText') continue
            const value = node[key]
            if (value && typeof value === 'object') {
              replaceTagRefsDeep(value)
            }
          }
        }

        const newStacks = fastClone(studio.stacks || [])
        for (const el of newStacks) {
          if (!el || !Array.isArray(el.data)) continue
          for (const part of el.data) {
            replaceTagRefsDeep(part)
          }
        }

        const newFocused = fastClone(studio.focusedPart)
        if (newFocused) replaceTagRefsDeep(newFocused)

        const newTargets = fastClone(studio.activePaletteTargets || [])
        replaceTagRefsDeep(newTargets)

        const pm = fastClone(this.paletteMap || {})
        pm[toTag] = pm[fromTag]
        delete pm[fromTag]

        studio.stacks = newStacks
        if (newFocused) studio._updateFocusedPartInPlace(newFocused)
        this.paletteMap = pm
        this._paletteVersion += 1

        // Keep selection targets consistent after rename.
        if (Array.isArray(newTargets) && newTargets.length > 0) {
          studio._applyPaletteTargetsToSelection(newTargets)
        }

        studio._refreshAllLayerEntriesFromPalette()
        studio.refreshMergedAppearanceData()
        studio._finalizeMutation({
          changed: true,
          scope: 'palette',
          historyMode: 'immediate',
          historyMeta: studio._normalizeHistoryMeta(null, 'palette.renameTagReferences'),
          scheduleLayer: false,
          scheduleRefresh: false,
          schedulePart: false,
          touchFocusedPart: false
        })
        return true
      } catch (e) {
        console.warn('[paletteStore] renamePaletteTagAndReferences failed', e)
        return false
      }
    },

    deletePaletteTag(studio, tag) {
      const result = PaletteActions.deleteTagFromPalette(this, tag, {
        paletteMap: this.paletteMap,
        focusedPart: studio.focusedPart,
        stacks: studio.stacks,
        findPartByUid: studio.findPartByUid.bind(studio),
        _updateFocusedPartInPlace: studio._updateFocusedPartInPlace.bind(studio),
        _scheduleLayerRefresh: studio._scheduleLayerRefresh.bind(studio),
        RebuildAllStacksLayerEntriesFromParts: studio.RebuildAllStacksLayerEntriesFromParts.bind(studio),
        _scheduleRefresh: studio._scheduleRefresh.bind(studio),
        pushHistorySnapshot: studio.pushHistorySnapshot.bind(studio)
      })

      if (result.stacks) studio.stacks = result.stacks
      if (result.paletteMap) this.paletteMap = result.paletteMap
      this._paletteVersion += 1

      if (result._scheduleLayerRefresh) {
        studio._scheduleLayerRefresh()
        studio.RebuildAllStacksLayerEntriesFromParts()
        studio._scheduleRefresh()
        studio.pushHistorySnapshot(studio._normalizeHistoryMeta(null, 'palette.deleteTag'))
      }
      return result._scheduleLayerRefresh
    },

    createTagAndReplaceInStacks(studio, value) {
      try {
        const createRes = Palette.createTagForValue(this.paletteMap, this._paletteNextCounter, value)
        this.paletteMap = createRes.paletteMap
        this._paletteNextCounter = createRes.paletteCounter
        this._paletteVersion += 1
        let tag = createRes.tag

        if (!tag) {
          try {
            const want = (value === undefined) ? null : JSON.stringify(value)
            for (const k of Object.keys(this.paletteMap || {})) {
              try {
                const v = this.paletteMap[k]
                if (JSON.stringify(v) === want) { tag = k; break }
              } catch (e) { continue }
            }
          } catch (e) { /* ignore fallback failure */ }
        }

        if (!tag) return null

        studio.stacks = Palette.replaceValueInStacks(studio.stacks, value, tag)

        const fp = studio.focusedPart
        if (fp) {
          const replaced = Palette.replaceValueInPart(fp, value, tag)
          studio._updateFocusedPartInPlace(replaced)
        }

        studio._scheduleLayerRefresh()
        studio._scheduleRefresh()
        studio._finalizeMutation({
          changed: true,
          scope: 'palette',
          historyMode: 'immediate',
          historyMeta: studio._normalizeHistoryMeta(null, 'palette.createTagAndReplace'),
          scheduleLayer: false,
          scheduleRefresh: false,
          schedulePart: false,
          touchFocusedPart: false
        })
        return tag
      } catch (e) {
        console.warn('[paletteStore] createTagAndReplaceInStacks failed', e)
        return null
      }
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
