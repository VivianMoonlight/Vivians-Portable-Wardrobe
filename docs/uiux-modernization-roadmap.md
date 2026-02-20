# UI/UX Modernization Roadmap (Based on Components Analysis)

## Input Baseline
This roadmap is derived from:
- `docs/components-architecture-analysis.md`
- Current implementation in `src/components` (33 Vue SFCs)

## Goals
1. **Unify interaction model** between FileManager and Studio (window shell, toolbar behavior, panel semantics).
2. **Increase design consistency** through tokenized, reusable primitives (`ui/*`) instead of per-panel bespoke CSS.
3. **Reduce cognitive load** in high-density editor flows (Part/Layer/Asset/Palette workflows).
4. **Improve maintainability** by reducing duplicated view logic and tightening component boundaries.

## Non-Goals
- No broad feature expansion during modernization.
- No redesign of domain logic in stores unless needed for UI decomposition.
- No visual “theme overhaul”; focus on consistency/usability first.

## UX Problem Statements
1. Window/container behaviors are duplicated across large shells, causing inconsistent drag/resize ergonomics.
2. Studio editing panels expose many controls simultaneously; user attention and mode state are easy to lose.
3. Repeated button/input/list/card patterns vary subtly between panels, increasing interaction ambiguity.
4. Layer/part replacement and batch edit pathways are powerful but feel fragmented across separate surfaces.

## Target UX Principles
- **One shell behavior model**: same resize/drag/header action semantics across major windows.
- **Progressive disclosure**: show essential controls first; advanced controls reveal contextually.
- **Mode visibility**: replace mode, multi-select mode, visual move mode must always be explicit.
- **Action consistency**: same button hierarchy, icon placement, confirmation semantics across panels.
- **Fast feedback**: edits should immediately reflect in preview/history/status without ambiguity.

## Migration Plan

### P0 (Stabilize + Foundation) — Highest Priority

#### P0.1 Build shared window shell primitive
- Create/adapt a common shell component for drag/resize/header slots used by:
  - `FileManagerPanel.vue`
  - `Studio/Studio.vue`
- Extract common behaviors:
  - pointer drag lifecycle
  - resize handles
  - window bounds/min-size constraints
  - close/minimize action slot contract

**Acceptance**
- Both major windows use the same shell behavior contract.
- No regression in existing drag/resize interactions on desktop/mobile.

#### P0.2 Standardize panel skeleton primitives
- Introduce reusable panel sections (header/body/footer/action row), built on `BasePanel` / `BaseCard`.
- Apply first to high-traffic panels:
  - `Studio/PartListPanel.vue`
  - `Studio/PartInspectorPanel.vue`
  - `Studio/AssetSelectorPanel.vue`
  - `Studio/PalettePanel.vue`

**Acceptance**
- Unified spacing, header action alignment, and empty-state styling in those panels.
- Reduced panel-specific structural CSS duplication.

#### P0.3 Fix known UI-quality defects
- Remove `FileThumbnail.vue` script typo (`let src = null; s`).
- Consolidate duplicated media-query block in `App.vue` floating button styles.
- Normalize mixed fallback color usage where token exists.

**Acceptance**
- No syntax artifacts in thumbnail renderer.
- Same launcher behavior with cleaner stylesheet structure.

---

### P1 (Flow Simplification + Consistency) — Medium Priority

#### P1.1 Unify action semantics
- Define button hierarchy conventions and apply across core workflows:
  - Primary: apply/confirm/save
  - Secondary: refresh/toggle/view switch
  - Danger: delete/clear
- Replace bespoke button implementations with `BaseButton` where practical.

**Acceptance**
- Similar actions look and behave consistently across FileManager + Studio.

#### P1.2 Clarify editing modes and status surfaces
- Persistent mode chips in Studio header/body for:
  - replace mode
  - multi-select mode
  - visual move mode
- Ensure mode entry/exit controls are colocated and obvious.

**Acceptance**
- User can always identify current editing mode without inspecting multiple panels.

#### P1.3 Reduce inspector overload through progressive sections
- In `PartInspectorPanel.vue`, split content into collapsible sections:
  - core properties
  - layer edits
  - advanced property/craft blocks
- Default to core + selected layer actions; advanced collapsed by default.

**Acceptance**
- Fewer above-the-fold controls while preserving full capability.

#### P1.4 Harmonize list interactions
- Align row interactions for `StackList`, `PartListPanel`, `LayerManagerWidget`:
  - selection feedback
  - rename affordance
  - arm-confirm delete pattern
  - drag handle location

**Acceptance**
- Lists share a predictable interaction grammar.

---

### P2 (Advanced UX + Performance Polish) — Lower Priority

#### P2.1 Compose “replace workflow” as a guided sequence
- Tighten loop between `PartListPanel` -> `AssetSelectorPanel` -> `PreviewWidget` with clearer step indicators.
- Optional contextual tips when entering replace mode for first-time users.

#### P2.2 Consolidate secondary/debug panels
- Re-evaluate role of `StackDetailPanel` and `StackJsonPanel`:
  - keep as advanced tools
  - reduce visual prominence in default layout

#### P2.3 Preview/performance feedback improvements
- Expose render status hints in preview/asset render surfaces.
- Standardize loading/error overlays and retry affordances.

## Suggested Execution Order (Component-Level)
1. Shell abstraction (`FileManagerPanel.vue`, `Studio/Studio.vue`)
2. Panel skeleton rollout (`PartListPanel.vue`, `PartInspectorPanel.vue`, `AssetSelectorPanel.vue`, `PalettePanel.vue`)
3. Action-system normalization (`BaseButton` adoption in key panels)
4. Mode/status UX refinement (`Studio.vue`, `PartInspectorPanel.vue`, `BatchEditPanel.vue`, `AssetSelectorPanel.vue`)
5. Advanced cleanup (`StackDetailPanel.vue`, `StackJsonPanel.vue`, auxiliary panels)

## Risks & Mitigations
- **Risk**: Refactoring shell behavior causes pointer-regression.
  - **Mitigation**: isolate shell logic first; migrate one window at a time with manual interaction checklist.
- **Risk**: Primitive adoption changes local panel layout unexpectedly.
  - **Mitigation**: migrate by panel skeleton first, then controls, avoiding full visual rewrite in one pass.
- **Risk**: Store-driven complex modes desync with UI indicators.
  - **Mitigation**: source all mode chips from store computed flags only; no local duplicated mode state.

## Validation Checklist
- Consistent spacing, typography, border radius, and action alignment across core panels.
- All critical flows still work:
  - file browse/apply
  - send to Studio
  - stack/part/layer editing
  - replace + preview refresh
  - save/load/history operations
- No new build errors; existing unrelated warnings remain tracked separately.

## Deliverables for Next Implementation Sprint
1. Shared shell component and integration in both main windows.
2. Panel skeleton utility components/composables.
3. P0 defect fixes + first-wave primitive adoption.
4. Updated docs:
   - progress in `docs/css-modernization-plan.md`
   - implementation notes in a new migration log section.
