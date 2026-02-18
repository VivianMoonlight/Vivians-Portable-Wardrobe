/**
 * Canvas utilities for rendering services
 * Provides common canvas creation and context helpers
 */
import { doc } from '@/utils/host-window.js'

/**
 * Create a canvas with specified dimensions
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @returns {HTMLCanvasElement} Canvas element
 */
export function createCanvas(width, height) {
  const canvas = doc.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/**
 * Get 2D context with graceful fallback
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {Object} options - Context options
 * @returns {CanvasRenderingContext2D|null} Context or null
 */
export function get2DContext(canvas, options = {}) {
  if (!canvas) return null
  try {
    return canvas.getContext('2d', options)
  } catch (e) {
    try {
      return canvas.getContext('2d')
    } catch (e2) {
      return null
    }
  }
}

/**
 * Calculate hash of canvas image data for comparison
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {string} Simple hash string
 */
export function hashImageData(ctx, width, height) {
  try {
    const imageData = ctx.getImageData(0, 0, width, height)
    const data = imageData.data
    let hash = 0
    // Sample every 4th pixel for performance
    for (let i = 0; i < data.length; i += 16) {
      hash = ((hash << 5) - hash) + data[i]
      hash = hash & hash
    }
    return hash.toString(36)
  } catch (e) {
    return ''
  }
}
