function toNumberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null
}

function cloneValue(value) {
  try {
    return structuredClone(value)
  } catch (e) {
    try {
      return JSON.parse(JSON.stringify(value))
    } catch (err) {
      return value
    }
  }
}

function getActivePaletteTargets(store) {
  const targets = Array.isArray(store?.activePaletteTargets) ? store.activePaletteTargets : []
  return cloneValue(targets)
}

function getFocusedLayer(store, params = {}) {
  const part = store?.focusedPart
  if (!part || !Array.isArray(part.layerEntries) || part.layerEntries.length === 0) {
    return null
  }

  let layerIndex = toNumberOrNull(params?.layerIndex)
  if (layerIndex === null && typeof store?.getPrimaryMoveLayerIndex === 'function') {
    layerIndex = toNumberOrNull(store.getPrimaryMoveLayerIndex(part))
  }
  if (layerIndex === null) layerIndex = 0
  if (layerIndex < 0 || layerIndex >= part.layerEntries.length) return null

  const layer = part.layerEntries[layerIndex]
  if (!layer || typeof layer !== 'object') return null

  return {
    stackIndex: toNumberOrNull(store?.focusedPartIndex?.stackIndex),
    partIndex: toNumberOrNull(store?.focusedPartIndex?.partIndex),
    layerIndex,
    key: layer._key || `${store?.focusedPartIndex?.stackIndex ?? 's'}:${store?.focusedPartIndex?.partIndex ?? 'p'}:${layerIndex}`,
    name: layer.name || layer.layerName || null,
    isColorable: !!layer.isColorable,
    colorText: layer.colorText || null,
    colorCss: layer.colorCss || null,
    opacity: layer.opacity,
    drawingLeft: layer.drawingLeft,
    drawingTop: layer.drawingTop,
    priority: layer.priority,
    hasSubLayers: Array.isArray(layer.subLayers) && layer.subLayers.length > 0
  }
}

function getRenderStats(store) {
  const previewRenderer = store?.previewRenderer || null
  return {
    useOptimizedRenderer: !!store?.useOptimizedRenderer,
    pipelineEnabled: !!store?.renderPipeline,
    pendingMergedRefresh: !!store?._pendingMergedRefresh,
    pendingLayerRefresh: !!store?._pendingLayerRefresh,
    paletteRealtimeMode: !!store?._paletteRealtimeMode,
    paletteRealtimeDirty: !!store?._paletteRealtimeDirty,
    perf: cloneValue(previewRenderer?.perfStats || {}),
    pipelineStats: cloneValue(store?._renderPipelineLastStats || null)
  }
}

function getMutationStats(store) {
  const stats = cloneValue(store?._mutationStats || {})
  return {
    ...stats,
    paletteRealtimeMode: !!store?._paletteRealtimeMode,
    paletteRealtimeDirty: !!store?._paletteRealtimeDirty,
    editorRealtimeMode: !!store?._editorRealtimeMode,
    editorRealtimeDirty: !!store?._editorRealtimeDirty,
    pendingMergedRefresh: !!store?._pendingMergedRefresh,
    pendingLayerRefresh: !!store?._pendingLayerRefresh
  }
}

function getInteractionState(store) {
  const paletteActive = !!store?._paletteRealtimeMode
  const editorActive = !!store?._editorRealtimeMode
  return {
    paletteActive,
    editorActive,
    activeKind: paletteActive ? 'palette' : (editorActive ? 'editor' : 'none'),
    hasPendingCommit: !!store?._paletteRealtimeDirty || !!store?._editorRealtimeDirty,
    selectedCount: Array.isArray(store?.selectedLayers) ? store.selectedLayers.length : 0,
    selectionMode: store?.selectionMode || 'single',
    focusedPartIndex: cloneValue(store?.focusedPartIndex || null)
  }
}

function getHistoryState(store) {
  try {
    const history = typeof store?.getFullHistory === 'function' ? (store.getFullHistory() || {}) : {}
    const undoCount = Number(history?.undoCount || 0)
    const redoCount = Number(history?.redoCount || 0)
    const undoStack = Array.isArray(history?.undoStack) ? history.undoStack : []
    const redoStack = Array.isArray(history?.redoStack) ? history.redoStack : []
    return {
      canUndo: undoCount > 0,
      canRedo: redoCount > 0,
      undoCount,
      redoCount,
      undoStackSize: undoStack.length,
      redoStackSize: redoStack.length,
      latestUndo: cloneValue(undoStack[0] || null),
      latestRedo: cloneValue(redoStack[0] || null)
    }
  } catch (e) {
    return {
      canUndo: false,
      canRedo: false,
      undoCount: 0,
      redoCount: 0,
      undoStackSize: 0,
      redoStackSize: 0,
      latestUndo: null,
      latestRedo: null,
      error: String(e?.message || e || 'history-unavailable')
    }
  }
}

function getDirtyScopes(store) {
  const scopes = {
    palette: !!store?._paletteRealtimeDirty,
    editor: !!store?._editorRealtimeDirty,
    pendingMergedRefresh: !!store?._pendingMergedRefresh,
    pendingLayerRefresh: !!store?._pendingLayerRefresh
  }
  const active = Object.entries(scopes)
    .filter(([key, value]) => key !== 'pendingMergedRefresh' && key !== 'pendingLayerRefresh' && value)
    .map(([key]) => key)

  return {
    ...scopes,
    activeScopes: active,
    hasDirty: active.length > 0
  }
}

function getSelectionSummary(store) {
  const selectedLayers = Array.isArray(store?.selectedLayers) ? store.selectedLayers : []
  return {
    mode: store?.selectionMode || store?.focusState?.selection?.mode || 'single',
    selectedCount: selectedLayers.length,
    selectedLayers: cloneValue(selectedLayers),
    focusedPartIndex: {
      stackIndex: toNumberOrNull(store?.focusedPartIndex?.stackIndex),
      partIndex: toNumberOrNull(store?.focusedPartIndex?.partIndex)
    },
    focusContext: cloneValue(store?.activeFocusContext || {}),
    focusState: cloneValue(store?.focusState || {})
  }
}

function getPersistenceState(store, params = {}, context = {}) {
  const persistenceStore = context?.persistenceStore
  if (!persistenceStore) {
    return {
      autoSaveEnabled: false,
      saveStatus: 'idle',
      lastSaveTime: null,
      currentSaveId: null
    }
  }

  return {
    autoSaveEnabled: !!persistenceStore.autoSaveEnabled,
    saveStatus: persistenceStore.saveStatus || 'idle',
    lastSaveTime: persistenceStore.lastSaveTime || null,
    currentSaveId: persistenceStore.currentSaveId || null
  }
}

const QUERY_HANDLERS = Object.freeze({
  activePaletteTargets: getActivePaletteTargets,
  focusedLayer: getFocusedLayer,
  renderStats: getRenderStats,
  selectionSummary: getSelectionSummary,
  mutationStats: getMutationStats,
  interactionState: getInteractionState,
  historyState: getHistoryState,
  dirtyScopes: getDirtyScopes,
  persistenceState: getPersistenceState
})

export function queryStudio(store, name, params = {}, context = {}) {
  const queryName = String(name || '').trim()
  if (!queryName) return null

  const handler = QUERY_HANDLERS[queryName]
  if (!handler) return null

  return handler(store, params, context)
}

export function getStudioQueryNames() {
  return Object.keys(QUERY_HANDLERS)
}
