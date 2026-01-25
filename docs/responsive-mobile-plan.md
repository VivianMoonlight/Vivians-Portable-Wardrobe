# Responsive & Mobile Plan (Option A)

Goal: Fully interactive, touch-friendly experience across phone, tablet, and desktop while preserving desktop resizable workflows.

## Progress (2026-01-25)
### Step 1: Shared Foundation ✓
- Added safe-area + fluid spacing/typography tokens and dvh helpers in src/styles/theme.css.
- Introduced responsive utilities (fluid padding/gap, safe-area padding, sticky helpers, dvh max-height, mobile/desktop visibility) in src/styles/responsive.css and wired globally.

### Step 2: Panel & Launcher (FileManagerPanel) ✓
- Refactored FileManagerPanel to mobile-first layout with pointer-based drag/resize, touch-friendly handles (16px), mobile toggles for preview/filters, and clamp-based sizing that respects safe area/dvh.
- Desktop row layout at ≥900px breakpoint; mobile column stack by default.

### Step 3: Supporting Panes ✓
- FileManager: Applied fluid padding, mobile-first 160px grid (expands to 200px+ on larger screens), dvh-based max-height, touch-optimized spacing.
- FilterManager: Fluid padding and gaps, touch-friendly 36px min button heights, dvh scrollable area with momentum scrolling.
- SidePreview: Removed fixed widths, applied fluid padding, clamp-based min/max heights using dvh and vh units for responsive canvas sizing.

### Step 4: Dialogs/Modals ✓
- OutfitPanel: Clamp-based width (320px-620px), safe-area aware max-width/height, fluid padding, 36px touch-friendly buttons, dvh-based scrollable body.
- MyWindow: Responsive clamp width (300px-520px), safe-area offsets, fluid padding, 40px touch-target close button.
- DialogModal: Safe-area padding on overlay, clamp width (280px-500px), dvh max-height, 44px touch-friendly inputs/buttons, fluid spacing.
- ThemedStatusWidget: Mobile-adaptive positioning (top-right desktop, bottom-center mobile <640px), safe-area offsets, clamp width (280px-340px), 36px+ touch buttons, dvh scrollable content.

### Step 5: Studio Workspace ✓
- Mobile-first sizing: default size reduced to 98vw×94vh on mobile vs 92vw×88vh desktop, respects safe-area margins (8px mobile, 12px desktop).
- Pointer-based drag/resize: switched all mousedown/mousemove/mouseup to pointerdown/pointermove/pointerup with setPointerCapture for touch support; enlarged handles to 16-18px for touch targets.
- Breakpoint-based layout collapse: mobile tab switcher (<900px) for Preview/Stacks/Parts/Inspector/Assets tabs; desktop row layout (≥900px) with fixed column widths.
- Responsive panel sections: mobile columns stack vertically (width 100%, flex 1), desktop maintains fixed widths (450px preview, 240px stack, fluid parts, 360px inspector/assets).
- dvh max-height applied to window and all scrollable areas for safe-area/keyboard awareness; window resize listener updates mobile state and clamps sizing.

## Principles
- Mobile-first: fluid widths/heights with clamp() and percent-based sizing; avoid fixed px defaults.
- Touch friendly: pointer events (mouse, touch, pen), 44px min hit targets, inertia-free dragging.
- Safe area aware: use env(safe-area-*) for launchers/overlays; prefer dvh over 100vh.
- Progressive layout: stack -> split -> multi-column via breakpoints (sm 640, md 768, lg 1024, xl 1280).
- Performance: keep canvas scaling DPR-aware; minimize forced reflows during drag/resize.

## Shared Foundation
- Extend src/styles/theme.css with mobile-aware spacing/typography ramps tied to breakpoints.
- Add src/styles/responsive.css utilities: fluid padding, hide/show per breakpoint, sticky sections, max-height via dvh.
- Normalize scroll + overscroll on mobile; enable momentum scrolling where appropriate.

## Panel & Launcher
- FileManagerPanel: mobile-first column stack; collapsible/accordion side preview and filters; sticky top actions; clamp sizes with min() and viewport-safe padding.
- Replace mouse drag/resize with pointer events; larger handles; allow double-tap to toggle full height on phones.
- Launcher: choose entry model (FAB vs bottom sheet). Align with safe areas; avoid overlapping system gestures.

## Supporting Panes
- FileManager/FilterManager/SidePreview: drop rigid min-widths; allow wrap; responsive gaps; canvas heights via clamp and dvh; mobile toolbars for key actions.
- HistoryViewer: mobile-friendly card list, sticky filters/toolbar, long-press for context instead of right-click.
- ThemedStatusWidget: avoid fixed top-right on phones; use bottom sheet or inline banner.

## Dialogs/Modals
- OutfitPanel/MyWindow/DialogModal: percent-based max-width, adaptive padding, safe-area offsets; touch-sized buttons; avoid fixed centering that breaks on small screens.

## Studio Workspace
- Default size reduced; pointer-based drag/resize; breakpoint collapse of side columns into tabs/accordions on tablet/phone; ensure canvases remeasure on resize/orientation.

## Legacy Widget
- PortableWardrobe/ui/main_ui_view.js: align to responsive patterns or gate to desktop-only to prevent mobile conflicts.

## Open Decision
- Launcher on mobile: A1) floating FAB; A2) bottom bar entrypoint. Pick one and cascade through layouts.
