const PALETTE_DELTA_COMMANDS = Object.freeze([
  'palette.applyColor',
  'palette.applyTagOffset',
  'palette.resetTagOffset'
])

const EDITOR_KINDS = Object.freeze([
  'preview-move',
  'layer-edit',
  'batch-edit',
  'priority-drag'
])

const EDITOR_DELTA_COMMANDS = Object.freeze([
  'part.updateProperty',
  'part.applyLayerDeltas',
  'layer.batchApplyLayerDeltas'
])

function isEditorKind(kind) {
  return EDITOR_KINDS.includes(kind)
}

export class TransactionCoordinator {
  constructor({ store, executeCommand } = {}) {
    this.store = store
    this.executeCommand = executeCommand
    this.activeInteraction = null
  }

  _finalizeInteractionByKind(kind, { commit = true } = {}) {
    if (kind === 'palette') {
      return this.store.endPaletteRealtimeUpdate({
        commit,
        interactionKind: kind
      })
    }

    if (isEditorKind(kind)) {
      return this.store.endEditorRealtimeUpdate({
        commit,
        interactionKind: kind
      })
    }

    return false
  }

  _drainActiveInteraction({ commit = true } = {}) {
    if (!this.activeInteraction) return false

    const { kind } = this.activeInteraction
    this.activeInteraction = null

    return this._finalizeInteractionByKind(kind, { commit })
  }

  beginInteraction(kind = 'palette', meta = {}) {
    const normalizedKind = String(kind || '').trim() || 'palette'

    if (this.activeInteraction?.kind === normalizedKind) {
      this.activeInteraction = {
        kind: normalizedKind,
        meta: {
          ...(this.activeInteraction?.meta || {}),
          ...(meta || {})
        }
      }
      return true
    }

    // Always settle previous interaction before switching kinds, otherwise
    // deferred history commits can be lost when the single-slot state is overwritten.
    if (this.activeInteraction) {
      this._drainActiveInteraction({ commit: true })
    }

    this.activeInteraction = { kind: normalizedKind, meta }

    if (normalizedKind === 'palette') {
      this.store.beginPaletteRealtimeUpdate(normalizedKind)
      return true
    }

    if (isEditorKind(normalizedKind)) {
      this.store.beginEditorRealtimeUpdate(normalizedKind)
      return true
    }

    this.activeInteraction = null

    return false
  }

  applyDelta(delta = {}) {
    if (!this.activeInteraction) return false

    const kind = this.activeInteraction.kind

    if (kind === 'palette') {
      if (typeof delta.type === 'string' && delta.type.trim()) {
        const normalizedType = delta.type.trim()
        if (PALETTE_DELTA_COMMANDS.includes(normalizedType)) {
          return this.executeCommand({
            type: normalizedType,
            payload: delta.payload || {},
            meta: {
              deferCommit: true,
              interactionKind: kind,
              source: this.activeInteraction?.meta?.source || null
            }
          })
        }
      }

      if (Object.prototype.hasOwnProperty.call(delta, 'newColor')) {
        return this.executeCommand({
          type: 'palette.applyColor',
          payload: { newColor: delta.newColor },
          meta: {
            deferCommit: true,
            interactionKind: kind,
            source: this.activeInteraction?.meta?.source || null
          }
        })
      }

      return false
    }

    if (isEditorKind(kind)) {
      if (typeof delta.type === 'string' && delta.type.trim()) {
        const normalizedType = delta.type.trim()
        if (EDITOR_DELTA_COMMANDS.includes(normalizedType)) {
          return this.executeCommand({
            type: normalizedType,
            payload: delta.payload || {},
            meta: {
              deferCommit: true,
              interactionKind: kind,
              source: this.activeInteraction?.meta?.source || null
            }
          })
        }
      }

      return false
    }

    return false
  }

  commitInteraction() {
    if (!this.activeInteraction) return false
    return this._drainActiveInteraction({ commit: true })
  }

  cancelInteraction() {
    if (!this.activeInteraction) return false
    return this._drainActiveInteraction({ commit: false })
  }

  getActiveInteraction() {
    return this.activeInteraction ? { ...this.activeInteraction } : null
  }
}

export function createTransactionCoordinator(options = {}) {
  return new TransactionCoordinator(options)
}
