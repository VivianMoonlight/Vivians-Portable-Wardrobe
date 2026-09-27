import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { onRequest } from '../functions/api/wardrobe.js'

const API_URL = 'https://vpw-cloud-sync.pages.dev/api/wardrobe'
const KEY_A = `vpw1_${Buffer.alloc(32, 17).toString('base64url')}`
const KEY_B = `vpw1_${Buffer.alloc(32, 31).toString('base64url')}`
const KEY_C = `vpw1_${Buffer.alloc(32, 43).toString('base64url')}`
const PROVISIONING_SECRET = 'test-only-provisioning-secret-with-32-chars'

function index(name = 'Blue dress') {
  return {
    schemaVersion: 3,
    clock: 1,
    outfits: { outfit_1: { id: 'outfit_1', name, type: 'outfit', tagIds: [], data: [], rev: [1, 'test'] } },
    tags: {}, tombstones: { outfits: {}, tags: {} },
    cloudState: { outfit_1: { enabled: true, rev: [1, 'test'] } },
  }
}

function database() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'))
  return {
    sqlite,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            first() { return sqlite.prepare(sql).get(...values) || null },
            run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } } },
          }
        },
      }
    },
  }
}

function request(db, method = 'GET', { key = KEY_A, origin, body, ip = '203.0.113.10', secret = PROVISIONING_SECRET } = {}) {
  const headers = { Authorization: `Bearer ${key}`, 'CF-Connecting-IP': ip }
  if (origin) headers.Origin = origin
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  return onRequest({
    request: new Request(API_URL, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env: { DB: db, VPW_PROVISIONING_SECRET: secret },
  })
}

test('new key starts empty; write and read use one active revision', async () => {
  const db = database()
  const empty = await request(db)
  assert.deepEqual(await empty.json(), { revision: 0, index: null, updatedAt: null })
  const saved = await request(db, 'PUT', { body: { expectedRevision: 0, index: index() } })
  assert.equal(saved.status, 200)
  assert.equal((await saved.json()).revision, 1)
  const loaded = await request(db)
  const document = await loaded.json()
  assert.equal(document.revision, 1)
  assert.equal(document.index.outfits.outfit_1.name, 'Blue dress')
  assert.match(loaded.headers.get('Cache-Control'), /no-store/)
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM wardrobes').get().count, 1)
})

test('concurrent writes at one revision produce one winner and a reviewable conflict', async () => {
  const db = database()
  await request(db, 'PUT', { body: { expectedRevision: 0, index: index() } })
  const [first, second] = await Promise.all([
    request(db, 'PUT', { body: { expectedRevision: 1, index: index('Red dress') } }),
    request(db, 'PUT', { body: { expectedRevision: 1, index: index('Green dress') } }),
  ])
  assert.deepEqual([first.status, second.status].sort(), [200, 409])
  const conflict = await (first.status === 409 ? first : second).json()
  const current = await (await request(db)).json()
  assert.equal(conflict.error, 'conflict')
  assert.equal(conflict.revision, 2)
  assert.deepEqual(conflict.index, current.index)
  assert.equal(current.revision, 2)
})

test('keys isolate wardrobes and raw credentials never enter D1', async () => {
  const db = database()
  await request(db, 'PUT', { body: { expectedRevision: 0, index: index() } })
  assert.equal((await (await request(db, 'GET', { key: KEY_B })).json()).revision, 0)
  const rows = db.sqlite.prepare('SELECT account_hash FROM wardrobes').all()
  assert.equal(rows.length, 1)
  assert.match(rows[0].account_hash, /^[a-f0-9]{64}$/)
  assert.ok(!JSON.stringify(rows).includes(KEY_A))
})

test('untrusted origins and malformed credentials cannot access data', async () => {
  const db = database()
  const foreign = await request(db, 'GET', { origin: 'https://untrusted.example' })
  assert.equal(foreign.status, 403)
  const malformed = await request(db, 'GET', { key: '187592' })
  assert.equal(malformed.status, 401)
  const nonCanonical = await request(db, 'GET', { key: `${KEY_A.slice(0, -1)}F` })
  assert.equal(nonCanonical.status, 401)
  const allowed = await request(db, 'OPTIONS', { origin: 'https://bondage-europe.com' })
  assert.equal(allowed.status, 204)
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://bondage-europe.com')
})

test('invalid and oversized documents do not change the stored revision', async () => {
  const db = database()
  const privateIndex = index()
  privateIndex.cloudState.outfit_1.enabled = false
  assert.equal((await request(db, 'PUT', { body: { expectedRevision: 0, index: privateIndex } })).status, 400)
  const malformedTag = index()
  malformedTag.tags.tag_1 = { id: 'tag_1', name: '   ', rev: [1, 'test'] }
  assert.equal((await request(db, 'PUT', { body: { expectedRevision: 0, index: malformedTag } })).status, 400)
  const hugeIndex = index()
  hugeIndex.outfits.outfit_1.data = ['x'.repeat(1_800_000)]
  assert.equal((await request(db, 'PUT', { body: { expectedRevision: 0, index: hugeIndex } })).status, 413)
  assert.equal((await (await request(db)).json()).revision, 0)
})

test('new accounts fail closed without server secret and are capped per IP', async () => {
  const db = database()
  const body = { expectedRevision: 0, index: index() }
  const missingSecret = await request(db, 'PUT', { body, secret: '' })
  assert.equal(missingSecret.status, 503)
  assert.equal((await missingSecret.json()).error, 'provisioning-unavailable')
  assert.equal((await request(db, 'PUT', { body })).status, 200)
  assert.equal((await request(db, 'PUT', { key: KEY_B, body })).status, 200)
  const capped = await request(db, 'PUT', { key: KEY_C, body })
  assert.equal(capped.status, 429)
  assert.equal((await capped.json()).error, 'capacity-reached')
  assert.equal((await request(db, 'PUT', { key: KEY_C, ip: '203.0.113.11', body })).status, 200)
})

test('daily write cap refuses more writes without changing the document', async () => {
  const db = database()
  const body = { expectedRevision: 0, index: index() }
  assert.equal((await request(db, 'PUT', { body })).status, 200)
  for (let revision = 1; revision < 500; revision++) {
    body.expectedRevision = revision
    const saved = await request(db, 'PUT', { body })
    assert.equal(saved.status, 200)
  }
  body.expectedRevision = 500
  const limited = await request(db, 'PUT', { body })
  assert.equal(limited.status, 429)
  assert.equal((await limited.json()).error, 'write-limit')
  assert.equal((await (await request(db)).json()).revision, 500)
})

test('global account cap is checked inside the atomic creation statement', async () => {
  const db = database()
  const body = { expectedRevision: 0, index: index() }
  for (let seed = 1; seed < 100; seed++) {
    const key = `vpw1_${Buffer.alloc(32, seed).toString('base64url')}`
    assert.equal((await request(db, 'PUT', { key, ip: `203.0.113.${seed}`, body })).status, 200)
  }
  const candidates = [100, 101].map(seed => request(db, 'PUT', {
    key: `vpw1_${Buffer.alloc(32, seed).toString('base64url')}`,
    ip: `203.0.113.${seed}`, body,
  }))
  const statuses = (await Promise.all(candidates)).map(result => result.status).sort()
  assert.deepEqual(statuses, [200, 429])
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM wardrobes').get().count, 100)
})
