import assert from 'node:assert/strict'
import { test } from 'node:test'
import LZString from 'lz-string'
import { WardrobeRepository, decodeWardrobePayload } from '../src/services/WardrobeRepository.js'
import { applyWardrobeOperations, createWardrobeIndex, projectWardrobeCloudIndex } from '../src/services/wardrobe-index.js'

const copy = (value) => JSON.parse(JSON.stringify(value))
const encode = (value) => LZString.compressToBase64(JSON.stringify(value))
const put = (id, name = id, changes = {}) => ({ type: 'put-outfit', id, changes: { name, data: [{ Group: 'Cloth', Name: 'Shirt' }], ...changes } })
const names = (index) => Object.values(index.outfits).map((item) => item.name).sort()
const cloudIndex = (server) => decodeWardrobePayload(server.settings.VPWardrobe)

/** Independent device storage and game memory; only successful sends touch the server. */
function client(server = { settings: {} }, { saved = new Map(), member = 42, replicaId = 'device-a' } = {}) {
  let player = { MemberNumber: member, ExtensionSettings: copy(server.settings) }
  let connected = true
  let localFailure = null
  let sendFailure = null
  let sendCount = 0
  let timerId = 0
  const timers = new Map()
  const notifications = []
  const localStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem(key, value) {
      if (localFailure === 'throw') throw new Error('Local storage is full')
      if (localFailure === 'false') return false
      saved.set(key, value)
    },
  }
  const repo = new WardrobeRepository({
    getPlayer: () => player,
    localStorage,
    replicaId,
    isOnline: () => connected,
    send() {
      sendCount++
      if (sendFailure === 'throw') throw new Error('Disconnected while submitting')
      if (sendFailure === 'false') return false
      server.settings.VPWardrobe = player.ExtensionSettings.VPWardrobe
      // The game transport supplies no server acknowledgment.
      return undefined
    },
    onChange: (state) => notifications.push(state),
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId },
    clearTimeout: (id) => timers.delete(id),
  })
  return {
    repo, server, saved, timers, notifications,
    player: () => player,
    sendCount: () => sendCount,
    setOnline: (value) => { connected = value },
    failLocal: (value) => { localFailure = value },
    failSend: (value) => { sendFailure = value },
    switchAccount: (memberNumber, settings = {}) => { player = { MemberNumber: memberNumber, ExtensionSettings: copy(settings) } },
    login: () => repo.receiveCloud({ memberNumber: player.MemberNumber, extensionSettings: copy(server.settings), fresh: true }),
    runNextTimer() {
      const first = timers.entries().next().value
      assert.ok(first, 'Expected a scheduled sync attempt')
      const [id, timer] = first
      timers.delete(id)
      timer.callback()
      return timer.delay
    },
    document: () => decodeWardrobePayload(saved.get(repo.key)),
  }
}

function seed(server = { settings: {} }) {
  const device = client(server)
  assert.equal(device.repo.open(), true)
  device.repo.apply([put('outfit-1', 'Original'), put('outfit-2', 'Keep me')])
  assert.equal(device.repo.flush(), true)
  return device
}

test('deletion survives a stale second device login and subsequent save', () => {
  const a = seed()
  const b = client(a.server, { replicaId: 'device-b' })
  assert.equal(b.repo.open(), true)
  const stalePlayerPayload = b.player().ExtensionSettings.VPWardrobe
  a.repo.apply([{ type: 'delete-outfit', id: 'outfit-1' }])
  assert.equal(a.repo.flush(), true)

  assert.equal(b.login(), true)
  assert.equal(b.player().ExtensionSettings.VPWardrobe, stalePlayerPayload, 'Relog does not refresh the game Player object')
  assert.deepEqual(names(b.repo.index), ['Keep me'])
  b.repo.apply([put('outfit-3', 'New from B')])
  assert.equal(b.repo.flush(), true)
  assert.deepEqual(names(cloudIndex(a.server)), ['Keep me', 'New from B'])
  assert.ok(cloudIndex(a.server).tombstones.outfits['outfit-1'])
})

test('rename keeps the same ID and wins over an older device cache after relog', () => {
  const a = seed()
  const b = client(a.server, { replicaId: 'device-b' })
  b.repo.open()
  a.repo.apply([{ type: 'put-outfit', id: 'outfit-1', changes: { name: 'Renamed' } }])
  a.repo.flush()

  assert.equal(b.login(), true)
  assert.equal(b.repo.index.outfits['outfit-1'].name, 'Renamed')
  b.repo.apply([put('outfit-3')])
  b.repo.flush()
  assert.equal(cloudIndex(a.server).outfits['outfit-1'].name, 'Renamed')
  assert.equal(Object.values(cloudIndex(a.server).outfits).filter((item) => item.name === 'Original').length, 0)
  assert.equal(Object.keys(cloudIndex(a.server).outfits).length, 3)
})

test('different IDs with the same name remain separate outfits and survive reload', () => {
  const device = client()
  device.repo.open()
  device.repo.apply([put('one', 'Same name'), put('two', 'Same name'), put('three', 'Same name')])
  device.repo.flush()
  const reloaded = client(device.server, { saved: device.saved, replicaId: 'same-device-reload' })
  assert.equal(reloaded.repo.open(), true)
  assert.deepEqual(Object.keys(reloaded.repo.index.outfits).sort(), ['one', 'three', 'two'])
  reloaded.repo.apply([{ type: 'put-outfit', id: 'two', changes: { name: 'Only this one' } }])
  assert.deepEqual(names(reloaded.repo.index), ['Only this one', 'Same name', 'Same name'])
})

test('shared quota blocks cloud but keeps the full local document, then remeasures other plugins', () => {
  const device = client({ settings: { Other: 'x'.repeat(179900), VPWardrobe: encode(createWardrobeIndex()) } })
  assert.equal(device.repo.open(), true)
  device.repo.apply([put('one')])
  assert.equal(device.repo.flush(), false)
  assert.equal(device.repo.status.state, 'quota')
  assert.equal(device.sendCount(), 0)
  assert.equal(device.document().index.outfits.one.name, 'one')
  assert.equal(device.document().pending, true)
  assert.ok(device.repo.quota.otherExtensionsBytes > 179900)

  device.player().ExtensionSettings.Other = 'small now'
  assert.equal(device.repo.flush(), true)
  assert.equal(device.repo.status.state, 'submitted')
  assert.equal(device.sendCount(), 1)
  assert.equal(device.player().ExtensionSettings.Other, 'small now')
  assert.ok(device.repo.quota.totalBytes < 180000)
})

test('offline edits stay durable and pending, and submit once connection resumes', () => {
  const device = client()
  device.repo.open()
  device.setOnline(false)
  device.repo.apply([put('offline')])
  assert.equal(device.repo.flush(), false)
  assert.equal(device.repo.status.state, 'offline')
  assert.equal(device.document().pending, true)
  assert.ok(device.document().index.outfits.offline)
  assert.equal(device.sendCount(), 0)
  device.setOnline(true)
  device.repo.queue(0)
  device.runNextTimer()
  assert.equal(device.sendCount(), 1)
  assert.equal(device.repo.status.state, 'submitted')
  assert.equal(device.document().pending, true, 'Submission must not invent a server acknowledgment')
})

for (const failure of ['false', 'throw']) {
  for (const hadValue of [false, true]) {
    test(`send ${failure} restores the ${hadValue ? 'previous' : 'absent'} Player value and leaves durable work pending`, () => {
      const server = { settings: hadValue ? { VPWardrobe: encode(createWardrobeIndex()), Other: 'untouched' } : { Other: 'untouched' } }
      const device = client(server)
      device.repo.open()
      device.repo.apply([put('pending')])
      const previous = copy(device.player().ExtensionSettings)
      device.failSend(failure)
      assert.equal(device.repo.flush(), false)
      assert.equal(device.repo.status.state, 'error')
      assert.deepEqual(device.player().ExtensionSettings, previous)
      assert.equal(device.document().pending, true)
      assert.ok(device.document().index.outfits.pending)
      device.failSend(null)
      assert.equal(device.repo.flush(), true)
      assert.ok(cloudIndex(server).outfits.pending)
    })
  }
}

for (const failure of ['false', 'throw']) {
  test(`local write ${failure} prevents any cloud send`, () => {
    const device = seed()
    const beforeSends = device.sendCount()
    const beforeCloud = device.server.settings.VPWardrobe
    const beforeDocument = device.saved.get(device.repo.key)
    device.failLocal(failure)
    assert.throws(() => device.repo.apply([put('not-durable')]))
    assert.equal(device.repo.flush(), false)
    assert.equal(device.sendCount(), beforeSends)
    assert.equal(device.server.settings.VPWardrobe, beforeCloud)
    assert.equal(device.saved.get(device.repo.key), beforeDocument)
    assert.equal(device.repo.index.outfits['not-durable'], undefined)
  })
}

test('switching accounts cancels the old edit instead of writing old clothes into the new account', () => {
  const device = seed()
  const oldDocument = device.saved.get('VPWardrobe_index_42')
  const beforeSends = device.sendCount()
  device.switchAccount(84)
  assert.throws(() => device.repo.apply([{ type: 'put-outfit', id: 'outfit-1', changes: { name: 'Wrong account edit' } }]), /Account changed/)
  assert.equal(device.repo.member, '84')
  assert.deepEqual(names(device.repo.index), [])
  assert.equal(device.saved.get('VPWardrobe_index_42'), oldDocument)
  assert.equal(device.sendCount(), beforeSends)
  device.repo.apply([put('account-84', 'New account outfit')])
  device.repo.flush()
  assert.deepEqual(names(cloudIndex(device.server)), ['New account outfit'])
  assert.deepEqual(names(decodeWardrobePayload(device.saved.get('VPWardrobe_index_42')).index), ['Keep me', 'Original'])
})

test('a late login response for another account is ignored', () => {
  const device = seed()
  const before = copy(device.repo.index)
  assert.equal(device.repo.receiveCloud({ memberNumber: 999, extensionSettings: { VPWardrobe: encode(createWardrobeIndex()) }, fresh: true }), false)
  assert.deepEqual(device.repo.index, before)
})

test('migration prefers the React local key, backs up old sources, and never reimports them after indexing', () => {
  const tree = (name) => ({ name: 'Home', type: 'folder', children: [{ name, type: 'outfit', data: [{ Group: 'Cloth', Name: 'Shirt' }] }] })
  const saved = new Map([
    ['VPWardrobe_VPWardrobe_local_42', encode(tree('Current React local'))],
    ['VPWardrobe_42', encode(tree('Old buggy local'))],
  ])
  const server = { settings: { VPWardrobe: encode(tree('Stale cloud tree')) } }
  const device = client(server, { saved })
  assert.equal(device.repo.open(), true)
  assert.deepEqual(names(device.repo.index), ['Current React local'])
  const backups = device.repo.exportRecovery()
  assert.ok(backups.length > 0)
  assert.match(JSON.stringify(backups), /Current React local/)
  assert.match(JSON.stringify(backups), /Old buggy local/)
  assert.match(JSON.stringify(backups), /Stale cloud tree/)
  assert.equal(backups[0].data.local.find((source) => source.key === 'VPWardrobe_VPWardrobe_local_42').raw,
    saved.get('VPWardrobe_VPWardrobe_local_42'))
  assert.equal(backups[0].data.onlineRaw, server.settings.VPWardrobe)
  const id = Object.keys(device.repo.index.outfits)[0]
  device.repo.apply([{ type: 'delete-outfit', id }])
  device.repo.flush()

  // A legacy client overwrites cloud with an unversioned tree after migration.
  server.settings.VPWardrobe = encode(tree('Stale cloud tree'))
  const reopened = client(server, { saved })
  assert.equal(reopened.repo.open(), true)
  assert.deepEqual(names(reopened.repo.index), [])
  assert.ok(reopened.repo.index.tombstones.outfits[id])
  assert.match(JSON.stringify(reopened.repo.exportRecovery()), /Stale cloud tree/)
  assert.ok(reopened.repo.exportRecovery().some((backup) => backup.data.onlineRaw === server.settings.VPWardrobe))
  assert.ok(saved.has('VPWardrobe_VPWardrobe_local_42'), 'Migration keeps the original backup source')
})

test('an indexed cloud replica suppresses stale local-tree import on a new indexed device', () => {
  const a = seed()
  a.repo.apply([{ type: 'delete-outfit', id: 'outfit-1' }])
  a.repo.flush()
  const saved = new Map([['VPWardrobe_VPWardrobe_local_42', encode({ name: 'Home', type: 'folder', children: [{ name: 'Original', type: 'outfit', data: [] }] })]])
  const device = client(a.server, { saved, replicaId: 'new-device' })
  assert.equal(device.repo.open(), true)
  assert.deepEqual(names(device.repo.index), ['Keep me'])
  assert.ok(device.repo.index.tombstones.outfits['outfit-1'])
  assert.ok(device.repo.exportRecovery().length > 0)
})

test('damaged cloud keeps the durable local wardrobe and blocks automatic overwrite', () => {
  const device = seed()
  const before = copy(device.repo.index)
  const beforeSends = device.sendCount()
  const corrupt = '{this is not valid wardrobe data'
  device.server.settings.VPWardrobe = corrupt
  assert.equal(device.login(), false)
  assert.equal(device.repo.status.state, 'error')
  assert.deepEqual(device.repo.index, before)
  assert.equal(device.repo.flush(), false)
  assert.equal(device.sendCount(), beforeSends)
  assert.equal(device.server.settings.VPWardrobe, corrupt)
  assert.deepEqual(device.document().index, before)
})

test('only a fresh matching server response verifies a submission', () => {
  const device = seed()
  assert.equal(device.repo.status.state, 'submitted')
  assert.equal(device.repo.status.lastVerifiedAt, null)
  assert.equal(device.document().pending, true)
  assert.equal(device.repo.receiveCloud({ extensionSettings: copy(device.player().ExtensionSettings), fresh: false }), true)
  assert.notEqual(device.repo.status.state, 'verified')
  assert.equal(device.document().pending, true)
  assert.equal(device.login(), true)
  assert.equal(device.repo.status.state, 'verified')
  assert.ok(device.repo.status.lastVerifiedAt > 0)
  assert.equal(device.document().pending, false)
})

test('a verified relog stays verified when Player still contains the older cloud value', () => {
  const a = seed()
  const b = client(a.server, { replicaId: 'device-b' })
  b.repo.open()
  a.repo.apply([{ type: 'put-outfit', id: 'outfit-1', changes: { name: 'New from A' } }])
  a.repo.flush()
  b.login()
  assert.equal(b.repo.status.state, 'verified')
  assert.equal(b.repo.flush(), true)
  assert.equal(b.repo.status.state, 'verified')
  assert.equal(b.sendCount(), 0)
})

test('shared quota uses newly received server settings even when relog leaves Player stale', () => {
  const device = seed({ settings: { Other: 'small old value' } })
  device.server.settings.Other = 'x'.repeat(179900)
  device.login()
  const beforeSends = device.sendCount()
  device.repo.apply([put('new-after-relog')])
  assert.equal(device.repo.flush(), false)
  assert.equal(device.repo.status.state, 'quota')
  assert.equal(device.sendCount(), beforeSends)
  assert.ok(device.repo.quota.otherExtensionsBytes > 179900)
  assert.equal(device.player().ExtensionSettings.Other, 'small old value', 'VPW must not rewrite another extension while reading its server budget')
})

test('corrupted indexed local storage is retained and blocks fallback uploads', () => {
  const device = seed()
  const corrupt = 'corrupted local index'
  device.saved.set('VPWardrobe_index_42', corrupt)
  const reopened = client(device.server, { saved: device.saved })
  assert.equal(reopened.repo.open(), false)
  assert.equal(reopened.repo.status.localSaved, false)
  assert.equal(reopened.repo.flush(), false)
  assert.equal(reopened.sendCount(), 0)
  assert.equal(reopened.saved.get('VPWardrobe_index_42'), corrupt)
})

test('unchanged submitted data does not flood the unacknowledged transport', () => {
  const device = seed()
  const count = device.sendCount()
  const projection = projectWardrobeCloudIndex(device.repo.index)
  assert.equal(device.repo.flush(), true)
  assert.equal(device.repo.flush(), true)
  assert.equal(device.sendCount(), count)
  assert.equal(device.document().pending, true)
  assert.deepEqual(cloudIndex(device.server), projection)
})

test('a fresh server response missing an earlier submission triggers resubmission of the same durable payload', () => {
  const device = seed()
  const previousPayload = device.server.settings.VPWardrobe
  const count = device.sendCount()
  // A queued send can be lost without an acknowledgment; a later login is the
  // first evidence that it did not reach durable server storage.
  device.server.settings.VPWardrobe = encode(createWardrobeIndex())
  assert.equal(device.login(), true)
  assert.equal(device.repo.status.state, 'pending')
  assert.equal(device.repo.flush(), true)
  assert.equal(device.sendCount(), count + 1)
  assert.equal(device.server.settings.VPWardrobe, previousPayload)
  assert.equal(device.document().pending, true)
})

test('local-only outfit content stays private across submission and another device login', () => {
  const a = seed()
  const b = client(a.server, { replicaId: 'device-b' })
  b.repo.open()
  a.repo.apply([{ type: 'set-cloud', id: 'outfit-1', enabled: false }])
  assert.equal(a.repo.flush(), true)
  assert.ok(a.repo.index.outfits['outfit-1'])
  assert.equal(cloudIndex(a.server).outfits['outfit-1'], undefined)
  assert.equal(cloudIndex(a.server).cloudState['outfit-1'].enabled, false)
  b.login()
  b.repo.apply([put('other')])
  b.repo.flush()
  assert.equal(cloudIndex(a.server).outfits['outfit-1'], undefined)
  const newcomer = client(a.server, { replicaId: 'device-c' })
  newcomer.repo.open()
  assert.equal(newcomer.repo.index.outfits['outfit-1'], undefined)
})

test('two devices keep private edits local when the first device re-enables cloud', () => {
  const a = seed()
  a.repo.apply([
    { type: 'put-tag', id: 'tag-a', name: '日常' },
    { type: 'put-outfit', id: 'outfit-1', changes: { tagIds: ['tag-a'] } },
  ])
  a.repo.flush()
  const b = client(a.server, { replicaId: 'device-b' })
  b.repo.open()

  a.repo.apply([{ type: 'set-cloud', id: 'outfit-1', enabled: false }])
  a.repo.flush()
  b.login()
  b.repo.apply([{ type: 'put-outfit', id: 'outfit-1', changes: { data: [{ Group: 'Cloth', Name: 'PrivateDress' }] } }])
  b.repo.flush()
  assert.equal(cloudIndex(a.server).outfits['outfit-1'], undefined)

  a.repo.apply([{ type: 'set-cloud', id: 'outfit-1', enabled: true }])
  a.repo.flush()
  b.login()
  const fork = Object.values(b.repo.index.outfits).find(record => record.vpwLocalFork?.sourceId === 'outfit-1')
  assert.ok(fork)
  assert.equal(fork.name, 'Original')
  assert.deepEqual(fork.tagIds, ['tag-a'])
  assert.equal(fork.data[0].Name, 'PrivateDress')
  assert.equal(b.repo.index.cloudState[fork.id].enabled, false)
  assert.equal(b.repo.index.outfits['outfit-1'].data[0].Name, 'Shirt')
  assert.equal(b.login(), true)
  assert.equal(Object.values(b.repo.index.outfits).filter(record => record.vpwLocalFork?.sourceId === 'outfit-1').length, 1)

  b.repo.apply([put('unrelated')])
  b.repo.flush()
  const cloud = cloudIndex(a.server)
  assert.equal(cloud.outfits['outfit-1'].data[0].Name, 'Shirt')
  assert.equal(cloud.outfits[fork.id], undefined)
  assert.equal(cloud.cloudState[fork.id], undefined)
  assert.equal(JSON.stringify(cloud).includes('PrivateDress'), false)
  assert.equal(b.document().index.outfits[fork.id].data[0].Name, 'PrivateDress')
})

test('an edit observes a newer host cloud revision before allocating its own revision', () => {
  const device = seed()
  let latest = cloudIndex(device.server)
  for (let step = 0; step < 10; step++) {
    latest = applyWardrobeOperations(latest, [{ type: 'put-outfit', id: 'outfit-1', changes: { name: `Remote ${step}` } }], { replicaId: 'other-device' })
  }
  device.server.settings.VPWardrobe = encode(latest)
  device.player().ExtensionSettings.VPWardrobe = encode(latest)
  device.repo.apply([{ type: 'put-outfit', id: 'outfit-1', changes: { name: 'My subsequent edit' } }])
  assert.ok(device.repo.index.outfits['outfit-1'].rev[0] > latest.clock)
  assert.equal(device.repo.flush(), true)
  assert.equal(cloudIndex(device.server).outfits['outfit-1'].name, 'My subsequent edit')
})

test('another tab sharing local storage preserves newer private content when making an unrelated edit', () => {
  const a = seed()
  const b = client(a.server, { saved: a.saved, replicaId: 'other-tab' })
  b.repo.open()
  a.repo.apply([
    { type: 'set-cloud', id: 'outfit-1', enabled: false },
    { type: 'put-outfit', id: 'outfit-1', changes: { name: 'Private revision from A', data: [{ Group: 'Cloth', Name: 'PrivateShirt' }] } },
  ])
  a.repo.flush()
  b.repo.apply([put('unrelated')])
  assert.equal(b.repo.index.outfits['outfit-1'].name, 'Private revision from A')
  assert.equal(b.document().index.outfits['outfit-1'].data[0].Name, 'PrivateShirt')
  b.repo.flush()
  assert.equal(cloudIndex(a.server).outfits['outfit-1'], undefined)
  const reloaded = client(a.server, { saved: a.saved })
  reloaded.repo.open()
  assert.equal(reloaded.repo.index.outfits['outfit-1'].name, 'Private revision from A')
})

test('first indexed cloud load cannot import content whose cloud state says private', () => {
  const fullLocal = applyWardrobeOperations(createWardrobeIndex(), [
    put('private', 'Private content'), put('public', 'Public content'),
    { type: 'set-cloud', id: 'private', enabled: false },
  ], { replicaId: 'older-client' })
  // A broken/older client uploaded its full local index instead of the cloud projection.
  const device = client({ settings: { VPWardrobe: encode(fullLocal) } })
  assert.equal(device.repo.open(), true)
  assert.equal(device.repo.index.outfits.private, undefined)
  assert.equal(device.document().index.outfits.private, undefined)
  assert.equal(device.repo.index.cloudState.private.enabled, false)
  assert.equal(device.repo.index.outfits.public.name, 'Public content')
})

test('a failed send is retried from durable state with a bounded scheduled delay', () => {
  const device = client()
  device.repo.open()
  device.repo.apply([put('retry')])
  device.failSend('throw')
  assert.equal(device.repo.flush(), false)
  assert.ok(device.timers.size > 0, 'A failed online submission schedules retry')
  const timer = Array.from(device.timers.values())[0]
  assert.ok(timer.delay > 0 && timer.delay <= 60000)
  device.failSend(null)
  device.runNextTimer()
  assert.ok(cloudIndex(device.server).outfits.retry)
  assert.equal(device.repo.status.state, 'submitted')
})

for (const raw of ['false', '0', '""']) {
  test(`a JSON primitive cloud payload (${raw}) is an error, never an empty remote wardrobe`, () => {
    const device = client({ settings: { VPWardrobe: raw } })
    assert.equal(device.repo.open(), true, 'The empty local document can still be saved')
    assert.equal(device.repo.status.localSaved, true)
    assert.equal(device.repo.status.state, 'error')
    assert.equal(device.timers.size, 0)
    assert.equal(device.repo.flush(), false)
    assert.equal(device.sendCount(), 0)
    assert.equal(device.server.settings.VPWardrobe, raw)
    assert.equal(device.timers.size, 0)
  })
}

test('open while logged out returns an error state without throwing or writing', () => {
  const device = client()
  device.switchAccount(undefined)
  let opened
  assert.doesNotThrow(() => { opened = device.repo.open() })
  assert.equal(opened, false)
  assert.equal(device.repo.status.state, 'error')
  assert.equal(device.repo.status.localSaved, false)
  assert.equal(device.saved.size, 0)
  assert.equal(device.sendCount(), 0)
  assert.equal(device.timers.size, 0)
})

test('apply retains a successful local edit when later shared-quota measurement fails', () => {
  const device = seed()
  const cyclic = {}
  cyclic.self = cyclic
  device.player().ExtensionSettings.Other = cyclic
  let result
  assert.doesNotThrow(() => { result = device.repo.apply([put('saved-despite-quota-error')]) })
  assert.ok(result.outfits['saved-despite-quota-error'])
  assert.ok(device.repo.index.outfits['saved-despite-quota-error'])
  assert.ok(device.document().index.outfits['saved-despite-quota-error'])
  assert.equal(device.repo.status.localSaved, true)
  assert.equal(device.repo.status.state, 'error')
  assert.equal(device.timers.size, 0)
  const beforeSends = device.sendCount()
  assert.equal(device.repo.flush(), false)
  assert.equal(device.sendCount(), beforeSends)
  device.player().ExtensionSettings.Other = 'repaired'
  assert.equal(device.repo.flush(), true)
  assert.ok(cloudIndex(device.server).outfits['saved-despite-quota-error'])
})

test('open reports local success when loading succeeds but subsequent quota measurement fails', () => {
  const a = seed()
  const device = client(a.server)
  const cyclic = {}
  cyclic.self = cyclic
  device.player().ExtensionSettings.Other = cyclic
  assert.equal(device.repo.open(), true)
  assert.equal(device.repo.status.localSaved, true)
  assert.equal(device.repo.status.state, 'error')
  assert.deepEqual(names(device.repo.index), ['Keep me', 'Original'])
  assert.deepEqual(names(device.document().index), ['Keep me', 'Original'])
  assert.equal(device.timers.size, 0)
  assert.equal(device.repo.flush(), false)
  device.player().ExtensionSettings.Other = 'repaired'
  assert.equal(device.repo.flush(), false, 'A repaired quota cannot turn the stale Player cache into fresh server proof')
  assert.equal(device.sendCount(), 0)
  assert.equal(device.login(), true)
  assert.equal(device.repo.flush(), true)
  assert.deepEqual(names(cloudIndex(device.server)), ['Keep me', 'Original'])
})

test('receiveCloud retains newly saved remote changes when subsequent quota measurement fails', () => {
  const a = seed()
  const b = client(a.server, { replicaId: 'device-b' })
  b.repo.open()
  a.repo.apply([{ type: 'put-outfit', id: 'outfit-1', changes: { name: 'Fresh rename' } }])
  a.repo.flush()
  const cyclic = {}
  cyclic.self = cyclic
  const settings = { ...a.server.settings, Other: cyclic }
  assert.equal(b.repo.receiveCloud({ memberNumber: 42, extensionSettings: settings, fresh: true }), true)
  assert.equal(b.repo.status.localSaved, true)
  assert.equal(b.repo.status.state, 'error')
  assert.equal(b.repo.index.outfits['outfit-1'].name, 'Fresh rename')
  assert.equal(b.document().index.outfits['outfit-1'].name, 'Fresh rename')
  assert.equal(b.timers.size, 0)
  assert.equal(b.repo.flush(), false)
  b.player().ExtensionSettings.Other = 'repaired'
  assert.equal(b.repo.flush(), true)
  assert.equal(cloudIndex(a.server).outfits['outfit-1'].name, 'Fresh rename')
})

test('transport retry stops after five growing automatic delays instead of retrying forever', () => {
  const device = client()
  device.repo.open()
  device.repo.apply([put('retry-limit')])
  device.failSend('throw')
  assert.equal(device.repo.flush(), false)
  const delays = []
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal(device.timers.size, 1)
    const delay = device.runNextTimer()
    const base = 1000 * 2 ** attempt
    assert.ok(delay >= base * 0.8 && delay <= base * 1.2, `Retry ${attempt + 1} is within its jitter range`)
    assert.ok(delay <= 60000)
    delays.push(delay)
  }
  assert.equal(device.timers.size, 0)
  assert.equal(device.sendCount(), 6, 'One initial attempt plus five automatic retries')
  assert.ok(delays.every((delay, index) => index === 0 || delay > delays[index - 1]))
  assert.equal(device.document().pending, true)
  assert.equal(device.repo.status.state, 'error')
})

test('quota, local storage, and decode failures do not schedule automatic transport retries', () => {
  const quota = client({ settings: { Other: 'x'.repeat(180000) } })
  quota.repo.open()
  quota.repo.apply([put('quota')])
  assert.equal(quota.repo.flush(), false)
  assert.equal(quota.timers.size, 0)

  const local = client()
  local.repo.open()
  local.failLocal('throw')
  assert.throws(() => local.repo.apply([put('local')]))
  assert.equal(local.repo.flush(), false)
  assert.equal(local.timers.size, 0)

  const decode = seed()
  decode.server.settings.VPWardrobe = 'corrupt cloud'
  assert.equal(decode.login(), false)
  assert.equal(decode.repo.flush(), false)
  assert.equal(decode.timers.size, 0)
})

test('after a local write failure, retry saves the pending fresh cloud rename before sending anything', () => {
  const a = seed()
  const b = client(a.server, { replicaId: 'device-b' })
  b.repo.open()
  a.repo.apply([{ type: 'put-outfit', id: 'outfit-1', changes: { name: 'Fresh name that must survive' } }])
  a.repo.flush()
  b.failLocal('throw')
  assert.equal(b.login(), false)
  assert.equal(b.repo.index.outfits['outfit-1'].name, 'Original', 'UI rolls back to its durable local state')
  assert.equal(b.document().index.outfits['outfit-1'].name, 'Original')
  assert.equal(b.sendCount(), 0)
  assert.equal(b.timers.size, 0)
  b.failLocal(null)
  assert.equal(b.repo.flush(), true)
  assert.equal(b.repo.index.outfits['outfit-1'].name, 'Fresh name that must survive')
  assert.equal(b.document().index.outfits['outfit-1'].name, 'Fresh name that must survive')
  assert.equal(cloudIndex(a.server).outfits['outfit-1'].name, 'Fresh name that must survive')
})
