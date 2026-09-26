import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EXTENSION_QUOTA_BYTES, WARDROBE_MARKER_PREFIX, measureExtensionQuota,
  measureObservedExtensionQuota } from '../src/services/extension-quota.js'

const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8')
const markerA = `${WARDROBE_MARKER_PREFIX}${'a'.repeat(32)}`
const markerB = `${WARDROBE_MARKER_PREFIX}${'b'.repeat(32)}`

test('counts VPW together with the shared extension budget and actual update packet', () => {
  const settings = { Other: 'other settings', VPWardrobe: 'obsolete' }
  const quota = measureExtensionQuota(settings, 'new payload')

  assert.equal(EXTENSION_QUOTA_BYTES, 180000)
  assert.equal(quota.limitBytes, 180000)
  assert.equal(quota.totalBytes, bytes({ Other: 'other settings', VPWardrobe: 'new payload' }))
  assert.equal(quota.otherExtensionsBytes, bytes({ Other: 'other settings' }))
  assert.equal(quota.wardrobeBytes + quota.otherExtensionsBytes, quota.totalBytes)
  assert.equal(quota.packetBytes, bytes(['AccountUpdate', { 'ExtensionSettings.VPWardrobe': 'new payload' }]) + 2)
  assert.equal(quota.remainingBytes, 180000 - quota.totalBytes)
  assert.equal(quota.usageRatio, quota.totalBytes / 180000)
  assert.equal(quota.isOverLimit, false)
})

test('counts all device markers as VPW usage and both fields in the actual packet', () => {
  const oldMarker = { v: 1, s: 2, d: ['old'], t: [], w: 2 }
  const nextMarker = { v: 1, s: 3, d: ['deleted-🧵'], t: [], w: 3 }
  const otherMarker = { v: 1, s: 7, d: [], t: ['withdrawn'], w: 7 }
  const settings = { Other: 'external', VPWardrobe: 'old', [markerA]: oldMarker, [markerB]: otherMarker }
  const quota = measureExtensionQuota(settings, 'new', { markerKey: markerA, markerValue: nextMarker })

  assert.equal(quota.totalBytes, bytes({ Other: 'external', VPWardrobe: 'new', [markerA]: nextMarker, [markerB]: otherMarker }))
  assert.equal(quota.otherExtensionsBytes, bytes({ Other: 'external' }))
  assert.equal(quota.wardrobeBytes + quota.otherExtensionsBytes, quota.totalBytes)
  assert.equal(quota.packetBytes, bytes(['AccountUpdate', {
    'ExtensionSettings.VPWardrobe': 'new',
    [`ExtensionSettings.${markerA}`]: nextMarker,
  }]) + 2)
  assert.equal(quota.remainingBytes, EXTENSION_QUOTA_BYTES - quota.totalBytes)
  assert.equal(settings.VPWardrobe, 'old')
  assert.equal(settings[markerA], oldMarker)
})

test('device marker growth can fill the shared budget without enlarging the update packet', () => {
  const settings = { Other: 'o'.repeat(166000), [markerB]: { d: 'x'.repeat(10000) } }
  const small = measureExtensionQuota(settings, 'snapshot', { markerKey: markerA, markerValue: { d: '' } })
  const large = measureExtensionQuota(settings, 'snapshot', { markerKey: markerA, markerValue: { d: 'y'.repeat(5000) } })

  assert.equal(small.isOverLimit, false)
  assert.equal(large.isOverLimit, true)
  assert.ok(large.totalBytes > EXTENSION_QUOTA_BYTES)
  assert.ok(large.packetBytes < EXTENSION_QUOTA_BYTES)
  assert.equal(large.otherExtensionsBytes, bytes({ Other: settings.Other }))
})

test('allows a cleanup write that replaces an oversized old marker with a smaller one', () => {
  const settings = { Other: 'external', VPWardrobe: 'old', [markerA]: { d: 'x'.repeat(190000) } }
  const quota = measureExtensionQuota(settings, 'smaller', {
    markerKey: markerA,
    markerValue: { v: 1, s: 9, d: [], t: [], w: 9 },
  })

  assert.ok(bytes(settings) > EXTENSION_QUOTA_BYTES)
  assert.equal(quota.isOverLimit, false)
  assert.ok(quota.totalBytes < EXTENSION_QUOTA_BYTES)
  assert.ok(quota.packetBytes < EXTENSION_QUOTA_BYTES)
})

test('reports observed cloud bytes separately from a smaller quarantined upload proposal', () => {
  const settings = { Other: 'external', VPWardrobe: 'cloud outfits'.repeat(900),
    [markerB]: { v: 1, s: 7, d: [], t: [], w: 7 } }
  const observed = measureObservedExtensionQuota(settings)
  const proposed = measureExtensionQuota(settings, 'visible local outfits', {
    markerKey: markerA, markerValue: { v: 1, s: 1, d: [], t: [], w: 1 },
  })

  assert.equal(observed.totalBytes, bytes(settings))
  assert.equal(observed.otherExtensionsBytes, bytes({ Other: 'external' }))
  assert.equal(observed.wardrobeBytes + observed.otherExtensionsBytes, observed.totalBytes)
  assert.equal(observed.remainingBytes, EXTENSION_QUOTA_BYTES - observed.totalBytes)
  assert.ok(observed.totalBytes > proposed.totalBytes)
  assert.equal(observed.packetBytes, undefined)
})

test('observed quota measures storage only, even when a proposed packet exceeds transport limit', () => {
  const payload = 'x'.repeat(EXTENSION_QUOTA_BYTES - bytes({ VPWardrobe: '' }))
  const settings = { VPWardrobe: payload }
  const observed = measureObservedExtensionQuota(settings)
  const proposed = measureExtensionQuota({}, payload)

  assert.equal(observed.totalBytes, EXTENSION_QUOTA_BYTES)
  assert.equal(observed.isOverLimit, false)
  assert.equal(proposed.isOverLimit, true)
  assert.equal(measureObservedExtensionQuota(null).totalBytes, bytes({}))
  assert.throws(() => measureObservedExtensionQuota([], {}), TypeError)
})

test('measures Unicode and UTF16-compressed settings in UTF8 bytes, including JSON escaping', () => {
  const settings = { Other: '\u4e2d\u6587\ud83e\uddf5\u8000\ud7ff\u0000"\\', More: { caption: '\u6362\u88c5' } }
  const payload = 'base64=='
  const quota = measureExtensionQuota(settings, payload)

  assert.equal(quota.otherExtensionsBytes, bytes(settings))
  assert.equal(quota.totalBytes, bytes({ ...settings, VPWardrobe: payload }))
  assert.ok(quota.otherExtensionsBytes > JSON.stringify(settings).length)
})

test('replaces the existing VPW value rather than counting both versions near the limit', () => {
  const others = { Other: 'x'.repeat(179900) }
  const overhead = bytes({ ...others, VPWardrobe: '' })
  const payload = 'y'.repeat(EXTENSION_QUOTA_BYTES - overhead)
  const settings = { ...others, VPWardrobe: 'z'.repeat(90000) }
  const atLimit = measureExtensionQuota(settings, payload)

  assert.equal(atLimit.totalBytes, EXTENSION_QUOTA_BYTES)
  assert.equal(atLimit.isOverLimit, false)
  assert.equal(atLimit.isWarning, true)
  assert.equal(atLimit.remainingBytes, 0)
  const overLimit = measureExtensionQuota(settings, payload + 'y')
  assert.equal(overLimit.isOverLimit, true)
  assert.equal(overLimit.isWarning, false)
  assert.equal(overLimit.remainingBytes, 0)
})

test('blocks a large wardrobe update whose transport envelope exceeds the packet limit', () => {
  const payload = 'x'.repeat(EXTENSION_QUOTA_BYTES - bytes({ VPWardrobe: '' }))
  const quota = measureExtensionQuota({}, payload)

  assert.equal(quota.totalBytes, EXTENSION_QUOTA_BYTES)
  assert.ok(quota.packetBytes > EXTENSION_QUOTA_BYTES)
  assert.equal(quota.isOverLimit, true)
})

test('warning uses total shared usage, even when VPW itself is small', () => {
  const quota = measureExtensionQuota({ Other: 'x'.repeat(145000) }, 'small')

  assert.ok(quota.wardrobeBytes < 100)
  assert.equal(quota.warnRatio, 0.8)
  assert.equal(quota.isWarning, true)
  assert.equal(measureExtensionQuota({ Other: 'x'.repeat(145000) }, 'small', { warnRatio: 0.9 }).isWarning, false)
})

test('keeps all input fields untouched, including nested settings and the old VPW value', () => {
  const nested = Object.freeze({ unicode: '\u4e2d\u6587' })
  const settings = Object.freeze({ Other: nested, VPWardrobe: 'old', Flag: false, Count: 0 })
  const before = JSON.stringify(settings)

  measureExtensionQuota(settings, 'replacement')

  assert.equal(JSON.stringify(settings), before)
  assert.equal(settings.Other, nested)
  assert.equal(settings.VPWardrobe, 'old')
})

test('supports an absent extension-settings object without mutating it', () => {
  for (const settings of [null, undefined]) {
    const quota = measureExtensionQuota(settings, '')
    assert.equal(quota.totalBytes, bytes({ VPWardrobe: '' }))
    assert.equal(quota.otherExtensionsBytes, 2)
  }
})

test('fails closed on unserializable settings or an invalid encoded payload', () => {
  const cyclic = {}
  cyclic.self = cyclic
  for (const settings of [{ Other: cyclic }, { Other: 1n }, { toJSON: () => undefined }, { get Other() { throw new Error('unreadable') } }]) {
    assert.throws(() => measureExtensionQuota(settings, 'payload'))
  }
  for (const payload of [null, undefined, {}, 0]) {
    assert.throws(() => measureExtensionQuota({}, payload), TypeError)
  }
  assert.throws(() => measureExtensionQuota([], 'payload'), TypeError)
  assert.throws(() => measureExtensionQuota({}, 'payload', { limitBytes: 0 }), RangeError)
  assert.throws(() => measureExtensionQuota({}, 'payload', { markerValue: { s: 1 } }), TypeError)
  assert.throws(() => measureExtensionQuota({}, 'payload', { markerKey: markerA }), TypeError)
  assert.throws(() => measureExtensionQuota({}, 'payload', { markerKey: 'VPW4_M_a.b', markerValue: {} }), TypeError)
  assert.throws(() => measureExtensionQuota({}, 'payload', { markerKey: markerA, markerValue: { n: 1n } }), TypeError)
})
