function createPaletteHandlers(store) {
  return {
    'palette.applyColor': (payload, meta) => store.applyColorToActivePaletteTargets(payload.newColor, {
      deferCommit: meta.deferCommit === true,
      _fromFacade: true
    }),
    'palette.applyTag': (payload) => store.applyTagToActivePaletteTargets(payload.tag, { _fromFacade: true }),
    'palette.applyTagOffset': (payload, meta) => store.applyTagOffsetToActivePaletteTargets(payload, {
      deferCommit: meta.deferCommit === true,
      _fromFacade: true
    }),
    'palette.resetTagOffset': (payload, meta) => store.resetTagOffsetToTag(payload.tag, {
      deferCommit: meta.deferCommit === true,
      _fromFacade: true
    }),
    'palette.updateTag': (payload) => store.updatePaletteTag(payload.tag, payload.newValue, { _fromFacade: true })
  }
}

export class StudioCommandBus {
  constructor(store) {
    this.store = store
    this.handlers = {
      ...createPaletteHandlers(store)
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
