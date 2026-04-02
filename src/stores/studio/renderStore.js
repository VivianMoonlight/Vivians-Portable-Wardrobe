import { defineStore } from 'pinia'
import { fastClone } from '@/utils/clone.js'

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
      this._refreshScheduler = payload._refreshScheduler || defaults._refreshScheduler
      this._pendingMergedRefresh = payload._pendingMergedRefresh === true
      this._pendingLayerRefresh = payload._pendingLayerRefresh === true
      this._previewStack = Array.isArray(payload._previewStack) ? fastClone(payload._previewStack) : []
      this._activePreviewId = payload._activePreviewId || null
    }
  }
})

export default useStudioRenderStore
