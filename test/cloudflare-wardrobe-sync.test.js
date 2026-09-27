import assert from 'node:assert/strict'
import { test } from 'node:test'
import { syncCloudflareRepository } from '../src/services/cloudflare-wardrobe-sync.js'
import { applyWardrobeOperations, createWardrobeIndex } from '../src/services/wardrobe-index.js'

const outfit = name => applyWardrobeOperations(createWardrobeIndex(), [{
  type: 'put-outfit', id: name, changes: { name, data: [], tagIds: [] },
}], { replicaId: 'test-device' })

test('first sync seeds an empty cloud wardrobe and verifies the acknowledged revision', async () => {
  const local = outfit('shirt')
  const calls = []
  const repository = {
    observeCloudflareSnapshot: async remote => {
      calls.push(['observe', remote.revision])
      return { conflicts: [] }
    },
    cloudflarePlan: async () => {
      calls.push(['plan'])
      return { revision: 0, index: local, conflicts: [] }
    },
    confirmCloudflareWrite: async acknowledged => {
      calls.push(['confirm', acknowledged.revision])
      assert.deepEqual(acknowledged.index, local)
      return true
    },
  }
  const client = {
    read: async () => {
      calls.push(['read'])
      return { revision: 0, index: null }
    },
    write: async (_key, revision, index) => {
      calls.push(['write', revision])
      assert.deepEqual(index, local)
      return 1
    },
  }
  assert.deepEqual(await syncCloudflareRepository(repository, client, 'key'),
    { state: 'verified', revision: 1 })
  assert.deepEqual(calls, [['read'], ['observe', 0], ['plan'], ['write', 0], ['confirm', 1]])
})

test('an identical server snapshot is verified without an extra write', async () => {
  const index = outfit('shirt')
  let writes = 0
  const repository = {
    observeCloudflareSnapshot: async () => ({ conflicts: [] }),
    cloudflarePlan: async () => ({ revision: 4, index, conflicts: [] }),
  }
  const client = {
    read: async () => ({ revision: 4, index }),
    write: async () => { writes++; return 5 },
  }
  assert.deepEqual(await syncCloudflareRepository(repository, client, 'key'),
    { state: 'verified', revision: 4 })
  assert.equal(writes, 0)
})

test('a concurrent 409 snapshot is merged and retried at its new revision', async () => {
  const local = outfit('local')
  const remote = outfit('remote')
  const calls = []
  const repository = {
    observeCloudflareSnapshot: async snapshot => {
      calls.push(['observe', snapshot.revision])
      return { conflicts: [] }
    },
    cloudflarePlan: async () => ({
      revision: calls.at(-1)[1], index: local, conflicts: [],
    }),
    confirmCloudflareWrite: async ({ revision }) => {
      calls.push(['confirm', revision])
      return true
    },
  }
  let reads = 0
  const client = {
    read: async () => { reads++; return { revision: 0, index: null } },
    write: async (_key, revision) => {
      calls.push(['write', revision])
      if (revision === 0) throw Object.assign(new Error('conflict'), {
        code: 'cloudflare-conflict', remote: { revision: 1, index: remote },
      })
      return 2
    },
  }
  assert.deepEqual(await syncCloudflareRepository(repository, client, 'key'),
    { state: 'verified', revision: 2 })
  assert.equal(reads, 1)
  assert.deepEqual(calls, [['observe', 0], ['write', 0], ['observe', 1],
    ['write', 1], ['confirm', 2]])
})

test('unresolved local conflict stops before upload', async () => {
  let writes = 0
  const client = {
    read: async () => ({ revision: 3, index: createWardrobeIndex() }),
    write: async () => { writes++ },
  }
  const repository = {
    observeCloudflareSnapshot: async () => ({ conflicts: [{ id: 'shirt' }] }),
  }
  assert.deepEqual(await syncCloudflareRepository(repository, client, 'key'),
    { state: 'conflict', revision: 3 })
  assert.equal(writes, 0)
})

test('an existing repository conflict also stops before upload', async () => {
  let writes = 0
  const client = {
    read: async () => ({ revision: 3, index: createWardrobeIndex() }),
    write: async () => { writes++ },
  }
  const repository = {
    observeCloudflareSnapshot: async () => ({ conflicts: [] }),
    cloudflarePlan: async () => ({ revision: 3, index: createWardrobeIndex(),
      conflicts: [{ id: 'shirt' }] }),
  }
  assert.deepEqual(await syncCloudflareRepository(repository, client, 'key'),
    { state: 'conflict', revision: 3 })
  assert.equal(writes, 0)
})

test('failed write never confirms or reports verified', async () => {
  let confirms = 0
  const repository = {
    observeCloudflareSnapshot: async () => ({ conflicts: [] }),
    cloudflarePlan: async () => ({ revision: 0, index: outfit('shirt'), conflicts: [] }),
    confirmCloudflareWrite: async () => { confirms++ },
  }
  const client = {
    read: async () => ({ revision: 0, index: null }),
    write: async () => { throw Object.assign(new Error('timeout'), { code: 'cloudflare-timeout' }) },
  }
  await assert.rejects(syncCloudflareRepository(repository, client, 'key'),
    error => error.code === 'cloudflare-timeout')
  assert.equal(confirms, 0)
})

test('if local confirmation fails after PUT, reread verifies the committed server state', async () => {
  const index = outfit('shirt')
  let reads = 0
  let writes = 0
  const repository = {
    observeCloudflareSnapshot: async () => ({ conflicts: [] }),
    cloudflarePlan: async () => ({ revision: reads === 1 ? 0 : 1, index, conflicts: [] }),
    confirmCloudflareWrite: async () => false,
  }
  const client = {
    read: async () => ({ revision: reads++, index: reads === 1 ? null : index }),
    write: async () => { writes++; return 1 },
  }
  assert.deepEqual(await syncCloudflareRepository(repository, client, 'key'),
    { state: 'verified', revision: 1 })
  assert.equal(reads, 2)
  assert.equal(writes, 1)
})

test('repeated 409 responses exhaust retries without a false verified state', async () => {
  const repository = {
    document: { cloudflareRevision: 2 },
    observeCloudflareSnapshot: async () => ({ conflicts: [] }),
    cloudflarePlan: async () => ({ revision: 2, index: outfit('shirt'), conflicts: [] }),
  }
  let writes = 0
  const client = {
    read: async () => ({ revision: 2, index: null }),
    write: async () => {
      writes++
      throw Object.assign(new Error('conflict'), {
        code: 'cloudflare-conflict', remote: { revision: 2, index: null },
      })
    },
  }
  assert.deepEqual(await syncCloudflareRepository(repository, client, 'key', { maxAttempts: 2 }),
    { state: 'pending', revision: 2 })
  assert.equal(writes, 2)
})
