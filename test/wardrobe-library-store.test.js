import test from 'node:test'
import assert from 'node:assert/strict'
import { loadFileSystemStore } from './helpers/load-file-system-store.js'
import { applyWardrobeOperations, createWardrobeIndex, mergeWardrobeIndexes } from '../src/services/wardrobe-index.js'
import { decodeWardrobePayload } from '../src/services/WardrobeRepository.js'

const plain = value => JSON.parse(JSON.stringify(value))
const part = Name => ({ Group: 'Cloth', Name, Color: ['Default'] })
const outfit = (name, extra = {}) => ({ name, type: 'outfit', data: [part(name)], ...extra })
const wardrobe = children => ({ name: 'Home', type: 'folder', children })

function setup({ local = null, cloud = null } = {}) {
  const fixture = loadFileSystemStore()
  const { fs, hostWindow } = fixture
  hostWindow.ServerSend = () => {}
  hostWindow.navigator = { onLine: true }
  if (local) hostWindow.localStorage.setItem('VPWardrobe_VPWardrobe_local_42', JSON.stringify(local))
  if (cloud) hostWindow.Player.ExtensionSettings.VPWardrobe = JSON.stringify(cloud)
  fs.filterSnapshot = { items: [{ key: 'Cloth' }], groups: [{ groupID: 'clothes', itemList: [{ key: 'Cloth' }] }] }
  assert.equal(fs.loadAll(), true)
  fs.characterItem = [part('Worn shirt')]
  fixture.writes.length = 0
  return fixture
}

test('an initial login snapshot for another account cannot populate the current account wardrobe', () => {
  const { fs, hostWindow, writes } = loadFileSystemStore()
  const foreign = applyWardrobeOperations(createWardrobeIndex(), [
    { type: 'put-outfit', id: 'foreign', changes: outfit('Other account outfit') }
  ], { replicaId: 'other-account' })
  const beforePersistedLoaded = fs._persistedLoaded
  assert.equal(fs.receiveCloud({ memberNumber: 999, extensionSettings: { VPWardrobe: JSON.stringify(foreign) } }), false)
  assert.equal(hostWindow.Player.MemberNumber, 42)
  assert.equal(fs._repository.member, null)
  assert.equal(fs._persistedLoaded, beforePersistedLoaded)
  assert.equal(fs.outfits.length, 0)
  assert.equal(writes.length, 0)
  assert.equal(hostWindow.localStorage.getItem('VPWardrobe_index_42'), null)
})

test('an initial matching login snapshot initializes and durably saves the current account wardrobe', () => {
  const { fs, hostWindow } = loadFileSystemStore()
  const incoming = applyWardrobeOperations(createWardrobeIndex(), [
    { type: 'put-outfit', id: 'current', changes: outfit('Current account outfit') }
  ], { replicaId: 'current-account' })
  assert.equal(fs.receiveCloud({ memberNumber: 42, extensionSettings: { VPWardrobe: JSON.stringify(incoming) } }), true)
  assert.equal(fs._repository.member, '42')
  assert.equal(fs._persistedLoaded, '42')
  assert.equal(fs.syncStatus.localSaved, true)
  assert.equal(fs.syncStatus.state, 'pending')
  assert.deepEqual(Array.from(fs.outfits, item => item.id), ['current'])
  const saved = decodeWardrobePayload(hostWindow.localStorage.getItem('VPWardrobe_index_42'))
  assert.equal(saved.index.outfits.current.name, 'Current account outfit')
})

test('loadAll migrates the React local wardrobe into outfits and tags with a recoverable source copy', () => {
  const source = wardrobe([
    { name: 'Daily', type: 'folder', __vpwNodeId: 'daily', cloudSync: false, children: [outfit('Dress', { __vpwNodeId: 'dress' })] },
    outfit('Loose', { __vpwNodeId: 'loose' })
  ])
  const { fs, hostWindow } = setup({ local: source })
  assert.deepEqual(Array.from(fs.outfits, item => item.name), ['Dress', 'Loose'])
  assert.deepEqual(Array.from(fs.tags, tag => tag.name), ['Daily'])
  assert.deepEqual(Array.from(fs.outfits.find(item => item.id === 'dress').tagIds), ['daily'])
  assert.equal(fs.outfits.find(item => item.id === 'dress').cloudSync, false)
  assert.equal(fs.syncStatus.localSaved, true)
  assert.equal(fs.syncStatus.recoveryAvailable, true)
  assert.deepEqual(JSON.parse(hostWindow.localStorage.getItem('VPWardrobe_VPWardrobe_local_42')), source)
  assert.ok(hostWindow.localStorage.getItem('VPWardrobe_index_42'))
  assert.equal(fs.exportRecovery().length, 1)
})

test('creating, renaming and deleting a tag preserves outfits and their stable identity', () => {
  const { fs } = setup()
  const tagId = fs.createTag('  Daily  ')
  fs.selectTag(tagId)
  const id = fs.addOutfit(outfit('Dress'))
  const data = plain(fs.outfits[0].data)
  assert.equal(fs.tags[0].name, 'Daily')
  assert.deepEqual(Array.from(fs.outfits[0].tagIds), [tagId])
  assert.equal(fs.renameTag(tagId, 'Everyday'), true)
  assert.equal(fs.tags[0].id, tagId)
  assert.equal(fs.tags[0].name, 'Everyday')
  assert.equal(fs.deleteTag(tagId), true)
  assert.equal(fs.tags.length, 0)
  assert.equal(fs.selectedTagId, null)
  assert.equal(fs.outfits.length, 1)
  assert.equal(fs.outfits[0].id, id)
  assert.deepEqual(plain(fs.outfits[0].data), data)
  assert.ok(fs.wardrobeIndex.tombstones.tags[tagId])
})

test('renaming or deleting a merged tag affects every alias without losing either tagged outfit', () => {
  const left = applyWardrobeOperations(createWardrobeIndex(), [
    { type: 'put-tag', id: 'left-tag', name: 'Daily' },
    { type: 'put-outfit', id: 'left-outfit', changes: outfit('One', { tagIds: ['left-tag'] }) }
  ], { replicaId: 'left' })
  const right = applyWardrobeOperations(createWardrobeIndex(), [
    { type: 'put-tag', id: 'right-tag', name: 'Daily' },
    { type: 'put-outfit', id: 'right-outfit', changes: outfit('Two', { tagIds: ['right-tag'] }) }
  ], { replicaId: 'right' })
  const { fs } = setup({ cloud: mergeWardrobeIndexes(left, right) })
  assert.equal(fs.tags.length, 1)
  assert.deepEqual(Array.from(fs.tags[0].aliasIds).sort(), ['left-tag', 'right-tag'])
  fs.renameTag('right-tag', 'Travel')
  assert.equal(fs.tags.length, 1)
  assert.equal(fs.tags[0].name, 'Travel')
  assert.equal(fs.wardrobeIndex.tags['left-tag'].name, 'Travel')
  assert.equal(fs.wardrobeIndex.tags['right-tag'].name, 'Travel')
  fs.deleteTag('left-tag')
  assert.equal(fs.tags.length, 0)
  assert.deepEqual(Array.from(fs.outfits, item => item.id).sort(), ['left-outfit', 'right-outfit'])
  assert.ok(fs.wardrobeIndex.tombstones.tags['left-tag'])
  assert.ok(fs.wardrobeIndex.tombstones.tags['right-tag'])
})

test('outfit add, rename, content edit and delete keep one stable identity and independent cloud preference', () => {
  const { fs } = setup()
  const id = fs.addOutfit(outfit('Before', { id: 'untrusted-backup-id', cloudSync: false }))
  assert.notEqual(id, 'untrusted-backup-id')
  const firstRevision = plain(fs.outfits[0].rev)
  fs.updateOutfit(id, { name: 'Renamed', data: [part('New dress')] })
  assert.equal(fs.outfits.length, 1)
  assert.equal(fs.outfits[0].id, id)
  assert.equal(fs.outfits[0].name, 'Renamed')
  assert.deepEqual(plain(fs.outfits[0].data), [part('New dress')])
  assert.ok(fs.outfits[0].rev[0] > firstRevision[0])
  assert.equal(fs.outfits[0].cloudSync, false)
  fs.removeOutfit(id)
  assert.equal(fs.outfits.length, 0)
  assert.ok(fs.wardrobeIndex.tombstones.outfits[id])
})

test('locked preview follows an edited outfit and falls back safely when that outfit is deleted', () => {
  const { fs, renders } = setup()
  const id = fs.addOutfit(outfit('Before'))
  const previous = fs.outfits[0]
  fs.togglePreviewLock(previous)
  fs.updateOutfit(id, { name: 'After', data: [part('New dress')] })
  assert.notEqual(fs.lockedItem, previous)
  assert.equal(fs.lockedItem, fs.outfits[0])
  assert.equal(fs.activeItem.data, fs.outfits[0].data)
  assert.deepEqual(Array.from(fs.previewItem.data, item => item.Name), ['New dress'])
  assert.equal(fs.isPreviewLockedOn(previous), false)
  assert.equal(fs.isPreviewLockedOn(fs.outfits[0]), true)
  fs.removeOutfit(id)
  assert.equal(fs.lockedItem, null)
  assert.deepEqual(plain(fs.activeItem.data), plain(fs.characterItem))
  assert.notEqual(fs.activeItem.data, fs.characterItem)
  assert.deepEqual(Array.from(fs.previewItem.data, item => item.Name), ['Worn shirt'])
  assert.ok(renders.length >= 3)
})

test('a batch backup import saves once and assigns fresh identities instead of reviving tombstones', () => {
  const { fs, writes, hostWindow } = setup()
  const tag = fs.createTag('Daily')
  const oldId = fs.addOutfit(outfit('Restorable', { tagIds: [tag], cloudSync: false }))
  const keepId = fs.addOutfit(outfit('Second', { tagIds: [tag] }))
  const backup = fs.exportWardrobe()
  fs.removeOutfit(oldId)
  const repository = fs._repository
  const apply = repository.apply
  let applyCalls = 0
  repository.apply = function (operations) { applyCalls++; return apply.call(this, operations) }
  writes.length = 0
  assert.equal(fs.importWardrobe(backup).count, 2)
  assert.equal(applyCalls, 1)
  assert.equal(writes.filter(([key]) => key === 'VPWardrobe_index_42').length, 1)
  assert.equal(fs.outfits.length, 3)
  const restored = fs.outfits.find(item => item.name === 'Restorable')
  assert.notEqual(restored.id, oldId)
  assert.equal(restored.cloudSync, false)
  assert.ok(fs.wardrobeIndex.tombstones.outfits[oldId])
  assert.equal(fs.tags.length, 1)
  assert.equal(new Set(Array.from(fs.outfits, item => item.id)).size, 3)
  assert.ok(fs.outfits.some(item => item.id === keepId))
  const document = decodeWardrobePayload(hostWindow.localStorage.getItem('VPWardrobe_index_42'))
  assert.ok(document.index.outfits[restored.id])
})

test('export contains persisted records without thumbnail runtime state or shared mutable references', () => {
  const { fs } = setup()
  const id = fs.addOutfit(outfit('Dress'))
  const view = fs.outfits[0]
  view.thumbCanvas = { self: null }
  view.thumbCanvas.self = view.thumbCanvas
  view.isThumbGenerated = true
  view.__thumbRefresh = 12
  const backup = fs.exportWardrobe()
  assert.equal(backup.schemaVersion, 3)
  assert.equal(backup.children, undefined)
  assert.equal(backup.outfits[id].thumbCanvas, undefined)
  assert.equal(backup.outfits[id].isThumbGenerated, undefined)
  assert.equal(backup.outfits[id].__thumbRefresh, undefined)
  backup.outfits[id].data[0].Name = 'Backup changed'
  assert.equal(fs.outfits[0].data[0].Name, 'Dress')
})

test('a local write exception leaves the old UI record, locked preview and durable data intact', () => {
  const { fs, hostWindow } = setup()
  const id = fs.addOutfit(outfit('Saved'))
  fs.togglePreviewLock(fs.outfits[0])
  const previous = fs.outfits[0]
  const before = hostWindow.localStorage.getItem('VPWardrobe_index_42')
  hostWindow.localStorage.setItem = () => { throw new Error('Storage full') }
  assert.throws(() => fs.updateOutfit(id, { name: 'Not saved', data: [part('Not saved')] }), /Storage full/)
  assert.equal(fs.outfits[0], previous)
  assert.equal(fs.lockedItem, previous)
  assert.equal(fs.outfits[0].name, 'Saved')
  assert.deepEqual(Array.from(fs.previewItem.data, item => item.Name), ['Saved'])
  assert.equal(hostWindow.localStorage.getItem('VPWardrobe_index_42'), before)
  assert.equal(fs.syncStatus.state, 'error')
})

test('switching accounts through loadAll clears the old outfit lock, selection and history', () => {
  const { fs, hostWindow } = setup()
  const tagId = fs.createTag('Private tag')
  fs.selectTag(tagId)
  fs.addOutfit(outfit('First account dress'))
  fs.togglePreviewLock(fs.outfits[0])
  fs.history.addRecord([part('First account history')])
  fs.saveHistory()
  hostWindow.Player = { MemberNumber: 43, ExtensionSettings: {} }
  assert.equal(fs.loadAll(), true)
  assert.equal(fs.lockedItem, null)
  assert.equal(fs.selectedTagId, null)
  assert.equal(fs.history.getAllRecords().length, 0)
  assert.equal(fs.outfits.length, 0)
  assert.deepEqual(plain(fs.activeItem.data), [])
  assert.equal(fs.previewItem.data.some(item => item.Name === 'First account dress'), false)
})

test('an account change detected during an action rejects that action and clears old account context', () => {
  const { fs, hostWindow } = setup()
  fs.addOutfit(outfit('Old account dress'))
  fs.togglePreviewLock(fs.outfits[0])
  fs.history.addRecord([part('Old account history')])
  hostWindow.Player = { MemberNumber: 43, ExtensionSettings: {} }
  assert.throws(() => fs.createTag('Old action'), /Account changed/)
  assert.equal(fs.lockedItem, null)
  assert.equal(fs.outfits.length, 0)
  assert.equal(fs.tags.length, 0)
  assert.equal(fs.history.getAllRecords().length, 0)
  assert.equal(fs.previewItem.data.some(item => item.Name === 'Old account dress'), false)
})

test('an old account lock cannot upload after Player switches accounts without a login callback', () => {
  const { fs, hostWindow } = setup()
  const sent = []
  hostWindow.ServerSend = (event, fields) => sent.push([event, fields])
  hostWindow.Player = { MemberNumber: 43, ExtensionSettings: {} }
  assert.throws(() => fs.createTag('Account change'), /Account changed/)
  assert.equal(fs.receiveCloud({ extensionSettings: {}, memberNumber: 43 }), true)
  fs.addOutfit(outfit('New account draft'))
  assert.equal(fs.syncNow(), false)
  assert.equal(sent.length, 0)
  assert.equal(fs.outfits.length, 1)
})

test('a selected tag follows the canonical alias when a same-name remote tag sorts before it', () => {
  const local = applyWardrobeOperations(createWardrobeIndex(), [
    { type: 'put-tag', id: 'z-local', name: 'Daily' },
    { type: 'put-outfit', id: 'tagged', changes: outfit('Tagged', { tagIds: ['z-local'] }) },
    { type: 'put-outfit', id: 'other', changes: outfit('Other') }
  ], { replicaId: 'local' })
  const remote = applyWardrobeOperations(createWardrobeIndex(), [
    { type: 'put-tag', id: 'a-remote', name: 'Daily' }
  ], { replicaId: 'remote' })
  const { fs } = setup({ cloud: local })
  fs.selectTag('z-local')
  assert.equal(fs.receiveCloud({ extensionSettings: { VPWardrobe: JSON.stringify(remote) }, memberNumber: 42 }), true)
  assert.equal(fs.tags.length, 1)
  assert.equal(fs.tags[0].id, 'a-remote')
  assert.equal(fs.selectedTagId, 'a-remote')
  const selected = fs.tags.find(tag => tag.id === fs.selectedTagId)
  assert.deepEqual(Array.from(selected.aliasIds), ['a-remote', 'z-local'])
  const matching = fs.outfits.filter(item => item.tagIds.some(id => selected.aliasIds.includes(id)))
  assert.deepEqual(Array.from(matching, item => item.id), ['tagged'])
})

test('a deterministic same-revision winner refreshes the list and locked preview while unchanged views retain runtime state', () => {
  const local = applyWardrobeOperations(createWardrobeIndex(), [
    { type: 'put-outfit', id: 'tied', changes: outfit('Before') },
    { type: 'put-outfit', id: 'untouched', changes: outfit('Untouched') }
  ], { replicaId: 'same-replica' })
  const remote = plain(local)
  remote.outfits.tied.name = 'Z winner'
  remote.outfits.tied.data = [part('Z winner')]
  const { fs } = setup({ cloud: local })
  const previous = fs.outfits.find(item => item.id === 'tied')
  const untouched = fs.outfits.find(item => item.id === 'untouched')
  untouched.thumbCanvas = { self: null }
  untouched.thumbCanvas.self = untouched.thumbCanvas
  fs.togglePreviewLock(previous)
  assert.equal(fs.receiveCloud({ extensionSettings: { VPWardrobe: JSON.stringify(remote) }, memberNumber: 42 }), true)
  assert.equal(fs.wardrobeIndex.outfits.tied.name, 'Z winner')
  const winner = fs.outfits.find(item => item.id === 'tied')
  assert.notEqual(winner, previous)
  assert.deepEqual(plain(winner.rev), plain(previous.rev))
  assert.equal(winner.name, 'Z winner')
  assert.deepEqual(plain(winner.data), [part('Z winner')])
  assert.equal(fs.lockedItem, winner)
  assert.equal(fs.activeItem.data, winner.data)
  assert.deepEqual(Array.from(fs.previewItem.data, item => item.Name), ['Z winner'])
  assert.equal(fs.outfits.find(item => item.id === 'untouched'), untouched)
  assert.equal(untouched.thumbCanvas.self, untouched.thumbCanvas)
})
