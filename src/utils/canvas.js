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
