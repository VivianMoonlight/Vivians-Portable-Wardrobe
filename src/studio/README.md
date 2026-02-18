# Studio Store Architecture

## Overview

The `studioStore.js` is the main state management for the Studio editing interface. It manages stacks, palettes, rendering, and user interactions.

## Store State

### Core State Properties

| Property | Type | Description |
|----------|------|-------------|
| `stacks` | Array | Array of stack elements with outfit data |
| `selectedIndex` | Number | Currently selected stack index (-1 = none) |
| `mergedAppearanceData` | Object | Preview data for merged appearance |
| `focusedPartIndex` | Object | { stackIndex, partIndex } for focused part |
| `focusedProperty` | Object | Currently focused property within a part |
| `replaceTarget` | Object | Replace mode target: { active, key, item, isEmpty } |
| `paletteMap` | Object | Tag -> color mapping |
| `savedColors` | Array | Saved color values |
| `assetIndex` | Object | Asset group name -> assets mapping |
| `assetGroupsRaw` | Array | Raw asset group data |

### UI State

| Property | Type | Description |
|----------|------|-------------|
| `layerManagerActive` | Boolean | Layer manager panel visibility |
| `palettePanelVisible` | Boolean | Palette panel visibility |
| `historyPanelVisible` | Boolean | History panel visibility |
| `paletteModeActive` | Boolean | Palette editing mode active |
| `activePaletteTargets` | Array | Parts being edited in palette mode |
| `previewTool` | String | 'view' or 'move' tool mode |
| `selectionMode` | String | 'single' or 'multiple' selection |
| `selectedLayers` | Array | Multi-selected layer info |

### Renderers

| Property | Type | Description |
|----------|------|-------------|
| `renderer` | RenderService | Legacy renderer for thumbnails |
| `previewRenderer` | OptimizedRenderService | Optimized renderer for main preview |
| `useOptimizedRenderer` | Boolean | Toggle between renderers |

### Auto-save State

| Property | Type | Description |
|----------|------|-------------|
| `autoSaveEnabled` | Boolean | Auto-save enabled |
| `lastSaveTime` | Number | Timestamp of last save |
| `saveStatus` | String | 'idle' | 'saving' | 'saved' | 'error' |
| `currentSaveId` | String | ID of currently loaded save |

## Key Getters

| Getter | Returns | Description |
|--------|----------|-------------|
| `selectedElement` | Object/null | Currently selected stack element |
| `focusedPart` | Object/null | Currently focused part |
| `getAssetsByGroup(groupName)` | Array | Assets for a group |
| `paletteSnapshot` | Object | Current palette snapshot |
| `canUseMoveTool` | Boolean | Whether move tool can be used |

## Key Action Groups

### Stack Operations
- `addElement(element)` - Add new element to stacks
- `removeElement(idx)` - Remove element at index
- `moveElement(fromIdx, toIdx)` - Move element between positions
- `select(idx)` - Select element at index
- `clear()` - Clear all stacks

### Palette Operations
- `applyColorToActivePaletteTargets(color)` - Apply color to selected targets
- `applyTagToActivePaletteTargets(tag)` - Apply tag to selected targets
- `addSavedColor(value)` - Add color to saved colors
- `deletePaletteTag(tag)` - Delete a palette tag
- `clearPalette()` - Clear all palette data

### Focus Operations
- `focusPart(part)` - Focus on a part
- `clearFocus()` - Clear current focus
- `setFocusedProperty(payload)` - Set focused property
- `setReplaceTarget(item, key, isEmpty)` - Set replace target

### Rendering Operations
- `refreshMergedAppearanceData()` - Refresh merged appearance
- `getMergedAppearanceForExport()` - Get merged appearance for export
- `_scheduleRefresh()` - Schedule refresh with throttling

### Undo/Redo Operations
- `pushSnapshot()` - Push state to history
- `undo()` - Undo last action
- `redo()` - Redo last action
- `clearHistory()` - Clear all history

## External Dependencies

The store depends on several external services:

- **PaletteService** (`@/services/PaletteService`) - Palette operations
- **AssetIndexService** (`@/services/AssetIndexService`) - Asset indexing
- **LayerTranslator** (`@/services/LayerTranslator`) - Layer operations
- **PriorityService** (`@/services/PriorityService`) - Priority management
- **RenderService** (`@/services/RenderService`) - Legacy rendering
- **OptimizedRenderService** (`@/services/OptimizedRenderService`) - Optimized rendering

## Performance Considerations

1. **Throttled Refresh**: `_scheduleRefresh()` uses RefreshScheduler to batch refresh requests
2. **WeakMap Caching**: Layer entries cached using WeakMap for automatic cleanup
3. **Lazy Loading**: Asset data loaded on-demand
4. **Deep Watcher**: Some watchers use `deep: true` - consider optimization

## Notes for Refactoring

When refactoring this store:

1. **Preserve all side effects**: Many actions trigger refreshes, history snapshots, or UI updates
2. **Maintain index consistency**: `selectedIndex`, `focusedPartIndex`, and array indices must stay in sync
3. **Handle special cases**: Empty stacks, negative indices, folder items
4. **Test thoroughly**: Each action affects multiple state properties and may trigger cascading updates
5. **Consider incremental approach**: Extract one concern at a time and verify before moving to next
