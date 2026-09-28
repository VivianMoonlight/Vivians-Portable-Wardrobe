import { projectWardrobeCloudIndex } from '../services/wardrobe-index.js'

export const CLOUDFLARE_WARDROBE_LIMIT_BYTES = 8_000_000

export function estimateCloudflareWardrobeBytes(index) {
  return new TextEncoder().encode(JSON.stringify(projectWardrobeCloudIndex(index))).byteLength
}
