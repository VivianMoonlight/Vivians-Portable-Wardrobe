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
        return this.store.jumpToHistoryState(payload.steps, { _fromFacade: true })
      case 'history.clear':
        return this.store.clearHistory({ _fromFacade: true })
      case 'saves.save':
        return this.store.saveStudioSession(payload.name, { _fromFacade: true })
      case 'saves.load':
        return this.store.loadStudioSession(payload.id, { _fromFacade: true })
      case 'saves.delete':
        return this.store.deleteStudioSession(payload.id, { _fromFacade: true })
      case 'saves.rename':
        return this.store.renameStudioSession(payload.id, payload.newName, { _fromFacade: true })
      case 'saves.restoreLocal':
        return this.store.restoreFromLocalStorage({ _fromFacade: true })
      case 'stack.add':
        return this.store.addElement(payload.element, { _fromFacade: true })
      case 'stack.remove':
        return this.store.removeElement(payload.index, { _fromFacade: true })
      case 'stack.move':
        return this.store.moveElement(payload.fromIdx, payload.toIdx, { _fromFacade: true })
      case 'stack.rename':
        return this.store.renameStack(payload.stackIndex, payload.newName, { _fromFacade: true })
      case 'storage.loadStacksLocal':
        return this.store.loadStacksFromLocalStorage({ _fromFacade: true })
      case 'storage.loadPaletteLocal':
        return this.store.loadPaletteFromLocalStorage({ _fromFacade: true })
      case 'storage.importStacks':
        return this.store.importStacksFromJsonFile(payload.file, {
          _fromFacade: true,
          atomicHistory: meta.atomicHistory !== false
        })
      case 'storage.importPalette':
        return this.store.importPaletteFromJsonFile(payload.file, {
          _fromFacade: true,
          atomicHistory: meta.atomicHistory !== false
        })
      case 'storage.importSnapshot':
        return this.store.importStudioSnapshotFromFile(payload.file, {
          _fromFacade: true,
          atomicHistory: meta.atomicHistory !== false
        })
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
