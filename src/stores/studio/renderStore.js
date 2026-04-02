import { defineStore } from 'pinia'
import { fastClone } from '@/utils/clone.js'
import { RenderService } from '@/services/RenderService'
import OptimizedRenderService from '@/services/OptimizedRenderService'
import { RenderApi } from '@/utils/RenderApi'
import { AssetApi } from '@/utils/AssetApi'
import * as Palette from '@/services/PaletteService'
import { createStudioRenderPipeline } from '@/studio/StudioRenderPipeline'
import { isStudioRenderPipelineEnabled } from '@/config/featureFlags'

class RefreshScheduler {
  constructor() {
    this._pendingRefresh = false
    this._pendingLayerRefresh = false
    this._rafId = null
    this._callbacks = []
  }

  scheduleRefresh(callback) {
    this._callbacks.push(callback)
    if (!this._rafId) {
      this._rafId = requestAnimationFrame(() => {
        this._rafId = null
        const cbs = this._callbacks.slice()
        this._callbacks = []
        for (const cb of cbs) {
          try { cb() } catch (e) { console.warn(e) }
        }
      })
    }
  }

  cancel() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }
    this._callbacks = []
  }
}

function createDefaultRenderState() {
  return {
    mergedAppearanceData: { data: [] },
    renderer: new RenderService({ drawCallbacks: RenderApi, thumbwidth: 500, thumbheight: 1000, previewwidth: 500, previewheight: 1000 }),
    previewRenderer: new OptimizedRenderService({
      drawCallbacks: RenderApi,
      previewwidth: 500,
      previewheight: 1000
    }),
    useOptimizedRenderer: true,
    renderPipeline: createStudioRenderPipeline({
      assetApi: AssetApi,
      paletteService: Palette
    }),
    _renderPipelineLastStats: null,
    translatedLayerEntries: [],
    _refreshScheduler: new RefreshScheduler(),
    _pendingMergedRefresh: false,
    _pendingLayerRefresh: false,
    _previewStack: [],
    _activePreviewId: null
  }
}

export const useStudioRenderStore = defineStore('studioRender', {
  state: () => createDefaultRenderState(),

  actions: {
    syncFromLegacyState(payload = {}) {
      const defaults = createDefaultRenderState()
      this.mergedAppearanceData = payload.mergedAppearanceData || defaults.mergedAppearanceData
      this.renderer = payload.renderer || defaults.renderer
      this.previewRenderer = payload.previewRenderer || defaults.previewRenderer
      this.useOptimizedRenderer = payload.useOptimizedRenderer !== false
      this.renderPipeline = payload.renderPipeline || defaults.renderPipeline
      this._renderPipelineLastStats = payload._renderPipelineLastStats || null
      this.translatedLayerEntries = Array.isArray(payload.translatedLayerEntries) ? fastClone(payload.translatedLayerEntries) : []
      this._refreshScheduler = payload._refreshScheduler || defaults._refreshScheduler
      this._pendingMergedRefresh = payload._pendingMergedRefresh === true
      this._pendingLayerRefresh = payload._pendingLayerRefresh === true
      this._previewStack = Array.isArray(payload._previewStack) ? fastClone(payload._previewStack) : []
      this._activePreviewId = payload._activePreviewId || null
    },

    pushPreview(studio, id, priority, previewData, source = '') {
      if (!id || typeof priority !== 'number') return

      this._previewStack = this._previewStack.filter(p => p.id !== id)
      this._previewStack.push({
        id,
        priority,
        preview: previewData,
        source,
        timestamp: Date.now()
      })

      this.updateActivePreview(studio)
    },

    popPreview(studio, id) {
      if (!id) return

      const nextStack = this._previewStack.filter(p => p.id !== id)
      if (nextStack.length === this._previewStack.length) return

      this._previewStack = nextStack
      this.updateActivePreview(studio)
    },

    updateActivePreview(studio) {
      if (this._previewStack.length === 0) {
        this._activePreviewId = null
        this.refreshMergedAppearanceData(studio)
        return
      }

      let highestPriority = -1
      let activePreview = null

      for (const preview of this._previewStack) {
        if (preview.priority > highestPriority) {
          highestPriority = preview.priority
          activePreview = preview
        }
      }

      if (!activePreview) return

      const shouldRender =
        this._activePreviewId !== activePreview.id ||
        this.mergedAppearanceData !== activePreview.preview

      if (shouldRender) {
        this._activePreviewId = activePreview.id
        this.mergedAppearanceData = activePreview.preview

        try {
          const activeRenderer = this.useOptimizedRenderer ? this.previewRenderer : this.renderer
          if (activeRenderer && typeof activeRenderer.renderPreviewWithItem === 'function') {
            activeRenderer.renderPreviewWithItem(activePreview.preview)
          }
        } catch (e) {
          console.warn('[studioRenderStore] Failed to render preview:', e)
        }
      }
    },

    isPreviewActive(id) {
      return this._activePreviewId === id
    },

    scheduleRefresh(studio) {
      if (this._pendingMergedRefresh) return
      this._pendingMergedRefresh = true

      this._refreshScheduler.scheduleRefresh(() => {
        this._pendingMergedRefresh = false
        this.doRefreshMergedAppearanceData(studio)
      })
    },

    refreshMergedAppearanceData(studio) {
      this._pendingMergedRefresh = false
      this.doRefreshMergedAppearanceData(studio)
    },

    doRefreshMergedAppearanceData(studio) {
      const activeRenderer = this.useOptimizedRenderer ? this.previewRenderer : this.renderer

      if (isStudioRenderPipelineEnabled() && this.renderPipeline) {
        const result = this.renderPipeline.render({
          stacks: studio.stacks,
          paletteMap: studio.paletteMap,
          activeRenderer,
          previousMergedAppearanceData: this.mergedAppearanceData,
          reconstructStacks: (stacks) => studio._reconstructStacksForRender(stacks)
        })

        this._renderPipelineLastStats = result?.stats || null
        if (result?.mergedAppearanceData) {
          this.mergedAppearanceData = result.mergedAppearanceData
        }
        return
      }

      this._renderPipelineLastStats = null
      try { activeRenderer.removeCanvas(this.mergedAppearanceData) } catch (e) { console.warn(e) }
      const unexpanded = {
        data: AssetApi.stackOutfitData(studio._reconstructStacksForRender(studio.stacks)),
        type: 'outfit'
      }
      this.mergedAppearanceData = Palette.expandedAppearanceForRendering(unexpanded, studio.paletteMap)
      activeRenderer.renderPreviewWithItem(this.mergedAppearanceData)
    },

    scheduleLayerRefresh(studio) {
      if (this._pendingLayerRefresh) return
      this._pendingLayerRefresh = true

      this._refreshScheduler.scheduleRefresh(() => {
        this._pendingLayerRefresh = false
        this.doRefreshAllLayerEntriesFromPalette(studio)
      })
    },

    refreshAllLayerEntriesFromPalette(studio) {
      this._pendingLayerRefresh = false
      this.doRefreshAllLayerEntriesFromPalette(studio)
    },

    doRefreshAllLayerEntriesFromPalette(studio) {
      if (!studio) return
      try {
        // Update existing layer entries in-place to avoid unnecessary deep clones.
        for (const stack of studio.stacks) {
          if (!stack || !Array.isArray(stack.data)) continue
          for (const part of stack.data) {
            if (!part) continue
            if (!Array.isArray(part.layerEntries)) {
              part.layerEntries = studio._buildLayerEntriesWithCache(part) || []
            } else {
              studio._updateLayerEntriesColorCss(part.layerEntries)
            }
          }
        }

        const focusedPart = studio.focusedPart
        if (focusedPart && Array.isArray(focusedPart.layerEntries)) {
          studio._updateLayerEntriesColorCss(focusedPart.layerEntries)
        }
      } catch (e) {
        console.warn('[studioRenderStore] Failed to refresh layer entries from palette', e)
      }
    },

    toggleRendererMode(studio, useOptimized = true) {
      this.useOptimizedRenderer = !!useOptimized
      this.refreshMergedAppearanceData(studio)
    },

    destroy(studio) {
      try {
        if (this.previewRenderer && typeof this.previewRenderer.destroy === 'function') {
          this.previewRenderer.destroy()
        }
      } catch (e) {
        console.warn('[studioRenderStore] Preview renderer cleanup error:', e)
      }

      try {
        if (this.renderer) {
          studio.stacks.forEach(it => {
            this.renderer.removeCanvas({ data: it.data, type: 'outfit' })
          })
        }
      } catch (e) {
        console.warn('[studioRenderStore] Renderer cleanup error:', e)
      }
    }
  }
})

export default useStudioRenderStore
