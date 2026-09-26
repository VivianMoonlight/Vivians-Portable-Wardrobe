/** Constant-size per-device receipts for the one-copy BC ExtensionSettings wardrobe. */
export const WARDROBE_MARKER_PREFIX = 'VPW4_M_'
export const WARDROBE_MARKER_VERSION = 1
export const MAX_WARDROBE_DEVICE_MARKERS = 16

const DEVICE_ID = /^[0-9a-f]{32}$/
const MARKER_FIELDS = new Set(['v', 's'])
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const validSequence = value => Number.isSafeInteger(value) && value >= 0

function assertDeviceId(deviceId) {
  if (!DEVICE_ID.test(deviceId)) throw new Error('Invalid wardrobe device ID')
  return deviceId
}

function canonicalMarker(value) {
  if (!isObject(value) || Object.keys(value).some(key => !MARKER_FIELDS.has(key))) {
    throw new Error('Invalid wardrobe sync marker')
  }
  if (value.v !== WARDROBE_MARKER_VERSION || !validSequence(value.s)) {
    throw new Error('Invalid wardrobe marker version or sequence')
  }
  return { v: WARDROBE_MARKER_VERSION, s: value.s }
}

export function generateWardrobeDeviceId(cryptoProvider = globalThis.crypto) {
  if (typeof cryptoProvider?.getRandomValues !== 'function') {
    throw new Error('Secure wardrobe device ID generation is unavailable')
  }
  const bytes = cryptoProvider.getRandomValues(new Uint8Array(16))
  if (!(bytes instanceof Uint8Array) || bytes.length !== 16) {
    throw new Error('Secure wardrobe device ID generation failed')
  }
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function getOrCreateWardrobeDeviceId(storage, memberNumber, cryptoProvider = globalThis.crypto) {
  if (!Number.isSafeInteger(memberNumber) || memberNumber < 0) {
    throw new Error('A BC account is required for wardrobe device ID')
  }
  const key = `VPW4_device_${memberNumber}`
  const existing = storage.getItem(key)
  if (existing !== null) return assertDeviceId(existing)
  const deviceId = generateWardrobeDeviceId(cryptoProvider)
  if (storage.setItem(key, deviceId) === false || storage.getItem(key) !== deviceId) {
    throw new Error('Wardrobe device ID could not be saved locally')
  }
  return deviceId
}

export function markerKeyForDevice(deviceId) {
  return WARDROBE_MARKER_PREFIX + assertDeviceId(deviceId)
}

export function createWardrobeSyncMarker(options = {}) {
  if (!isObject(options) || Object.keys(options).some(key => key !== 'sequence')) {
    throw new Error('Invalid wardrobe marker options')
  }
  return canonicalMarker({ v: WARDROBE_MARKER_VERSION, s: options.sequence ?? 0 })
}

export function encodeWardrobeSyncMarker(marker) {
  return JSON.stringify(canonicalMarker(marker))
}

export function decodeWardrobeSyncMarker(raw) {
  if (typeof raw !== 'string') throw new Error('Wardrobe sync marker must be a string')
  if (raw.length > 28) throw new Error('Wardrobe sync marker exceeds its fixed size')
  let value
  try { value = JSON.parse(raw) } catch { throw new Error('Wardrobe sync marker could not be decoded') }
  const marker = canonicalMarker(value)
  if (raw !== encodeWardrobeSyncMarker(marker)) throw new Error('Wardrobe sync marker is not canonical')
  return marker
}

export function readWardrobeSyncMarkers(extensionSettings) {
  if (!isObject(extensionSettings)) throw new Error('ExtensionSettings must be an object')
  const markers = new Map()
  for (const [key, raw] of Object.entries(extensionSettings)) {
    if (!key.startsWith(WARDROBE_MARKER_PREFIX)) continue
    if (markers.size >= MAX_WARDROBE_DEVICE_MARKERS) {
      throw new Error('Wardrobe device marker limit reached')
    }
    const deviceId = assertDeviceId(key.slice(WARDROBE_MARKER_PREFIX.length))
    markers.set(deviceId, decodeWardrobeSyncMarker(raw))
  }
  return markers
}

/** Every gap requires quarantining the entire snapshot; a receipt cannot restore outfit content. */
export function findUnappliedWardrobeMarkers(markers, appliedSeqByDevice = {}) {
  if (!(markers instanceof Map) || !isObject(appliedSeqByDevice)) {
    throw new Error('Invalid wardrobe synchronization receipts')
  }
  if (markers.size > MAX_WARDROBE_DEVICE_MARKERS
    || Object.keys(appliedSeqByDevice).length > MAX_WARDROBE_DEVICE_MARKERS) {
    throw new Error('Wardrobe device marker limit reached')
  }
  for (const [deviceId, sequence] of Object.entries(appliedSeqByDevice)) {
    assertDeviceId(deviceId)
    if (!validSequence(sequence)) throw new Error('Invalid applied wardrobe sequence')
    if (sequence > 0 && !markers.has(deviceId)) {
      throw new Error('Wardrobe snapshot references a missing device marker')
    }
  }
  const missing = []
  for (const [deviceId, marker] of markers) {
    assertDeviceId(deviceId)
    const receipt = canonicalMarker(marker)
    const appliedSequence = own(appliedSeqByDevice, deviceId) ? appliedSeqByDevice[deviceId] : 0
    if (receipt.s > appliedSequence) missing.push({ deviceId, marker: receipt, appliedSequence })
    else if (receipt.s < appliedSequence) {
      throw new Error('Wardrobe device marker is older than the cloud snapshot')
    }
  }
  return missing.sort((left, right) => left.deviceId.localeCompare(right.deviceId))
}
