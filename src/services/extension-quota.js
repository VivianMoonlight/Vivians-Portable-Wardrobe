// Shared extension-settings budget. The server's Socket.IO packet limit is also
// 180000 decimal bytes, so a VPW update must fit both the shared budget and packet.
export const EXTENSION_QUOTA_BYTES = 180000

const WARDROBE_KEY = 'VPWardrobe'
export const WARDROBE_MARKER_PREFIX = 'VPW4_M_'

function isWardrobeKey(key) {
  return key === WARDROBE_KEY || key.startsWith(WARDROBE_MARKER_PREFIX)
}

function jsonBytes(value) {
  const serialized = JSON.stringify(value)
  if (typeof serialized !== 'string') throw new TypeError('Extension settings cannot be serialized')
  return new TextEncoder().encode(serialized).byteLength
}

function validateSettings(extensionSettings, limitBytes, warnRatio) {
  if (extensionSettings != null && (typeof extensionSettings !== 'object' || Array.isArray(extensionSettings))) {
    throw new TypeError('Extension settings must be an object')
  }
  if (!Number.isFinite(limitBytes) || limitBytes <= 0 || !Number.isFinite(warnRatio) || warnRatio < 0 || warnRatio > 1) {
    throw new RangeError('Invalid extension storage budget')
  }
}

function settingsUsage(extensionSettings, { limitBytes = EXTENSION_QUOTA_BYTES, warnRatio = 0.8 } = {}) {
  validateSettings(extensionSettings, limitBytes, warnRatio)
  const current = { ...extensionSettings }
  const others = Object.fromEntries(Object.entries(current).filter(([key]) => !isWardrobeKey(key)))
  const otherExtensionsBytes = jsonBytes(others)
  const totalBytes = jsonBytes(current)
  const wardrobeBytes = totalBytes - otherExtensionsBytes
  const usageRatio = totalBytes / limitBytes
  const isOverLimit = totalBytes > limitBytes
  return {
    limitBytes,
    warnRatio,
    wardrobeBytes,
    otherExtensionsBytes,
    totalBytes,
    remainingBytes: Math.max(0, limitBytes - totalBytes),
    usageRatio,
    isOverLimit,
    isWarning: !isOverLimit && usageRatio >= warnRatio,
  }
}

/** Report bytes in an observed BC ExtensionSettings snapshot, without an upload estimate. */
export function measureObservedExtensionQuota(extensionSettings, options) {
  return settingsUsage(extensionSettings, options)
}

/**
 * Measure the proposed VPW value and device marker alongside every other
 * extension's settings. Existing markers for other devices remain in the
 * proposed settings, but their outfit content is not duplicated.
 * Throws if the proposal cannot be serialized; callers must retain the local
 * snapshot and stop the upload rather than interpreting a failed estimate as 0.
 */
export function measureExtensionQuota(extensionSettings, encodedVpwPayload, {
  limitBytes = EXTENSION_QUOTA_BYTES,
  warnRatio = 0.8,
  markerKey,
  markerValue,
} = {}) {
  if (typeof encodedVpwPayload !== 'string') {
    throw new TypeError('The wardrobe payload must be an encoded string')
  }
  validateSettings(extensionSettings, limitBytes, warnRatio)
  if (markerKey === undefined ? markerValue !== undefined :
    typeof markerKey !== 'string' || !/^VPW4_M_[0-9a-f]{32}$/.test(markerKey) || markerValue === undefined) {
    throw new TypeError('A device marker requires a safe key and serializable value')
  }
  if (markerKey !== undefined) jsonBytes(markerValue)

  const current = { ...extensionSettings }
  const proposed = { ...current, [WARDROBE_KEY]: encodedVpwPayload }
  if (markerKey !== undefined) proposed[markerKey] = markerValue
  const quota = settingsUsage(proposed, { limitBytes, warnRatio })
  const update = { [`ExtensionSettings.${WARDROBE_KEY}`]: encodedVpwPayload }
  if (markerKey !== undefined) update[`ExtensionSettings.${markerKey}`] = markerValue
  const packet = ['AccountUpdate', update]
  const packetBytes = jsonBytes(packet) + 2 // Socket.IO event + Engine.IO message prefixes: 42

  return {
    ...quota,
    packetBytes,
    isOverLimit: quota.isOverLimit || packetBytes > limitBytes,
    isWarning: !quota.isOverLimit && packetBytes <= limitBytes && quota.usageRatio >= warnRatio,
  }
}
