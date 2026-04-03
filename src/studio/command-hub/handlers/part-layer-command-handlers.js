import { buildHistoryMeta } from '@/studio/command-hub/history-meta'

export function createPartLayerCommandHandlers({ store } = {}) {
  if (!store) return {}

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

export default createPartLayerCommandHandlers