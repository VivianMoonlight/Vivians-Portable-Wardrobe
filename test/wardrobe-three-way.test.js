import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyWardrobeOperations, createWardrobeIndex, projectWardrobeCloudIndex,
} from '../src/services/wardrobe-index.js'
import {
  mergeWardrobeIndexesThreeWay, resolveWardrobeConflicts,
} from '../src/services/wardrobe-three-way.js'

const apply = (index, operations, replicaId = 'device-a') =>
  applyWardrobeOperations(index, operations, { replicaId })

function baseIndex() {
  return apply(createWardrobeIndex(), [
    { type: 'put-tag', id: 'tag-base', name: 'Everyday' },
    { type: 'put-outfit', id: 'dress', changes: {
      name: 'Original', type: 'outfit', tagIds: ['tag-base'],
      data: [{ Group: 'Cloth', Name: 'Dress' }],
      metadata: { note: 'original' },
    } },
  ])
}

test('different outfit fields and independent tag memberships merge without a conflict', () => {
  const base = baseIndex()
  const local = apply(base, [
    { type: 'put-tag', id: 'tag-local', name: 'Local' },
    { type: 'put-outfit', id: 'dress', changes: { name: 'Renamed', tagIds: ['tag-base', 'tag-local'] } },
  ], 'local')
  const remote = apply(base, [
    { type: 'put-tag', id: 'tag-cloud', name: 'Cloud' },
    { type: 'put-outfit', id: 'dress', changes: {
      data: [{ Group: 'Cloth', Name: 'Gown' }], tagIds: ['tag-base', 'tag-cloud'],
    } },
  ], 'cloud')
  const original = structuredClone({ base, local, remote })
  const result = mergeWardrobeIndexesThreeWay(base, local, remote)
  assert.equal(result.canUpload, true)
  assert.deepEqual(result.conflicts, [])
  assert.equal(result.merged.outfits.dress.name, 'Renamed')
  assert.equal(result.merged.outfits.dress.data[0].Name, 'Gown')
  assert.deepEqual(result.merged.outfits.dress.tagIds, ['tag-base', 'tag-cloud', 'tag-local'])
  assert.deepEqual(Object.keys(result.merged.tags), ['tag-base', 'tag-cloud', 'tag-local'])
  assert.deepEqual({ base, local, remote }, original)
})

test('same-field changes are explicit conflicts until a user picks one version', () => {
  const base = baseIndex()
  const local = apply(base, [{ type: 'put-outfit', id: 'dress', changes: { name: 'Local name' } }], 'local')
  const remote = apply(base, [{ type: 'put-outfit', id: 'dress', changes: { name: 'Cloud name' } }], 'cloud')
  const result = mergeWardrobeIndexesThreeWay(base, local, remote)
  assert.equal(result.canUpload, false)
  assert.equal(result.merged.outfits.dress.name, 'Local name')
  assert.deepEqual(result.conflicts.map(({ kind, id, field, type }) => ({ kind, id, field, type })), [
    { kind: 'outfit', id: 'dress', field: 'name', type: 'concurrent-edit' },
  ])
  assert.equal(result.conflicts[0].base, 'Original')
  assert.equal(result.conflicts[0].local, 'Local name')
  assert.equal(result.conflicts[0].remote, 'Cloud name')
  const resolved = resolveWardrobeConflicts(result, [
    { kind: 'outfit', id: 'dress', field: 'name', choice: 'cloud' },
  ], { replicaId: 'resolver' })
  assert.equal(resolved.canUpload, true)
  assert.equal(resolved.merged.outfits.dress.name, 'Cloud name')
  assert.ok(resolved.merged.outfits.dress.rev[0] > remote.outfits.dress.rev[0])
  assert.equal(result.merged.outfits.dress.name, 'Local name')
})

test('identical concurrent edits need no choice and unrelated metadata edits survive', () => {
  const base = baseIndex()
  const local = apply(base, [{ type: 'put-outfit', id: 'dress', changes: {
    name: 'Shared', metadata: { note: 'local' },
  } }], 'local')
  const remote = apply(base, [{ type: 'put-outfit', id: 'dress', changes: {
    name: 'Shared', data: [{ Group: 'Cloth', Name: 'Gown' }],
  } }], 'cloud')
  const result = mergeWardrobeIndexesThreeWay(base, local, remote)
  assert.equal(result.canUpload, true)
  assert.equal(result.merged.outfits.dress.name, 'Shared')
  assert.deepEqual(result.merged.outfits.dress.metadata, { note: 'local' })
  assert.equal(result.merged.outfits.dress.data[0].Name, 'Gown')
})

test('delete versus edit keeps the tombstone and restores an edited copy only under a new ID', () => {
  const base = baseIndex()
  const local = apply(base, [{ type: 'delete-outfit', id: 'dress' }], 'local')
  const remote = apply(base, [{ type: 'put-outfit', id: 'dress', changes: { name: 'Edited elsewhere' } }], 'cloud')
  const result = mergeWardrobeIndexesThreeWay(base, local, remote)
  assert.equal(result.canUpload, false)
  assert.equal(result.merged.outfits.dress, undefined)
  assert.ok(result.merged.tombstones.outfits.dress)
  assert.deepEqual(result.conflicts.map(({ type, field }) => ({ type, field })), [
    { type: 'delete-edit', field: '$record' },
  ])
  const restored = resolveWardrobeConflicts(result, [
    { kind: 'outfit', id: 'dress', field: '$record', choice: 'cloud', newId: 'restored-dress' },
  ])
  assert.equal(restored.canUpload, true)
  assert.equal(restored.merged.outfits.dress, undefined)
  assert.equal(restored.merged.outfits['restored-dress'].name, 'Edited elsewhere')
  assert.ok(restored.merged.tombstones.outfits.dress)
  assert.equal(projectWardrobeCloudIndex(restored.merged).outfits['restored-dress'].name, 'Edited elsewhere')
  assert.throws(() => resolveWardrobeConflicts(result, [
    { kind: 'outfit', id: 'dress', field: '$record', choice: 'cloud', newId: 'dress' },
  ]))
  const discarded = resolveWardrobeConflicts(result, [
    { kind: 'outfit', id: 'dress', field: '$record', choice: 'discard' },
  ])
  assert.equal(discarded.canUpload, true)
  assert.deepEqual(Object.keys(discarded.merged.outfits), [])
})

test('remote deletion versus local edit has the same delete-first behavior', () => {
  const base = baseIndex()
  const local = apply(base, [{ type: 'put-outfit', id: 'dress', changes: { name: 'Local edit' } }], 'local')
  const remote = apply(base, [{ type: 'delete-outfit', id: 'dress' }], 'cloud')
  const result = mergeWardrobeIndexesThreeWay(base, local, remote)
  assert.equal(result.canUpload, false)
  assert.equal(result.merged.outfits.dress, undefined)
  const chosen = resolveWardrobeConflicts(result, [
    { kind: 'outfit', id: 'dress', field: '$record', choice: 'local', newId: 'local-copy' },
  ])
  assert.equal(chosen.merged.outfits['local-copy'].name, 'Local edit')
  assert.ok(chosen.merged.tombstones.outfits.dress)
})

test('restoring an edited tag uses a new ID and moves surviving outfit references', () => {
  const base = baseIndex()
  const local = apply(base, [{ type: 'delete-tag', id: 'tag-base' }], 'local')
  const remote = apply(base, [{ type: 'rename-tag', id: 'tag-base', name: 'Renamed' }], 'cloud')
  const result = mergeWardrobeIndexesThreeWay(base, local, remote)
  assert.equal(result.canUpload, false)
  assert.equal(result.merged.tags['tag-base'], undefined)
  const resolved = resolveWardrobeConflicts(result, [
    { kind: 'tag', id: 'tag-base', field: '$record', choice: 'cloud', newId: 'tag-restored' },
  ])
  assert.equal(resolved.canUpload, true)
  assert.equal(resolved.merged.tags['tag-restored'].name, 'Renamed')
  assert.deepEqual(resolved.merged.outfits.dress.tagIds, ['tag-restored'])
  assert.ok(resolved.merged.tombstones.tags['tag-base'])
})

test('private local content remains private when another device republishes or edits it', () => {
  const base = baseIndex()
  const local = apply(base, [
    { type: 'set-cloud', id: 'dress', enabled: false },
    { type: 'put-outfit', id: 'dress', changes: { data: [{ Group: 'Cloth', Name: 'Private' }] } },
  ], 'local')
  const remote = apply(base, [{ type: 'put-outfit', id: 'dress', changes: {
    data: [{ Group: 'Cloth', Name: 'Public edit' }],
  } }], 'cloud')
  const result = mergeWardrobeIndexesThreeWay(base, local, remote)
  assert.equal(result.canUpload, false)
  assert.equal(result.merged.cloudState.dress.enabled, false)
  assert.equal(result.merged.outfits.dress.data[0].Name, 'Private')
  assert.equal(projectWardrobeCloudIndex(result.merged).outfits.dress, undefined)
  assert.equal(JSON.stringify(projectWardrobeCloudIndex(result.merged)).includes('Private'), false)
  assert.ok(result.conflicts.some(conflict => conflict.type === 'privacy'))
  assert.deepEqual(result.conflicts.map(conflict => conflict.type), ['privacy'])
  const keepPrivate = resolveWardrobeConflicts(result, [
    { kind: 'cloud-state', id: 'dress', field: 'enabled', choice: 'local' },
  ])
  assert.equal(keepPrivate.canUpload, true)
  assert.equal(projectWardrobeCloudIndex(keepPrivate.merged).outfits.dress, undefined)
  const keepPublic = resolveWardrobeConflicts(result, [
    { kind: 'cloud-state', id: 'dress', field: 'enabled', choice: 'cloud' },
  ])
  assert.equal(keepPublic.canUpload, true)
  assert.equal(keepPublic.merged.outfits.dress.data[0].Name, 'Public edit')
  assert.equal(projectWardrobeCloudIndex(keepPublic.merged).outfits.dress.data[0].Name, 'Public edit')
})

test('a remote private payload is never used to populate the public index', () => {
  const base = baseIndex()
  const withdrawn = apply(base, [{ type: 'set-cloud', id: 'dress', enabled: false }], 'cloud')
  const remote = apply(withdrawn, [{ type: 'put-outfit', id: 'dress', changes: {
    data: [{ Group: 'Cloth', Name: 'Cloud private' }],
  } }], 'cloud')
  const local = apply(withdrawn, [
    { type: 'put-outfit', id: 'dress', changes: { data: [{ Group: 'Cloth', Name: 'Local public' }] } },
    { type: 'set-cloud', id: 'dress', enabled: true },
  ], 'local')
  const result = mergeWardrobeIndexesThreeWay(withdrawn, local, remote)
  assert.equal(result.canUpload, true)
  assert.equal(result.merged.cloudState.dress.enabled, true)
  assert.equal(result.merged.outfits.dress.data[0].Name, 'Local public')
  assert.equal(JSON.stringify(projectWardrobeCloudIndex(result.merged)).includes('Cloud private'), false)
})

test('prototype-like IDs are own records in a three-way merge', () => {
  const base = apply(createWardrobeIndex(), [{ type: 'put-outfit', id: '__proto__', changes: {
    name: 'Original', type: 'outfit', data: [], tagIds: [],
  } }])
  const local = apply(base, [{ type: 'put-outfit', id: '__proto__', changes: { name: 'Renamed' } }], 'local')
  const remote = apply(base, [{ type: 'put-outfit', id: '__proto__', changes: { data: [{ Group: 'Cloth', Name: 'Dress' }] } }], 'cloud')
  const result = mergeWardrobeIndexesThreeWay(base, local, remote)
  assert.equal(Object.hasOwn(result.merged.outfits, '__proto__'), true)
  assert.equal(result.merged.outfits.__proto__.name, 'Renamed')
  assert.equal(result.merged.outfits.__proto__.data[0].Name, 'Dress')
  assert.equal({}.name, undefined)
})
