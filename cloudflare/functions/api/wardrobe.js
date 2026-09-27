const MAX_INDEX_BYTES = 1_800_000
const MAX_REQUEST_BYTES = MAX_INDEX_BYTES + 8_192
const MAX_ACCOUNTS = 100
const MAX_CREATIONS_PER_IP_DAY = 2
const MAX_WRITES_PER_ACCOUNT_DAY = 500
const encoder = new TextEncoder()

const BC_ORIGINS = new Set([
  'https://bondageprojects.elementfx.com',
  'https://www.bondageprojects.elementfx.com',
  'https://bondage-europe.com',
  'https://www.bondage-europe.com',
  'https://bondage-asia.com',
  'https://www.bondage-asia.com',
])

function allowedOrigin(request) {
  const origin = request.headers.get('Origin')
  if (!origin) return null
  if (origin === new URL(request.url).origin || BC_ORIGINS.has(origin)) return origin
  if (/^http:\/\/localhost(?::\d+)?$/.test(origin)) return origin
  return false
}

function response(request, body, status = 200) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  })
  const origin = allowedOrigin(request)
  if (origin) headers.set('Access-Control-Allow-Origin', origin)
  return new Response(JSON.stringify(body), { status, headers })
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validId(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isRevision(value) {
  return Array.isArray(value) && value.length === 2
    && Number.isSafeInteger(value[0]) && value[0] >= 0
    && validId(value[1])
}

function validIndex(index) {
  if (!isObject(index) || index.schemaVersion !== 3
    || !Number.isSafeInteger(index.clock) || index.clock < 0
    || !isObject(index.outfits) || !isObject(index.tags)
    || !isObject(index.tombstones) || !isObject(index.tombstones.outfits)
    || !isObject(index.tombstones.tags) || !isObject(index.cloudState)) return false
  for (const kind of ['outfits', 'tags']) {
    for (const [id, record] of Object.entries(index[kind])) {
      if (!validId(id) || !isObject(record) || record.id !== id
        || typeof record.name !== 'string' || !isRevision(record.rev)) return false
      if (kind === 'outfits' && (typeof record.type !== 'string' || !record.type
        || !Array.isArray(record.tagIds) || !record.tagIds.every(validId)))
        return false
      if (kind === 'tags' && !record.name.normalize('NFKC').trim()) return false
    }
    for (const [id, revision] of Object.entries(index.tombstones[kind])) {
      if (!validId(id) || !isRevision(revision)) return false
    }
  }
  for (const [id, state] of Object.entries(index.cloudState)) {
    if (!validId(id) || !isObject(state) || typeof state.enabled !== 'boolean'
      || !isRevision(state.rev)) return false
    // A private outfit must never be uploaded, even by a buggy client.
    if (!state.enabled && Object.hasOwn(index.outfits, id)) return false
  }
  return true
}

async function accountHash(request) {
  const authorization = request.headers.get('Authorization') || ''
  const match = /^Bearer (vpw1_[A-Za-z0-9_-]{43})$/.exec(authorization)
  if (!match) return null
  const bytes = Uint8Array.from(atob(match[1].slice(5).replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))
  if (bytes.length !== 32) return null
  const canonical = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  if (canonical !== match[1].slice(5)) return null
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(match[1]))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function dailyIpHash(request, secret, day) {
  const ip = request.headers.get('CF-Connecting-IP')
  if (!ip || typeof secret !== 'string' || secret.length < 32) return null
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`${day}:${ip}`))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function boundedBody(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_REQUEST_BYTES) return null
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function rowDocument(row) {
  return row
    ? { revision: row.revision, index: JSON.parse(row.index_json), updatedAt: row.updated_at }
    : { revision: 0, index: null, updatedAt: null }
}

async function currentDocument(db, hash) {
  const row = await db.prepare('SELECT revision, index_json, updated_at FROM wardrobes WHERE account_hash = ?')
    .bind(hash).first()
  return rowDocument(row)
}

export async function onRequest({ request, env }) {
  if (allowedOrigin(request) === false) return response(request, { error: 'origin-not-allowed' }, 403)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': allowedOrigin(request) || new URL(request.url).origin,
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '3600',
        'Cache-Control': 'no-store',
        Vary: 'Origin',
      },
    })
  }
  if (request.method !== 'GET' && request.method !== 'PUT') {
    return response(request, { error: 'method-not-allowed' }, 405)
  }
  const hash = await accountHash(request)
  if (!hash) return response(request, { error: 'invalid-key' }, 401)
  if (!env.DB) return response(request, { error: 'storage-unavailable' }, 503)
  try {
    if (request.method === 'GET') return response(request, await currentDocument(env.DB, hash))
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
      return response(request, { error: 'expected-json' }, 415)
    }
    let payload
    try {
      const text = await boundedBody(request)
      if (text === null) return response(request, { error: 'too-large', maxIndexBytes: MAX_INDEX_BYTES }, 413)
      payload = JSON.parse(text)
    } catch {
      return response(request, { error: 'invalid-json' }, 400)
    }
    if (!isObject(payload) || !Number.isSafeInteger(payload.expectedRevision)
      || payload.expectedRevision < 0 || !validIndex(payload.index)) {
      return response(request, { error: 'invalid-wardrobe' }, 400)
    }
    const indexJson = JSON.stringify(payload.index)
    if (encoder.encode(indexJson).byteLength > MAX_INDEX_BYTES) {
      return response(request, { error: 'too-large', maxIndexBytes: MAX_INDEX_BYTES }, 413)
    }
    const nextRevision = payload.expectedRevision + 1
    if (!Number.isSafeInteger(nextRevision)) return response(request, { error: 'revision-exhausted' }, 400)
    const updatedAt = Date.now()
    const day = Math.floor(updatedAt / 86_400_000)
    let result
    if (payload.expectedRevision === 0) {
      const ipHash = await dailyIpHash(request, env.VPW_PROVISIONING_SECRET, day)
      if (!ipHash) return response(request, { error: 'provisioning-unavailable' }, 503)
      result = await env.DB.prepare(`
        INSERT OR IGNORE INTO wardrobes
          (account_hash, revision, index_json, updated_at, created_ip_hash, created_day, write_day, writes_today)
        SELECT ?, 1, ?, ?, ?, ?, ?, 1
        WHERE (SELECT COUNT(*) FROM wardrobes) < ?
          AND (SELECT COUNT(*) FROM wardrobes WHERE created_ip_hash = ? AND created_day = ?) < ?
      `).bind(hash, indexJson, updatedAt, ipHash, day, day,
        MAX_ACCOUNTS, ipHash, day, MAX_CREATIONS_PER_IP_DAY).run()
    } else {
      result = await env.DB.prepare(`
        UPDATE wardrobes SET revision = ?, index_json = ?, updated_at = ?, write_day = ?,
          writes_today = CASE WHEN write_day = ? THEN writes_today + 1 ELSE 1 END
        WHERE account_hash = ? AND revision = ? AND (write_day <> ? OR writes_today < ?)
      `).bind(nextRevision, indexJson, updatedAt, day, day, hash, payload.expectedRevision,
        day, MAX_WRITES_PER_ACCOUNT_DAY).run()
    }
    if (result.meta?.changes === 1) return response(request, { revision: nextRevision, updatedAt })
    const current = await currentDocument(env.DB, hash)
    if (current.revision !== payload.expectedRevision) {
      return response(request, { error: 'conflict', ...current }, 409)
    }
    return response(request, { error: current.revision === 0 ? 'capacity-reached' : 'write-limit' }, 429)
  } catch {
    return response(request, { error: 'storage-unavailable' }, 503)
  }
}
