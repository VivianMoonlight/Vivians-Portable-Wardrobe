export function createHistoryCommandHandlers({ store } = {}) {
  if (!store) return {}

  return {
    'history.jump': (payload) => {
      const timestamp = Number(payload?.timestamp)
      if (Number.isFinite(timestamp)) {
        return store.jumpToHistoryTimestamp(timestamp, payload?.policy || 'latest', {
          _fromFacade: true
        })
      }

      return store.jumpToHistoryState(payload?.steps, {
        _fromFacade: true
      })
    },
    'history.clear': () => store.clearHistory({
      _fromFacade: true
    })
  }
}

export default createHistoryCommandHandlers