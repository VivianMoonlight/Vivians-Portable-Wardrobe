import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { WardrobeRepository } from '../src/services/WardrobeRepository.js'
import { WardrobePersistence } from '../src/services/wardrobe-persistence.js'
import { applyWardrobeOperations, createWardrobeIndex } from '../src/services/wardrobe-index.js'

const put = (id, name = id) => ({ type: 'put-outfit', id, changes: {
  name, data: [{ Group: 'Cloth', Name: 'Shirt' }],
} })

function fixture({ saved = new Map(), persistence = new WardrobePersistence(() => new IDBFactory()) } = {}) {
  const settings = {}
  const player = { MemberNumber: 42, ExtensionSettings: settings }
  const notifications = []
  const sends = []
  const repo = new WardrobeRepository({
    getPlayer: () => player,
    localStorage: {
      getItem: key => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
      removeItem: key => saved.delete(key),
      get length() { return saved.size },
      key: index => [...saved.keys()][index] ?? null,
    },
    persistence,
    send: fields => { sends.push(fields) },
    onChange: snapshot => notifications.push(snapshot),
    setTimeout: () => 1,
    clearTimeout: () => {},
    replicaId: 'idb-test-device',
  })
  return { repo, persistence, saved, player, notifications, sends }
}

test('an edit is visible and uploadable only after its IndexedDB write completes', async () => {
  const device = fixture()
  assert.equal(await device.repo.open({ extensionSettings: {}, fresh: true }), true)
  const beforeCount = device.notifications.length
  const originalWrite = device.persistence.write.bind(device.persistence)
  let beginWrite
  const writing = new Promise(resolve => { beginWrite = resolve })
  let finishWrite
  const commit = new Promise(resolve => { finishWrite = resolve })
  device.persistence.write = async (...args) => {
    beginWrite()
    await commit
    return originalWrite(...args)
  }

  const edit = device.repo.apply([put('delayed')])
  await writing
  assert.equal(device.repo.index.outfits.delayed, undefined)
  assert.equal((await device.persistence.read('42')).index.outfits.delayed, undefined)
  assert.equal(device.notifications.length, beforeCount)
  assert.equal(device.sends.length, 0)

  finishWrite()
  await edit
  assert.equal(device.repo.index.outfits.delayed.name, 'delayed')
  assert.equal((await device.persistence.read('42')).index.outfits.delayed.name, 'delayed')
  assert.ok(device.notifications.length > beforeCount)
  assert.equal(await device.repo.flush(), true)
  assert.equal(device.sends.length, 1)
})

test('a rejected IndexedDB write keeps the old outfit and never uploads the failed edit', async () => {
  const device = fixture()
  assert.equal(await device.repo.open({ extensionSettings: {}, fresh: true }), true)
  await device.repo.apply([put('saved')])
  const before = await device.persistence.read('42')
  device.persistence.write = () => Promise.reject(Object.assign(new Error('Database full'), {
    name: 'QuotaExceededError',
  }))

  await assert.rejects(device.repo.apply([put('failed')]), error => error.code === 'indexeddb-quota')
  assert.equal(device.repo.index.outfits.failed, undefined)
  assert.ok(device.repo.index.outfits.saved)
  assert.deepEqual(await device.persistence.read('42'), before)
  assert.equal(device.repo.status.state, 'error')
  assert.equal(device.repo.status.errorCode, 'indexeddb-quota')
  assert.equal(device.sends.length, 0)
})

test('migration preserves a divergent localStorage document as recovery before deleting its key', async () => {
  const persistence = new WardrobePersistence(() => new IDBFactory())
  const currentIndex = applyWardrobeOperations(createWardrobeIndex(), [put('current')], {
    replicaId: 'idb-device',
  })
  const oldIndex = applyWardrobeOperations(createWardrobeIndex(), [put('old')], {
    replicaId: 'old-device',
  })
  const document = index => ({ index, pending: true, recoveryKeys: [], baseCloudIndex: null,
    baseCloudSequence: 0, baseAppliedSeq: {}, submittedVersions: [], conflicts: [], protocolVersion: 4 })
  await persistence.write('42', document(currentIndex))
  const legacyRaw = JSON.stringify(document(oldIndex))
  const saved = new Map([['VPWardrobe_index_42', legacyRaw]])
  const device = fixture({ saved, persistence })

  assert.equal(await device.repo.open(), true)
  assert.ok(device.repo.index.outfits.current)
  assert.equal(device.repo.index.outfits.old, undefined)
  assert.equal(saved.has('VPWardrobe_index_42'), false)
  const recovered = await device.repo.exportRecovery()
  assert.ok(recovered.some(archive => archive.reason === 'superseded-local-document'
    && archive.data.index.outfits.old))
  const reopened = fixture({ saved, persistence })
  assert.equal(await reopened.repo.open(), true)
  assert.ok(reopened.repo.index.outfits.current)
  assert.ok((await reopened.repo.exportRecovery()).some(archive => archive.data.index.outfits.old))
})

test('a full localStorage does not block migration or a new device ID', async () => {
  const index = applyWardrobeOperations(createWardrobeIndex(), [put('legacy')], {
    replicaId: 'old-device',
  })
  const key = 'VPWardrobe_index_42'
  const raw = JSON.stringify({ index, pending: true, recoveryKeys: [],
    baseCloudIndex: null, baseCloudSequence: 0, baseAppliedSeq: {}, submittedVersions: [], conflicts: [] })
  const device = fixture({ saved: new Map([[key, raw]]) })
  device.repo.local.setItem = () => { throw Object.assign(new Error('Full localStorage'), {
    name: 'QuotaExceededError',
  }) }

  assert.equal(await device.repo.open(), true)
  assert.equal(device.saved.has(key), false)
  assert.equal(device.repo.index.outfits.legacy.name, 'legacy')
  assert.match(device.repo.deviceId, /^[0-9a-f]{32}$/)
  await device.repo.apply([put('new')])
  assert.equal((await device.persistence.read('42')).index.outfits.new.name, 'new')
})

test('IndexedDB outage leaves the readable local backup visible without uploading it', async () => {
  const index = applyWardrobeOperations(createWardrobeIndex(), [put('backup')], {
    replicaId: 'old-device',
  })
  const key = 'VPWardrobe_index_42'
  const raw = JSON.stringify({ index, pending: true, recoveryKeys: [] })
  const device = fixture({ saved: new Map([[key, raw]]),
    persistence: new WardrobePersistence(() => null) })

  assert.equal(await device.repo.open(), false)
  assert.equal(device.repo.status.errorCode, 'indexeddb-error')
  assert.equal(device.repo.status.localSaved, false)
  assert.equal(device.repo.index.outfits.backup.name, 'backup')
  assert.equal(device.saved.get(key), raw)
  assert.equal(device.sends.length, 0)
})

test('an old wardrobe source is linked in recovery before its local key is removed', async () => {
  const persistence = new WardrobePersistence(() => new IDBFactory())
  const current = applyWardrobeOperations(createWardrobeIndex(), [put('current')], {
    replicaId: 'idb-device',
  })
  await persistence.write('42', { index: current, pending: true, recoveryKeys: [],
    baseCloudIndex: null, baseCloudSequence: 0, baseAppliedSeq: {}, submittedVersions: [], conflicts: [] })
  const key = 'VPWardrobe_VPWardrobe_local_42'
  const raw = JSON.stringify({ name: 'Home', type: 'folder', children: [
    { name: 'Old shirt', type: 'outfit', data: [{ Group: 'Cloth', Name: 'Shirt' }] },
  ] })
  const device = fixture({ saved: new Map([[key, raw]]), persistence })

  assert.equal(await device.repo.open(), true)
  assert.equal(device.saved.has(key), false)
  const document = await persistence.read('42')
  assert.ok(document.recoveryKeys.length > 0)
  const recovery = await device.repo.exportRecovery()
  assert.ok(recovery.some(item => item.reason === 'legacy-local-source'
    && item.data.local.some(source => source.key === key && source.raw === raw)))
})

test('orphan recovery is migrated and scoped to the current account', async () => {
  const key = 'VPWardrobe_index_42_recovery_orphan'
  const otherKey = 'VPWardrobe_index_420_recovery_other'
  const record = { reason: 'before-v4-migration', data: { note: 'orphan' }, createdAt: 1 }
  const saved = new Map([[key, JSON.stringify(record)], [otherKey, JSON.stringify(record)]])
  const device = fixture({ saved })

  assert.equal(await device.repo.open(), true)
  assert.equal(saved.has(key), false)
  assert.equal(saved.has(otherKey), true)
  assert.equal(device.repo.status.recoveryAvailable, true)
  const recovery = await device.repo.exportRecovery()
  assert.ok(recovery.some(item => item.key === key && item.data.note === 'orphan'))
  assert.equal(recovery.some(item => item.key === otherKey), false)
})

test('unreadable orphan recovery and old primary remain available as raw export', async () => {
  const persistence = new WardrobePersistence(() => new IDBFactory())
  await persistence.write('42', { index: createWardrobeIndex(), pending: false,
    recoveryKeys: [], baseCloudIndex: null, baseCloudSequence: 0, baseAppliedSeq: {},
    submittedVersions: [], conflicts: [] })
  const primaryKey = 'VPWardrobe_index_42'
  const archiveKey = `${primaryKey}_recovery_damaged`
  const saved = new Map([[primaryKey, 'damaged primary'], [archiveKey, 'damaged archive']])
  const device = fixture({ saved, persistence })

  assert.equal(await device.repo.open(), true)
  assert.equal(device.repo.status.recoveryAvailable, true)
  assert.equal(saved.get(primaryKey), 'damaged primary')
  assert.equal(saved.get(archiveKey), 'damaged archive')
  const recovery = await device.repo.exportRecovery()
  assert.ok(recovery.some(item => item.key === primaryKey
    && item.reason === 'unreadable-legacy-document' && item.data.raw === 'damaged primary'))
  assert.ok(recovery.some(item => item.key === archiveKey
    && item.reason === 'unreadable-legacy-recovery' && item.data.raw === 'damaged archive'))
})

test('recovery export uses current-account local raw keys when IndexedDB is unavailable', async () => {
  const archiveKey = 'VPWardrobe_index_42_recovery_orphan'
  const sourceKey = 'VPWardrobe_VPWardrobe_local_42'
  const otherArchive = 'VPWardrobe_index_420_recovery_other'
  const otherSource = 'VPWardrobe_VPWardrobe_local_420'
  const saved = new Map([
    [archiveKey, 'damaged archive'],
    [sourceKey, 'damaged old source'],
    [otherArchive, 'another account archive'],
    [otherSource, 'another account source'],
  ])
  const device = fixture({ saved, persistence: new WardrobePersistence(() => null) })

  assert.equal(await device.repo.open(), false)
  assert.equal(device.repo.status.errorCode, 'indexeddb-error')
  assert.equal(device.repo.status.recoveryAvailable, true)
  const recovery = await device.repo.exportRecovery()
  assert.ok(recovery.some(item => item.key === archiveKey && item.data.raw === 'damaged archive'))
  assert.ok(recovery.some(item => item.key === sourceKey && item.data.raw === 'damaged old source'))
  assert.equal(recovery.some(item => item.key === otherArchive || item.key === otherSource), false)
  assert.equal(saved.get(archiveKey), 'damaged archive')
  assert.equal(saved.get(sourceKey), 'damaged old source')
})

test('malformed old source remains exportable after a successful IndexedDB open', async () => {
  const key = 'VPWardrobe_42'
  const saved = new Map([[key, 'malformed old wardrobe']])
  const device = fixture({ saved })

  assert.equal(await device.repo.open(), true)
  assert.equal(device.repo.status.recoveryAvailable, true)
  assert.equal(saved.get(key), 'malformed old wardrobe')
  const recovery = await device.repo.exportRecovery()
  assert.ok(recovery.some(item => item.key === key
    && item.reason === 'legacy-local-source-raw' && item.data.raw === 'malformed old wardrobe'))
})
