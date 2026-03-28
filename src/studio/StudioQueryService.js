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

const QUERY_HANDLERS = Object.freeze({
  activePaletteTargets: getActivePaletteTargets,
  focusedLayer: getFocusedLayer,
  renderStats: getRenderStats,
  selectionSummary: getSelectionSummary
})

export function queryStudio(store, name, params = {}) {
  const queryName = String(name || '').trim()
  if (!queryName) return null

  const handler = QUERY_HANDLERS[queryName]
  if (!handler) return null

  return handler(store, params)
}

export function getStudioQueryNames() {
  return Object.keys(QUERY_HANDLERS)
}
