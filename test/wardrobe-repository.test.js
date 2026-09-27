import assert from 'node:assert/strict'
import { test } from 'node:test'
import LZString from 'lz-string'
import { WardrobeRepository, decodeWardrobePayload } from '../src/services/WardrobeRepository.js'
import { applyWardrobeOperations, createWardrobeIndex, projectWardrobeCloudIndex } from '../src/services/wardrobe-index.js'
import { decodeWardrobeSyncMarker } from '../src/services/wardrobe-sync-marker.js'

const copy = (value) => JSON.parse(JSON.stringify(value))
const encode = (value) => LZString.compressToBase64(JSON.stringify(value))
const put = (id, name = id, changes = {}) => ({ type: 'put-outfit', id, changes: { name, data: [{ Group: 'Cloth', Name: 'Shirt' }], ...changes } })
const names = (index) => Object.values(index.outfits).map((item) => item.name).sort()
const cloudEnvelope = (server) => decodeWardrobePayload(server.settings.VPWardrobe)
const cloudIndex = (server) => cloudEnvelope(server)?.index ?? cloudEnvelope(server)
const markerFor = (server, device) => decodeWardrobeSyncMarker(server.settings[device.repo.markerKey])

/** Independent device storage and game memory; only successful sends touch the server. */
function client(server = { settings: {} }, { saved = new Map(), member = 42, replicaId = 'device-a' } = {}) {
  const deviceKey = `VPW4_device_${member}`
  if (!saved.has(deviceKey)) saved.set(deviceKey,
    Buffer.from(replicaId).toString('hex').padEnd(32, '0').slice(0, 32))
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
      if (localFailure === 'quota') throw Object.assign(new Error('Storage quota exceeded'), { name: 'QuotaExceededError' })
      if (localFailure === 'false') return false
      saved.set(key, value)
    },
  }
  const repo = new WardrobeRepository({
    getPlayer: () => player,
    localStorage,
    replicaId,
    isOnline: () => connected,
    send(fields) {
      sendCount++
      if (sendFailure === 'throw') throw new Error('Disconnected while submitting')
      if (sendFailure === 'false') return false
      for (const [path, value] of Object.entries(fields)) {
        assert.match(path, /^ExtensionSettings\.(VPWardrobe|VPW4_M_[0-9a-f]{32})$/)
        server.settings[path.slice('ExtensionSettings.'.length)] = value
      }
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
    async runNextTimer() {
      const first = timers.entries().next().value
      assert.ok(first, 'Expected a scheduled sync attempt')
      const [id, timer] = first
      timers.delete(id)
      await timer.callback()
      return timer.delay
    },
    document: () => decodeWardrobePayload(saved.get(repo.key)),
  }
}

async function seed(server = { settings: {} }) {
  const device = client(server)
  assert.equal(await device.repo.open(), true)
  assert.equal(await device.login(), true)
  await device.repo.apply([put('outfit-1', 'Original'), put('outfit-2', 'Keep me')])
  assert.equal(await device.repo.flush(), true)
  return device
}

test('local UTF-16 payloads round-trip while cloud Base64 and older local formats remain readable', async () => {
  const device = client()
  assert.equal(await device.repo.open(), true)
  const stored = device.saved.get(device.repo.key)
  assert.ok(stored.startsWith('VPW-LZ16:'))
  assert.deepEqual(decodeWardrobePayload(stored).index, device.repo.index)
  const legacy = { index: createWardrobeIndex() }
  assert.deepEqual(decodeWardrobePayload(JSON.stringify(legacy)), legacy)
  assert.deepEqual(decodeWardrobePayload(encode(legacy)), legacy)
  await device.login()
  await device.repo.apply([put('local-format')])
  await device.repo.flush()
  assert.ok(device.server.settings.VPWardrobe)
  assert.equal(device.server.settings.VPWardrobe.startsWith('VPW-LZ16:'), false)
  assert.equal(cloudIndex(device.server).outfits['local-format'].name, 'local-format')
})

test('local writes fall back to Base64 when UTF-16 exceeds a byte-counted quota', async () => {
  const value = { index: applyWardrobeOperations(createWardrobeIndex(), Array.from({ length: 15 }, (_, i) =>
    put(`outfit-${i}`, `Outfit ${i}`, { data: Array.from({ length: 20 }, (_, j) =>
      ({ Group: `Group${j}`, Name: `Item-${i}-${j}`, Color: [`#${i}${j}abcdef`] })) })),
  { replicaId: 'device-a' }) }
  const base64 = encode(value)
  const compact = 'VPW-LZ16:' + LZString.compressToUTF16(JSON.stringify(value))
  assert.ok(Buffer.byteLength(compact) > Buffer.byteLength(base64))
  const saved = new Map()
  const storage = {
    getItem: key => saved.get(key) ?? null,
    setItem(key, payload) {
      if (Buffer.byteLength(payload) > Buffer.byteLength(base64)) {
        throw Object.assign(new Error('Storage quota exceeded'), { name: 'QuotaExceededError' })
      }
      saved.set(key, payload)
    },
  }
  const repo = new WardrobeRepository({ localStorage: storage })
  repo.persistLocalPayload('index', value)
  assert.equal(saved.get('index'), base64)
  assert.deepEqual(decodeWardrobePayload(saved.get('index')), value)
})

test('opening an older local document rewrites it in the compact local format', async () => {
  for (const oldFormat of ['json', 'base64']) {
    const index = createWardrobeIndex()
    const oldDocument = { index, pending: false, recoveryKeys: [], baseCloudIndex: index,
      baseCloudSequence: 0, baseAppliedSeq: {}, submittedVersions: [], conflicts: [], protocolVersion: 4 }
    const saved = new Map([['VPWardrobe_index_42', oldFormat === 'json'
      ? JSON.stringify(oldDocument) : encode(oldDocument)]])
    const server = { settings: { VPWardrobe: encode({ protocol: 'VPW4', index, a: {} }) } }
    const device = client(server, { saved })
    assert.equal(await device.repo.open(), true)
    assert.ok(saved.get(device.repo.key).startsWith('VPW-LZ16:'))
    assert.deepEqual(decodeWardrobePayload(saved.get(device.repo.key)).index, index)
    assert.equal(server.settings.VPWardrobe.startsWith('VPW-LZ16:'), false)
  }
})

test('a full store compacts legacy index and recovery data before creating its device marker', async () => {
  const index = applyWardrobeOperations(createWardrobeIndex(), Array.from({ length: 30 }, (_, i) =>
    put(`outfit-${i}`, `Outfit ${i}`, { data: Array.from({ length: 15 }, (_, j) =>
      ({ Group: `Group${j}`, Name: `Clothing-${i}-${j}`, Color: [`#${i}${j}abcdef`] })) })),
  { replicaId: 'old-device' })
  const key = 'VPWardrobe_index_42'
  const archiveKey = `${key}_recovery_existing`
  const backup = { reason: 'before-v4-migration', data: { local: index }, createdAt: 1 }
  const oldDocument = { index, pending: false, recoveryKeys: [archiveKey], baseCloudIndex: index,
    baseCloudSequence: 0, baseAppliedSeq: {}, submittedVersions: [], conflicts: [], protocolVersion: 4 }
  const saved = new Map([[key, encode(oldDocument)], [archiveKey, encode(backup)]])
  const usage = () => [...saved].reduce((total, [name, value]) => total + name.length + value.length, 0)
  const limit = usage() + 20
  const writes = []
  const storage = {
    getItem: name => saved.get(name) ?? null,
    setItem(name, value) {
      const previous = saved.get(name)
      const proposed = usage() - (previous === undefined ? 0 : name.length + previous.length)
        + name.length + value.length
      if (proposed > limit) throw Object.assign(new Error('Storage quota exceeded'), { name: 'QuotaExceededError' })
      saved.set(name, value)
      writes.push(name)
    },
  }
  assert.throws(() => storage.setItem('VPW4_device_42', '0'.repeat(32)), /Storage quota exceeded/)
  const server = { settings: { VPWardrobe: encode({ protocol: 'VPW4', index, a: {} }) } }
  const repo = new WardrobeRepository({ getPlayer: () => ({ MemberNumber: 42, ExtensionSettings: server.settings }),
    localStorage: storage, send: () => true, replicaId: 'new-device' })
  assert.equal(await repo.open(), true)
  assert.equal(repo.status.localSaved, true)
  assert.ok(saved.get(key).startsWith('VPW-LZ16:'))
  assert.ok(saved.get(archiveKey).startsWith('VPW-LZ16:'))
  assert.deepEqual(decodeWardrobePayload(saved.get(key)).index, index)
  assert.deepEqual(decodeWardrobePayload(saved.get(archiveKey)), backup)
  assert.match(saved.get('VPW4_device_42'), /^[0-9a-f]{32}$/)
  assert.deepEqual(writes.slice(0, 3), [key, archiveKey, 'VPW4_device_42'])
})

test('refused compaction does not hide an unchanged readable legacy index', async () => {
  const index = createWardrobeIndex()
  const oldDocument = { index, pending: false, recoveryKeys: [], baseCloudIndex: index,
    baseCloudSequence: 0, baseAppliedSeq: {}, submittedVersions: [], conflicts: [], protocolVersion: 4 }
  const raw = encode(oldDocument)
  const saved = new Map([['VPWardrobe_index_42', raw]])
  const server = { settings: { VPWardrobe: encode({ protocol: 'VPW4', index, a: {} }) } }
  const device = client(server, { saved })
  device.repo.local.setItem = () => { throw Object.assign(new Error('Storage quota exceeded'), { name: 'QuotaExceededError' }) }
  assert.equal(await device.repo.open(), true)
  assert.equal(device.repo.status.localSaved, true)
  assert.equal(saved.get(device.repo.key), raw)
  assert.deepEqual(device.repo.index, index)
})

test('unreadable legacy recovery data is left untouched while opening the index', async () => {
  const key = 'VPWardrobe_index_42'
  const archiveKey = `${key}_recovery_damaged`
  const index = createWardrobeIndex()
  const saved = new Map([[key, encode({ index, recoveryKeys: [archiveKey] })], [archiveKey, 'damaged backup']])
  const device = client({ settings: {} }, { saved })
  assert.equal(await device.repo.open(), true)
  assert.equal(saved.get(archiveKey), 'damaged backup')
})

test('a damaged prefixed local payload fails closed', async () => {
  assert.throws(() => decodeWardrobePayload('VPW-LZ16:invalid'), /Wardrobe data could not be decoded|JSON/)
  const saved = new Map([['VPWardrobe_index_42', 'VPW-LZ16:invalid']])
  const device = client({ settings: {} }, { saved })
  assert.equal(await device.repo.open(), false)
  assert.equal(device.repo.status.state, 'error')
  assert.equal(saved.get(device.repo.key), 'VPW-LZ16:invalid')
})

test('deletion survives a stale second device login and subsequent save', async () => {
  const a = await seed()
  const b = client(a.server, { replicaId: 'device-b' })
  assert.equal(await b.repo.open(), true)
  const stalePlayerPayload = b.player().ExtensionSettings.VPWardrobe
  await a.repo.apply([{ type: 'delete-outfit', id: 'outfit-1' }])
  assert.equal(await a.repo.flush(), true)

  assert.equal(await b.login(), true)
  assert.equal(b.player().ExtensionSettings.VPWardrobe, stalePlayerPayload, 'Relog does not refresh the game Player object')
  assert.deepEqual(names(b.repo.index), ['Keep me'])
  await b.repo.apply([put('outfit-3', 'New from B')])
  assert.equal(await b.repo.flush(), true)
  assert.deepEqual(names(cloudIndex(a.server)), ['Keep me', 'New from B'])
  assert.ok(cloudIndex(a.server).tombstones.outfits['outfit-1'])
})

test('rename keeps the same ID and wins over an older device cache after relog', async () => {
  const a = await seed()
  const b = client(a.server, { replicaId: 'device-b' })
  await b.repo.open()
  await a.repo.apply([{ type: 'put-outfit', id: 'outfit-1', changes: { name: 'Renamed' } }])
  await a.repo.flush()

  assert.equal(await b.login(), true)
  assert.equal(b.repo.index.outfits['outfit-1'].name, 'Renamed')
  await b.repo.apply([put('outfit-3')])
  await b.repo.flush()
  assert.equal(cloudIndex(a.server).outfits['outfit-1'].name, 'Renamed')
  assert.equal(Object.values(cloudIndex(a.server).outfits).filter((item) => item.name === 'Original').length, 0)
  assert.equal(Object.keys(cloudIndex(a.server).outfits).length, 3)
})

test('a stale device overwrite is detected by the earlier device marker and quarantines a deletion', async () => {
  const a = await seed()
  const b = client(a.server, { replicaId: 'device-b' })
  assert.equal(await b.repo.open(), true)
  assert.equal(await b.login(), true)

  await a.repo.apply([{ type: 'delete-outfit', id: 'outfit-1' }])
  assert.equal(await a.repo.flush(), true)
  const deletionSequence = markerFor(a.server, a).s
  assert.equal(cloudIndex(a.server).outfits['outfit-1'], undefined)

  await b.repo.apply([put('outfit-3', 'B from stale snapshot')])
  assert.equal(await b.repo.flush(), true)
  assert.ok(cloudIndex(a.server).outfits['outfit-1'], 'BC accepts the stale whole-snapshot overwrite')
  assert.ok(cloudEnvelope(a.server).a[a.repo.deviceId] < deletionSequence)
  assert.equal(markerFor(a.server, a).s, deletionSequence, 'B cannot overwrite A’s independent marker')

  const c = client(a.server, { replicaId: 'device-c' })
  assert.equal(await c.repo.open(), true)
  assert.equal(await c.login(), true)
  assert.equal(c.repo.status.state, 'conflict')
  assert.ok(c.repo.status.conflicts.some(conflict => conflict.type === 'missing-device'
    && conflict.id === a.repo.deviceId))
  assert.equal(c.repo.index.outfits['outfit-1'], undefined, 'Do not show a deleted outfit again')
  assert.deepEqual(names(c.repo.index), [], 'A sequence-only marker quarantines the whole cloud snapshot')
  assert.equal(await c.repo.flush(), false)
  assert.equal(c.sendCount(), 0)

  await c.repo.resolveSyncConflict([{ kind: 'device', id: a.repo.deviceId,
    field: 'sequence', choice: 'discard' }])
  assert.equal(c.repo.status.state, 'pending')
  assert.equal(await c.repo.flush(), true)
  assert.deepEqual(names(cloudIndex(a.server)), ['B from stale snapshot', 'Keep me', 'Original'],
    'Explicit discard accepts the stale cloud candidate')
  assert.equal(cloudEnvelope(a.server).a[a.repo.deviceId], deletionSequence)
  assert.equal(await c.login(), true)
  assert.equal(c.repo.status.state, 'verified')
})

test('a marker reveals an overwritten rename; the device holding the edit can repair it', async () => {
  const a = await seed()
  assert.equal(await a.login(), true)
  const b = client(a.server, { replicaId: 'device-b' })
  assert.equal(await b.repo.open(), true)
  assert.equal(await b.login(), true)

  await a.repo.apply([{ type: 'put-outfit', id: 'outfit-1', changes: { name: 'Name from A' } }])
  assert.equal(await a.repo.flush(), true)
  const renameSequence = markerFor(a.server, a).s
  await b.repo.apply([put('outfit-3', 'Name from B')])
  assert.equal(await b.repo.flush(), true)
  assert.equal(cloudIndex(a.server).outfits['outfit-1'].name, 'Original')
  assert.ok(cloudEnvelope(a.server).a[a.repo.deviceId] < renameSequence)

  const c = client(a.server, { replicaId: 'device-c' })
  assert.equal(await c.repo.open(), true)
  assert.equal(await c.login(), true)
  assert.equal(c.repo.status.state, 'conflict')
  assert.deepEqual(names(c.repo.index), [],
    'The marker cannot reconstruct the missing rename, so cloud content stays quarantined')
  assert.equal(await c.repo.flush(), false)

  assert.equal(await a.login(), true)
  assert.equal(a.repo.status.state, 'pending')
  assert.equal(a.repo.index.outfits['outfit-1'].name, 'Name from A')
  assert.equal(await a.repo.flush(), true)
  assert.deepEqual(names(cloudIndex(a.server)), ['Keep me', 'Name from A', 'Name from B'])
  assert.ok(cloudEnvelope(a.server).a[a.repo.deviceId] >= renameSequence)
  assert.equal(await c.login(), true)
  assert.equal(c.repo.status.state, 'verified')
})

test('different IDs with the same name remain separate outfits and survive reload', async () => {
  const device = client()
  await device.repo.open()
  await device.repo.apply([put('one', 'Same name'), put('two', 'Same name'), put('three', 'Same name')])
  await device.repo.flush()
  const reloaded = client(device.server, { saved: device.saved, replicaId: 'same-device-reload' })
  assert.equal(await reloaded.repo.open(), true)
  assert.deepEqual(Object.keys(reloaded.repo.index.outfits).sort(), ['one', 'three', 'two'])
  await reloaded.repo.apply([{ type: 'put-outfit', id: 'two', changes: { name: 'Only this one' } }])
  assert.deepEqual(names(reloaded.repo.index), ['Only this one', 'Same name', 'Same name'])
})

test('shared quota blocks cloud but keeps the full local document, then remeasures other plugins', async () => {
  const device = client({ settings: { Other: 'x'.repeat(179900), VPWardrobe: encode(createWardrobeIndex()) } })
  assert.equal(await device.repo.open(), true)
  assert.equal(await device.login(), true)
  await device.repo.apply([put('one')])
  assert.equal(await device.repo.flush(), false)
  assert.equal(device.repo.status.state, 'quota')
  assert.equal(device.sendCount(), 0)
  assert.equal(device.document().index.outfits.one.name, 'one')
  assert.equal(device.document().pending, true)
  assert.ok(device.repo.quota.otherExtensionsBytes > 179900)

  device.player().ExtensionSettings.Other = 'small now'
  assert.equal(await device.repo.flush(), true)
  assert.equal(device.repo.status.state, 'submitted')
  assert.equal(device.sendCount(), 1)
  assert.equal(device.player().ExtensionSettings.Other, 'small now')
  assert.ok(device.repo.quota.totalBytes < 180000)
})

test('offline edits stay durable and pending, and submit once connection resumes', async () => {
  const device = client()
  await device.repo.open()
  await device.login()
  device.setOnline(false)
  await device.repo.apply([put('offline')])
  assert.equal(await device.repo.flush(), false)
  assert.equal(device.repo.status.state, 'offline')
  assert.equal(device.document().pending, true)
  assert.ok(device.document().index.outfits.offline)
  assert.equal(device.sendCount(), 0)
  device.setOnline(true)
  device.repo.queue(0)
  await device.runNextTimer()
  assert.equal(device.sendCount(), 1)
  assert.equal(device.repo.status.state, 'submitted')
  assert.equal(device.document().pending, true, 'Submission must not invent a server acknowledgment')
})

for (const failure of ['false', 'throw']) {
  for (const hadValue of [false, true]) {
    test(`send ${failure} restores the ${hadValue ? 'previous' : 'absent'} Player value and leaves durable work pending`, async () => {
      const server = { settings: hadValue ? { VPWardrobe: encode(createWardrobeIndex()), Other: 'untouched' } : { Other: 'untouched' } }
      const device = client(server)
      await device.repo.open()
      await device.login()
      await device.repo.apply([put('pending')])
      const previous = copy(device.player().ExtensionSettings)
      device.failSend(failure)
      assert.equal(await device.repo.flush(), false)
      assert.equal(device.repo.status.state, 'error')
      assert.deepEqual(device.player().ExtensionSettings, previous)
      assert.equal(device.document().pending, true)
      assert.ok(device.document().index.outfits.pending)
      device.failSend(null)
      assert.equal(await device.repo.flush(), true)
      assert.ok(cloudIndex(server).outfits.pending)
    })
  }
}

for (const failure of ['false', 'throw']) {
  test(`local write ${failure} prevents any cloud send`, async () => {
    const device = await seed()
    const beforeSends = device.sendCount()
    const beforeCloud = device.server.settings.VPWardrobe
    const beforeDocument = device.saved.get(device.repo.key)
    device.failLocal(failure)
    await assert.rejects(() => device.repo.apply([put('not-durable')]))
    assert.equal(await device.repo.flush(), true, 'An unchanged persisted submission needs no new local write')
    assert.equal(device.sendCount(), beforeSends)
    assert.equal(device.server.settings.VPWardrobe, beforeCloud)
    assert.equal(device.saved.get(device.repo.key), beforeDocument)
    assert.equal(device.repo.index.outfits['not-durable'], undefined)
  })
}

test('a full browser store still opens an unchanged saved wardrobe without rewriting it', async () => {
  const first = await seed()
  const reopened = client(first.server, { saved: first.saved })
  reopened.failLocal('quota')
  assert.equal(await reopened.repo.open(), true)
  assert.deepEqual(names(reopened.repo.index), ['Keep me', 'Original'])
  assert.equal(reopened.repo.status.localSaved, true)
  assert.equal(reopened.sendCount(), 0)
})

test('a full browser store keeps an existing wardrobe readable when its device ID cannot be saved', async () => {
  const first = await seed()
  const reopened = client(first.server, { saved: first.saved })
  reopened.saved.delete('VPW4_device_42')
  reopened.failLocal('quota')
  assert.equal(await reopened.repo.open(), false)
  assert.equal(reopened.repo.status.errorCode, 'local-storage-quota')
  assert.deepEqual(names(reopened.repo.index), ['Keep me', 'Original'])
  assert.equal(reopened.sendCount(), 0)
})

test('browser storage quota failure preserves a real BC usage reading without inventing an upload estimate', async () => {
  const device = client({ settings: { OtherPlugin: 'saved on BC' } })
  device.failLocal('quota')
  assert.equal(await device.repo.open(), false)
  assert.equal(device.repo.status.errorCode, 'local-storage-quota')
  assert.equal(device.repo.status.localSaved, false)
  assert.ok(device.repo.quota.observed.otherExtensionsBytes > 0)
  assert.equal(device.repo.quota.proposalAvailable, false)
  assert.equal(device.sendCount(), 0)
})

test('a full browser store after sending can finalize locally without sending again', async () => {
  const device = await seed()
  await device.repo.apply([put('later')])
  const send = device.repo.send
  const setItem = device.repo.local.setItem
  let sent = false
  device.repo.send = fields => { const result = send(fields); sent = true; return result }
  device.repo.local.setItem = (key, value) => {
    if (sent && key === device.repo.key) {
      throw Object.assign(new Error('Storage quota exceeded'), { name: 'QuotaExceededError' })
    }
    return setItem(key, value)
  }
  const before = device.sendCount()
  assert.equal(await device.repo.flush(), false)
  assert.equal(device.repo.status.errorCode, 'local-storage-quota')
  assert.equal(device.sendCount(), before + 1)
  assert.equal(device.document().submission.submittedAt, null)
  device.repo.local.setItem = setItem
  assert.equal(await device.repo.flush(), true)
  assert.equal(device.sendCount(), before + 1)
  assert.ok(device.document().submission.submittedAt > 0)
  assert.equal(device.repo.status.state, 'submitted')
})

test('switching accounts cancels the old edit instead of writing old clothes into the new account', async () => {
  const device = await seed()
  const oldDocument = device.saved.get('VPWardrobe_index_42')
  const beforeSends = device.sendCount()
  device.switchAccount(84)
  await assert.rejects(() => device.repo.apply([{ type: 'put-outfit', id: 'outfit-1', changes: { name: 'Wrong account edit' } }]), /Account changed/)
  assert.equal(device.repo.member, '84')
  assert.deepEqual(names(device.repo.index), [])
  assert.equal(device.saved.get('VPWardrobe_index_42'), oldDocument)
  assert.equal(device.sendCount(), beforeSends)
  device.server.settings = {}
  assert.equal(await device.login(), true)
  await device.repo.apply([put('account-84', 'New account outfit')])
  await device.repo.flush()
  assert.deepEqual(names(cloudIndex(device.server)), ['New account outfit'])
  assert.deepEqual(names(decodeWardrobePayload(device.saved.get('VPWardrobe_index_42')).index), ['Keep me', 'Original'])
})

test('a late login response for another account is ignored', async () => {
  const device = await seed()
  const before = copy(device.repo.index)
  assert.equal(await device.repo.receiveCloud({ memberNumber: 999, extensionSettings: { VPWardrobe: encode(createWardrobeIndex()) }, fresh: true }), false)
  assert.deepEqual(device.repo.index, before)
})

test('migration prefers the React local key, backs up old sources, and never reimports them after indexing', async () => {
  const tree = (name) => ({ name: 'Home', type: 'folder', children: [{ name, type: 'outfit', data: [{ Group: 'Cloth', Name: 'Shirt' }] }] })
  const saved = new Map([
    ['VPWardrobe_VPWardrobe_local_42', encode(tree('Current React local'))],
    ['VPWardrobe_42', encode(tree('Old buggy local'))],
  ])
  const server = { settings: { VPWardrobe: encode(tree('Stale cloud tree')) } }
  const device = client(server, { saved })
  assert.equal(await device.repo.open(), true)
  assert.deepEqual(names(device.repo.index), ['Current React local'])
  const backups = await device.repo.exportRecovery()
  assert.ok(backups.length > 0)
  assert.ok(saved.get(backups[0].key).startsWith('VPW-LZ16:'))
  assert.match(JSON.stringify(backups), /Current React local/)
  assert.match(JSON.stringify(backups), /Old buggy local/)
  assert.equal(decodeWardrobePayload(backups[0].data.onlineRaw).children[0].name, 'Stale cloud tree')
  assert.equal(backups[0].data.local.find((source) => source.key === 'VPWardrobe_VPWardrobe_local_42').raw,
    saved.get('VPWardrobe_VPWardrobe_local_42'))
  assert.equal(backups[0].data.onlineRaw, server.settings.VPWardrobe)
  const id = Object.keys(device.repo.index.outfits)[0]
  await device.repo.apply([{ type: 'delete-outfit', id }])
  await device.repo.flush()

  // A legacy client overwrites cloud with an unversioned tree after migration.
  server.settings.VPWardrobe = encode(tree('Stale cloud tree'))
  const reopened = client(server, { saved })
  assert.equal(await reopened.repo.open(), true)
  assert.deepEqual(names(reopened.repo.index), [])
  assert.ok(reopened.repo.index.tombstones.outfits[id])
  assert.ok((await reopened.repo.exportRecovery()).some(backup =>
    decodeWardrobePayload(backup.data.onlineRaw).children[0].name === 'Stale cloud tree'))
  assert.ok((await reopened.repo.exportRecovery()).some((backup) => backup.data.onlineRaw === server.settings.VPWardrobe))
  assert.ok(saved.has('VPWardrobe_VPWardrobe_local_42'), 'Migration keeps the original backup source')
})

test('an indexed cloud replica suppresses stale local-tree import on a new indexed device', async () => {
  const a = await seed()
  await a.repo.apply([{ type: 'delete-outfit', id: 'outfit-1' }])
  await a.repo.flush()
  const saved = new Map([['VPWardrobe_VPWardrobe_local_42', encode({ name: 'Home', type: 'folder', children: [{ name: 'Original', type: 'outfit', data: [] }] })]])
  const device = client(a.server, { saved, replicaId: 'new-device' })
  assert.equal(await device.repo.open(), true)
  assert.deepEqual(names(device.repo.index), ['Keep me'])
  assert.ok(device.repo.index.tombstones.outfits['outfit-1'])
  assert.ok((await device.repo.exportRecovery()).length > 0)
})

test('damaged cloud keeps the durable local wardrobe and blocks automatic overwrite', async () => {
  const device = await seed()
  const before = copy(device.repo.index)
  const beforeSends = device.sendCount()
  const corrupt = '{this is not valid wardrobe data'
  device.server.settings.VPWardrobe = corrupt
  assert.equal(await device.login(), false)
  assert.equal(device.repo.status.state, 'error')
  assert.deepEqual(device.repo.index, before)
  assert.equal(await device.repo.flush(), false)
  assert.equal(device.sendCount(), beforeSends)
  assert.equal(device.server.settings.VPWardrobe, corrupt)
  assert.deepEqual(device.document().index, before)
})

test('only a fresh matching server response verifies a submission', async () => {
  const device = await seed()
  assert.equal(device.repo.status.state, 'submitted')
  assert.equal(device.repo.status.lastVerifiedAt, null)
  assert.equal(device.document().pending, true)
  assert.equal(await device.repo.receiveCloud({ extensionSettings: copy(device.player().ExtensionSettings), fresh: false }), true)
  assert.notEqual(device.repo.status.state, 'verified')
  assert.equal(device.document().pending, true)
  assert.equal(await device.login(), true)
  assert.equal(device.repo.status.state, 'verified')
  assert.ok(device.repo.status.lastVerifiedAt > 0)
  assert.equal(device.document().pending, false)
})

test('reopening preserves the assumed-success status without treating it as a cloud receipt', async () => {
  const first = await seed()
  const reopened = client(first.server, { saved: first.saved })
  assert.equal(await reopened.repo.open(), true)
  assert.equal(reopened.repo.status.state, 'submitted')
  assert.equal(reopened.repo.status.lastVerifiedAt, null)
  assert.equal(reopened.document().pending, true)
  assert.equal(await reopened.repo.flush({ force: true }), false)
  assert.equal(reopened.sendCount(), 0)
  await reopened.repo.apply([put('new-local')])
  assert.equal(reopened.repo.status.state, 'pending')
})

test('a verified relog stays verified when Player still contains the older cloud value', async () => {
  const a = await seed()
  const b = client(a.server, { replicaId: 'device-b' })
  await b.repo.open()
  await a.repo.apply([{ type: 'put-outfit', id: 'outfit-1', changes: { name: 'New from A' } }])
  await a.repo.flush()
  await b.login()
  assert.equal(b.repo.status.state, 'verified')
  assert.equal(await b.repo.flush(), true)
  assert.equal(b.repo.status.state, 'verified')
  assert.equal(b.sendCount(), 0)
})

test('shared quota uses newly received server settings even when relog leaves Player stale', async () => {
  const device = await seed({ settings: { Other: 'small old value' } })
  device.server.settings.Other = 'x'.repeat(179900)
  await device.login()
  const beforeSends = device.sendCount()
  await device.repo.apply([put('new-after-relog')])
  assert.equal(await device.repo.flush(), false)
  assert.equal(device.repo.status.state, 'quota')
  assert.equal(device.sendCount(), beforeSends)
  assert.ok(device.repo.quota.otherExtensionsBytes > 179900)
  assert.equal(device.player().ExtensionSettings.Other, 'small old value', 'VPW must not rewrite another extension while reading its server budget')
})

test('corrupted indexed local storage is retained and blocks fallback uploads', async () => {
  const device = await seed()
  const corrupt = 'corrupted local index'
  device.saved.set('VPWardrobe_index_42', corrupt)
  const reopened = client(device.server, { saved: device.saved })
  assert.equal(await reopened.repo.open(), false)
  assert.equal(reopened.repo.status.localSaved, false)
  assert.equal(await reopened.repo.flush(), false)
  assert.equal(reopened.sendCount(), 0)
  assert.equal(reopened.saved.get('VPWardrobe_index_42'), corrupt)
})

test('unchanged submitted data does not flood the unacknowledged transport', async () => {
  const device = await seed()
  const count = device.sendCount()
  const projection = projectWardrobeCloudIndex(device.repo.index)
  assert.equal(await device.repo.flush(), true)
  assert.equal(await device.repo.flush(), true)
  assert.equal(device.sendCount(), count)
  assert.equal(device.document().pending, true)
  assert.deepEqual(cloudIndex(device.server), projection)
})

test('a fresh response missing an entire earlier AccountUpdate retries durable local work', async () => {
  const device = await seed()
  const count = device.sendCount()
  // The wardrobe body and marker are one BC AccountUpdate; a lost send loses both.
  device.server.settings = {}
  assert.equal(await device.login(), true)
  assert.equal(device.repo.status.state, 'pending')
  assert.equal(await device.repo.flush(), true)
  assert.equal(device.sendCount(), count + 1)
  assert.deepEqual(names(cloudIndex(device.server)), ['Keep me', 'Original'])
  assert.equal(cloudEnvelope(device.server).a[device.repo.deviceId], markerFor(device.server, device).s)
  assert.equal(device.document().pending, true)
})

test('local-only outfit content stays private across submission and another device login', async () => {
  const a = await seed()
  const b = client(a.server, { replicaId: 'device-b' })
  await b.repo.open()
  await a.repo.apply([{ type: 'set-cloud', id: 'outfit-1', enabled: false }])
  assert.equal(await a.repo.flush(), true)
  assert.ok(a.repo.index.outfits['outfit-1'])
  assert.equal(cloudIndex(a.server).outfits['outfit-1'], undefined)
  assert.equal(cloudIndex(a.server).cloudState['outfit-1'].enabled, false)
  await b.login()
  await b.repo.apply([put('other')])
  await b.repo.flush()
  assert.equal(cloudIndex(a.server).outfits['outfit-1'], undefined)
  const newcomer = client(a.server, { replicaId: 'device-c' })
  await newcomer.repo.open()
  assert.equal(newcomer.repo.index.outfits['outfit-1'], undefined)
})

test('re-enabling cloud elsewhere preserves private edits locally and asks the user to resolve them', async () => {
  const a = await seed()
  assert.equal(await a.login(), true)
  await a.repo.apply([
    { type: 'put-tag', id: 'tag-a', name: '日常' },
    { type: 'put-outfit', id: 'outfit-1', changes: { tagIds: ['tag-a'] } },
  ])
  await a.repo.flush()
  const b = client(a.server, { replicaId: 'device-b' })
  await b.repo.open()

  await a.repo.apply([{ type: 'set-cloud', id: 'outfit-1', enabled: false }])
  await a.repo.flush()
  await b.login()
  await b.repo.apply([{ type: 'put-outfit', id: 'outfit-1', changes: { data: [{ Group: 'Cloth', Name: 'PrivateDress' }] } }])
  await b.repo.flush()
  assert.equal(cloudIndex(a.server).outfits['outfit-1'], undefined)

  await a.repo.apply([{ type: 'set-cloud', id: 'outfit-1', enabled: true }])
  await a.repo.flush()
  assert.equal(await b.login(), true)
  assert.equal(b.repo.status.state, 'conflict')
  assert.ok(b.repo.status.conflicts.some(conflict => conflict.type === 'privacy'))
  assert.equal(b.repo.index.outfits['outfit-1'].data[0].Name, 'PrivateDress')
  assert.equal(b.repo.index.cloudState['outfit-1'].enabled, false)

  await b.repo.apply([put('unrelated')])
  assert.equal(await b.repo.flush(), false)
  const cloud = cloudIndex(a.server)
  assert.equal(cloud.outfits['outfit-1'].data[0].Name, 'Shirt')
  assert.equal(JSON.stringify(cloud).includes('PrivateDress'), false)
  assert.equal(b.document().index.outfits['outfit-1'].data[0].Name, 'PrivateDress')
})

test('an edit after a fresh cloud read advances beyond the remote revision', async () => {
  const a = await seed()
  assert.equal(await a.login(), true)
  const b = client(a.server, { replicaId: 'other-device' })
  assert.equal(await b.repo.open(), true)
  assert.equal(await b.login(), true)
  for (let step = 0; step < 10; step++) {
    await b.repo.apply([{ type: 'put-outfit', id: 'outfit-1', changes: { name: `Remote ${step}` } }])
  }
  assert.equal(await b.repo.flush(), true)
  const latest = cloudIndex(a.server)
  assert.equal(await a.login(), true)
  await a.repo.apply([{ type: 'put-outfit', id: 'outfit-1', changes: { name: 'My subsequent edit' } }])
  assert.ok(a.repo.index.outfits['outfit-1'].rev[0] > latest.clock)
  assert.equal(await a.repo.flush(), true)
  assert.equal(cloudIndex(a.server).outfits['outfit-1'].name, 'My subsequent edit')
})

test('another tab sharing local storage preserves newer private content when making an unrelated edit', async () => {
  const a = await seed()
  const b = client(a.server, { saved: a.saved, replicaId: 'other-tab' })
  await b.repo.open()
  await a.repo.apply([
    { type: 'set-cloud', id: 'outfit-1', enabled: false },
    { type: 'put-outfit', id: 'outfit-1', changes: { name: 'Private revision from A', data: [{ Group: 'Cloth', Name: 'PrivateShirt' }] } },
  ])
  await a.repo.flush()
  await b.repo.apply([put('unrelated')])
  assert.equal(b.repo.index.outfits['outfit-1'].name, 'Private revision from A')
  assert.equal(b.document().index.outfits['outfit-1'].data[0].Name, 'PrivateShirt')
  await b.repo.flush()
  assert.equal(cloudIndex(a.server).outfits['outfit-1'], undefined)
  const reloaded = client(a.server, { saved: a.saved })
  await reloaded.repo.open()
  assert.equal(reloaded.repo.index.outfits['outfit-1'].name, 'Private revision from A')
})

test('first indexed cloud load cannot import content whose cloud state says private', async () => {
  const fullLocal = applyWardrobeOperations(createWardrobeIndex(), [
    put('private', 'Private content'), put('public', 'Public content'),
    { type: 'set-cloud', id: 'private', enabled: false },
  ], { replicaId: 'older-client' })
  // A broken/older client uploaded its full local index instead of the cloud projection.
  const device = client({ settings: { VPWardrobe: encode(fullLocal) } })
  assert.equal(await device.repo.open(), true)
  assert.equal(device.repo.index.outfits.private, undefined)
  assert.equal(device.document().index.outfits.private, undefined)
  assert.equal(device.repo.index.cloudState.private.enabled, false)
  assert.equal(device.repo.index.outfits.public.name, 'Public content')
})

test('a failed send is retried from durable state with a bounded scheduled delay', async () => {
  const device = client()
  await device.repo.open()
  await device.login()
  await device.repo.apply([put('retry')])
  device.failSend('throw')
  assert.equal(await device.repo.flush(), false)
  assert.ok(device.timers.size > 0, 'A failed online submission schedules retry')
  const timer = Array.from(device.timers.values())[0]
  assert.ok(timer.delay > 0 && timer.delay <= 60000)
  device.failSend(null)
  await device.runNextTimer()
  assert.ok(cloudIndex(device.server).outfits.retry)
  assert.equal(device.repo.status.state, 'submitted')
})

for (const raw of ['false', '0', '""']) {
  test(`a JSON primitive cloud payload (${raw}) is an error, never an empty remote wardrobe`, async () => {
    const device = client({ settings: { VPWardrobe: raw } })
    assert.equal(await device.repo.open(), true, 'The empty local document can still be saved')
    assert.equal(device.repo.status.localSaved, true)
    assert.equal(device.repo.status.state, 'error')
    assert.equal(device.timers.size, 0)
    assert.equal(await device.repo.flush(), false)
    assert.equal(device.sendCount(), 0)
    assert.equal(device.server.settings.VPWardrobe, raw)
    assert.equal(device.timers.size, 0)
  })
}

test('open while logged out returns an error state without throwing or writing', async () => {
  const device = client()
  device.switchAccount(undefined)
  let opened
  await assert.doesNotReject(async () => { opened = await device.repo.open() })
  assert.equal(opened, false)
  assert.equal(device.repo.status.state, 'error')
  assert.equal(device.repo.status.localSaved, false)
  assert.equal(device.saved.has(device.repo.key), false)
  assert.equal(device.sendCount(), 0)
  assert.equal(device.timers.size, 0)
})

test('apply retains a successful local edit when later shared-quota measurement fails', async () => {
  const device = await seed()
  const cyclic = {}
  cyclic.self = cyclic
  device.player().ExtensionSettings.Other = cyclic
  let result
  await assert.doesNotReject(async () => { result = await device.repo.apply([put('saved-despite-quota-error')]) })
  assert.ok(result.outfits['saved-despite-quota-error'])
  assert.ok(device.repo.index.outfits['saved-despite-quota-error'])
  assert.ok(device.document().index.outfits['saved-despite-quota-error'])
  assert.equal(device.repo.status.localSaved, true)
  assert.equal(device.repo.status.state, 'error')
  assert.equal(device.timers.size, 0)
  const beforeSends = device.sendCount()
  assert.equal(await device.repo.flush(), false)
  assert.equal(device.sendCount(), beforeSends)
  device.player().ExtensionSettings.Other = 'repaired'
  assert.equal(await device.repo.flush(), true)
  assert.ok(cloudIndex(device.server).outfits['saved-despite-quota-error'])
})

test('open reports local success when loading succeeds but subsequent quota measurement fails', async () => {
  const a = await seed()
  const device = client(a.server)
  const cyclic = {}
  cyclic.self = cyclic
  device.player().ExtensionSettings.Other = cyclic
  assert.equal(await device.repo.open(), true)
  assert.equal(device.repo.status.localSaved, true)
  assert.equal(device.repo.status.state, 'error')
  assert.deepEqual(names(device.repo.index), ['Keep me', 'Original'])
  assert.deepEqual(names(device.document().index), ['Keep me', 'Original'])
  assert.equal(device.timers.size, 0)
  assert.equal(await device.repo.flush(), false)
  device.player().ExtensionSettings.Other = 'repaired'
  assert.equal(await device.repo.flush(), false, 'A repaired quota cannot turn the stale Player cache into fresh server proof')
  assert.equal(device.sendCount(), 0)
  assert.equal(await device.login(), true)
  assert.equal(await device.repo.flush(), true)
  assert.deepEqual(names(cloudIndex(device.server)), ['Keep me', 'Original'])
})

test('receiveCloud retains newly saved remote changes when subsequent quota measurement fails', async () => {
  const a = await seed()
  const b = client(a.server, { replicaId: 'device-b' })
  await b.repo.open()
  await a.repo.apply([{ type: 'put-outfit', id: 'outfit-1', changes: { name: 'Fresh rename' } }])
  await a.repo.flush()
  const cyclic = {}
  cyclic.self = cyclic
  const settings = { ...a.server.settings, Other: cyclic }
  assert.equal(await b.repo.receiveCloud({ memberNumber: 42, extensionSettings: settings, fresh: true }), true)
  assert.equal(b.repo.status.localSaved, true)
  assert.equal(b.repo.status.state, 'error')
  assert.equal(b.repo.index.outfits['outfit-1'].name, 'Fresh rename')
  assert.equal(b.document().index.outfits['outfit-1'].name, 'Fresh rename')
  assert.equal(b.timers.size, 0)
  assert.equal(await b.repo.flush(), false)
  b.player().ExtensionSettings.Other = 'repaired'
  assert.equal(await b.repo.flush(), false, 'The malformed login snapshot stays untrusted until another login')
  assert.equal(await b.login(), true)
  assert.equal(await b.repo.flush(), true)
  assert.equal(cloudIndex(a.server).outfits['outfit-1'].name, 'Fresh rename')
})

test('transport retry stops after five growing automatic delays instead of retrying forever', async () => {
  const device = client()
  await device.repo.open()
  await device.login()
  await device.repo.apply([put('retry-limit')])
  device.failSend('throw')
  assert.equal(await device.repo.flush(), false)
  const delays = []
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal(device.timers.size, 1)
    const delay = await device.runNextTimer()
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

test('quota, local storage, and decode failures do not schedule automatic transport retries', async () => {
  const quota = client({ settings: { Other: 'x'.repeat(180000) } })
  await quota.repo.open()
  await quota.repo.apply([put('quota')])
  assert.equal(await quota.repo.flush(), false)
  assert.equal(quota.timers.size, 0)

  const local = client()
  await local.repo.open()
  local.failLocal('throw')
  await assert.rejects(() => local.repo.apply([put('local')]))
  assert.equal(await local.repo.flush(), false)
  assert.equal(local.timers.size, 0)

  const decode = await seed()
  decode.server.settings.VPWardrobe = 'corrupt cloud'
  assert.equal(await decode.login(), false)
  assert.equal(await decode.repo.flush(), false)
  assert.equal(decode.timers.size, 0)
})

test('after a local write failure, retry saves the pending fresh cloud rename before sending anything', async () => {
  const a = await seed()
  const b = client(a.server, { replicaId: 'device-b' })
  await b.repo.open()
  await a.repo.apply([{ type: 'put-outfit', id: 'outfit-1', changes: { name: 'Fresh name that must survive' } }])
  await a.repo.flush()
  b.failLocal('throw')
  assert.equal(await b.login(), false)
  assert.equal(b.repo.index.outfits['outfit-1'].name, 'Original', 'UI rolls back to its durable local state')
  assert.equal(b.document().index.outfits['outfit-1'].name, 'Original')
  assert.equal(b.sendCount(), 0)
  assert.equal(b.timers.size, 0)
  b.failLocal(null)
  assert.equal(await b.repo.flush(), true)
  assert.equal(b.repo.index.outfits['outfit-1'].name, 'Fresh name that must survive')
  assert.equal(b.document().index.outfits['outfit-1'].name, 'Fresh name that must survive')
  assert.equal(cloudIndex(a.server).outfits['outfit-1'].name, 'Fresh name that must survive')
})
