# Copilot Instructions for Vivian's Portable Wardrobe

## Project Overview

**Vivian's Portable Wardrobe** (VPW) is a **Tampermonkey userscript** for the game Bondage Club that provides an advanced outfit/wardrobe management system with a preview mirror, file browser UI, and outfit editing studio. The project is a **hybrid Vue 3 + legacy JavaScript** codebase built with Vite and the `vite-plugin-monkey` plugin.

### Key Architecture Layers

1. **Userscript Injection Layer** (`src/main.js`, `src/utils/register.js`, `src/utils/host-window.js`)
   - Hooks into Bondage Club's `bcModSdk` to register the mod
   - Injects Vue app into the game's DOM
   - Bridges the game's window object (hostWindow) with the Vue app
   
2. **Vue 3 Frontend** (`src/App.vue`, `src/components/`, `src/composables/`)
   - Modern Vue 3 Composition API components
   - Pinia store-based state management
   - i18n support (en/zh) via `vue-i18n`
   - Responsive UI with FileManager, OutfitPanel, Studio, etc.

3. **Service Layer** (`src/services/`)
   - Pure functions for business logic (PaletteService, LayerTranslator, PriorityService)
   - Rendering pipeline (RenderService, OptimizedRenderService, RenderApi)
   - Storage abstraction (StorageAdapter, StudioStorageService)
   - Asset data translation (LayerTranslator, AssetIndexService)

4. **Store Management** (`src/stores/studioStore.js`, `src/stores/fileSystemStore.js`)
   - `studioStore`: Handles outfit editing, layer management, undo/redo
   - `fileSystemStore`: Manages outfit file hierarchy and caching

5. **Legacy PortableWardrobe** (`PortableWardrobe/`)
   - Pre-Vue system still referenced; being phased out for Vue components

### Critical Data Flow

```
Game State (Player.Appearance, AssetGroupMap)
    ↓
LayerTranslator (buildLayerEntriesForPart) → Normalize game layers to UI format
    ↓
studioStore (layers, stacks, paletteMap) → State with undo/redo support
    ↓
Vue Components (Studio panels) → User edits
    ↓
PriorityService / PaletteService → Apply logic changes
    ↓
RenderService → Draw preview canvas
    ↓
StorageAdapter → Save to local/online storage (compressed)
```

## Build & Development

### Build Process
- **Dev**: `npm run dev` → Vite dev server at `localhost:5173` with hot module replacement
- **Production**: `npm run build` → Creates minified userscript in `dist/`
- **Plugin**: `vite-plugin-monkey` handles userscript metadata generation and injection

### Userscript Hosts
The script only runs on Bondage Club domains (see `vite.config.js` hosts array):
- `bondageprojects.elementfx.com`
- `bondage-europe.com`
- `bondage-asia.com`

### Critical Imports to Understand
- `hostWindow`: Always use for game window access (bridges dev/prod environments)
- `doc`: hostWindow.document reference
- `setTimeoutHost`: hostWindow.setTimeout for timing in game context
- Avoid direct `window` or `document` references when interacting with game state

## Code Patterns & Conventions

### Performance Optimizations
- **Deep cloning**: Use `fastClone()` (structuredClone fallback to JSON) in stores for large objects
- **Layer caching**: LayerTranslator caches layer display names to avoid O(n²) lookups
- **Debouncing**: Auto-save uses `lodash.debounce` (2s default) to batch updates
- **Storage compression**: Uses `lz-string` to compress outfits before saving to Player.ExtensionSettings

### Pure Function Philosophy
Services (Palette, Priority, LayerTranslator) are pure:
- Accept current state as input, return new state
- No mutations; always return clones
- Enables undo/redo and predictable testing

**Example** (PaletteService):
```javascript
export function setPaletteColorForPart(paletteMap, partId, colorIndex, newColor, deps = {}) {
  const clone = deepClone(paletteMap)
  // mutate clone, return it
  return clone
}
```

### Store Pattern (studioStore)
- **Computed properties**: Reactive getters for derived data
- **State mutations**: Direct state modification + auto-save trigger
- **Undo/Redo**: UndoRedoManager tracks snapshots of stacks/paletteMap
- **Focus tracking**: `focusedProperty` / `selectedElement` for UI state
- Watch: Auto-save watches `stacks` and `paletteMap` changes

### Vue Composition API
- Use `<script setup>` in all `.vue` files
- Destructure composables: `const { initTheme, toggleTheme } = useTheme()`
- Custom composables in `src/composables/`: `useAutoSave`, `useTheme`, `useUndoRedo`, `useThemedIntegration`

### Internationalization (i18n)
- Locales in `locales/en.json` and `locales/zh.json`
- Loaded via `import.meta.glob` (eager) at build time
- Use `{{ $t('key') }}` in templates or `i18n.t('key')` in scripts
- Fallback to en if locale not supported

## Key Files & Their Responsibilities

| File | Purpose |
|------|---------|
| [src/main.js](src/main.js) | Userscript entry; waits for game ready, mounts Vue app |
| [src/utils/host-window.js](src/utils/host-window.js) | Game window bridge (dev/prod agnostic) |
| [src/utils/register.js](src/utils/register.js) | bcModSdk integration & hook registration |
| [src/stores/studioStore.js](src/stores/studioStore.js) | Central state: layers, stacks, undo/redo (2768 LOC!) |
| [src/services/LayerTranslator.js](src/services/LayerTranslator.js) | Game asset ↔ UI layer format conversion |
| [src/services/RenderService.js](src/services/RenderService.js) | Canvas rendering pipeline |
| [src/services/PaletteService.js](src/services/PaletteService.js) | Pure color/palette state functions |
| [src/services/PriorityService.js](src/services/PriorityService.js) | Layer priority/stacking logic |
| [src/services/StorageAdapter.js](src/services/StorageAdapter.js) | Dual-storage (online/local) abstraction |
| [src/composables/useAutoSave.js](src/composables/useAutoSave.js) | Auto-save trigger on store changes |

## Common Tasks & Patterns

### Adding a New Studio Panel
1. Create `.vue` file in `src/components/Studio/`
2. Use `useStudioStore()` to access/mutate state
3. Emit changes via store mutations (not props callbacks)
4. Register in parent layout component

### Modifying Outfit Data
1. Changes flow through **studioStore mutations**
2. Mutations trigger **UndoRedoManager snapshots**
3. Auto-save debounce kicks in (~2s) → StorageAdapter
4. Use pure service functions (PaletteService, PriorityService) for logic

### Debugging Storage
- Online storage: `Player.ExtensionSettings.VPWardrobe` (server-synced)
- Local storage: `localStorage.getItem('VPWardrobe' + Player.MemberNumber)`
- Use browser DevTools Console: `JSON.parse(LZString.decompressFromBase64(...))`

### Rendering Preview
- Call `store.requestRender()` to queue a canvas draw
- RenderService batches renders and calls `drawPreview()` callback
- Layer visibility controlled by `overridePriority` in part data

### Working with Game Assets
- Game provides `AssetGroupMap` (loaded on game init)
- LayerTranslator converts BC's asset format → UI layer entries
- Always use LayerTranslator for game ↔ UI conversions; never assume BC format

## Performance & Constraints

- **Large state**: studioStore manages hundreds of outfit parts; use fastClone, not JSON.stringify
- **Rendering**: Throttled via OptimizedRenderService to avoid canvas redraws per keystroke
- **Storage limits**: Player.ExtensionSettings has size limits; compression is essential
- **Game thread**: Tampermonkey runs on game's thread; avoid blocking operations

## Testing & Debugging

- **Disable auto-save**: Set `store.autoSaveEnabled = false` in console to test without persisting
- **Inspect store state**: DevTools > Pinia tab shows all store mutations
- **Clear storage**: `localStorage.clear()` or delete Player.ExtensionSettings.VPWardrobe
- **Reload mod**: User bookmarklet includes cache-bust (`Date.now()` param)

## Integration Points

- **BC ModSDK**: Hooks `DrawCharacter` to intercept outfit rendering
- **Game assets**: Reads `AssetGroupMap`, `ItemColorLoad`, `Character.Appearance`
- **Server sync**: Uses `ServerPlayerExtensionSettingsSync()` to persist online
- **Dressroom plugin**: Special support via themed integration composable
