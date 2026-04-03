import { useStudioPersistenceStore } from '@/stores/studio/persistenceStore'
import { useStudioPaletteStore } from '@/stores/studio/paletteStore'
import { createDefaultStudioCommandHandlers } from '@/studio/command-hub/default-command-handlers'

export class StudioCommandBus {
  constructor(store, options = {}) {
    this.store = store
    this.persistenceStore = options.persistenceStore || useStudioPersistenceStore()
    this.paletteStore = options.paletteStore || useStudioPaletteStore()
    this.handlers = new Map()

    const defaultHandlers = options.defaultHandlers || createDefaultStudioCommandHandlers({
      store,
      persistenceStore: this.persistenceStore,
      paletteStore: this.paletteStore
    })
    this.registerHandlers(defaultHandlers)
  }

  registerHandler(type, handler, options = {}) {
    const normalizedType = String(type || '').trim()
    if (!normalizedType || typeof handler !== 'function') return false

    const overwrite = options?.overwrite !== false
    if (!overwrite && this.handlers.has(normalizedType)) return false

    this.handlers.set(normalizedType, handler)
    return true
  }

  registerHandlers(handlers = {}, options = {}) {
    if (!handlers || typeof handlers !== 'object') return 0

    let registered = 0
    for (const [type, handler] of Object.entries(handlers)) {
      if (this.registerHandler(type, handler, options)) {
        registered += 1
      }
    }
    return registered
  }

  unregisterHandler(type) {
    const normalizedType = String(type || '').trim()
    if (!normalizedType) return false
    return this.handlers.delete(normalizedType)
  }

  hasHandler(type) {
    const normalizedType = String(type || '').trim()
    if (!normalizedType) return false
    return this.handlers.has(normalizedType)
  }

  getRegisteredCommandTypes() {
    return Array.from(this.handlers.keys()).sort()
  }

  execute(command = {}) {
    if (!command || typeof command !== 'object') return false

    const type = String(command.type || '').trim()
    if (!type) return false

    const payload = command.payload || {}
    const meta = command.meta || {}
    const handler = this.handlers.get(type)
    if (typeof handler !== 'function') return false

    return handler(payload, meta)
  }
}

export function createStudioCommandBus(store, options = {}) {
  return new StudioCommandBus(store, options)
}
