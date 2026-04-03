# Panel System Guide

This guide explains how Studio panel management works after the registry/orchestrator refactor.

## Core Concepts

- Registry: `src/studio/panel-system.js`
- Runtime state: `studioStore.panelRuntime`
- Host routing: `studioStore.hostActivePanels`
- Legacy compatibility fields (kept for old code paths):
  - `panelStates`
  - `activeContextPanel`
  - `historyTrayExpanded`
  - `storageModalVisible`

## Hosts

- `context`: inspector/asset style side context panel
- `toolDock`: toolbar-driven tools (layer/palette)
- `bottomTray`: expandable bottom tray (history)
- `modal`: blocking modal panels (saves)

## Add a New Panel

1. Register metadata in `PANEL_REGISTRY`:
   - `id`
   - `preferredHost`
   - `allowedHosts`
   - `exclusiveGroup`
   - `defaultState`
2. Add the visual component in `Studio.vue` under the host container.
3. Open/close it through orchestrator APIs:
   - `store.openPanel(id, options)`
   - `store.closePanel(id, options)`
   - `store.togglePanel(id, options)`
4. Use host-aware selectors in UI:
   - `store.isPanelVisible(id)`
   - `store.getActivePanelForHost(host)`

No store schema change is required after registration unless the panel needs special business behavior.

## Orchestrator APIs

- `openPanel(panelId, { host, state, reason })`
- `closePanel(panelId, { reason })`
- `togglePanel(panelId, { host, state, reason })`

Rules handled automatically:

- Exclusive groups close siblings.
- One active panel is tracked per host.
- Runtime fields are synchronized to legacy fields.
- Layout is persisted and restored.

## Persistence

Current persistence keys:

- `studio.ui.panelRuntime`
- `studio.ui.hostActivePanels`
- Legacy compatibility keys remain written.

## Backward Compatibility

Legacy methods remain available and route to orchestrator:

- `openContextPanel`
- `setPanelState`
- `pinPanel`
- `unpinPanel`
- `setHistoryTrayExpanded`
- `setStorageModalVisible`
- `openPalettePanel`
- `closePalettePanel`

This allows progressive migration for components that still use old APIs.
