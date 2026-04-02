import { isStudioFacadeEnabled } from '@/config/featureFlags'
import { createStudioCommandBus } from '@/studio/StudioCommandBus'
import { queryStudio, getStudioQueryNames } from '@/studio/StudioQueryService'
import { createTransactionCoordinator } from '@/studio/TransactionCoordinator'
import { useStudioPersistenceStore } from '@/stores/studio/persistenceStore'
import { useStudioPaletteStore } from '@/stores/studio/paletteStore'

class StudioFacade {
  constructor(store) {
    this.store = store
    this.persistenceStore = useStudioPersistenceStore()
    this.paletteStore = useStudioPaletteStore()
    this.commandBus = createStudioCommandBus(store, {
      persistenceStore: this.persistenceStore,
      paletteStore: this.paletteStore
    })
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
    return queryStudio(this.store, name, params, {
      persistenceStore: this.persistenceStore
    })
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
        return this.paletteStore.applyColorToActivePaletteTargets(this.store, payload.newColor, {
          deferCommit: meta.deferCommit === true,
          _fromFacade: true
        })
      case 'palette.applyTag':
        return this.paletteStore.applyTagToActivePaletteTargets(this.store, payload.tag, { _fromFacade: true })
      case 'palette.applyTagOffset':
        return this.paletteStore.applyTagOffsetToActivePaletteTargets(this.store, payload, {
          deferCommit: meta.deferCommit === true,
          _fromFacade: true
        })
      case 'palette.resetTagOffset':
        return this.paletteStore.resetTagOffsetToTag(this.store, payload.tag, {
          deferCommit: meta.deferCommit === true,
          _fromFacade: true
        })
      case 'palette.updateTag':
        return this.paletteStore.updatePaletteTag(this.store, payload.tag, payload.newValue, { _fromFacade: true })
      case 'part.updateProperty':
        return this.store.applyFocusedPartProperty(payload.property, {
          rebuildLayers: payload.rebuildLayers !== false,
          refresh: payload.refresh !== false,
          deferCommit: meta.deferCommit === true,
          _fromFacade: true
        })
      case 'part.applyLayerDeltas':
        return this.store.applyPartLayerDeltas(payload.part, payload.deltas, {
          deferCommit: meta.deferCommit === true,
          _fromFacade: true
        })
      case 'layer.batchApplyLayerDeltas':
        return this.store.batchApplyPartLayerDeltas(payload.updates, {
          deferCommit: meta.deferCommit === true,
          _fromFacade: true
        })
      case 'batch.updateOpacity':
        return this.store.batchUpdateOpacity(payload.value, payload.mode, {
          deferCommit: meta.deferCommit === true,
          _fromFacade: true
        })
      case 'batch.updateOffset':
        return this.store.batchUpdateOffset(payload.x, payload.y, payload.mode, {
          deferCommit: meta.deferCommit === true,
          _fromFacade: true
        })
      case 'batch.updatePriority':
        return this.store.batchUpdatePriority(payload.value, payload.mode, {
          deferCommit: meta.deferCommit === true,
          _fromFacade: true
        })
      case 'batch.updateColor':
        return this.store.batchUpdateColor(payload.colorValue, {
          deferCommit: meta.deferCommit === true,
          _fromFacade: true
        })
      case 'asset.apply':
        return this.store.applyAssetToSelectedStack(payload.asset, payload.replaceTarget, {
          _fromFacade: true
        })
      case 'history.jump':
        if (Number.isFinite(Number(payload?.timestamp))) {
          return this.store.jumpToHistoryTimestamp(payload.timestamp, payload?.policy || 'latest', { _fromFacade: true })
        }
        return this.store.jumpToHistoryState(payload.steps, { _fromFacade: true })
      case 'history.clear':
        return this.store.clearHistory({ _fromFacade: true })
      case 'saves.save':
        return this.persistenceStore.saveStudioSession(this.store, payload.name)
      case 'saves.load':
        return this.persistenceStore.loadStudioSession(this.store, payload.id)
      case 'saves.delete':
        return this.persistenceStore.deleteStudioSession(this.store, payload.id)
      case 'saves.rename':
        return this.persistenceStore.renameStudioSession(this.store, payload.id, payload.newName)
      case 'stack.rename':
        return this.store.renameStack(payload.stackIndex, payload.newName, { _fromFacade: true })
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
