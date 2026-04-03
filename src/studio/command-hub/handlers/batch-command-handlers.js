import { buildHistoryMeta } from '@/studio/command-hub/history-meta'

export function createBatchCommandHandlers({ store } = {}) {
  if (!store) return {}

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

export default createBatchCommandHandlers