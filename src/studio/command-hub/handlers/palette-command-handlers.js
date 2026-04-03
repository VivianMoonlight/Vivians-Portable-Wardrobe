import { buildHistoryMeta } from '@/studio/command-hub/history-meta'

export function createPaletteCommandHandlers({ store, paletteStore } = {}) {
  if (!store || !paletteStore) return {}

  return {
    'palette.applyColor': (payload, meta) => paletteStore.applyColorToActivePaletteTargets(store, payload.newColor, {
      deferCommit: meta.deferCommit === true,
      historyMeta: buildHistoryMeta('palette.applyColor', payload, meta),
      _fromFacade: true
    }),
    'palette.applyTag': (payload, meta) => paletteStore.applyTagToActivePaletteTargets(store, payload.tag, {
      historyMeta: buildHistoryMeta('palette.applyTag', payload, meta),
      _fromFacade: true
    }),
    'palette.applyTagOffset': (payload, meta) => paletteStore.applyTagOffsetToActivePaletteTargets(store, payload, {
      deferCommit: meta.deferCommit === true,
      historyMeta: buildHistoryMeta('palette.applyTagOffset', payload, meta),
      _fromFacade: true
    }),
    'palette.resetTagOffset': (payload, meta) => paletteStore.resetTagOffsetToTag(store, payload.tag, {
      deferCommit: meta.deferCommit === true,
      historyMeta: buildHistoryMeta('palette.resetTagOffset', payload, meta),
      _fromFacade: true
    }),
    'palette.updateTag': (payload) => paletteStore.updatePaletteTag(store, payload.tag, payload.newValue, { _fromFacade: true })
  }
}

export default createPaletteCommandHandlers