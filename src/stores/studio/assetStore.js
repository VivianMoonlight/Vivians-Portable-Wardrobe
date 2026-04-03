import { defineStore } from 'pinia'
import { fastClone } from '@/utils/clone.js'
import { hostWindow } from '@/utils/host-window.js'
import * as AssetIndex from '@/services/AssetIndexService'
import * as AssetActions from '@/studio/asset-actions.js'
import { resolveCraftForAssetSlot } from '@/studio/craft-resolver.js'

export const useStudioAssetStore = defineStore('studioAsset', {
  state: () => ({
    assetGroupsRaw: [],
    assetIndex: {},
    _assetLoaded: false,
    _assetLoadingPromise: null
  }),

  actions: {
    syncFromLegacyState(payload = {}) {
      this.assetGroupsRaw = Array.isArray(payload.assetGroupsRaw) ? payload.assetGroupsRaw : []
      this.assetIndex = payload.assetIndex && typeof payload.assetIndex === 'object' ? payload.assetIndex : {}
    },

    async loadAssetData(studio, options = {}) {
      const forceReload = options?.force === true

      if (!forceReload && this._assetLoaded) {
        if (studio) {
          studio.assetGroupsRaw = this.assetGroupsRaw
          studio.assetIndex = this.assetIndex
        }
        return this.assetGroupsRaw
      }

      if (!forceReload && this._assetLoadingPromise) {
        const groups = await this._assetLoadingPromise
        if (studio) {
          studio.assetGroupsRaw = this.assetGroupsRaw
          studio.assetIndex = this.assetIndex
        }
        return groups
      }

      this._assetLoadingPromise = (async () => {
        const res = await AssetIndex.loadAssetData()
        this.assetGroupsRaw = Array.isArray(res.assetGroupsRaw) ? res.assetGroupsRaw : []
        this.assetIndex = res.assetIndex && typeof res.assetIndex === 'object' ? res.assetIndex : {}
        this._assetLoaded = true
        return this.assetGroupsRaw
      })()

      try {
        const groups = await this._assetLoadingPromise
        if (studio) {
          studio.assetGroupsRaw = this.assetGroupsRaw
          studio.assetIndex = this.assetIndex
        }
        return groups
      } finally {
        this._assetLoadingPromise = null
      }
    },

    findAssetsGroupForPart(studio, part) {
      const index = studio?.assetIndex || this.assetIndex
      const groups = studio?.assetGroupsRaw || this.assetGroupsRaw
      return AssetIndex.getAssetCandidatesForPart(index, groups, part)
    },

    findAssetGroupEntryForPart(studio, part) {
      const index = studio?.assetIndex || this.assetIndex
      const groups = studio?.assetGroupsRaw || this.assetGroupsRaw
      return AssetIndex.findAssetGroupEntryForPart(groups, index, part)
    },

    normalizeAssetsFromGroupData(studio, groupData) {
      return AssetIndex.normalizeAssetsFromGroupData(groupData)
    },

    getAssetCandidatesForPart(studio, part) {
      const index = studio?.assetIndex || this.assetIndex
      const groups = studio?.assetGroupsRaw || this.assetGroupsRaw
      return AssetIndex.getAssetCandidatesForPart(index, groups, part)
    },

    resolveAssetForPart(studio, part) {
      const index = studio?.assetIndex || this.assetIndex
      const groups = studio?.assetGroupsRaw || this.assetGroupsRaw
      return AssetIndex.resolveAssetForPart(index, groups, part)
    },

    getGroupDescriptionForPart(studio, part) {
      const index = studio?.assetIndex || this.assetIndex
      const groups = studio?.assetGroupsRaw || this.assetGroupsRaw
      return AssetIndex.getGroupDescriptionForPart(groups, index, part)
    },

    matchesSearchForPart(studio, part, term) {
      const index = studio?.assetIndex || this.assetIndex
      const groups = studio?.assetGroupsRaw || this.assetGroupsRaw
      return AssetIndex.matchesSearchForPart(index, groups, part, term)
    },

    async applyAssetToSelectedStack(studio, asset, replaceTarget = null, options = {}) {
      if (!studio) return null

      const result = AssetActions.applyAssetToSelectedStack(studio, asset, replaceTarget, {
        ensurePartUid: studio.ensurePartUid.bind(studio),
        _buildLayerEntriesWithCache: studio._buildLayerEntriesWithCache.bind(studio),
        fastClone: fastClone,
        resolveCraftForAssetSlot: ({ assetName, groupName }) => resolveCraftForAssetSlot({
          assetName,
          groupName,
          player: hostWindow?.Player,
          assetGet: typeof hostWindow?.AssetGet === 'function' ? hostWindow.AssetGet.bind(hostWindow) : null,
          cloneFn: fastClone
        })
      })

      if (result.stacks) {
        studio.stacks = result.stacks
        studio.focusedPartIndex = result.focusedPartIndex
        studio._syncFocusStateScopeFromFocusedPart()
        try { studio.translateFocusedPartToLayers && studio.translateFocusedPartToLayers() } catch (e) { /* ignore */ }
        studio._finalizeMutation({
          changed: true,
          scope: 'asset',
          historyMode: 'immediate',
          historyMeta: studio._normalizeHistoryMeta(options?.historyMeta, 'asset.apply')
        })
        studio.onReplaceApplied()
        return studio.focusedPart || null
      }

      return null
    }
  }
})

export default useStudioAssetStore
