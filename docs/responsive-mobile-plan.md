# Responsive & Mobile Plan (Option A)

Goal: Fully interactive, touch-friendly experience across phone, tablet, and desktop while preserving desktop resizable workflows.

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
