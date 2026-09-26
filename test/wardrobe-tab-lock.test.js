import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWardrobeTabLock } from '../src/utils/wardrobe-tab-lock.js'

class FakeLocks {
  held = new Set()
  queues = new Map()

  request(name, { signal }, callback) {
    return new Promise((resolve, reject) => {
      const queue = this.queues.get(name) || []
      this.queues.set(name, queue)
      const job = { run: null }
      const abort = () => {
        const index = queue.indexOf(job)
        if (index >= 0) queue.splice(index, 1)
        reject(new Error('aborted'))
      }
      job.run = () => {
        signal?.removeEventListener('abort', abort)
        if (signal?.aborted) return abort()
        this.held.add(name)
        Promise.resolve().then(() => callback({ name })).then(resolve, reject).finally(() => {
          this.held.delete(name)
          this.drain(name)
        })
      }
      signal?.addEventListener('abort', abort, { once: true })
      queue.push(job)
      this.drain(name)
    })
  }

  drain(name) {
    if (!this.held.has(name)) this.queues.get(name)?.shift()?.run()
  }
}

test('one account has one writer and a waiting tab takes over after release', async () => {
  const locks = new FakeLocks()
  const changes = []
  const first = createWardrobeTabLock({ locks, onChange: (owned) => changes.push(['first', owned]) })
  const second = createWardrobeTabLock({ locks, onChange: (owned) => changes.push(['second', owned]) })
  assert.equal(await first.acquire(42), true)
  let secondReady = false
  const waiting = second.acquire(42).then(value => { secondReady = value; return value })
  await Promise.resolve()
  assert.equal(secondReady, false)
  assert.equal(second.isHeldFor(42), false)
  first.release()
  assert.equal(await waiting, true)
  assert.equal(second.isHeldFor(42), true)
  second.dispose()
  assert.deepEqual(changes, [
    ['first', true], ['first', false], ['second', true], ['second', false],
  ])
})

test('a pre-login tab can yield the origin lock and reacquire after the active tab closes', async () => {
  const locks = new FakeLocks()
  const loginTab = createWardrobeTabLock({ locks })
  const wardrobeTab = createWardrobeTabLock({ locks })
  assert.equal(await loginTab.acquire('origin'), true)
  const waitingWardrobe = wardrobeTab.acquire('origin')
  loginTab.release() // Visibility changed to hidden before login.
  assert.equal(await waitingWardrobe, true)
  const visibleAgain = loginTab.acquire('origin')
  wardrobeTab.release()
  assert.equal(await visibleAgain, true)
  loginTab.dispose()
  wardrobeTab.dispose()
})

test('different BC accounts use independent locks', async () => {
  const locks = new FakeLocks()
  const first = createWardrobeTabLock({ locks })
  const second = createWardrobeTabLock({ locks })
  assert.equal(await first.acquire(42), true)
  assert.equal(await second.acquire(43), true)
  assert.equal(first.isHeldFor(43), false)
  first.dispose()
  second.dispose()
})

test('account switch cancels a queued request without a stale takeover', async () => {
  const locks = new FakeLocks()
  const owner = createWardrobeTabLock({ locks })
  const switching = createWardrobeTabLock({ locks })
  assert.equal(await owner.acquire(42), true)
  const oldRequest = switching.acquire(42)
  assert.equal(await switching.acquire(43), true)
  assert.equal(await oldRequest, false)
  owner.release()
  await Promise.resolve()
  assert.equal(switching.isHeldFor(42), false)
  assert.equal(switching.isHeldFor(43), true)
  switching.dispose()
})

test('without Web Locks cloud ownership fails closed', async () => {
  const lock = createWardrobeTabLock({ locks: undefined })
  assert.equal(lock.supported, false)
  assert.equal(await lock.acquire(42), false)
  assert.equal(lock.isHeldFor(42), false)
  lock.dispose()
  assert.equal(await lock.acquire(42), false)
})
