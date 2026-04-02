function toNumberOrZero(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function createStudioHistoryBridge(studio, history) {
  const fallbackHistory = {
    undoStack: [],
    redoStack: [],
    undoCount: 0,
    redoCount: 0,
    canUndo: false,
    canRedo: false
  }

  const hasDomain = !!studio && !!history

  return {
    undo: () => (hasDomain ? history.undo(studio) : false),
    redo: () => (hasDomain ? history.redo(studio) : false),
    canUndo: () => (hasDomain ? history.canUndo(studio) : false),
    canRedo: () => (hasDomain ? history.canRedo(studio) : false),
    getHistory: () => (hasDomain ? history.getHistory(studio) : { ...fallbackHistory }),
    getFullHistory: () => (hasDomain ? history.getFullHistory(studio) : { ...fallbackHistory }),
    getRevision: () => (hasDomain ? toNumberOrZero(history.historyRevision) : 0)
  }
}

export default createStudioHistoryBridge
