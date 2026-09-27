import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CloudflareWardrobeClient, generateCloudflareRecoveryKey,
  isCloudflareRecoveryKey,
} from '../src/services/cloudflare-wardrobe-client.js'
import { createWardrobeIndex } from '../src/services/wardrobe-index.js'

const response = (status, body) => ({
  status, ok: status >= 200 && status < 300,
  json: async () => body,
})
const key = generateCloudflareRecoveryKey({
  getRandomValues(bytes) {
    bytes.set(Uint8Array.from({ length: 32 }, (_, i) => i))
    return bytes
  },
})

test('recovery key uses 32 random bytes and rejects truncated or altered keys', () => {
  assert.match(key, /^vpw1_[A-Za-z0-9_-]{43}$/)
  assert.equal(isCloudflareRecoveryKey(key), true)
  assert.equal(isCloudflareRecoveryKey(key.slice(0, -1)), false)
  assert.equal(isCloudflareRecoveryKey(`${key}!`), false)
  assert.equal(isCloudflareRecoveryKey(key.replace('vpw1_', 'vpw2_')), false)
  assert.throws(() => generateCloudflareRecoveryKey({}), /Secure random/)
})

test('client requires HTTPS outside loopback and never sends browser credentials', async () => {
  assert.throws(() => new CloudflareWardrobeClient({ baseUrl: 'http://example.com' }), /HTTPS/)
  const requests = []
  const client = new CloudflareWardrobeClient({
    baseUrl: 'https://example.com/sync/',
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return response(200, { revision: 0, index: null })
    },
  })
  assert.deepEqual(await client.read(key), { revision: 0, index: null })
  assert.equal(requests[0].url, 'https://example.com/sync/api/wardrobe')
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${key}`)
  assert.equal(requests[0].options.credentials, 'omit')
  assert.equal(requests[0].options.cache, 'no-store')
  assert.equal(requests[0].options.method, 'GET')
  assert.equal('body' in requests[0].options, false)
  await assert.rejects(client.read('wrong-key'), /Invalid Cloudflare recovery key/)
  assert.equal(requests.length, 1)
})

test('write sends the expected revision and requires a newer confirmed revision', async () => {
  const index = createWardrobeIndex()
  const requests = []
  const client = new CloudflareWardrobeClient({
    baseUrl: 'https://example.com',
    fetchImpl: async (_url, options) => {
      requests.push(options)
      return response(200, { revision: 2 })
    },
  })
  assert.equal(await client.write(key, 1, index), 2)
  assert.deepEqual(JSON.parse(requests[0].body), { expectedRevision: 1, index })
  await assert.rejects(client.write(key, -1, index), /Invalid Cloudflare wardrobe revision/)
  await assert.rejects(client.write(key, 0, { bad: true }), /Invalid wardrobe index/)
  assert.equal(requests.length, 1)

  const stale = new CloudflareWardrobeClient({
    baseUrl: 'https://example.com',
    fetchImpl: async () => response(200, { revision: 1 }),
  })
  await assert.rejects(stale.write(key, 1, index), /did not confirm/)
})

test('conflict carries a validated remote snapshot for a retry', async () => {
  const index = createWardrobeIndex()
  const client = new CloudflareWardrobeClient({
    baseUrl: 'https://example.com',
    fetchImpl: async () => response(409, { revision: 3, index }),
  })
  await assert.rejects(client.write(key, 2, index), error => {
    assert.equal(error.code, 'cloudflare-conflict')
    assert.deepEqual(error.remote, { revision: 3, index })
    return true
  })
  const invalid = new CloudflareWardrobeClient({
    baseUrl: 'https://example.com',
    fetchImpl: async () => response(409, { revision: 3, index: { bad: true } }),
  })
  await assert.rejects(invalid.write(key, 2, index), /Invalid wardrobe index/)
})

test('timeout and HTTP failure cannot be mistaken for successful synchronization', async () => {
  const timeout = new CloudflareWardrobeClient({
    baseUrl: 'https://example.com', timeoutMs: 1,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {
        name: 'AbortError',
      })), { once: true })
    }),
  })
  await assert.rejects(timeout.read(key), error => error.code === 'cloudflare-timeout')

  const failed = new CloudflareWardrobeClient({
    baseUrl: 'https://example.com',
    fetchImpl: async () => response(503, { error: 'unavailable' }),
  })
  await assert.rejects(failed.read(key), error => error.code === 'cloudflare-http'
    && error.status === 503)
})
