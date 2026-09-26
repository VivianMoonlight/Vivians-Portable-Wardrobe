import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EXTENSION_QUOTA_BYTES, measureExtensionQuota } from '../src/services/extension-quota.js'

const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8')

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
})
