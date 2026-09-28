import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyWardrobeOperations, createWardrobeIndex, projectWardrobeCloudIndex } from '../src/services/wardrobe-index.js'
import { CLOUDFLARE_WARDROBE_LIMIT_BYTES, estimateCloudflareWardrobeBytes } from '../src/ui/cloudflare-size.js'

test('Cloudflare estimate matches the UTF-8 JSON sent to the service and excludes local-only outfits', () => {
  const publicIndex = applyWardrobeOperations(createWardrobeIndex(), [{
    type: 'put-outfit', id: 'public', changes: {
      name: '春装', type: 'outfit', data: [{ Group: 'Cloth', Name: '裙子' }], tagIds: [],
    },
  }], { replicaId: 'device-a' })
  const withPrivate = applyWardrobeOperations(publicIndex, [{
    type: 'put-outfit', id: 'private', changes: {
      name: '仅本机', type: 'outfit', data: [{ Group: 'Cloth', Name: 'x'.repeat(10_000) }], tagIds: [],
    },
  }, { type: 'set-cloud', id: 'private', enabled: false }], { replicaId: 'device-a' })
  const projected = projectWardrobeCloudIndex(withPrivate)

  assert.equal(CLOUDFLARE_WARDROBE_LIMIT_BYTES, 8_000_000)
  assert.equal(projected.outfits.private, undefined)
  assert.equal(estimateCloudflareWardrobeBytes(withPrivate),
    Buffer.byteLength(JSON.stringify(projected), 'utf8'))
  assert.ok(estimateCloudflareWardrobeBytes(withPrivate) <
    Buffer.byteLength(JSON.stringify(withPrivate), 'utf8') - 9_000)
  assert.ok(estimateCloudflareWardrobeBytes(publicIndex) >
    JSON.stringify(projectWardrobeCloudIndex(publicIndex)).length)
})
