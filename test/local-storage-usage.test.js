import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateLocalStorageUsage } from '../src/services/local-storage-usage.js'

test('estimates the stored VPW and other data without writing or exposing values', () => {
  const entries = new Map([
    ['VPWardrobe_index_123', '衣服'],
    ['vpw-color-scheme', 'dark'],
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
  assert.deepEqual(usage, {
    wardrobeBytes: bytes(['VPWardrobe_index_123', '衣服']) + bytes(['vpw-color-scheme', 'dark']),
    otherBytes: bytes(['OtherApp', '😀']),
    totalBytes: [...entries].reduce((total, entry) => total + bytes(entry), 0),
  })
  assert.deepEqual(Object.keys(usage), ['wardrobeBytes', 'otherBytes', 'totalBytes'])
})

test('reports usage as unavailable when localStorage cannot be read', () => {
  const storage = { length: 1, key: () => 'VPWardrobe_index_123', getItem: () => { throw new Error('blocked') } }
  assert.equal(estimateLocalStorageUsage(storage), null)
  assert.equal(estimateLocalStorageUsage({ length: 1, key: () => null }), null)
})
