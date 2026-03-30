export const PANEL_HOST = Object.freeze({
  CONTEXT: 'context',
  TOOL_DOCK: 'toolDock',
  BOTTOM_TRAY: 'bottomTray',
  MODAL: 'modal'
})

export const PANEL_VISIBILITY = Object.freeze({
  PINNED: 'pinned',
  PEEK: 'peek',
  HIDDEN: 'hidden'
})

export const PANEL_REGISTRY = Object.freeze({
  inspector: {
    id: 'inspector',
    category: 'context',
    preferredHost: PANEL_HOST.CONTEXT,
    allowedHosts: [PANEL_HOST.CONTEXT],
    exclusiveGroup: 'context',
    defaultState: PANEL_VISIBILITY.HIDDEN
  },
  asset: {
    id: 'asset',
    category: 'tool',
    preferredHost: PANEL_HOST.CONTEXT,
    allowedHosts: [PANEL_HOST.CONTEXT],
    exclusiveGroup: 'context',
    defaultState: PANEL_VISIBILITY.HIDDEN
  },
  palette: {
    id: 'palette',
    category: 'tool',
    preferredHost: PANEL_HOST.TOOL_DOCK,
    allowedHosts: [PANEL_HOST.TOOL_DOCK],
    exclusiveGroup: 'toolDock',
    defaultState: PANEL_VISIBILITY.HIDDEN
  },
  layer: {
    id: 'layer',
    category: 'tool',
    preferredHost: PANEL_HOST.TOOL_DOCK,
    allowedHosts: [PANEL_HOST.TOOL_DOCK],
    exclusiveGroup: 'toolDock',
    defaultState: PANEL_VISIBILITY.HIDDEN
  },
  history: {
    id: 'history',
    category: 'history',
    preferredHost: PANEL_HOST.BOTTOM_TRAY,
    allowedHosts: [PANEL_HOST.BOTTOM_TRAY],
    exclusiveGroup: 'bottomTray',
    defaultState: PANEL_VISIBILITY.HIDDEN
  },
  saves: {
    id: 'saves',
    category: 'storage',
    preferredHost: PANEL_HOST.MODAL,
    allowedHosts: [PANEL_HOST.MODAL],
    exclusiveGroup: 'modal',
    defaultState: PANEL_VISIBILITY.HIDDEN
  }
})

export const PANEL_IDS = Object.freeze(Object.keys(PANEL_REGISTRY))

export function normalizePanelState(state) {
  if (state === PANEL_VISIBILITY.PINNED || state === PANEL_VISIBILITY.PEEK || state === PANEL_VISIBILITY.HIDDEN) {
    return state
  }
  return PANEL_VISIBILITY.HIDDEN
}

export function resolvePanelHost(panelId, requestedHost) {
  const meta = PANEL_REGISTRY[panelId]
  if (!meta) return null
  if (requestedHost && meta.allowedHosts.includes(requestedHost)) return requestedHost
  return meta.preferredHost
}

export function getPanelsInExclusiveGroup(exclusiveGroup) {
  if (!exclusiveGroup) return []
  return PANEL_IDS.filter((panelId) => PANEL_REGISTRY[panelId].exclusiveGroup === exclusiveGroup)
}

export function createPanelRuntimeDefaults() {
  const runtime = {}
  for (const panelId of PANEL_IDS) {
    const meta = PANEL_REGISTRY[panelId]
    runtime[panelId] = {
      state: meta.defaultState,
      host: meta.preferredHost,
      lastReason: 'default',
      lastOpenedAt: 0,
      lastClosedAt: 0
    }
  }
  return runtime
}

export function createHostActiveDefaults(runtime = createPanelRuntimeDefaults()) {
  const active = {
    [PANEL_HOST.CONTEXT]: null,
    [PANEL_HOST.TOOL_DOCK]: null,
    [PANEL_HOST.BOTTOM_TRAY]: null,
    [PANEL_HOST.MODAL]: null
  }

  for (const panelId of PANEL_IDS) {
    const panelRuntime = runtime[panelId]
    if (!panelRuntime) continue
    if (panelRuntime.state === PANEL_VISIBILITY.HIDDEN) continue
    const host = resolvePanelHost(panelId, panelRuntime.host)
    if (!host) continue
    active[host] = panelId
  }

  return active
}

export function sanitizePersistedPanelRuntime(raw) {
  const sanitized = createPanelRuntimeDefaults()
  if (!raw || typeof raw !== 'object') return sanitized

  for (const panelId of PANEL_IDS) {
    const fromRaw = raw[panelId]
    if (!fromRaw || typeof fromRaw !== 'object') continue

    sanitized[panelId] = {
      state: normalizePanelState(fromRaw.state),
      host: resolvePanelHost(panelId, fromRaw.host),
      lastReason: typeof fromRaw.lastReason === 'string' ? fromRaw.lastReason : 'restore',
      lastOpenedAt: Number.isFinite(fromRaw.lastOpenedAt) ? fromRaw.lastOpenedAt : 0,
      lastClosedAt: Number.isFinite(fromRaw.lastClosedAt) ? fromRaw.lastClosedAt : 0
    }
  }

  return sanitized
}

export function sanitizePersistedHostActive(raw, runtime) {
  const active = createHostActiveDefaults(runtime)
  if (!raw || typeof raw !== 'object') return active

  for (const host of Object.keys(active)) {
    const panelId = raw[host]
    if (!panelId || !PANEL_REGISTRY[panelId]) continue
    const resolvedHost = resolvePanelHost(panelId, runtime?.[panelId]?.host)
    if (resolvedHost === host) {
      active[host] = panelId
    }
  }

  return active
}

export function toLegacyPanelStates(runtime) {
  const states = {}
  for (const panelId of PANEL_IDS) {
    states[panelId] = normalizePanelState(runtime?.[panelId]?.state)
  }
  return states
}
