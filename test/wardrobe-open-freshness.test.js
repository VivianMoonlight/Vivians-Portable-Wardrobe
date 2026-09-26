import assert from 'node:assert/strict'
import { test } from 'node:test'
import LZString from 'lz-string'
import { WardrobeRepository, decodeWardrobePayload } from '../src/services/WardrobeRepository.js'
import { applyWardrobeOperations, projectWardrobeCloudIndex } from '../src/services/wardrobe-index.js'

const copy = value => JSON.parse(JSON.stringify(value))
const encode = value => LZString.compressToBase64(JSON.stringify(value))
const put = (id, name) => ({ type: 'put-outfit', id, changes: {
  name, data: [{ Group: 'Cloth', Name: name }],
} })

function device(server, { saved = new Map(), cachedSettings = server.settings, replicaId = 'a' } = {}) {
  const player = { MemberNumber: 42, ExtensionSettings: copy(cachedSettings) }
  const timers = new Map()
  let timerId = 0
  let sends = 0
  const repo = new WardrobeRepository({
    getPlayer: () => player,
    localStorage: {
      getItem: key => saved.get(key) ?? null,
      setItem(key, value) { saved.set(key, value) },
    },
    send() { sends++; server.settings.VPWardrobe = player.ExtensionSettings.VPWardrobe },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId },
    clearTimeout(id) { timers.delete(id) },
    replicaId,
  })
  return { repo, saved, timers, player, sends: () => sends,
    login: () => repo.receiveCloud({ extensionSettings: copy(server.settings), fresh: true }),
    document: () => decodeWardrobePayload(saved.get(repo.key)),
  }
}

test('a stale Player cache cannot verify or re-upload outfits deleted and renamed on another device', () => {
  const server = { settings: {} }
  const a = device(server)
  a.repo.open()
  a.repo.apply([put('deleted', 'Old outfit'), put('renamed', 'Old name')])
  assert.equal(a.repo.flush(), true)

  const bSaved = new Map()
  const b = device(server, { saved: bSaved, replicaId: 'b' })
  assert.equal(b.repo.open(), true)
  assert.equal(b.login(), true)
  assert.equal(b.repo.status.state, 'verified')
  const staleSettings = copy(b.player.ExtensionSettings)

  a.repo.apply([
    { type: 'delete-outfit', id: 'deleted' },
    { type: 'put-outfit', id: 'renamed', changes: { name: 'New name' } },
  ])
  assert.equal(a.repo.flush(), true)
  const updatedCloud = server.settings.VPWardrobe

  const reopened = device(server, { saved: bSaved, cachedSettings: staleSettings, replicaId: 'b-new-session' })
  assert.equal(reopened.repo.open(), true)
  assert.equal(reopened.repo.status.state, 'pending')
  assert.equal(reopened.timers.size, 0, 'Opening from Player must not queue a stale upload')
  assert.ok(reopened.document().lastVerifiedPayload, 'The prior session had a verification record')
  assert.equal(reopened.repo.flush({ force: true }), false, 'Manual retry also waits when only the cached payload is known')
  assert.equal(reopened.sends(), 0)
  assert.equal(server.settings.VPWardrobe, updatedCloud)

  assert.equal(reopened.login(), true)
  assert.equal(reopened.repo.status.state, 'verified')
  assert.equal(reopened.repo.index.outfits.deleted, undefined)
  assert.ok(reopened.repo.index.tombstones.outfits.deleted)
  assert.equal(reopened.repo.index.outfits.renamed.name, 'New name')
  assert.equal(reopened.repo.flush(), true)
  assert.equal(reopened.sends(), 0)
})

test('a genuine edit made after provisional open can still upload before a new login response', () => {
  const server = { settings: {} }
  const d = device(server)
  assert.equal(d.repo.open(), true)
  assert.equal(d.repo.status.state, 'pending')
  assert.equal(d.repo.flush({ force: true }), false)
  assert.equal(d.sends(), 0)
  d.repo.apply([put('new', 'New outfit')])
  assert.equal(d.repo.flush(), true)
  assert.equal(d.repo.status.state, 'submitted')
  assert.equal(d.sends(), 1)
  assert.equal(decodeWardrobePayload(server.settings.VPWardrobe).outfits.new.name, 'New outfit')
  assert.equal(d.login(), true)
  assert.equal(d.repo.status.state, 'verified')
})

test('a private-only edit does not re-upload an unchanged provisional cloud projection', () => {
  const server = { settings: {} }
  const saved = new Map()
  const a = device(server, { saved })
  a.repo.open()
  a.repo.apply([put('private', 'Original')])
  a.repo.flush()
  a.repo.apply([{ type: 'set-cloud', id: 'private', enabled: false }])
  a.repo.flush()
  const cloudBefore = server.settings.VPWardrobe

  const reopened = device(server, { saved, cachedSettings: server.settings, replicaId: 'new-session' })
  reopened.repo.open()
  reopened.repo.apply([{ type: 'put-outfit', id: 'private', changes: { name: 'Private edit' } }])
  assert.equal(reopened.repo.flush({ force: true }), false)
  assert.equal(reopened.sends(), 0)
  assert.equal(server.settings.VPWardrobe, cloudBefore)
  assert.equal(reopened.repo.index.outfits.private.name, 'Private edit')
  assert.equal(reopened.login(), true)
  assert.equal(reopened.repo.status.state, 'verified')
  assert.equal(reopened.repo.index.outfits.private.name, 'Private edit')
})

test('a stale tab keeps its private edit as a local-only fork after a shared-storage cloud re-enable', () => {
  const server = { settings: {} }
  const saved = new Map()
  const a = device(server, { saved, replicaId: 'tab-a' })
  a.repo.open()
  a.repo.apply([put('outfit', 'Public shirt')])
  a.repo.flush()
  a.repo.apply([{ type: 'set-cloud', id: 'outfit', enabled: false }])
  a.repo.flush()

  const b = device(server, { saved, replicaId: 'tab-b' })
  b.repo.open()
  b.repo.apply([put('outfit', 'Private dress')])
  const privateIndex = b.repo.index
  const publicIndex = applyWardrobeOperations(a.repo.index,
    [{ type: 'set-cloud', id: 'outfit', enabled: true }], { replicaId: 'tab-a' })
  saved.set(b.repo.key, encode({ ...b.document(), index: publicIndex, pending: true }))

  b.repo.apply([put('other', 'Other outfit')])
  const fork = Object.values(b.repo.index.outfits).find(outfit => outfit.vpwLocalFork?.sourceId === 'outfit')
  assert.ok(fork)
  assert.equal(fork.name, privateIndex.outfits.outfit.name)
  assert.equal(b.repo.index.cloudState[fork.id].enabled, false)
  assert.equal(b.repo.index.outfits.outfit.name, 'Public shirt')
  assert.equal(b.repo.flush(), true)
  const cloud = decodeWardrobePayload(server.settings.VPWardrobe)
  assert.equal(cloud.outfits.outfit.name, 'Public shirt')
  assert.equal(cloud.outfits[fork.id], undefined)
  assert.equal(JSON.stringify(cloud).includes('Private dress'), false)
  assert.deepEqual(cloud, projectWardrobeCloudIndex(b.repo.index))
})
