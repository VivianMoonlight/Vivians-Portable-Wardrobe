import assert from 'node:assert/strict'
import { test } from 'node:test'
import LZString from 'lz-string'
import { WardrobeRepository, decodeWardrobePayload } from '../src/services/WardrobeRepository.js'
import { createWardrobeIndex } from '../src/services/wardrobe-index.js'

const copy = value => JSON.parse(JSON.stringify(value))

function device(server, storage = new Map()) {
  const player = { MemberNumber: 42, ExtensionSettings: copy(server.settings) }
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem(key, value) { storage.set(key, value) },
  }
  const repo = new WardrobeRepository({ getPlayer: () => player, localStorage,
    send(fields) {
      for (const [path, value] of Object.entries(fields)) {
        server.settings[path.slice('ExtensionSettings.'.length)] = value
      }
    }, setTimeout() { return 1 }, clearTimeout() {} })
  return { repo, player, storage,
    login: () => repo.receiveCloud({ extensionSettings: copy(server.settings), fresh: true }),
  }
}

const put = (id, name = id) => ({ type: 'put-outfit', id,
  changes: { name, data: [{ Group: 'Cloth', Name: 'Shirt' }] } })

test('v4 submission includes one snapshot and a per-device marker, then verifies on fresh login', () => {
  const server = { settings: {} }
  const a = device(server)
  assert.equal(a.repo.open({ extensionSettings: server.settings, fresh: true }), true)
  a.repo.apply([put('shirt')])
  assert.equal(a.repo.flush(), true)
  const cloud = decodeWardrobePayload(server.settings.VPWardrobe)
  assert.equal(cloud.protocol, 'VPW4')
  assert.equal(cloud.index.outfits.shirt.name, 'shirt')
  assert.equal(Object.keys(server.settings).filter(key => key.startsWith('VPW4_M_')).length, 1)
  assert.equal(a.login(), true)
  assert.equal(a.repo.status.state, 'verified', JSON.stringify({ status: a.repo.status,
    cloud, local: a.repo.index, document: decodeWardrobePayload(a.storage.get(a.repo.key)) }))
})

test('retrying a failed send does not create another sequence for unchanged content', () => {
  const server = { settings: {} }
  const a = device(server)
  a.repo.open({ extensionSettings: server.settings, fresh: true })
  a.repo.apply([put('shirt')])
  const send = a.repo.send
  let attempts = 0
  a.repo.send = fields => {
    attempts++
    if (attempts === 1) return false
    return send(fields)
  }
  assert.equal(a.repo.flush(), false)
  assert.equal(a.repo.flush(), true)
  assert.equal(a.repo.flush(), true)
  assert.equal(attempts, 2)
  assert.equal(JSON.parse(server.settings[a.repo.markerKey]).s, 1)
})

test('an older discard receipt cannot hide a newer complete cloud sequence', () => {
  const server = { settings: {} }
  const a = device(server)
  a.repo.open({ extensionSettings: server.settings, fresh: true })
  a.repo.apply([put('first')])
  assert.equal(a.repo.flush(), true)
  assert.equal(a.login(), true)
  a.repo.apply([put('second')])
  assert.equal(a.repo.flush(), true)
  assert.equal(a.login(), true)
  const b = device(server)
  assert.equal(b.repo.open({ extensionSettings: server.settings, fresh: true }), true)
  b.repo.writeDocument(b.repo.index, { discardedSeqByDevice: { [a.repo.deviceId]: 1 } })
  assert.equal(b.login(), true)
  assert.equal(b.repo.status.conflicts.length, 0)
  assert.ok(b.repo.index.outfits.first)
  assert.ok(b.repo.index.outfits.second)
  assert.equal(b.repo.document.baseAppliedSeq[a.repo.deviceId], 2)
})

test('an untrusted login invalidates an earlier fresh upload anchor', () => {
  const server = { settings: {} }
  const a = device(server)
  a.repo.open({ extensionSettings: server.settings, fresh: true })
  a.repo.apply([put('first')])
  assert.equal(a.repo.flush(), true)
  assert.equal(a.login(), true)
  assert.equal(a.repo.status.state, 'verified')
  a.repo.invalidateFreshness()
  assert.equal(a.repo.status.state, 'pending')
  a.repo.apply([put('second')])
  assert.equal(a.repo.flush(), false)
  assert.equal(decodeWardrobePayload(server.settings.VPWardrobe).index.outfits.second, undefined)
  assert.equal(a.login(), true)
  assert.equal(a.repo.flush(), true)
  assert.ok(decodeWardrobePayload(server.settings.VPWardrobe).index.outfits.second)
})

test('stale second-device write is quarantined by the first device marker', () => {
  const server = { settings: {} }
  const a = device(server)
  a.repo.open({ extensionSettings: server.settings, fresh: true })
  a.repo.apply([put('old')])
  assert.equal(a.repo.flush(), true)
  assert.equal(a.login(), true)
  const b = device(server)
  b.repo.open({ extensionSettings: server.settings, fresh: true })
  a.repo.apply([{ type: 'delete-outfit', id: 'old' }])
  assert.equal(a.repo.flush(), true)
  b.repo.apply([put('new')])
  assert.equal(b.repo.flush(), true)
  assert.ok(decodeWardrobePayload(server.settings.VPWardrobe).index.outfits.old)

  const c = device(server)
  c.repo.open()
  assert.equal(c.login(), true)
  assert.equal(c.repo.status.state, 'conflict')
  assert.ok(c.repo.status.conflicts.some(conflict => conflict.type === 'missing-device'))
  assert.equal(c.repo.index.outfits.old, undefined)
  assert.equal(c.repo.quota.observedSource, 'login-response')
  assert.equal(c.repo.quota.observed.totalBytes,
    new TextEncoder().encode(JSON.stringify(server.settings)).byteLength)
  assert.ok(c.repo.quota.observed.wardrobeBytes > c.repo.quota.wardrobeBytes,
    'Quarantined projection must not masquerade as current BC storage usage')
  assert.equal(c.repo.flush(), false)
  const reopened = device(server, c.storage)
  assert.equal(reopened.repo.open(), true)
  assert.equal(reopened.repo.index.outfits.old, undefined)
  assert.equal(reopened.login(), true)
  assert.equal(reopened.repo.status.state, 'conflict')
  assert.equal(reopened.repo.index.outfits.old, undefined)
  const missing = reopened.repo.status.conflicts.find(conflict => conflict.type === 'missing-device')
  reopened.repo.resolveSyncConflict([{ kind: 'device', id: missing.id, field: 'sequence', choice: 'discard' }])
  assert.equal(reopened.repo.status.state, 'pending')
  assert.ok(reopened.repo.index.outfits.old, 'Discarding the missing delete restores the stale cloud candidate')
  assert.equal(reopened.repo.flush(), true)
  const settled = decodeWardrobePayload(server.settings.VPWardrobe)
  assert.equal(settled.a[missing.id], missing.sequence)
  assert.ok(settled.index.outfits.old)
  assert.equal(reopened.login(), true)
  assert.equal(reopened.repo.status.state, 'verified')
})

test('durable original device can repair its own lost rename', () => {
  const server = { settings: {} }
  const a = device(server)
  a.repo.open({ extensionSettings: server.settings, fresh: true })
  a.repo.apply([put('shirt', 'First')])
  a.repo.flush()
  a.login()
  const b = device(server)
  b.repo.open({ extensionSettings: server.settings, fresh: true })
  a.repo.apply([{ type: 'put-outfit', id: 'shirt', changes: { name: 'Renamed' } }])
  a.repo.flush()
  b.repo.apply([put('other')])
  b.repo.flush()
  assert.equal(a.login(), true)
  assert.equal(a.repo.status.state, 'pending')
  assert.deepEqual(a.repo.status.conflicts, [])
  assert.equal(a.repo.flush(), true)
  assert.equal(decodeWardrobePayload(server.settings.VPWardrobe).index.outfits.shirt.name, 'Renamed')
})

test('original device repairs a lost second edit even before its first submission was verified', () => {
  const server = { settings: {} }
  const a = device(server)
  a.repo.open({ extensionSettings: server.settings, fresh: true })
  a.repo.apply([put('shirt', 'First')])
  a.repo.flush()
  const b = device(server)
  b.repo.open({ extensionSettings: server.settings, fresh: true })
  a.repo.apply([{ type: 'put-outfit', id: 'shirt', changes: { name: 'Renamed' } }])
  a.repo.flush()
  b.repo.apply([put('other')])
  b.repo.flush()
  assert.equal(a.login(), true)
  assert.deepEqual(a.repo.status.conflicts, [])
  assert.equal(a.repo.index.outfits.shirt.name, 'Renamed')
  assert.equal(a.repo.flush(), true)
  assert.equal(decodeWardrobePayload(server.settings.VPWardrobe).index.outfits.shirt.name, 'Renamed')
})

test('unverified in-session host wardrobe change blocks the next upload', () => {
  const server = { settings: {} }
  const a = device(server)
  a.repo.open({ extensionSettings: server.settings, fresh: true })
  a.repo.apply([put('first')])
  a.repo.flush()
  a.login()
  a.player.ExtensionSettings.VPWardrobe = 'changed by another script'
  a.repo.apply([put('second')])
  assert.equal(a.repo.flush(), false)
  assert.equal(decodeWardrobePayload(server.settings.VPWardrobe).index.outfits.second, undefined)
  assert.equal(a.login(), true)
  assert.equal(a.repo.flush(), true)
  assert.ok(decodeWardrobePayload(server.settings.VPWardrobe).index.outfits.second)
})

test('unverified in-session device marker change also blocks the next upload', () => {
  const server = { settings: {} }
  const a = device(server)
  a.repo.open({ extensionSettings: server.settings, fresh: true })
  a.repo.apply([put('first')])
  a.repo.flush()
  a.login()
  a.player.ExtensionSettings[a.repo.markerKey] = '{"v":1,"s":2}'
  a.repo.apply([put('second')])
  assert.equal(a.repo.flush(), false)
  assert.equal(decodeWardrobePayload(server.settings.VPWardrobe).index.outfits.second, undefined)
})

test('the 17th device saves locally but cannot add another BC marker', () => {
  const ids = Array.from({ length: 16 }, (_, index) => (index + 1).toString(16).padStart(32, '0'))
  const settings = Object.fromEntries(ids.map(id => [`VPW4_M_${id}`, '{"v":1,"s":0}']))
  settings.VPWardrobe = LZString.compressToBase64(JSON.stringify({ protocol: 'VPW4',
    index: createWardrobeIndex(), a: Object.fromEntries(ids.map(id => [id, 0])) }))
  const server = { settings }
  const local = new Map([['VPW4_device_42', 'ffffffffffffffffffffffffffffffff']])
  const newcomer = device(server, local)
  assert.equal(newcomer.repo.open(), true)
  assert.equal(newcomer.login(), true)
  newcomer.repo.apply([put('local-only')])
  assert.equal(newcomer.repo.status.state, 'error')
  assert.equal(newcomer.repo.status.errorCode, 'device-limit')
  assert.equal(newcomer.repo.quota.proposalAvailable, false)
  assert.equal(newcomer.repo.quota.observedSource, 'login-response')
  assert.equal(newcomer.repo.quota.observed.totalBytes,
    new TextEncoder().encode(JSON.stringify(server.settings)).byteLength)
  assert.match(newcomer.repo.status.error, /16-device marker limit/)
  assert.equal(newcomer.repo.flush(), false)
  assert.ok(decodeWardrobePayload(local.get(newcomer.repo.key)).index.outfits['local-only'])
  assert.equal(decodeWardrobePayload(server.settings.VPWardrobe).index.outfits['local-only'], undefined)
  assert.equal(Object.keys(server.settings).filter(key => key.startsWith('VPW4_M_')).length, 16)
})

test('the 16th device can register and then reuse its own marker', () => {
  const ids = Array.from({ length: 15 }, (_, index) => (index + 1).toString(16).padStart(32, '0'))
  const settings = Object.fromEntries(ids.map(id => [`VPW4_M_${id}`, '{"v":1,"s":0}']))
  settings.VPWardrobe = LZString.compressToBase64(JSON.stringify({ protocol: 'VPW4',
    index: createWardrobeIndex(), a: Object.fromEntries(ids.map(id => [id, 0])) }))
  const server = { settings }
  const local = new Map([['VPW4_device_42', 'ffffffffffffffffffffffffffffffff']])
  const device16 = device(server, local)
  assert.equal(device16.repo.open({ extensionSettings: server.settings, fresh: true }), true)
  device16.repo.apply([put('first')])
  assert.equal(device16.repo.flush(), true)
  assert.equal(Object.keys(server.settings).filter(key => key.startsWith('VPW4_M_')).length, 16)
  assert.equal(device16.login(), true)
  const reopened = device(server, local)
  assert.equal(reopened.repo.open({ extensionSettings: server.settings, fresh: true }), true)
  reopened.repo.apply([put('second')])
  assert.equal(reopened.repo.flush(), true)
  assert.equal(Object.keys(server.settings).filter(key => key.startsWith('VPW4_M_')).length, 16)
  assert.ok(decodeWardrobePayload(server.settings.VPWardrobe).index.outfits.second)
})

test('a partial conflict choice survives an unrelated local edit and fresh read', () => {
  const server = { settings: {} }
  const a = device(server)
  a.repo.open({ extensionSettings: server.settings, fresh: true })
  a.repo.apply([put('x', 'Base X'), put('y', 'Base Y')])
  a.repo.flush()
  a.login()
  const b = device(server)
  b.repo.open({ extensionSettings: server.settings, fresh: true })
  b.repo.apply([
    { type: 'put-outfit', id: 'x', changes: { name: 'B X' } },
    { type: 'put-outfit', id: 'y', changes: { name: 'B Y' } },
  ])
  a.repo.apply([
    { type: 'put-outfit', id: 'x', changes: { name: 'A X' } },
    { type: 'put-outfit', id: 'y', changes: { name: 'A Y' } },
  ])
  a.repo.flush()
  assert.equal(b.login(), true)
  assert.equal(b.repo.status.state, 'conflict')
  const names = b.repo.status.conflicts.filter(conflict => conflict.field === 'name')
  assert.equal(names.length, 2)
  b.repo.resolveSyncConflict([{ kind: 'outfit', id: 'x', field: 'name', choice: 'local' }])
  assert.equal(b.repo.status.conflicts.filter(conflict => conflict.field === 'name').length, 1)
  b.repo.apply([put('z')])
  assert.equal(b.repo.status.conflicts.filter(conflict => conflict.field === 'name').length, 1)
  assert.equal(b.login(), true)
  assert.equal(b.repo.status.conflicts.filter(conflict => conflict.field === 'name').length, 1)
  b.repo.resolveSyncConflict([{ kind: 'outfit', id: 'y', field: 'name', choice: 'cloud' }])
  assert.equal(b.repo.flush(), true)
  const cloud = decodeWardrobePayload(server.settings.VPWardrobe).index
  assert.equal(cloud.outfits.x.name, 'B X')
  assert.equal(cloud.outfits.y.name, 'A Y')
  assert.ok(cloud.outfits.z)
})

test('observed quota remains the last immutable login snapshot after Player changes', () => {
  const server = { settings: { Other: 'small' } }
  const a = device(server)
  assert.equal(a.repo.open({ extensionSettings: server.settings, fresh: true }), true)
  const observed = a.repo.quota.observed.totalBytes
  a.player.ExtensionSettings.Other = 'x'.repeat(1000)
  a.repo.measure()
  assert.equal(a.repo.quota.observedSource, 'login-response')
  assert.equal(a.repo.quota.observed.totalBytes, observed)
  assert.ok(a.repo.quota.totalBytes > observed)
})
