function buildHistoryMeta(type, payload, meta = {}) {
  const actionType = String(meta?.historyActionType || type || '').trim()
  if (!actionType) return null

  const historyMeta = { actionType }
  const source = String(meta?.historySource || meta?.source || '').trim()
  const interactionKind = String(meta?.interactionKind || '').trim()

  if (source) historyMeta.source = source
  if (interactionKind) historyMeta.interactionKind = interactionKind

  if (type === 'layer.batchApplyLayerDeltas') {
    const changedParts = Array.isArray(payload?.updates) ? payload.updates.length : 0
    if (changedParts > 0) historyMeta.changedParts = changedParts
  }

  return historyMeta
}

function createPaletteHandlers(store) {
  return {
    'palette.applyColor': (payload, meta) => store.applyColorToActivePaletteTargets(payload.newColor, {
      deferCommit: meta.deferCommit === true,
      historyMeta: buildHistoryMeta('palette.applyColor', payload, meta),
      _fromFacade: true
    }),
    'palette.applyTag': (payload) => store.applyTagToActivePaletteTargets(payload.tag, { _fromFacade: true }),
    'palette.applyTagOffset': (payload, meta) => store.applyTagOffsetToActivePaletteTargets(payload, {
      deferCommit: meta.deferCommit === true,
      historyMeta: buildHistoryMeta('palette.applyTagOffset', payload, meta),
      _fromFacade: true
    }),
    'palette.resetTagOffset': (payload, meta) => store.resetTagOffsetToTag(payload.tag, {
      deferCommit: meta.deferCommit === true,
      historyMeta: buildHistoryMeta('palette.resetTagOffset', payload, meta),
      _fromFacade: true
    }),
    'palette.updateTag': (payload) => store.updatePaletteTag(payload.tag, payload.newValue, { _fromFacade: true })
  }
}

function createEditorHandlers(store) {
  return {
    'part.updateProperty': (payload, meta) => store.applyFocusedPartProperty(payload.property, {
      rebuildLayers: payload.rebuildLayers !== false,
      refresh: payload.refresh !== false,
      deferCommit: meta.deferCommit === true,
      historyMeta: buildHistoryMeta('part.updateProperty', payload, meta),
      _fromFacade: true
    }),
    'part.applyLayerDeltas': (payload, meta) => store.applyPartLayerDeltas(payload.part, payload.deltas, {
      deferCommit: meta.deferCommit === true,
      historyMeta: buildHistoryMeta('part.applyLayerDeltas', payload, meta),
      _fromFacade: true
    }),
    'layer.batchApplyLayerDeltas': (payload, meta) => store.batchApplyPartLayerDeltas(payload.updates, {
      deferCommit: meta.deferCommit === true,
      historyMeta: buildHistoryMeta('layer.batchApplyLayerDeltas', payload, meta),
      _fromFacade: true
    })
  }
}

function createBatchHandlers(store) {
  return {
    'batch.updateOpacity': (payload, meta) => store.batchUpdateOpacity(payload.value, payload.mode, {
      deferCommit: meta.deferCommit === true,
      historyMeta: buildHistoryMeta('batch.updateOpacity', payload, meta),
      _fromFacade: true
    }),
    'batch.updateOffset': (payload, meta) => store.batchUpdateOffset(payload.x, payload.y, payload.mode, {
      deferCommit: meta.deferCommit === true,
      historyMeta: buildHistoryMeta('batch.updateOffset', payload, meta),
      _fromFacade: true
    }),
    'batch.updatePriority': (payload, meta) => store.batchUpdatePriority(payload.value, payload.mode, {
      deferCommit: meta.deferCommit === true,
      historyMeta: buildHistoryMeta('batch.updatePriority', payload, meta),
      _fromFacade: true
    }),
    'batch.updateColor': (payload, meta) => store.batchUpdateColor(payload.colorValue, {
      deferCommit: meta.deferCommit === true,
      historyMeta: buildHistoryMeta('batch.updateColor', payload, meta),
      _fromFacade: true
    })
  }
}

function createAssetHandlers(store) {
  return {
    'asset.apply': (payload) => store.applyAssetToSelectedStack(payload.asset, payload.replaceTarget, {
      _fromFacade: true
    })
  }
}

function createHistoryHandlers(store) {
  return {
    'history.jump': (payload) => store.jumpToHistoryState(payload.steps, {
      _fromFacade: true
    }),
    'history.clear': () => store.clearHistory({
      _fromFacade: true
    })
  }
}

function createSavesHandlers(store) {
  return {
    'saves.save': (payload) => store.saveStudioSession(payload.name, {
      _fromFacade: true
    }),
    'saves.load': (payload) => store.loadStudioSession(payload.id, {
      _fromFacade: true
    }),
    'saves.delete': (payload) => store.deleteStudioSession(payload.id, {
      _fromFacade: true
    }),
    'saves.rename': (payload) => store.renameStudioSession(payload.id, payload.newName, {
      _fromFacade: true
    })
  }
}

function createStackHandlers(store) {
  return {
    'stack.rename': (payload) => store.renameStack(payload.stackIndex, payload.newName, {
      _fromFacade: true
    })
  }
}

export class StudioCommandBus {
  constructor(store) {
    this.store = store
    this.handlers = {
      ...createPaletteHandlers(store),
      ...createEditorHandlers(store),
      ...createBatchHandlers(store),
      ...createAssetHandlers(store),
      ...createHistoryHandlers(store),
      ...createSavesHandlers(store),
      ...createStackHandlers(store)
    }
  }

  execute(command = {}) {
    if (!command || typeof command !== 'object') return false

    const type = String(command.type || '').trim()
    if (!type) return false

    const payload = command.payload || {}
    const meta = command.meta || {}
    const handler = this.handlers[type]
    if (typeof handler !== 'function') return false

    return handler(payload, meta)
  }
}

export function createStudioCommandBus(store) {
  return new StudioCommandBus(store)
}
