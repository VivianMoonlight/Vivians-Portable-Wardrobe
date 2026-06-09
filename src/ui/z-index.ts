/**
 * Stacking order inside the Shadow DOM.
 *
 * The shadow host element sits at the page's max z-index, so these values only
 * compete with each other — not with the game page. Overlays (dialogs, menus,
 * context menus) must render ABOVE the free-floating panel window, otherwise the
 * panel (PANEL_Z_INDEX) covers them and they appear not to open.
 */
export const PANEL_Z_INDEX = 2147483000
export const OVERLAY_Z_INDEX = 2147483640
