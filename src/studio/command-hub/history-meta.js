export function buildHistoryMeta(type, payload, meta = {}) {
  const actionType = String(meta?.historyActionType || type || '').trim()
  if (!actionType) return null

  const historyMeta = { actionType }
  const source = String(meta?.historySource || meta?.source || '').trim()
  const interactionKind = String(meta?.interactionKind || '').trim()

  if (source) historyMeta.source = source
  if (interactionKind) historyMeta.interactionKind = interactionKind

  if (type === 'layer.batchApplyLayerDeltas') {
    const changedParts = Array.isArray(payload?.updates) ? payload.updates.length : 0
    if (changedParts > 0) historyMeta.changedParts = changedParts
  }

  return historyMeta
}

export default buildHistoryMeta
