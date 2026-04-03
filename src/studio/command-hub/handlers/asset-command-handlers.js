import { buildHistoryMeta } from '@/studio/command-hub/history-meta'

export function createAssetCommandHandlers({ store } = {}) {
  if (!store) return {}

  return {
    'asset.apply': (payload, meta) => store.applyAssetToSelectedStack(payload.asset, payload.replaceTarget, {
      selectedCraftEntry: payload.selectedCraftEntry || null,
      autoResolveCraft: payload.autoResolveCraft === true,
      historyMeta: buildHistoryMeta('asset.apply', payload, meta),
      _fromFacade: true
    })
  }
}

export default createAssetCommandHandlers