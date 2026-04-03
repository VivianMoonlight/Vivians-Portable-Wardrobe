import { buildHistoryMeta } from '@/studio/command-hub/history-meta'

export function createStackCommandHandlers({ store } = {}) {
  if (!store) return {}

  return {
    'stack.rename': (payload, meta) => store.renameStack(payload.stackIndex, payload.newName, {
      historyMeta: buildHistoryMeta('stack.rename', payload, meta),
      _fromFacade: true
    })
  }
}

export default createStackCommandHandlers