import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { installWardrobeSyncEvents } from '../src/utils/wardrobe-sync-events.js'

function setup(callbacks = {}) {
  const windowEvents = new EventEmitter()
  const socket = new EventEmitter()
  let hook
  let unhookCount = 0
  const errors = []
  const hostWindow = {
    Player: { MemberNumber: 42, ExtensionSettings: { VPWardrobe: 'stale player value' } },
    ServerSocket: socket,
    addEventListener: (name, listener) => windowEvents.on(name, listener),
    removeEventListener: (name, listener) => windowEvents.off(name, listener),
  }
  const modApi = {
    hookFunction(name, priority, callback) {
      assert.equal(name, 'LoginResponse')
      hook = callback
      return () => { unhookCount++ }
    },
  }
  const dispose = installWardrobeSyncEvents({ hostWindow, modApi, onError: (error) => errors.push(error), ...callbacks })
  return { hostWindow, windowEvents, socket, dispose, errors, login: (args, next = () => undefined) => hook(args, next), unhookCount: () => unhookCount }
}

const response = (overrides = {}) => ({
  AccountName: 'fixture', Name: 'Fixture', ID: 'socket-id', MemberNumber: 42,
  ExtensionSettings: { VPWardrobe: 'fresh response value', Other: 'preserved' },
  ...overrides,
})

test('runs the game first, keeps its return value, and delivers the fresh login response', () => {
  const order = []
  let received
  const fixture = setup({ onLogin: (payload) => { order.push('sync'); received = payload } })
  const data = response()
  const result = fixture.login([data], (args) => {
    assert.equal(args[0], data)
    order.push('game')
    return 'game-result'
  })

  assert.equal(result, 'game-result')
  assert.deepEqual(order, ['game', 'sync'])
  assert.equal(received.memberNumber, 42)
  assert.equal(received.rawWardrobe, 'fresh response value')
  assert.deepEqual(received.extensionSettings, data.ExtensionSettings)
  assert.notEqual(received.extensionSettings, data.ExtensionSettings)
  assert.equal(fixture.hostWindow.Player.ExtensionSettings.VPWardrobe, 'stale player value')
  fixture.dispose()
})

test('ignores failed or incomplete login responses and handles missing extension data', () => {
  const received = []
  const fixture = setup({ onLogin: (payload) => received.push(payload) })
  for (const invalid of ['InvalidNamePassword', null, [], {}, response({ AccountName: '' }), response({ Name: '' }), response({ ID: null }), response({ MemberNumber: null })]) {
    assert.equal(fixture.login([invalid], () => 'result'), 'result')
  }
  assert.equal(received.length, 0)
  fixture.login([response({ ExtensionSettings: undefined })])
  assert.deepEqual(received[0].extensionSettings, {})
  assert.equal(received[0].rawWardrobe, undefined)
  fixture.login([response({ ID: 123 })])
  assert.equal(received.length, 2)
  fixture.dispose()
})

test('callback errors do not interrupt game login and game exceptions keep their behavior', async () => {
  const error = new Error('persistence failed')
  const fixture = setup({ onLogin: () => { throw error }, onOnline: async () => { throw error } })
  assert.equal(fixture.login([response()], () => 17), 17)
  assert.deepEqual(fixture.errors, [error])
  fixture.windowEvents.emit('online')
  await Promise.resolve()
  assert.deepEqual(fixture.errors, [error, error])
  const gameError = new Error('game failed')
  assert.throws(() => fixture.login([response()], () => { throw gameError }), gameError)
  assert.equal(fixture.errors.length, 2)
  fixture.dispose()
})

test('forwards storage and browser/socket connectivity events without reading Player settings', () => {
  const events = []
  const fixture = setup({
    onStorage: (event) => events.push(['storage', event]),
    onOnline: (event) => events.push(['online', event]),
    onOffline: (event) => events.push(['offline', event]),
  })
  const storage = { key: 'scoped wardrobe key', newValue: 'payload' }
  fixture.windowEvents.emit('storage', storage)
  fixture.windowEvents.emit('online')
  fixture.socket.emit('connect')
  fixture.socket.emit('disconnect', 'transport close')
  fixture.windowEvents.emit('offline')

  assert.deepEqual(events, [
    ['storage', storage], ['online', { source: 'browser' }], ['online', { source: 'socket' }],
    ['offline', { source: 'socket', reason: 'transport close' }], ['offline', { source: 'browser' }],
  ])
  fixture.dispose()
})

test('rebinds a replaced host socket after login and detaches old listeners', () => {
  const events = []
  const fixture = setup({ onOnline: (event) => events.push(event) })
  const replacement = new EventEmitter()
  fixture.hostWindow.ServerSocket = replacement
  fixture.login([response()])
  assert.equal(fixture.socket.listenerCount('connect'), 0)
  assert.equal(fixture.socket.listenerCount('disconnect'), 0)
  fixture.socket.emit('connect')
  replacement.emit('connect')
  fixture.login([response()])
  assert.equal(replacement.listenerCount('connect'), 1)
  assert.deepEqual(events, [{ source: 'socket' }])
  fixture.dispose()
  assert.equal(replacement.listenerCount('connect'), 0)
  assert.equal(replacement.listenerCount('disconnect'), 0)
})

test('dispose is idempotent and removes every hook and listener', () => {
  let callbackCount = 0
  const callback = () => { callbackCount++ }
  const fixture = setup({ onLogin: callback, onStorage: callback, onOnline: callback, onOffline: callback })
  fixture.dispose()
  fixture.dispose()
  fixture.windowEvents.emit('storage', {})
  fixture.windowEvents.emit('online')
  fixture.windowEvents.emit('offline')
  fixture.socket.emit('connect')
  fixture.socket.emit('disconnect')
  assert.equal(fixture.login([response()], () => 'still game'), 'still game')
  assert.equal(callbackCount, 0)
  assert.equal(fixture.unhookCount(), 1)
  assert.deepEqual(fixture.windowEvents.eventNames(), [])
  assert.deepEqual(fixture.socket.eventNames(), [])
})
