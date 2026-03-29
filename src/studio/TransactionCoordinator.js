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

export class TransactionCoordinator {
  constructor({ store, executeCommand } = {}) {
    this.store = store
    this.executeCommand = executeCommand
    this.activeInteraction = null
  }

  beginInteraction(kind = 'palette', meta = {}) {
    this.activeInteraction = { kind, meta }

    if (kind === 'palette') {
      this.store.beginPaletteRealtimeUpdate()
      return true
    }

    if (EDITOR_KINDS.includes(kind)) {
      this.store.beginEditorRealtimeUpdate()
      return true
    }

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
            meta: { deferCommit: true }
          })
        }
      }

      if (Object.prototype.hasOwnProperty.call(delta, 'newColor')) {
        return this.executeCommand({
          type: 'palette.applyColor',
          payload: { newColor: delta.newColor },
          meta: { deferCommit: true }
        })
      }

      return false
    }

    if (EDITOR_KINDS.includes(kind)) {
      if (typeof delta.type === 'string' && delta.type.trim()) {
        const normalizedType = delta.type.trim()
        if (EDITOR_DELTA_COMMANDS.includes(normalizedType)) {
          return this.executeCommand({
            type: normalizedType,
            payload: delta.payload || {},
            meta: { deferCommit: true }
          })
        }
      }

      return false
    }

    return false
  }

  commitInteraction() {
    if (!this.activeInteraction) return false
    const { kind } = this.activeInteraction
    this.activeInteraction = null

    if (kind === 'palette') {
      return this.store.endPaletteRealtimeUpdate({ commit: true })
    }

    if (EDITOR_KINDS.includes(kind)) {
      return this.store.endEditorRealtimeUpdate({ commit: true })
    }

    return false
  }

  cancelInteraction() {
    if (!this.activeInteraction) return false
    const { kind } = this.activeInteraction
    this.activeInteraction = null

    if (kind === 'palette') {
      return this.store.endPaletteRealtimeUpdate({ commit: false })
    }

    if (EDITOR_KINDS.includes(kind)) {
      return this.store.endEditorRealtimeUpdate({ commit: false })
    }

    return false
  }

  getActiveInteraction() {
    return this.activeInteraction ? { ...this.activeInteraction } : null
  }
}

export function createTransactionCoordinator(options = {}) {
  return new TransactionCoordinator(options)
}
