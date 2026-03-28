const PALETTE_DELTA_COMMANDS = Object.freeze([
  'palette.applyColor',
  'palette.applyTagOffset',
  'palette.resetTagOffset'
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

    return false
  }

  applyDelta(delta = {}) {
    if (!this.activeInteraction) return false

    const kind = this.activeInteraction.kind
    if (kind !== 'palette') return false

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

  commitInteraction() {
    if (!this.activeInteraction) return false
    const { kind } = this.activeInteraction
    this.activeInteraction = null

    if (kind === 'palette') {
      return this.store.endPaletteRealtimeUpdate({ commit: true })
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

    return false
  }

  getActiveInteraction() {
    return this.activeInteraction ? { ...this.activeInteraction } : null
  }
}

export function createTransactionCoordinator(options = {}) {
  return new TransactionCoordinator(options)
}
