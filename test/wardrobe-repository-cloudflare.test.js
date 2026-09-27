import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { WardrobeRepository } from '../src/services/WardrobeRepository.js'
import { WardrobePersistence } from '../src/services/wardrobe-persistence.js'
import { applyWardrobeOperations, createWardrobeIndex } from '../src/services/wardrobe-index.js'

const put = (id, name = id) => ({ type: 'put-outfit', id, changes: {
  name, data: [{ Group: 'Cloth', Name: 'Shirt' }],
} })
const rename = (id, name) => ({ type: 'put-outfit', id, changes: { name } })

function fixture({ persistence = new WardrobePersistence(() => new IDBFactory()),
  extensionSettings = {} } = {}) {
  const player = { MemberNumber: 42, ExtensionSettings: extensionSettings }
  const saved = new Map()
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
    send: fields => sends.push(fields),
    onChange: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    replicaId: 'cloudflare-test-device',
  })
  repo.setCloudflareMode(true)
  return { repo, persistence, player, saved, sends }
}

async function seed(device) {
  await device.repo.observeCloudflareSnapshot({ revision: 0, index: createWardrobeIndex() })
  await device.repo.apply([put('shirt', 'Base shirt')])
  const plan = await device.repo.cloudflarePlan()
  assert.equal(plan.revision, 0)
  assert.equal(await device.repo.confirmCloudflareWrite({ revision: 1, index: plan.index }), true)
  return plan.index
}

test('Cloudflare mode saves edits locally without reading or writing the BC wardrobe payload', async () => {
  const extensionSettings = { VPWardrobe: 'unreadable older BC payload', Other: 'keep' }
  const device = fixture({ extensionSettings })
  assert.equal(await device.repo.open({ extensionSettings, fresh: true }), true)
  await device.repo.apply([put('shirt')])
  assert.equal(await device.repo.receiveCloud({ extensionSettings, fresh: true }), true)
  assert.equal(await device.repo.flush({ force: true }), false)
  assert.equal(device.sends.length, 0)
  assert.deepEqual(extensionSettings, { VPWardrobe: 'unreadable older BC payload', Other: 'keep' })
  assert.equal((await device.persistence.read('42')).index.outfits.shirt.name, 'shirt')
  assert.equal((await device.repo.cloudflarePlan()).index.outfits.shirt.name, 'shirt')
})

test('first Cloudflare snapshot seeds the saved wardrobe and a newer revision verifies it', async () => {
  const device = fixture()
  assert.equal(await device.repo.open(), true)
  await device.repo.apply([put('shirt')])
  const initial = await device.repo.observeCloudflareSnapshot({ revision: 0,
    index: createWardrobeIndex() })
  assert.equal(initial.pending, true)
  assert.deepEqual(initial.conflicts, [])
  const plan = await device.repo.cloudflarePlan()
  assert.equal(plan.revision, 0)
  assert.ok(plan.index.outfits.shirt)
  assert.equal(await device.repo.confirmCloudflareWrite({ revision: 1, index: plan.index }), true)
  assert.equal(device.repo.status.state, 'verified')
  const persisted = await device.persistence.read('42')
  assert.equal(persisted.cloudflareRevision, 1)
  assert.equal(persisted.pending, false)
  assert.ok(persisted.cloudflareBaseIndex.outfits.shirt)
  assert.equal(device.sends.length, 0)
})

test('an older or divergent same-revision Cloudflare response cannot replace a verified copy', async () => {
  const device = fixture()
  await device.repo.open()
  const base = await seed(device)
  const before = await device.persistence.read('42')
  await assert.rejects(device.repo.observeCloudflareSnapshot({ revision: 0,
    index: createWardrobeIndex() }), /older revision/)
  const divergent = applyWardrobeOperations(base, [put('another')], {
    replicaId: 'remote-device',
  })
  await assert.rejects(device.repo.observeCloudflareSnapshot({ revision: 1,
    index: divergent }), /same revision/)
  assert.deepEqual(await device.persistence.read('42'), before)
  assert.equal(device.repo.status.state, 'verified')
  assert.equal((await device.repo.cloudflarePlan()).index.outfits.another, undefined)
})

test('concurrent rename requires a choice before a Cloudflare write can be planned', async () => {
  const device = fixture()
  await device.repo.open()
  const base = await seed(device)
  await device.repo.apply([rename('shirt', 'Local shirt')])
  const remote = applyWardrobeOperations(base, [rename('shirt', 'Remote shirt')], {
    replicaId: 'remote-device',
  })
  const observed = await device.repo.observeCloudflareSnapshot({ revision: 2, index: remote })
  assert.equal(observed.conflicts.length, 1)
  assert.equal(observed.conflicts[0].field, 'name')
  assert.equal(device.repo.status.state, 'conflict')
  assert.equal((await device.repo.cloudflarePlan()).conflicts.length, 1)
  await device.repo.resolveSyncConflict([{ kind: 'outfit', id: 'shirt',
    field: 'name', choice: 'local' }])
  const plan = await device.repo.cloudflarePlan()
  assert.deepEqual(plan.conflicts, [])
  assert.equal(plan.revision, 2)
  assert.equal(plan.index.outfits.shirt.name, 'Local shirt')
  assert.equal(await device.repo.confirmCloudflareWrite({ revision: 3, index: plan.index }), true)
  assert.equal(device.repo.status.state, 'verified')
  assert.equal((await device.persistence.read('42')).cloudflareRevision, 3)
  assert.equal(device.sends.length, 0)
})

test('an edit made while PUT is in flight remains pending after its earlier plan is acknowledged', async () => {
  const device = fixture()
  await device.repo.open()
  await device.repo.observeCloudflareSnapshot({ revision: 0, index: createWardrobeIndex() })
  await device.repo.apply([put('first')])
  const plan = await device.repo.cloudflarePlan()
  await device.repo.apply([put('second')])
  assert.equal(await device.repo.confirmCloudflareWrite({ revision: 1, index: plan.index }), false)
  assert.equal(device.repo.status.state, 'pending')
  const persisted = await device.persistence.read('42')
  assert.equal(persisted.cloudflareRevision, 1)
  assert.equal(persisted.cloudflareBaseIndex.outfits.second, undefined)
  assert.ok(persisted.index.outfits.second)
  assert.equal(persisted.pending, true)
  const next = await device.repo.observeCloudflareSnapshot({ revision: 1, index: plan.index })
  assert.equal(next.pending, true)
  assert.ok(next.index.outfits.second)
})

test('failed IndexedDB commit leaves Cloudflare revision, index, and upload plan unchanged', async () => {
  const device = fixture()
  await device.repo.open()
  const base = await seed(device)
  await device.repo.apply([put('local')])
  const plan = await device.repo.cloudflarePlan()
  const before = await device.persistence.read('42')
  const originalWrite = device.persistence.write.bind(device.persistence)
  device.persistence.write = () => Promise.reject(new Error('disk rejected commit'))
  const changed = applyWardrobeOperations(base, [put('remote')], {
    replicaId: 'remote-device',
  })
  await assert.rejects(device.repo.observeCloudflareSnapshot({ revision: 2, index: changed }),
    /disk rejected commit/)
  assert.deepEqual(await device.persistence.read('42'), before)
  assert.equal(device.repo.index.outfits.remote, undefined)
  assert.equal((await device.repo.cloudflarePlan()).revision, 1)
  await assert.rejects(device.repo.confirmCloudflareWrite({ revision: 2, index: plan.index }),
    /disk rejected commit/)
  assert.deepEqual(await device.persistence.read('42'), before)
  device.persistence.write = originalWrite
})

test('leaving Cloudflare mode archives unresolved choices before BC mode resumes', async () => {
  const device = fixture()
  await device.repo.open()
  const base = await seed(device)
  await device.repo.apply([rename('shirt', 'Local shirt')])
  const remote = applyWardrobeOperations(base, [rename('shirt', 'Remote shirt')], {
    replicaId: 'remote-device',
  })
  await device.repo.observeCloudflareSnapshot({ revision: 2, index: remote })
  assert.equal(device.repo.status.state, 'conflict')
  await device.repo.leaveCloudflareMode()
  device.repo.setCloudflareMode(false)
  assert.equal(device.repo.status.state, 'pending')
  assert.deepEqual(device.repo.status.conflicts, [])
  assert.ok((await device.repo.exportRecovery()).some(entry =>
    entry.reason === 'cloudflare-conflict-before-bc'))
  assert.equal(device.sends.length, 0)
})
