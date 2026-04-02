import { defineStore } from 'pinia'
import { fastClone } from '@/utils/clone.js'
import * as StackActions from '@/studio/stack-actions.js'
import * as LayerTranslator from '@/services/LayerTranslator'
import { applyLayerDeltasToPart } from '@/services/PartPatchApplier'

export const useStudioCoreStore = defineStore('studioCore', {
  state: () => ({
    stacks: [],
    selectedIndex: -1,
    focusedPartIndex: {
      stackIndex: null,
      partIndex: null
    },
    _partUidCounter: 1
  }),

  actions: {
    syncFromLegacyState(payload = {}) {
      this.stacks = Array.isArray(payload.stacks) ? payload.stacks : []
      this.selectedIndex = Number.isFinite(Number(payload.selectedIndex)) ? Number(payload.selectedIndex) : -1
      this.focusedPartIndex = payload.focusedPartIndex && typeof payload.focusedPartIndex === 'object'
        ? {
            stackIndex: Number.isFinite(Number(payload.focusedPartIndex.stackIndex))
              ? Number(payload.focusedPartIndex.stackIndex)
              : null,
            partIndex: Number.isFinite(Number(payload.focusedPartIndex.partIndex))
              ? Number(payload.focusedPartIndex.partIndex)
              : null
          }
        : { stackIndex: null, partIndex: null }
      this._partUidCounter = (typeof payload._partUidCounter === 'number' && payload._partUidCounter >= 1)
        ? payload._partUidCounter
        : 1
    },

    ensurePartUid(studio, part) {
      if (!part || typeof part !== 'object') return null
      if (part._uid) return part._uid
      const uid = 'p' + (studio._partUidCounter++)
      try { part._uid = uid } catch (e) { /* ignore non-writable part */ }
      return uid
    },

    findPartByUid(studio, uid) {
      if (!uid) return null
      for (let si = 0; si < studio.stacks.length; si++) {
        const el = studio.stacks[si]
        if (!el || !Array.isArray(el.data)) continue
        for (let pi = 0; pi < el.data.length; pi++) {
          const part = el.data[pi]
          if (part && part._uid === uid) return { partRef: part, stackIndex: si, partIndex: pi }
        }
      }
      return null
    },

    async addElement(studio, el) {
      if (!studio.assetIndex || Object.keys(studio.assetIndex).length === 0 ||
          !studio.assetGroupsRaw || studio.assetGroupsRaw.length === 0) {
        await studio.loadAssetData()
      }

      const result = StackActions.addElementToStacks(studio, el, {
        fastClone,
        ensurePartUid: studio.ensurePartUid.bind(studio),
        _buildLayerEntriesWithCache: studio._buildLayerEntriesWithCache.bind(studio),
        _updateLayerEntriesColorCss: studio._updateLayerEntriesColorCss.bind(studio),
        refreshMergedAppearanceData: studio.refreshMergedAppearanceData.bind(studio),
        pushHistorySnapshot: studio.pushHistorySnapshot.bind(studio)
      })

      if (result.element !== null) {
        studio.stacks = result.stacks
        studio.selectedIndex = result.selectedIndex
        studio.paletteMap = result.paletteMap
        studio._paletteNextCounter = result._paletteNextCounter
        studio._paletteVersion = result._paletteVersion
        studio.refreshMergedAppearanceData()
        studio.pushHistorySnapshot(studio._normalizeHistoryMeta(null, 'stack.add'))
      }
    },

    removeElement(studio, idx) {
      if (idx < 0 || idx >= studio.stacks.length) return

      const result = StackActions.removeElementFromStacks(studio, idx, {
        renderer: studio.renderer,
        stacks: studio.stacks,
        selectedIndex: studio.selectedIndex,
        focusedPartIndex: studio.focusedPartIndex,
        pushHistorySnapshot: () => studio.pushHistorySnapshot(studio._normalizeHistoryMeta(null, 'stack.remove'))
      })

      studio.stacks = result.stacks
      studio.selectedIndex = result.selectedIndex
      studio.focusedPartIndex = result.focusedPartIndex
      studio._syncFocusStateScopeFromFocusedPart()
      studio._scheduleRefresh()
    },

    moveElement(studio, fromIdx, toIdx) {
      if (fromIdx === toIdx) return
      if (fromIdx < 0 || fromIdx >= studio.stacks.length) return
      if (toIdx < 0 || toIdx >= studio.stacks.length) return

      const result = StackActions.moveElementInStacks(studio, fromIdx, toIdx, {
        stacks: studio.stacks,
        selectedIndex: studio.selectedIndex,
        focusedPartIndex: studio.focusedPartIndex,
        _scheduleRefresh: studio._scheduleRefresh.bind(studio)
      })

      studio.stacks = result.stacks
      studio.selectedIndex = result.selectedIndex
      studio.focusedPartIndex = result.focusedPartIndex
      studio._syncFocusStateScopeFromFocusedPart()
      studio._scheduleRefresh()
      studio.pushHistorySnapshot(studio._normalizeHistoryMeta(null, 'stack.move'))
    },

    select(studio, idx) {
      const result = StackActions.selectElementInStacks(studio, idx, {
        focusedPartIndex: studio.focusedPartIndex
      })

      studio.selectedIndex = result.selectedIndex
      if (result.focusedPartIndex) {
        studio.focusedPartIndex = result.focusedPartIndex
        studio._syncFocusStateScopeFromFocusedPart()
      }
      if (result.clearPropertyFocus) {
        studio.clearPropertyFocus()
      }
    },

    clear(studio) {
      if (!Array.isArray(studio.stacks) || studio.stacks.length === 0) return

      studio.pushHistorySnapshot(studio._normalizeHistoryMeta(null, 'stack.clear'))

      const result = StackActions.clearAllStacks(studio, {
        renderer: studio.renderer,
        focusedPartIndex: studio.focusedPartIndex
      })

      studio.stacks = result.stacks
      studio.selectedIndex = result.selectedIndex
      studio.mergedAppearanceData = result.mergedAppearanceData
      studio.focusedPartIndex = result.focusedPartIndex
      studio._syncFocusStateScopeFromFocusedPart()
      if (result.clearPropertyFocus) {
        studio.clearPropertyFocus()
      }
    },

    renameStack(studio, stackIndex, newName) {
      if (!Array.isArray(studio.stacks) || stackIndex < 0 || stackIndex >= studio.stacks.length) return false

      const normalizedName = String(newName || '').trim()
      const currentName = String(studio.stacks[stackIndex]?.name || '').trim()
      if (!normalizedName || currentName === normalizedName) return false

      const nextStacks = studio.stacks.slice()
      nextStacks[stackIndex] = { ...nextStacks[stackIndex], name: normalizedName }
      studio.stacks = nextStacks

      return true
    },

    updateFocusedPartInPlace(studio, newPartData) {
      const idx = studio.focusedPartIndex
      if (idx.stackIndex === null || idx.partIndex === null) return false
      if (idx.stackIndex < 0 || idx.stackIndex >= studio.stacks.length) return false

      const stack = studio.stacks[idx.stackIndex]
      if (!stack || !Array.isArray(stack.data)) return false
      if (idx.partIndex < 0 || idx.partIndex >= stack.data.length) return false

      try {
        const copy = fastClone(newPartData)
        stack.data[idx.partIndex] = copy
        studio.triggerFocusedPartUpdate()
        return true
      } catch (e) {
        console.warn('[studioCoreStore] updateFocusedPartInPlace failed', e)
        return false
      }
    },

    updateFocusedPartProperty(studio, propName, value) {
      const idx = studio.focusedPartIndex
      if (idx.stackIndex === null || idx.partIndex === null) return false
      if (idx.stackIndex < 0 || idx.partIndex < 0) return false
      if (idx.stackIndex >= studio.stacks.length) return false

      const stack = studio.stacks[idx.stackIndex]
      if (!stack || !Array.isArray(stack.data)) return false
      if (idx.partIndex < 0 || idx.partIndex >= stack.data.length) return false

      try {
        stack.data[idx.partIndex][propName] = value
        studio.triggerFocusedPartUpdate()
        return true
      } catch (e) {
        console.warn('[studioCoreStore] updateFocusedPartProperty failed', e)
        return false
      }
    },

    resolvePartLocation(studio, part = null) {
      if (!part) {
        const stackIndex = Number(studio.focusedPartIndex?.stackIndex)
        const partIndex = Number(studio.focusedPartIndex?.partIndex)
        if (!Number.isFinite(stackIndex) || !Number.isFinite(partIndex)) return null

        const stack = studio.stacks[stackIndex]
        const partRef = stack && Array.isArray(stack.data) ? stack.data[partIndex] : null
        if (!partRef) return null

        return { partRef, stackIndex, partIndex }
      }

      const uid = part._uid || this.ensurePartUid(studio, part)
      if (uid) {
        const found = this.findPartByUid(studio, uid)
        if (found?.partRef) {
          return {
            partRef: found.partRef,
            stackIndex: found.stackIndex,
            partIndex: found.partIndex
          }
        }
      }

      for (let stackIndex = 0; stackIndex < studio.stacks.length; stackIndex++) {
        const stack = studio.stacks[stackIndex]
        if (!stack || !Array.isArray(stack.data)) continue
        for (let partIndex = 0; partIndex < stack.data.length; partIndex++) {
          if (stack.data[partIndex] === part) {
            return { partRef: part, stackIndex, partIndex }
          }
        }
      }

      return null
    },

    applyPartLayerDeltasInternal(studio, part, deltas = []) {
      if (!Array.isArray(deltas) || deltas.length === 0) return null

      const location = this.resolvePartLocation(studio, part)
      if (!location?.partRef) return null

      const sourcePart = location.partRef
      const asset = studio.resolveAssetForPart(sourcePart)
      let rebuilt = null

      try {
        const patchResult = applyLayerDeltasToPart(sourcePart, deltas, { asset })
        if (patchResult?.changed && patchResult?.part) {
          rebuilt = patchResult.part
        }
      } catch (e) {
        console.warn('[studioCoreStore] Part patch applier failed, using legacy layer translator fallback', e)
      }

      if (!rebuilt) {
        const sourceEntries = studio.getLayerEntriesForPart(sourcePart, { forceRebuild: false, clone: true })
        if (!Array.isArray(sourceEntries) || sourceEntries.length === 0) return null

        const nextEntries = fastClone(sourceEntries)
        const changed = studio._applyLayerDeltasToEntries(nextEntries, deltas)
        if (!changed) return null

        rebuilt = LayerTranslator.reconstructPartFromLayerEntries(nextEntries, sourcePart, { originalAsset: asset })
      }

      if (!rebuilt) return null

      const uid = sourcePart._uid || this.ensurePartUid(studio, sourcePart)
      try { rebuilt._uid = uid } catch (e) { console.warn(e) }

      const rebuiltClone = fastClone(rebuilt)
      rebuiltClone.layerEntries = studio.getLayerEntriesForPart(rebuiltClone, { forceRebuild: true, clone: true })

      const stack = studio.stacks[location.stackIndex]
      if (!stack || !Array.isArray(stack.data)) return null

      const nextStack = { ...stack, data: stack.data.slice() }
      nextStack.data[location.partIndex] = rebuiltClone

      const nextStacks = studio.stacks.slice()
      nextStacks[location.stackIndex] = nextStack
      studio.stacks = nextStacks

      return { location, updatedPart: rebuiltClone }
    },

    applyPartLayerDeltas(studio, part, deltas = [], options = {}) {
      const result = this.applyPartLayerDeltasInternal(studio, part, deltas)
      if (!result) return false

      const isFocusedTarget =
        studio.focusedPartIndex?.stackIndex === result.location.stackIndex &&
        studio.focusedPartIndex?.partIndex === result.location.partIndex

      if (isFocusedTarget) {
        studio.triggerFocusedPartUpdate()
      }

      const normalizedHistoryMeta = studio._normalizeHistoryMeta(
        options?.historyMeta,
        'part.applyLayerDeltas',
        {
          interactionKind: studio._editorRealtimeInteractionKind,
          changedParts: 1,
          deltaCount: Array.isArray(deltas) ? deltas.length : 0
        }
      )

      const historyMode = options?.deferCommit === true ? 'throttled' : 'immediate'

      studio._finalizeMutation({
        changed: true,
        deferCommit: options?.deferCommit === true,
        scope: 'editor',
        historyMode,
        historyMeta: normalizedHistoryMeta,
        schedulePart: false,
        touchFocusedPart: false
      })

      if (isFocusedTarget) {
        studio.translateFocusedPartToLayers()
        return studio.focusedPart
      }

      return result.updatedPart
    },

    batchApplyPartLayerDeltas(studio, updates = [], options = {}) {
      if (!Array.isArray(updates) || updates.length === 0) {
        return {
          success: false,
          updatedCount: 0,
          changedParts: 0,
          reason: 'No updates provided'
        }
      }

      let changedCount = 0
      let totalDeltaCount = 0
      for (const update of updates) {
        const result = this.applyPartLayerDeltasInternal(studio, update?.part, update?.deltas)
        if (result) {
          const isFocusedTarget =
            studio.focusedPartIndex?.stackIndex === result.location.stackIndex &&
            studio.focusedPartIndex?.partIndex === result.location.partIndex
          if (isFocusedTarget) {
            studio.triggerFocusedPartUpdate()
          }
          changedCount += 1
          totalDeltaCount += Array.isArray(update?.deltas) ? update.deltas.length : 0
        }
      }

      const normalizedHistoryMeta = studio._normalizeHistoryMeta(
        options?.historyMeta,
        'layer.batchApplyLayerDeltas',
        {
          interactionKind: studio._editorRealtimeInteractionKind,
          changedParts: changedCount,
          deltaCount: totalDeltaCount
        }
      )

      const historyMode = options?.deferCommit === true ? 'throttled' : 'immediate'

      studio._finalizeMutation({
        changed: changedCount > 0,
        deferCommit: options?.deferCommit === true,
        scope: 'editor',
        historyMode,
        historyMeta: normalizedHistoryMeta,
        schedulePart: false,
        touchFocusedPart: false
      })

      if (changedCount > 0) {
        studio.translateFocusedPartToLayers()
      }

      return {
        success: changedCount > 0,
        updatedCount: changedCount,
        changedParts: changedCount,
        reason: changedCount > 0 ? null : 'No part was updated'
      }
    },

    updatePartFromLayerEntries(studio, entries, options = {}) {
      const focusedPart = studio.focusedPart
      if (!entries || !focusedPart) return null

      const previousEntries = studio.getLayerEntriesForPart(focusedPart, { forceRebuild: false, clone: true })
      const deltas = studio._deriveLayerDeltas(previousEntries, entries)
      if (Array.isArray(deltas)) {
        if (deltas.length === 0) return studio.focusedPart
        const updated = this.applyPartLayerDeltas(studio, focusedPart, deltas, {
          deferCommit: options?.deferCommit === true,
          historyMeta: options?.historyMeta,
          _fromFacade: true
        })
        if (updated) return studio.focusedPart
      }

      try {
        const newPartClone = studio.UpdateSpecificPartFromLayerEntries(focusedPart, entries)
        if (!newPartClone) return null

        const uid = focusedPart._uid || this.ensurePartUid(studio, focusedPart)
        const originalPartJson = JSON.stringify(focusedPart)

        const nextStacks = studio.stacks.map(el => {
          const stackCopy = fastClone(el)
          if (Array.isArray(stackCopy.data)) {
            stackCopy.data = stackCopy.data.map(p => {
              try {
                if (p && p._uid && p._uid === uid) return fastClone(newPartClone)
                if (JSON.stringify(p) === originalPartJson) return fastClone(newPartClone)
              } catch (e) { /* ignore */ }
              return p
            })
          }
          return stackCopy
        })

        studio.stacks = nextStacks
        this.updateFocusedPartInPlace(studio, newPartClone)

        const normalizedHistoryMeta = studio._normalizeHistoryMeta(
          options?.historyMeta,
          'part.applyLayerDeltas',
          {
            interactionKind: studio._editorRealtimeInteractionKind,
            changedParts: 1,
            deltaCount: Array.isArray(entries) ? entries.length : 0
          }
        )

        const historyMode = options?.deferCommit === true ? 'throttled' : 'immediate'

        studio._finalizeMutation({
          changed: true,
          deferCommit: options?.deferCommit === true,
          scope: 'editor',
          historyMode,
          historyMeta: normalizedHistoryMeta,
          schedulePart: false,
          touchFocusedPart: false
        })
        studio.translateFocusedPartToLayers()
        return studio.focusedPart
      } catch (e) {
        console.error('[studioCoreStore] updatePartFromLayerEntries failed', e)
        return null
      }
    },

    updatePartLayerEntries(studio, part, entries, options = {}) {
      if (!part || !entries) return

      const previousEntries = studio.getLayerEntriesForPart(part, { forceRebuild: false, clone: true })
      const deltas = studio._deriveLayerDeltas(previousEntries, entries)
      if (Array.isArray(deltas)) {
        if (deltas.length === 0) return false
        return this.applyPartLayerDeltas(studio, part, deltas, {
          deferCommit: options?.deferRefresh === true,
          historyMeta: options?.historyMeta,
          _fromFacade: true
        })
      }

      const newPart = studio.UpdateSpecificPartFromLayerEntries(part, entries)
      if (!newPart) return

      const selectedStackIndex = studio.selectedIndex
      if (selectedStackIndex < 0 || selectedStackIndex >= studio.stacks.length) return

      const stack = studio.stacks[selectedStackIndex]
      if (!stack || !Array.isArray(stack.data)) return

      const uid = part._uid || this.ensurePartUid(studio, part)
      let foundIndex = -1

      const newStackData = stack.data.map((p, idx) => {
        if (p === part || (uid && p._uid === uid)) {
          foundIndex = idx
          return newPart
        }
        return p
      })

      if (foundIndex === -1) return

      const newStack = { ...stack, data: newStackData }
      const newStacks = [...studio.stacks]
      newStacks[selectedStackIndex] = newStack
      studio.stacks = newStacks

      if (studio.focusedPartIndex.stackIndex === selectedStackIndex && studio.focusedPartIndex.partIndex === foundIndex) {
        studio.triggerFocusedPartUpdate()
      }

      const normalizedHistoryMeta = studio._normalizeHistoryMeta(
        options?.historyMeta,
        'part.applyLayerDeltas',
        {
          interactionKind: studio._editorRealtimeInteractionKind,
          changedParts: 1,
          deltaCount: Array.isArray(entries) ? entries.length : 0
        }
      )

      const historyMode = options?.deferRefresh === true ? 'throttled' : 'immediate'

      return studio._finalizeMutation({
        changed: true,
        deferCommit: options?.deferRefresh === true,
        scope: 'editor',
        historyMode,
        historyMeta: normalizedHistoryMeta,
        schedulePart: false,
        touchFocusedPart: false
      })
    }
  }
})

export default useStudioCoreStore
