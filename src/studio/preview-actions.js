/**
 * Preview Actions Module
 * Pure functions for preview tool operations
 * These functions handle preview tool state and operations
 */
import { PREVIEW_TOOL_VIEW, PREVIEW_TOOL_MOVE } from './constants.js'

/**
 * Set the preview tool mode
 * @param {string} tool - 'view' or 'move'
 * @returns {Object} Updated state
 */
export function setPreviewTool(tool) {
  if (tool === PREVIEW_TOOL_VIEW || tool === PREVIEW_TOOL_MOVE) {
    return { previewTool: tool }
  }
  return { previewTool: PREVIEW_TOOL_VIEW }
}

/**
 * Toggle between view and move modes
 * @param {Object} state - Current store state
 * @returns {Object} Updated state
 */
export function togglePreviewTool(state) {
  if (state.previewTool === PREVIEW_TOOL_VIEW) {
    // Only switch to move if available
    if (canUseMoveTool(state)) {
      return { previewTool: PREVIEW_TOOL_MOVE }
    }
  } else {
    return { previewTool: PREVIEW_TOOL_VIEW }
  }
  return { previewTool: state.previewTool }
}

/**
 * Check if move tool can be used (requires focused part)
 * @param {Object} state - Current store state
 * @returns {boolean} True if move tool can be used
 */
export function canUseMoveTool(state) {
  const idx = state.focusedPartIndex
  if (idx.stackIndex === null || idx.partIndex === null) return false
  if (idx.stackIndex < 0 || idx.stackIndex >= state.stacks.length) return false

  const stack = state.stacks[idx.stackIndex]
  if (!stack || !Array.isArray(stack.data)) return false
  if (idx.partIndex < 0 || idx.partIndex >= stack.data.length) return false

  return true
}

/**
 * Toggle renderer mode between optimized and legacy
 * @param {boolean} useOptimized - True to use optimized renderer
 * @returns {Object} Updated state
 */
export function toggleRendererMode(useOptimized = true) {
  return { useOptimizedRenderer: !!useOptimized }
}
