export function createSavesCommandHandlers({ store, persistenceStore } = {}) {
  if (!store || !persistenceStore) return {}

  return {
    'saves.save': (payload) => persistenceStore.saveStudioSession(store, payload.name),
    'saves.load': (payload) => persistenceStore.loadStudioSession(store, payload.id),
    'saves.delete': (payload) => persistenceStore.deleteStudioSession(store, payload.id),
    'saves.rename': (payload) => persistenceStore.renameStudioSession(store, payload.id, payload.newName)
  }
}

export default createSavesCommandHandlers