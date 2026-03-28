import { isStudioFacadeEnabled } from '@/config/featureFlags'
import { createStudioCommandBus } from '@/studio/StudioCommandBus'
import { queryStudio, getStudioQueryNames } from '@/studio/StudioQueryService'
import { createTransactionCoordinator } from '@/studio/TransactionCoordinator'

class StudioFacade {
  constructor(store) {
    this.store = store
    this.commandBus = createStudioCommandBus(store)
    this.transactionCoordinator = createTransactionCoordinator({
      store,
      executeCommand: this.execute.bind(this)
    })
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

    const handled = this.commandBus.execute({ type, payload, meta })
    if (handled !== false) return handled

    return this._executeLegacy(type, payload, meta, options)
  }

  query(name, params = {}) {
    return queryStudio(this.store, name, params)
  }

  getQueryNames() {
    return getStudioQueryNames()
  }

  beginInteraction(kind = 'palette', meta = {}) {
    return this.transactionCoordinator.beginInteraction(kind, meta)
  }

  applyDelta(delta = {}) {
    return this.transactionCoordinator.applyDelta(delta)
  }

  commitInteraction() {
    return this.transactionCoordinator.commitInteraction()
  }

  cancelInteraction() {
    return this.transactionCoordinator.cancelInteraction()
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
        return this.store.applyTagOffsetToActivePaletteTargets(payload, {
          deferCommit: meta.deferCommit === true,
          _fromFacade: true
        })
      case 'palette.resetTagOffset':
        return this.store.resetTagOffsetToTag(payload.tag, {
          deferCommit: meta.deferCommit === true,
          _fromFacade: true
        })
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
