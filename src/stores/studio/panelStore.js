import { defineStore } from 'pinia'
import { fastClone } from '@/utils/clone.js'
import {
  PANEL_HOST,
  PANEL_REGISTRY,
  PANEL_VISIBILITY,
  createHostActiveDefaults,
  createPanelRuntimeDefaults,
  getPanelsInExclusiveGroup,
  normalizePanelState,
  resolvePanelHost,
  sanitizePersistedHostActive,
  sanitizePersistedPanelRuntime,
  toLegacyPanelStates
} from '@/studio/panel-system'

export const useStudioPanelStore = defineStore('studioPanel', {
  state: () => ({
    workspaceMode: 'pro',
    // Deprecated but kept for compatibility.
    taskStage: 'assemble',
    activeContextPanel: null,
    panelStates: {
      inspector: 'pinned',
      asset: 'hidden',
      palette: 'hidden',
      layer: 'hidden',
      history: 'hidden',
      saves: 'hidden'
    },
    panelRuntime: createPanelRuntimeDefaults(),
    hostActivePanels: createHostActiveDefaults(),
    historyTrayExpanded: false,
    storageModalVisible: false,
    pinnedPanel: null,
    mobileTab: 'structure',
    firstRunGuideDone: false,
    palettePanelVisible: false,
    layerManagerActive: false,
    historyPanelVisible: false
  }),

  actions: {
    setWorkspaceMode() {
      this.workspaceMode = 'pro'
      this.persistUiLayout()
    },

    setTaskStage() {
      this.taskStage = 'assemble'
      this.persistUiLayout()
    },

    _syncLegacyPanelStateFromRuntime() {
      this.panelStates = toLegacyPanelStates(this.panelRuntime)

      const contextActive = this.hostActivePanels?.[PANEL_HOST.CONTEXT]
      this.activeContextPanel = (contextActive === 'asset' || contextActive === 'inspector') ? contextActive : null

      this.palettePanelVisible = this.panelRuntime.palette.state !== PANEL_VISIBILITY.HIDDEN
      this.layerManagerActive = this.panelRuntime.layer.state !== PANEL_VISIBILITY.HIDDEN
      this.historyPanelVisible = this.panelRuntime.history.state !== PANEL_VISIBILITY.HIDDEN
      this.historyTrayExpanded = this.historyPanelVisible
      this.storageModalVisible = this.panelRuntime.saves.state !== PANEL_VISIBILITY.HIDDEN

      if (this.panelRuntime.asset.state === PANEL_VISIBILITY.PINNED) {
        this.pinnedPanel = 'asset'
      } else if (this.panelRuntime.inspector.state === PANEL_VISIBILITY.PINNED) {
        this.pinnedPanel = 'inspector'
      } else {
        this.pinnedPanel = null
      }
    },

    openPanel(panelId, options = {}) {
      if (!panelId || !PANEL_REGISTRY[panelId]) return false

      const host = resolvePanelHost(panelId, options.host)
      if (!host) return false

      const requestedState = normalizePanelState(options.state || PANEL_VISIBILITY.PINNED)
      const reason = options.reason || 'manual'
      const meta = PANEL_REGISTRY[panelId]
      const now = Date.now()

      const runtime = fastClone(this.panelRuntime)
      const hostActive = { ...this.hostActivePanels }

      for (const otherPanelId of getPanelsInExclusiveGroup(meta.exclusiveGroup)) {
        if (otherPanelId === panelId) continue
        const otherRuntime = runtime[otherPanelId]
        if (!otherRuntime || otherRuntime.state === PANEL_VISIBILITY.HIDDEN) continue
        const otherHost = resolvePanelHost(otherPanelId, otherRuntime.host)
        runtime[otherPanelId] = {
          ...otherRuntime,
          state: PANEL_VISIBILITY.HIDDEN,
          lastReason: `exclusive:${panelId}`,
          lastClosedAt: now
        }
        if (otherHost && hostActive[otherHost] === otherPanelId) {
          hostActive[otherHost] = null
        }
      }

      const currentActiveOnHost = hostActive[host]
      if (currentActiveOnHost && currentActiveOnHost !== panelId && runtime[currentActiveOnHost]) {
        runtime[currentActiveOnHost] = {
          ...runtime[currentActiveOnHost],
          state: PANEL_VISIBILITY.HIDDEN,
          lastReason: `host-switch:${panelId}`,
          lastClosedAt: now
        }
      }

      runtime[panelId] = {
        ...runtime[panelId],
        state: requestedState,
        host,
        lastReason: reason,
        lastOpenedAt: now
      }

      hostActive[host] = panelId

      this.panelRuntime = runtime
      this.hostActivePanels = hostActive
      this._syncLegacyPanelStateFromRuntime()
      this.persistUiLayout()
      return true
    },

    closePanel(panelId, options = {}) {
      if (!panelId || !PANEL_REGISTRY[panelId]) return false

      const runtime = fastClone(this.panelRuntime)
      const hostActive = { ...this.hostActivePanels }
      const current = runtime[panelId]
      if (!current) return false

      const reason = options.reason || 'manual-close'
      const now = Date.now()
      const host = resolvePanelHost(panelId, current.host)

      runtime[panelId] = {
        ...current,
        state: PANEL_VISIBILITY.HIDDEN,
        lastReason: reason,
        lastClosedAt: now
      }

      if (host && hostActive[host] === panelId) {
        hostActive[host] = null
      }

      this.panelRuntime = runtime
      this.hostActivePanels = hostActive
      this._syncLegacyPanelStateFromRuntime()
      this.persistUiLayout()
      return true
    },

    togglePanel(panelId, options = {}) {
      if (!panelId || !PANEL_REGISTRY[panelId]) return false
      const isVisible = this.panelRuntime?.[panelId]?.state !== PANEL_VISIBILITY.HIDDEN
      if (isVisible) {
        return this.closePanel(panelId, { reason: options.reason || 'toggle-close' })
      }
      return this.openPanel(panelId, options)
    },

    setHistoryTrayExpanded(expanded = false) {
      if (expanded) {
        this.openPanel('history', {
          host: PANEL_HOST.BOTTOM_TRAY,
          state: PANEL_VISIBILITY.PINNED,
          reason: 'history-tray-expand'
        })
        return
      }
      this.closePanel('history', { reason: 'history-tray-collapse' })
    },

    setStorageModalVisible(visible = false) {
      if (visible) {
        this.openPanel('saves', {
          host: PANEL_HOST.MODAL,
          state: PANEL_VISIBILITY.PINNED,
          reason: 'storage-modal-open'
        })
        return
      }
      this.closePanel('saves', { reason: 'storage-modal-close' })
    },

    openContextPanel(panel, reason = 'manual') {
      if (!['inspector', 'asset', 'palette'].includes(panel)) return

      if (panel === 'palette') {
        this.openPanel('palette', {
          host: PANEL_HOST.TOOL_DOCK,
          state: PANEL_VISIBILITY.PEEK,
          reason
        })
        return
      }

      this.openPanel(panel, {
        host: PANEL_HOST.CONTEXT,
        state: PANEL_VISIBILITY.PINNED,
        reason
      })
    },

    pinPanel(panel) {
      if (!panel || !PANEL_REGISTRY[panel]) return
      this.openPanel(panel, {
        state: PANEL_VISIBILITY.PINNED,
        reason: 'pin-panel'
      })
    },

    unpinPanel(panel) {
      if (!panel || !PANEL_REGISTRY[panel]) return
      this.closePanel(panel, { reason: 'unpin-panel' })
    },

    setPanelState(panel, state) {
      if (!panel || !PANEL_REGISTRY[panel]) return
      const normalizedState = normalizePanelState(state)
      if (normalizedState === PANEL_VISIBILITY.HIDDEN) {
        this.closePanel(panel, { reason: 'set-panel-hidden' })
        return
      }
      this.openPanel(panel, {
        state: normalizedState,
        reason: 'set-panel-state'
      })
    },

    onReplaceEnter(payload = {}) {
      this.setTaskStage('replace')
      this.openContextPanel('asset', payload?.isEmpty ? 'replace-enter-empty' : 'replace-enter-part')
      if (this.mobileTab !== 'replace') {
        this.mobileTab = 'replace'
      }
    },

    onReplaceApplied() {
      this.setTaskStage('polish')
      if (this.pinnedPanel !== 'asset') {
        this.openContextPanel('inspector', 'replace-applied')
      }
      if (this.mobileTab === 'replace') {
        this.mobileTab = 'property'
      }
    },

    enterPeekPanel(panel) {
      if (!panel || !PANEL_REGISTRY[panel]) return
      if (this.panelRuntime[panel].state === PANEL_VISIBILITY.PINNED) return
      this.openPanel(panel, {
        state: PANEL_VISIBILITY.PEEK,
        reason: 'enter-peek'
      })
    },

    exitPeekPanel(panel) {
      if (!panel || !PANEL_REGISTRY[panel]) return
      if (this.panelRuntime[panel].state === PANEL_VISIBILITY.PINNED) return
      this.closePanel(panel, { reason: 'exit-peek' })
    },

    hydrateUiLayout() {
      try {
        this.workspaceMode = 'pro'

        let runtime = createPanelRuntimeDefaults()
        let hostActive = createHostActiveDefaults(runtime)

        const runtimeRaw = localStorage.getItem('studio.ui.panelRuntime')
        if (runtimeRaw) {
          const parsedRuntime = JSON.parse(runtimeRaw)
          runtime = sanitizePersistedPanelRuntime(parsedRuntime)
          hostActive = createHostActiveDefaults(runtime)

          const activeRaw = localStorage.getItem('studio.ui.hostActivePanels')
          if (activeRaw) {
            const parsedActive = JSON.parse(activeRaw)
            const sanitizedActive = sanitizePersistedHostActive(parsedActive, runtime)
            hostActive = {
              ...hostActive,
              ...sanitizedActive
            }
          }
        } else {
          const statesRaw = localStorage.getItem('studio.ui.panelStates')
          if (statesRaw) {
            const parsed = JSON.parse(statesRaw)
            if (parsed && typeof parsed === 'object') {
              for (const panelId of Object.keys(PANEL_REGISTRY)) {
                if (!Object.prototype.hasOwnProperty.call(parsed, panelId)) continue
                runtime[panelId] = {
                  ...runtime[panelId],
                  state: normalizePanelState(parsed[panelId]),
                  host: resolvePanelHost(panelId, runtime[panelId].host),
                  lastReason: 'legacy-migration'
                }
              }
            }
          }

          const historyTrayRaw = localStorage.getItem('studio.ui.historyTrayExpanded')
          if (historyTrayRaw === 'true' || historyTrayRaw === '1') {
            runtime.history.state = PANEL_VISIBILITY.PINNED
          }
          if (historyTrayRaw === 'false' || historyTrayRaw === '0') {
            runtime.history.state = PANEL_VISIBILITY.HIDDEN
          }

          const storageModalRaw = localStorage.getItem('studio.ui.storageModalVisible')
          if (storageModalRaw === 'true' || storageModalRaw === '1') {
            runtime.saves.state = PANEL_VISIBILITY.PINNED
          }
          if (storageModalRaw === 'false' || storageModalRaw === '0') {
            runtime.saves.state = PANEL_VISIBILITY.HIDDEN
          }

          if (runtime.palette.state !== PANEL_VISIBILITY.HIDDEN) {
            runtime.layer.state = PANEL_VISIBILITY.HIDDEN
          }

          hostActive = createHostActiveDefaults(runtime)
        }

        this.panelRuntime = runtime
        this.hostActivePanels = hostActive

        const pinned = localStorage.getItem('studio.ui.pinnedPanel')
        this.pinnedPanel = pinned || null

        this.taskStage = 'assemble'
        this._syncLegacyPanelStateFromRuntime()
      } catch (e) {
        // ignore malformed persisted ui state
      }
    },

    persistUiLayout() {
      try {
        localStorage.setItem('studio.ui.workspaceMode', this.workspaceMode)
        localStorage.setItem('studio.ui.panelRuntime', JSON.stringify(this.panelRuntime))
        localStorage.setItem('studio.ui.hostActivePanels', JSON.stringify(this.hostActivePanels))
        localStorage.setItem('studio.ui.panelStates', JSON.stringify(this.panelStates))
        localStorage.setItem('studio.ui.pinnedPanel', this.pinnedPanel || '')
        localStorage.setItem('studio.ui.historyTrayExpanded', this.historyTrayExpanded ? '1' : '0')
        localStorage.setItem('studio.ui.storageModalVisible', this.storageModalVisible ? '1' : '0')
      } catch (e) {
        // ignore storage write failures
      }
    },

    toggleHistoryPanel(visible) {
      if (typeof visible === 'boolean') {
        this.historyPanelVisible = visible
      } else {
        this.historyPanelVisible = !this.historyPanelVisible
      }
      this.panelStates.history = this.historyPanelVisible ? 'pinned' : 'hidden'
      this.persistUiLayout()
    }
  }
})

export default useStudioPanelStore
