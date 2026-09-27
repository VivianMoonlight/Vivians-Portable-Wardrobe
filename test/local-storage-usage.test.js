import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateLocalStorageUsage } from '../src/services/local-storage-usage.js'

test('classifies stored localStorage by purpose without writing or exposing keys', () => {
  const entries = new Map([
    ['VPWardrobe_index_187592', '衣服'],
    ['VPWardrobe_index_187592_recovery_1', 'recovery'],
    ['VPWardrobe_VPWardrobe_history_187577', 'history'],
    ['VPWardrobe_VPWardrobe_local_187577', 'legacy'],
    ['VPWardrobe_187577', 'legacy-old'],
    ['VPWardrobe187578', 'legacy-older'],
    ['vpw-color-scheme', 'dark'],
    ['VPW4_device_187592', 'device'],
    ['VPWardrobe_index_187592_backup', 'unrecognized VPW key'],
    ['OtherApp', '😀'],
  ])
  const storage = {
    get length() { return entries.size },
    key(index) { return [...entries.keys()][index] ?? null },
    getItem(key) { return entries.get(key) ?? null },
    setItem() { throw new Error('usage inspection must not write') },
  }

  const usage = estimateLocalStorageUsage(storage)
  const bytes = ([key, value]) => (key.length + value.length) * 2
  const sum = keys => keys.reduce((total, key) => total + bytes([key, entries.get(key)]), 0)
  assert.deepEqual(usage, {
    wardrobeBytes: sum([...entries.keys()].filter(key => key !== 'OtherApp')),
    otherBytes: bytes(['OtherApp', '😀']),
    totalBytes: [...entries].reduce((total, entry) => total + bytes(entry), 0),
    categories: {
      currentIndexBytes: sum(['VPWardrobe_index_187592']),
      recoveryBytes: sum(['VPWardrobe_index_187592_recovery_1']),
      oldHistoryBytes: sum(['VPWardrobe_VPWardrobe_history_187577']),
      legacyWardrobeBytes: sum(['VPWardrobe_VPWardrobe_local_187577', 'VPWardrobe_187577', 'VPWardrobe187578']),
      otherVpwBytes: sum(['vpw-color-scheme', 'VPW4_device_187592', 'VPWardrobe_index_187592_backup']),
      otherAppsBytes: sum(['OtherApp']),
    },
  })
  assert.equal(Object.values(usage.categories).reduce((total, size) => total + size, 0), usage.totalBytes)
  assert.equal(usage.wardrobeBytes + usage.otherBytes, usage.totalBytes)
  const result = JSON.stringify(usage)
  for (const key of entries.keys()) assert.equal(result.includes(key), false)
  for (const memberId of ['187592', '187577', '187578']) assert.equal(result.includes(memberId), false)
})

test('reports usage as unavailable when localStorage cannot be read', () => {
  const storage = { length: 1, key: () => 'VPWardrobe_index_123', getItem: () => { throw new Error('blocked') } }
  assert.equal(estimateLocalStorageUsage(storage), null)
  assert.equal(estimateLocalStorageUsage({ length: 1, key: () => null }), null)
  assert.equal(estimateLocalStorageUsage({ length: 1, key: () => 'VPWardrobe_index_123', getItem: () => null }), null)
  assert.equal(estimateLocalStorageUsage({ get length() { throw new Error('blocked') } }), null)
})
