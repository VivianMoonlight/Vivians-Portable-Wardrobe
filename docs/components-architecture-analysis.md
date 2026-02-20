# Components Architecture Analysis (src/components)

## Scope
- Target: `src/components` (including `Studio`, `Dialog`, `ui`)
- Total Vue SFCs analyzed: **33**
- Stack context: Vue 3 + Pinia + vue-i18n + Vite + userscript host integration

## High-Level UI Architecture

### L0 Entry / Mount
- `src/main.js`: bootstraps app into host page (`#vue-tampermonkey-root`), registers game hooks, sets i18n global bridges.
- `src/App.vue`: floating launcher button + top-level orchestration of `FileManagerPanel` visibility.

### L1 Shell / Feature Containers
- `FileManagerPanel.vue`: primary shell window (drag/resize/layout/theme switching), routes to FileManager and Studio workflows.
- `Studio/Studio.vue`: Studio shell window (toolbar, panel composition, mobile tabs, save/restore, history/layer/palette toggles).

### L2 Feature Panels (Business UI)
- File workflows: `FileManager.vue`, `FileItem.vue`, `FilterManager.vue`, `HistoryViewer.vue`, `SidePreview.vue`, `FileThumbnail.vue`
- Outfit workflows: `OutfitEntryButton.vue`, `OutfitPanel.vue`
- Status/runtime: `ThemedStatusWidget.vue`
- Studio workflows: Stack/Part/Asset/Palette/Layer/History/Saves subpanels

### L3 Reusable UI Primitives
- `ui/BaseButton.vue`, `ui/BaseInput.vue`, `ui/BasePanel.vue`, `ui/BaseCard.vue`
- Export barrel: `ui/index.js`

### Cross-Cutting Utility Modal
- `Dialog/DialogModal.vue` through `DialogService` usage

## State & Data Flow

### Main Stores
- `useFileSystemStore`: file tree, history, character-facing operations, thumbnail pipeline integration.
- `useStudioStore`: stack editing, focused part/layer, palette state, replace mode, history/undo-redo, session save/load.

### Typical Interaction Paths
1. Launcher (`App.vue`) -> open `FileManagerPanel.vue`
2. File select/apply (`FileManager` + `FileItem`) -> update file-system state / character target
3. Send to Studio / open Studio -> `Studio.vue`
4. Studio editing loop:
   - stack pick (`StackList`) -> part pick (`PartListPanel`) -> inspect/edit (`PartInspectorPanel` + `ColorableLayer`)
   - asset replace (`AssetSelectorPanel`) + preview (`PreviewWidget`)
   - auxiliary control (`PalettePanel`, `LayerManagerWidget`, `HistoryPanel`, `SavesManager`)

## Component Inventory (All 33 Vue files)

## Root components (`src/components`)

| Component | Core responsibility | Primary dependencies | Notes |
|---|---|---|---|
| `FileManagerPanel.vue` | Main floating app window; layout, drag/resize, feature composition | `useTheme`, `useFileSystemStore`, child panels | Core shell of non-Studio workflows |
| `FileManager.vue` | File browser tree/grid, search/filter entry, navigation | `useFileSystemStore`, `FileItem`, `FileThumbnail` | Central file workflow panel |
| `FileItem.vue` | Single item row/card interactions (rename/delete/context/apply/send) | `useFileSystemStore`, emits to parent | Action-heavy leaf component |
| `FileThumbnail.vue` | Canvas thumbnail rendering and DPR-aware sizing | `useFileSystemStore`, renderer canvas | Contains suspicious typo `let src = null; s` in script |
| `FilterManager.vue` | Filter grouping and toggle management | file-system state / filter config | Controls filtering dimensions |
| `HistoryViewer.vue` | History list with context/apply/delete controls | `useFileSystemStore`, dialog/menu flows | File-level history, separate from Studio history |
| `SidePreview.vue` | Side preview canvas + resize observation | renderer + store state | Visual quick preview panel |
| `HelloWorld.vue` | Legacy/demo style component | minimal | Likely non-core runtime usage |
| `MyWindow.vue` | Generic window shell slot container | generic props/emits | Lightweight utility shell |
| `OutfitEntryButton.vue` | Entry floating button + teleport overlay for outfit panel | `OutfitPanel` | Alternate access path |
| `OutfitPanel.vue` | Outfit import/export/save wrapper panel | stores/services | Workflow shell |
| `ThemedStatusWidget.vue` | Runtime status + theme sync/indicator | themed adapter/runtime state | Useful diagnostics/status control |

## Dialog (`src/components/Dialog`)

| Component | Core responsibility | Primary dependencies | Notes |
|---|---|---|---|
| `DialogModal.vue` | Global alert/confirm/prompt modal via teleport | Dialog state + host i18n fallback | Shared blocking interaction primitive |

## Studio (`src/components/Studio`)

| Component | Core responsibility | Primary dependencies | Notes |
|---|---|---|---|
| `Studio.vue` | Studio root shell + toolbar + subpanel composition | `useStudioStore`, multiple Studio children | Highest complexity in project |
| `PreviewWidget.vue` | Main rendered preview with pan/zoom/move tool | `RenderApi`, `useStudioStore` | Central feedback loop for edits |
| `StackList.vue` | Stack CRUD/copy/rename/reorder list | `useStudioStore` | Entry point for selected element |
| `PartListPanel.vue` | Grouped part list, visibility/delete/replace entry | `useStudioStore`, `filterGroupConfig`, `AssetApi` | Dense operations and selection logic |
| `PartInspectorPanel.vue` | Focused part inspector, typed/modular edits, layer editor host | `useStudioStore`, `AssetApi`, `ColorableLayer`, `BatchEditPanel` | Inspector hub |
| `ColorableLayer.vue` | Per-layer color/opacity/offset/priority editing + selection hooks | `useStudioStore` | High-frequency editing control |
| `BatchEditPanel.vue` | Multi-layer batch operations (opacity/offset/priority/color) | `useStudioStore` | Multi-select productivity panel |
| `AssetSelectorPanel.vue` | Replace-mode asset search/list/card selection + thumb rendering | `useStudioStore`, `useFileSystemStore`, `AssetApi`, `PaletteService` | Candidate browsing and apply |
| `AssetRenderPanel.vue` | Focused asset render/poll visualization panel | `useStudioStore`, `useFileSystemStore` | Diagnostic/preview render helper |
| `PalettePanel.vue` | Color picker, saved colors, palette tag CRUD/editing | `@ckpack/vue-color`, `useStudioStore` | Color system control center |
| `LayerManagerWidget.vue` | Layer ordering/grouping and drag-drop priority arrangement | `useStudioStore` | Alternative structural editing view |
| `PriorityArrangementPanel.vue` | Priority-grouped drag-drop arrangement for parts/layers | `useStudioStore` | Focused priority control surface |
| `HistoryPanel.vue` | Studio undo/redo timeline and jump navigation | `useStudioStore`, `DialogService` | Studio-specific history UI |
| `SavesManager.vue` | Session save/load/rename/delete management | `StudioStorageService`, `DialogService`, `useStudioStore` | Persistence management panel |
| `StackDetailPanel.vue` | Read-focused stack/part detail summary + copy/download | `useStudioStore` | Inspection/export helper |
| `StackJsonPanel.vue` | Raw JSON view/copy/download for selected stack data | `useStudioStore` | Low-level debugging/introspection |

## UI primitives (`src/components/ui`)

| Component | Core responsibility | Primary dependencies | Notes |
|---|---|---|---|
| `BaseButton.vue` | Variant/size button primitive | theme tokens | Present but adoption is still partial |
| `BaseInput.vue` | Input primitive with size/error states | theme tokens | Good candidate for form normalization |
| `BasePanel.vue` | Panel shell primitive (`default`/`glassmorphism`) | theme tokens | Useful to reduce repeated panel CSS |
| `BaseCard.vue` | Card primitive with optional interactive state | theme tokens | Newly added in migration |

## Observed Architectural Characteristics

### Strengths
- Clear functional separation between file manager domain and Studio domain.
- Strong store-centric state model (`fileSystemStore` / `studioStore`).
- Rich editing capability already present (layer, palette, history, saves).
- Teleport-based overlays/modals are consistently used for top-layer UX.

### Current Frictions
- **Shell duplication**: both `FileManagerPanel.vue` and `Studio.vue` implement large, custom window chrome/drag/resize logic.
- **Panel CSS duplication**: repeated header/body/card structures across many Studio panels.
- **Primitive adoption gap**: many feature components still use bespoke `<button>/<input>/<panel>` markup instead of `ui/*` primitives.
- **Mixed language / mixed naming** in text comments and labels increases maintenance cost.
- **Potential bug**: `FileThumbnail.vue` has stray character sequence (`let src = null; s`).
- **Legacy/low-value surfaces** (`HelloWorld.vue`, some debug-style panels) may clutter the production interaction model.

## Coupling & Complexity Hotspots
- `Studio.vue`: highest orchestration complexity (window behavior + toolbar + multi-panel state + mobile adaptation).
- `PartListPanel.vue` and `PartInspectorPanel.vue`: dense event/state logic and high edit cardinality.
- `ColorableLayer.vue`: deep editing behavior and local/store synchronization complexity.
- `AssetSelectorPanel.vue`: rendering + search + apply + dual view modes in one component.

## Suggested Component Taxonomy for Future Migration
1. **Shell Layer**: draggable/resizable window containers and header toolbars.
2. **Feature Layer**: business panels (file/studio workflows).
3. **Interaction Layer**: list-row, action cluster, empty-state, toolbar group blocks.
4. **Primitive Layer**: `Base*` components + design tokens.

This taxonomy can be used as the baseline for a UI/UX modernization roadmap.
