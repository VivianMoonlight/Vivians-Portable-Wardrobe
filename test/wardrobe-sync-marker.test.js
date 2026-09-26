import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_WARDROBE_DEVICE_MARKERS,
  WARDROBE_MARKER_PREFIX,
  createWardrobeSyncMarker,
  decodeWardrobeSyncMarker,
  encodeWardrobeSyncMarker,
  findUnappliedWardrobeMarkers,
  generateWardrobeDeviceId,
  getOrCreateWardrobeDeviceId,
  markerKeyForDevice,
  readWardrobeSyncMarkers,
} from '../src/services/wardrobe-sync-marker.js'

const DEVICE_A = '00112233445566778899aabbccddeeff'
const DEVICE_B = 'ffeeddccbbaa99887766554433221100'

function storage() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } }
}

test('device IDs are secure 128-bit hex values scoped to one BC account', () => {
  const local = storage()
  let calls = 0
  const cryptoProvider = { getRandomValues(bytes) { bytes.fill(++calls); return bytes } }
  assert.equal(getOrCreateWardrobeDeviceId(local, 42, cryptoProvider), '01'.repeat(16))
  assert.equal(getOrCreateWardrobeDeviceId(local, 42, cryptoProvider), '01'.repeat(16))
  assert.equal(getOrCreateWardrobeDeviceId(local, 43, cryptoProvider), '02'.repeat(16))
  assert.equal(calls, 2)
  assert.equal(generateWardrobeDeviceId(cryptoProvider), '03'.repeat(16))
  assert.equal(markerKeyForDevice(DEVICE_A), `${WARDROBE_MARKER_PREFIX}${DEVICE_A}`)
  assert.throws(() => markerKeyForDevice('other.device'))
  assert.throws(() => getOrCreateWardrobeDeviceId(local, -1, cryptoProvider))
  assert.throws(() => generateWardrobeDeviceId({}))
})

test('marker encoding has a fixed 28-byte maximum and contains no outfit data', () => {
  const marker = createWardrobeSyncMarker({ sequence: 7 })
  const encoded = encodeWardrobeSyncMarker(marker)
  assert.equal(encoded, '{"v":1,"s":7}')
  assert.deepEqual(decodeWardrobeSyncMarker(encoded), marker)
  assert.equal(encodeWardrobeSyncMarker(decodeWardrobeSyncMarker(encoded)), encoded)
  assert.equal(encodeWardrobeSyncMarker(createWardrobeSyncMarker()), '{"v":1,"s":0}')
  assert.equal(encodeWardrobeSyncMarker(createWardrobeSyncMarker({ sequence: Number.MAX_SAFE_INTEGER })).length, 28)
  assert.throws(() => createWardrobeSyncMarker({ deletedOutfitIds: ['x'] }))
})

test('A deletion is detectable after B overwrites the single snapshot without retaining the deleted ID', () => {
  const settings = {
    VPWardrobe: 'single outfit-content payload',
    [markerKeyForDevice(DEVICE_A)]: encodeWardrobeSyncMarker(createWardrobeSyncMarker({ sequence: 2 })),
    [markerKeyForDevice(DEVICE_B)]: encodeWardrobeSyncMarker(createWardrobeSyncMarker({ sequence: 1 })),
  }
  const markers = readWardrobeSyncMarkers(settings)
  const staleSnapshotApplied = { [DEVICE_A]: 1, [DEVICE_B]: 1 }
  const missing = findUnappliedWardrobeMarkers(markers, staleSnapshotApplied)
  assert.deepEqual(missing.map(({ deviceId, appliedSequence }) => [deviceId, appliedSequence]), [[DEVICE_A, 1]])
  assert.deepEqual(missing[0].marker, { v: 1, s: 2 })
  assert.deepEqual(findUnappliedWardrobeMarkers(markers, { [DEVICE_A]: 2, [DEVICE_B]: 1 }), [])
  assert.deepEqual(findUnappliedWardrobeMarkers(markers, staleSnapshotApplied), missing)
})

test('long edit and delete histories cannot grow the marker', () => {
  for (const sequence of [0, 1, 1000, Number.MAX_SAFE_INTEGER]) {
    const marker = createWardrobeSyncMarker({ sequence })
    assert.ok(encodeWardrobeSyncMarker(marker).length <= 28)
  }
  // A sequence gap is enough to quarantine the whole snapshot; only the
  // original device's local outbox can recover the missing content.
  const missing = findUnappliedWardrobeMarkers(new Map([[DEVICE_A,
    createWardrobeSyncMarker({ sequence: 1000 })]]), { [DEVICE_A]: 999 })
  assert.equal(missing.length, 1)
  assert.deepEqual(missing[0].marker, { v: 1, s: 1000 })
})

test('a seventeenth lifetime device or applied receipt fails closed', () => {
  const marker = encodeWardrobeSyncMarker(createWardrobeSyncMarker({ sequence: 1 }))
  const entries = Array.from({ length: MAX_WARDROBE_DEVICE_MARKERS + 1 }, (_, index) => [
    index.toString(16).padStart(32, '0'), marker,
  ])
  const settings = Object.fromEntries(entries.map(([id, raw]) => [markerKeyForDevice(id), raw]))
  const firstSixteen = readWardrobeSyncMarkers(Object.fromEntries(Object.entries(settings).slice(0, 16)))
  assert.equal(firstSixteen.size, 16)
  assert.deepEqual(findUnappliedWardrobeMarkers(firstSixteen,
    Object.fromEntries(entries.slice(0, 16).map(([id]) => [id, 1]))), [])
  assert.throws(() => readWardrobeSyncMarkers(settings), /limit/)
  const markers = new Map(entries.map(([id]) => [id, createWardrobeSyncMarker({ sequence: 1 })]))
  assert.throws(() => findUnappliedWardrobeMarkers(markers, {}), /limit/)
  assert.throws(() => findUnappliedWardrobeMarkers(new Map(),
    Object.fromEntries(entries.map(([id]) => [id, 0]))), /limit/)
  const largest = encodeWardrobeSyncMarker(createWardrobeSyncMarker({ sequence: Number.MAX_SAFE_INTEGER }))
  const maxSettings = Object.fromEntries(entries.slice(0, 16)
    .map(([id]) => [markerKeyForDevice(id), largest]))
  assert.equal(new TextEncoder().encode(JSON.stringify(maxSettings)).byteLength, 1233)
})

test('malformed markers and regressions stop automatic synchronization', () => {
  const bad = [
    '', '{', '{}', 'null', '[]', '{"v":2,"s":1}', '{"v":1,"s":-1}',
    '{ "v":1,"s":1}', '{"s":1,"v":1}', '{"v":1,"s":1}        ',
    '{"v":1,"s":1.5}', '{"v":1,"s":1,"d":null}',
    '{"v":1,"s":1,"data":["private outfit"]}',
    '{"v":1,"s":1,"d":["x"]}', '{"v":1,"s":1,"t":["x"]}',
    '{"v":1,"s":1,"w":["x"]}',
  ]
  for (const raw of bad) assert.throws(() => decodeWardrobeSyncMarker(raw), raw)
  assert.throws(() => readWardrobeSyncMarkers({ [`${WARDROBE_MARKER_PREFIX}bad.key`]: '{"v":1,"s":1}' }))
  assert.throws(() => readWardrobeSyncMarkers({ [markerKeyForDevice(DEVICE_A)]: '{' }))
  assert.throws(() => findUnappliedWardrobeMarkers(new Map([[DEVICE_A, createWardrobeSyncMarker({ sequence: 1 })]]),
    { [DEVICE_A]: 2 }), /older/)
  assert.throws(() => findUnappliedWardrobeMarkers(new Map(), { [DEVICE_A]: -1 }))
  assert.throws(() => findUnappliedWardrobeMarkers(new Map(), { [DEVICE_A]: 1 }), /missing/)
})
