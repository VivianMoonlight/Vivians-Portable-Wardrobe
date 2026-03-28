import { isStudioFacadeEnabled } from '@/config/featureFlags'

class StudioFacade {
  constructor(store) {
    this.store = store
    this.activeInteraction = null
  }

  execute(command, options = {}) {
    if (!command || typeof command !== 'object') return false
    const type = String(command.type || '').trim()
    const payload = command.payload || {}
    const meta = command.meta || {}

    // Feature-flag bypass keeps legacy calls available for quick rollback.
    if (!isStudioFacadeEnabled()) {
      return this._executeLegacy(type, payload, meta, options)
    }

    switch (type) {
      case 'palette.applyColor':
        return this.store.applyColorToActivePaletteTargets(payload.newColor, {
          deferCommit: meta.deferCommit === true,
          _fromFacade: true
        })
      case 'palette.applyTag':
        return this.store.applyTagToActivePaletteTargets(payload.tag, { _fromFacade: true })
      case 'palette.applyTagOffset':
        return this.store.applyTagOffsetToActivePaletteTargets(payload, { _fromFacade: true })
      case 'palette.resetTagOffset':
        return this.store.resetTagOffsetToTag(payload.tag, { _fromFacade: true })
      case 'palette.updateTag':
        return this.store.updatePaletteTag(payload.tag, payload.newValue, { _fromFacade: true })
      default:
        return this._executeLegacy(type, payload, meta, options)
    }
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
    if (kind === 'palette') {
      if (delta.type === 'palette.applyColor') {
        return this.execute({ type: delta.type, payload: delta.payload, meta: { deferCommit: true } })
      }
      if (Object.prototype.hasOwnProperty.call(delta, 'newColor')) {
        return this.execute({
          type: 'palette.applyColor',
          payload: { newColor: delta.newColor },
          meta: { deferCommit: true }
        })
      }
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

  _executeLegacy(type, payload, meta, options) {
    switch (type) {
      case 'palette.applyColor':
        return this.store.applyColorToActivePaletteTargets(payload.newColor, {
          deferCommit: meta.deferCommit === true,
          _fromFacade: true
        })
      case 'palette.applyTag':
        return this.store.applyTagToActivePaletteTargets(payload.tag, { _fromFacade: true })
      case 'palette.applyTagOffset':
        return this.store.applyTagOffsetToActivePaletteTargets(payload, { _fromFacade: true })
      case 'palette.resetTagOffset':
        return this.store.resetTagOffsetToTag(payload.tag, { _fromFacade: true })
      case 'palette.updateTag':
        return this.store.updatePaletteTag(payload.tag, payload.newValue, { _fromFacade: true })
      default:
        return false
    }
  }
}

const facadeCache = new WeakMap()

export function getStudioFacade(store) {
  if (!store || typeof store !== 'object') {
    throw new Error('getStudioFacade requires a store instance')
  }

  let facade = facadeCache.get(store)
  if (!facade) {
    facade = new StudioFacade(store)
    facadeCache.set(store, facade)
  }
  return facade
}
