// Shared extension-settings budget. The server's Socket.IO packet limit is also
// 180000 decimal bytes, so a VPW update must fit both the shared budget and packet.
export const EXTENSION_QUOTA_BYTES = 180000

const WARDROBE_KEY = 'VPWardrobe'

function jsonBytes(value) {
  const serialized = JSON.stringify(value)
  if (typeof serialized !== 'string') throw new TypeError('Extension settings cannot be serialized')
  return new TextEncoder().encode(serialized).byteLength
}

/**
 * Measure the proposed VPW value alongside every other extension's settings.
 * Throws if the proposal cannot be serialized; callers must retain the local
 * snapshot and stop the upload rather than interpreting a failed estimate as 0.
 */
export function measureExtensionQuota(extensionSettings, encodedVpwPayload, {
  limitBytes = EXTENSION_QUOTA_BYTES,
  warnRatio = 0.8,
} = {}) {
  if (typeof encodedVpwPayload !== 'string') {
    throw new TypeError('The wardrobe payload must be an encoded string')
  }
  if (extensionSettings != null && (typeof extensionSettings !== 'object' || Array.isArray(extensionSettings))) {
    throw new TypeError('Extension settings must be an object')
  }
  if (!Number.isFinite(limitBytes) || limitBytes <= 0 || !Number.isFinite(warnRatio) || warnRatio < 0 || warnRatio > 1) {
    throw new RangeError('Invalid extension storage budget')
  }

  const others = { ...extensionSettings }
  delete others[WARDROBE_KEY]
  const proposed = { ...others, [WARDROBE_KEY]: encodedVpwPayload }
  const otherExtensionsBytes = jsonBytes(others)
  const totalBytes = jsonBytes(proposed)
  // This delta includes the VPW key, JSON quoting, and its separator. The other
  // count owns the outer braces, so the two contributions sum to the total.
  const wardrobeBytes = totalBytes - otherExtensionsBytes
  const packet = ['AccountUpdate', { [`ExtensionSettings.${WARDROBE_KEY}`]: encodedVpwPayload }]
  const packetBytes = jsonBytes(packet) + 2 // Socket.IO event + Engine.IO message prefixes: 42
  const usageRatio = totalBytes / limitBytes
  const isOverLimit = totalBytes > limitBytes || packetBytes > limitBytes

  return {
    limitBytes,
    warnRatio,
    wardrobeBytes,
    otherExtensionsBytes,
    totalBytes,
    packetBytes,
    remainingBytes: Math.max(0, limitBytes - totalBytes),
    usageRatio,
    isOverLimit,
    isWarning: !isOverLimit && usageRatio >= warnRatio,
  }
}
