import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyWardrobeOperations,
  createWardrobeIndex,
  isWardrobeIndex,
  listWardrobeOutfits,
  listWardrobeTags,
  mergeWardrobeIndexes,
  projectWardrobeCloudIndex,
  validateWardrobeIndex,
} from '../src/services/wardrobe-index.js'

function apply(index, operations, replicaId = 'device-a') {
  return applyWardrobeOperations(index, operations, { replicaId })
}

function outfit(id, name = id, changes = {}) {
  return { type: 'put-outfit', id, changes: { name, type: 'outfit', data: [{ Group: 'Cloth', Name: 'Dress' }], tagIds: [], ...changes } }
}

function names(index) {
  return Object.fromEntries(listWardrobeOutfits(index).map(record => [record.id, record.name]))
}

function freezeDeep(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    Object.values(value).forEach(freezeDeep)
  }
  return value
}

test('new indexes have a valid empty schema and malformed cloud structures are rejected', () => {
  const index = createWardrobeIndex()
  assert.equal(index.schemaVersion, 3)
  assert.equal(isWardrobeIndex(index), true)
  assert.equal(validateWardrobeIndex(index), index)
  assert.deepEqual(listWardrobeOutfits(index), [])
  assert.deepEqual(listWardrobeTags(index), [])
  for (const invalid of [null, [], {}, { ...index, schemaVersion: 99 }, { ...index, outfits: [] }, { ...index, clock: -1 }]) {
    assert.equal(isWardrobeIndex(invalid), false)
    assert.throws(() => validateWardrobeIndex(invalid))
  }
})

test('renaming a synced outfit survives repeated merges with the old cloud copy', () => {
  const initial = apply(createWardrobeIndex(), [outfit('dress-1', '旧名字')])
  const oldCloud = projectWardrobeCloudIndex(initial)
  const renamed = apply(initial, [{ type: 'put-outfit', id: 'dress-1', changes: { name: '新的名字' } }])
  const merged = mergeWardrobeIndexes(renamed, oldCloud)
  assert.deepEqual(names(merged), { 'dress-1': '新的名字' })
  assert.deepEqual(merged.outfits['dress-1'].data, initial.outfits['dress-1'].data)
  assert.deepEqual(mergeWardrobeIndexes(merged, oldCloud), merged)
  assert.deepEqual(names(mergeWardrobeIndexes(oldCloud, renamed)), { 'dress-1': '新的名字' })
})

test('deleting an outfit leaves a permanent tombstone that stale devices cannot resurrect', () => {
  const initial = apply(createWardrobeIndex(), [outfit('deleted', '要删除的衣服')])
  const deleted = apply(initial, [{ type: 'delete-outfit', id: 'deleted' }])
  // A device that has not seen the deletion can keep editing its old record.
  const staleEdited = apply(initial, [
    { type: 'put-outfit', id: 'deleted', changes: { name: '旧设备上的改名' } },
    { type: 'put-outfit', id: 'deleted', changes: { name: '继续编辑旧副本' } },
  ], 'offline-device')
  for (const result of [mergeWardrobeIndexes(deleted, staleEdited), mergeWardrobeIndexes(staleEdited, deleted)]) {
    assert.deepEqual(names(result), {})
    assert.ok(result.tombstones.outfits.deleted)
    assert.equal(result.outfits.deleted, undefined)
    assert.deepEqual(names(mergeWardrobeIndexes(result, initial)), {})
  }
  const restored = apply(deleted, [outfit('restored-with-new-id', '要删除的衣服')])
  assert.deepEqual(names(restored), { 'restored-with-new-id': '要删除的衣服' })
  assert.ok(restored.tombstones.outfits.deleted)
})

test('concurrent additions on separate devices merge without losing either outfit', () => {
  const left = apply(createWardrobeIndex(), [outfit('left', '左边添加')], 'device-a')
  const right = apply(createWardrobeIndex(), [outfit('right', '右边添加')], 'device-b')
  const result = mergeWardrobeIndexes(left, right)
  assert.deepEqual(names(result), { left: '左边添加', right: '右边添加' })
  assert.deepEqual(names(mergeWardrobeIndexes(right, left)), names(result))
  assert.deepEqual(mergeWardrobeIndexes(result, result), result)
  assert.deepEqual(mergeWardrobeIndexes(result, right), result)
})

test('concurrent edits of the same record converge independent of merge direction', () => {
  const initial = apply(createWardrobeIndex(), [outfit('shared', '起始名字')])
  const left = apply(initial, [{ type: 'put-outfit', id: 'shared', changes: { name: 'A 上的修改' } }], 'device-a')
  const right = apply(initial, [{ type: 'put-outfit', id: 'shared', changes: { name: 'B 上的修改' } }], 'device-b')
  const leftFirst = mergeWardrobeIndexes(left, right)
  const rightFirst = mergeWardrobeIndexes(right, left)
  assert.deepEqual(leftFirst.outfits.shared, rightFirst.outfits.shared)
  assert.ok(['A 上的修改', 'B 上的修改'].includes(leftFirst.outfits.shared.name))
})

test('private outfits stay local while cloud settings and tombstones remain publishable', () => {
  const initial = apply(createWardrobeIndex(), [outfit('private', '秘密衣服'), outfit('public', '公开衣服'), outfit('removed')])
  const local = apply(initial, [
    { type: 'set-cloud', id: 'private', enabled: false },
    { type: 'delete-outfit', id: 'removed' },
  ])
  const cloud = projectWardrobeCloudIndex(local)
  assert.deepEqual(names(cloud), { public: '公开衣服' })
  assert.deepEqual(names(local), { private: '秘密衣服', public: '公开衣服' })
  assert.equal(cloud.outfits.private, undefined)
  assert.equal(cloud.cloudState.private.enabled, false)
  assert.ok(cloud.tombstones.outfits.removed)
  assert.equal(JSON.stringify(cloud).includes('秘密衣服'), false)
  assert.equal(isWardrobeIndex(cloud), true)
})

test('editing a private outfit never implicitly re-enables cloud sync', () => {
  const original = apply(createWardrobeIndex(), [outfit('private')])
  assert.equal(original.cloudState.private.enabled, true)
  const disabled = apply(original, [{ type: 'set-cloud', id: 'private', enabled: false }])
  const renamed = apply(disabled, [{ type: 'put-outfit', id: 'private', changes: { name: '仍然仅保存在本地' } }])
  assert.deepEqual(renamed.cloudState.private, disabled.cloudState.private)
  assert.equal(projectWardrobeCloudIndex(renamed).outfits.private, undefined)
  const reenabled = apply(renamed, [{ type: 'set-cloud', id: 'private', enabled: true }])
  assert.equal(projectWardrobeCloudIndex(reenabled).outfits.private.name, '仍然仅保存在本地')
  assert.ok(reenabled.cloudState.private.rev[0] > disabled.cloudState.private.rev[0])
})

test('a remote opt-out retains the local payload but blocks a stale remote payload from replacing it', () => {
  const initial = apply(createWardrobeIndex(), [outfit('private', '共同起点')])
  const local = apply(initial, [{ type: 'put-outfit', id: 'private', changes: { name: '此设备保留的衣服' } }], 'local')
  const remote = apply(initial, [
    { type: 'put-outfit', id: 'private', changes: { name: '其他设备上的衣服' } },
    { type: 'set-cloud', id: 'private', enabled: false },
  ], 'remote')
  const result = mergeWardrobeIndexes(local, remote)
  assert.equal(result.cloudState.private.enabled, false)
  assert.equal(result.outfits.private.name, '此设备保留的衣服')
  assert.equal(projectWardrobeCloudIndex(result).outfits.private, undefined)
  assert.equal(mergeWardrobeIndexes(createWardrobeIndex(), remote).outfits.private, undefined)
})

test('a disabled local outfit cannot be overwritten or re-enabled by an older cloud snapshot', () => {
  const initial = apply(createWardrobeIndex(), [outfit('private', '旧云内容')])
  const local = apply(initial, [
    { type: 'set-cloud', id: 'private', enabled: false },
    { type: 'put-outfit', id: 'private', changes: { name: '本地修改' } },
  ])
  const result = mergeWardrobeIndexes(local, projectWardrobeCloudIndex(initial))
  assert.equal(result.outfits.private.name, '本地修改')
  assert.equal(result.cloudState.private.enabled, false)
})

test('explicit opt-in publishes the existing local payload after a remote opt-out', () => {
  const initial = apply(createWardrobeIndex(), [outfit('private', '本地可恢复的服装')])
  const disabledRemote = projectWardrobeCloudIndex(apply(initial, [{ type: 'set-cloud', id: 'private', enabled: false }], 'remote'))
  const reconciled = mergeWardrobeIndexes(initial, disabledRemote)
  const enabled = apply(reconciled, [{ type: 'set-cloud', id: 'private', enabled: true }], 'local')
  const uploaded = projectWardrobeCloudIndex(enabled)
  assert.equal(uploaded.outfits.private.name, '本地可恢复的服装')
  assert.equal(uploaded.cloudState.private.enabled, true)
  assert.equal(mergeWardrobeIndexes(createWardrobeIndex(), uploaded).outfits.private.name, '本地可恢复的服装')
})

test('partial edits preserve outfit extensions and never mutate caller-owned input', () => {
  const data = [{ Group: 'Cloth', Name: 'Dress', Color: ['#abc'], Property: { Type: 'Custom' }, Craft: { Name: 'Custom craft' } }]
  const initial = apply(createWardrobeIndex(), [outfit('custom', '原名', { data, extensionMetadata: { owner: 'test', values: [1, 2] } })])
  const before = structuredClone(initial)
  freezeDeep(initial)
  const operations = freezeDeep([{ type: 'put-outfit', id: 'custom', changes: { name: '仅改名称' } }])
  const renamed = apply(initial, operations)
  assert.notEqual(renamed, initial)
  assert.deepEqual(initial, before)
  assert.deepEqual(renamed.outfits.custom.data, data)
  assert.deepEqual(renamed.outfits.custom.extensionMetadata, { owner: 'test', values: [1, 2] })
  assert.deepEqual(renamed.outfits.custom.tagIds, [])
  const remote = freezeDeep(projectWardrobeCloudIndex(renamed))
  const remoteBefore = structuredClone(remote)
  mergeWardrobeIndexes(initial, remote)
  projectWardrobeCloudIndex(initial)
  assert.deepEqual(initial, before)
  assert.deepEqual(remote, remoteBefore)
})

test('tag names are normalized and duplicate normalized names cannot be added locally', () => {
  const initial = apply(createWardrobeIndex(), [{ type: 'put-tag', id: 'tag-a', name: '  Ｃａｓｕａｌ  ' }])
  assert.equal(listWardrobeTags(initial)[0].name, 'Casual')
  assert.throws(() => apply(initial, [{ type: 'put-tag', id: 'tag-b', name: ' Casual ' }]))
  const differentCase = apply(initial, [{ type: 'put-tag', id: 'tag-c', name: 'casual' }])
  assert.equal(listWardrobeTags(differentCase).length, 2)
  const renamed = apply(differentCase, [{ type: 'put-tag', id: 'tag-c', name: '正式' }])
  assert.deepEqual(listWardrobeTags(renamed).map(tag => tag.name).sort(), ['Casual', '正式'].sort())
})

test('concurrently created tags with the same name expose one stable alias group', () => {
  const left = apply(createWardrobeIndex(), [
    { type: 'put-tag', id: 'tag-z', name: ' 日常 ' },
    outfit('left', '左设备', { tagIds: ['tag-z'] }),
  ], 'device-a')
  const right = apply(createWardrobeIndex(), [
    { type: 'put-tag', id: 'tag-a', name: '日常' },
    outfit('right', '右设备', { tagIds: ['tag-a'] }),
  ], 'device-b')
  const result = mergeWardrobeIndexes(left, right)
  const tags = listWardrobeTags(result)
  assert.equal(tags.length, 1)
  assert.equal(tags[0].id, 'tag-a')
  assert.equal(tags[0].name, '日常')
  assert.deepEqual([...tags[0].aliasIds].sort(), ['tag-a', 'tag-z'])
  assert.deepEqual(listWardrobeTags(mergeWardrobeIndexes(right, left)), tags)
  assert.deepEqual(result.outfits.left.tagIds, ['tag-z'])
  assert.deepEqual(result.outfits.right.tagIds, ['tag-a'])
})

test('deleted tags cannot reappear from stale snapshots', () => {
  const initial = apply(createWardrobeIndex(), [{ type: 'put-tag', id: 'tag', name: '旧标签' }])
  const deleted = apply(initial, [{ type: 'delete-tag', id: 'tag' }])
  const stale = apply(initial, [{ type: 'put-tag', id: 'tag', name: '旧设备的改名' }], 'offline')
  for (const merged of [mergeWardrobeIndexes(deleted, stale), mergeWardrobeIndexes(stale, deleted)]) {
    assert.deepEqual(listWardrobeTags(merged), [])
    assert.ok(merged.tombstones.tags.tag)
  }
})

test('local revisions advance past observed remote records even when the remote clock is stale', () => {
  const remote = apply(createWardrobeIndex(), [outfit('remote')], 'remote')
  remote.clock = 1
  remote.outfits.remote.rev = [100, 'remote']
  remote.cloudState.remote.rev = [125, 'remote']
  remote.tags.observed = { id: 'observed', name: '已知标签', rev: [150, 'remote'] }
  remote.tombstones.outfits.deleted = [175, 'remote']
  const merged = mergeWardrobeIndexes(createWardrobeIndex(), remote)
  const result = apply(merged, [outfit('new-local')], 'local')
  assert.ok(result.outfits['new-local'].rev[0] > 175)
  assert.equal(result.outfits['new-local'].rev[1], 'local')
  assert.ok(result.clock >= result.outfits['new-local'].rev[0])
})

test('invalid revisions, entity identities, tombstones, and cloud flags fail validation', () => {
  const valid = apply(createWardrobeIndex(), [outfit('one'), { type: 'put-tag', id: 'tag', name: '日常' }])
  const corruptions = [
    index => { index.outfits.one.id = 'different-key' },
    index => { index.outfits.one.tagIds = [''] },
    index => { index.outfits.one.type = '' },
    index => { index.outfits.one.name = null },
    index => { index.outfits.one.rev = [1] },
    index => { index.outfits.one.rev = [-1, 'device'] },
    index => { index.outfits.one.rev = [1.5, 'device'] },
    index => { index.outfits.one.rev = [Infinity, 'device'] },
    index => { index.outfits.one.rev = [1, ''] },
    index => { index.tags.tag.name = '　 ' },
    index => { index.tags.tag = null },
    index => { index.tombstones.tags.deleted = 'not-a-revision' },
    index => { index.tombstones.outfits = [] },
    index => { index.cloudState.one.enabled = 'false' },
    index => { index.cloudState.one.rev = [1, null] },
    index => { index.cloudState = null },
  ]
  for (const corrupt of corruptions) {
    const invalid = structuredClone(valid)
    corrupt(invalid)
    assert.equal(isWardrobeIndex(invalid), false)
    assert.throws(() => validateWardrobeIndex(invalid))
    assert.throws(() => mergeWardrobeIndexes(valid, invalid))
  }
})

test('invalid operations and partial batch failures cannot modify the original index', () => {
  const original = apply(createWardrobeIndex(), [outfit('one'), { type: 'put-tag', id: 'tag', name: '日常' }])
  const before = structuredClone(original)
  freezeDeep(original)
  for (const id of [undefined, null, '', '   ', 123]) {
    for (const type of ['delete-outfit', 'delete-tag', 'set-cloud']) {
      assert.throws(() => apply(original, [{ type, id, enabled: false }]))
    }
  }
  for (const operation of [
    { type: 'unknown', id: 'one' },
    { type: 'set-cloud', id: 'one', enabled: 'false' },
    { type: 'set-cloud', id: 'missing', enabled: true },
    { type: 'put-outfit', id: 'one', changes: { tagIds: 'not-an-array' } },
    { type: 'put-tag', id: 'new-tag', name: ' 日常 ' },
  ]) {
    assert.throws(() => apply(original, [
      { type: 'put-outfit', id: 'one', changes: { name: '不应保存的前一操作' } },
      operation,
    ]))
    assert.deepEqual(original, before)
  }
  assert.throws(() => applyWardrobeOperations(original, [], {}))
  assert.throws(() => apply(original, null))
})

test('deleted identities cannot be reused by ordinary put operations', () => {
  const original = apply(createWardrobeIndex(), [outfit('one'), { type: 'put-tag', id: 'tag', name: '日常' }])
  const deleted = apply(original, [{ type: 'delete-outfit', id: 'one' }, { type: 'delete-tag', id: 'tag' }])
  assert.throws(() => apply(deleted, [outfit('one')]))
  assert.throws(() => apply(deleted, [{ type: 'put-tag', id: 'tag', name: '重新添加' }]))
  assert.deepEqual(listWardrobeOutfits(deleted), [])
  assert.deepEqual(listWardrobeTags(deleted), [])
})

test('prototype-like IDs remain ordinary own records across edits, merges, and deletion', () => {
  const ids = ['__proto__', 'constructor', 'toString']
  const original = apply(createWardrobeIndex(), ids.flatMap(id => [
    outfit(id, `outfit ${id}`),
    { type: 'put-tag', id, name: `tag ${id}` },
  ]))
  assert.equal(Object.getPrototypeOf(original.outfits), Object.prototype)
  assert.equal(Object.getPrototypeOf(original.tags), Object.prototype)
  for (const id of ids) {
    assert.equal(Object.hasOwn(original.outfits, id), true)
    assert.equal(original.outfits[id].id, id)
    assert.equal(Object.hasOwn(original.tags, id), true)
  }
  const cloud = projectWardrobeCloudIndex(original)
  const merged = mergeWardrobeIndexes(createWardrobeIndex(), JSON.parse(JSON.stringify(cloud)))
  assert.equal(listWardrobeOutfits(merged).length, ids.length)
  assert.equal(listWardrobeTags(merged).length, ids.length)
  const deleted = apply(merged, ids.flatMap(id => [{ type: 'delete-outfit', id }, { type: 'delete-tag', id }]))
  assert.deepEqual(listWardrobeOutfits(deleted), [])
  assert.deepEqual(listWardrobeTags(deleted), [])
  assert.equal(Object.getPrototypeOf(deleted.tombstones.outfits), Object.prototype)
  for (const id of ids) assert.equal(Object.hasOwn(deleted.tombstones.outfits, id), true)
  assert.equal({}.id, undefined)
  assert.equal({}.enabled, undefined)
  assert.equal({}.name, undefined)
})

test('three public replicas converge after out-of-order and repeated delivery', () => {
  const base = apply(createWardrobeIndex(), [outfit('shared'), outfit('to-delete')], 'base')
  const replicas = [
    apply(base, [outfit('a'), { type: 'put-outfit', id: 'shared', changes: { name: 'A 编辑' } }], 'a'),
    apply(base, [outfit('b'), { type: 'delete-outfit', id: 'to-delete' }], 'b'),
    apply(base, [outfit('c'), { type: 'put-outfit', id: 'shared', changes: { name: 'C 编辑' } }], 'c'),
  ].map(projectWardrobeCloudIndex)
  const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
  const results = permutations.map(order => order.reduce((index, position) => mergeWardrobeIndexes(index, replicas[position]), createWardrobeIndex()))
  for (const result of results) {
    assert.deepEqual(result, results[0])
    assert.deepEqual(projectWardrobeCloudIndex(result), result)
    assert.deepEqual(replicas.reduce(mergeWardrobeIndexes, result), result)
    assert.equal(result.outfits['to-delete'], undefined)
    assert.deepEqual(Object.keys(result.outfits).sort(), ['a', 'b', 'c', 'shared'])
  }
})

function indexWithConcurrentTagAliases() {
  const left = apply(createWardrobeIndex(), [
    { type: 'put-tag', id: 'tag-z', name: ' Casual ' },
    outfit('left', 'Left outfit', { tagIds: ['tag-z'] }),
  ], 'left')
  const right = apply(createWardrobeIndex(), [
    { type: 'put-tag', id: 'tag-a', name: 'Ｃａｓｕａｌ' },
    outfit('right', 'Right outfit', { tagIds: ['tag-a'] }),
  ], 'right')
  return mergeWardrobeIndexes(left, right)
}

test('renaming either alias updates the entire tag group with one revision and retains outfit references', () => {
  const original = indexWithConcurrentTagAliases()
  const before = structuredClone(original)
  freezeDeep(original)
  for (const id of ['tag-a', 'tag-z']) {
    const renamed = apply(original, [{ type: 'rename-tag', id, name: '  Ｆｏｒｍａｌ  ' }], 'rename-device')
    const tags = listWardrobeTags(renamed)
    assert.equal(tags.length, 1)
    assert.equal(tags[0].id, 'tag-a')
    assert.equal(tags[0].name, 'Formal')
    assert.deepEqual(tags[0].aliasIds, ['tag-a', 'tag-z'])
    assert.equal(renamed.tags['tag-a'].name, 'Formal')
    assert.equal(renamed.tags['tag-z'].name, 'Formal')
    assert.deepEqual(renamed.tags['tag-a'].rev, renamed.tags['tag-z'].rev)
    assert.ok(renamed.tags['tag-a'].rev[0] > Math.max(original.tags['tag-a'].rev[0], original.tags['tag-z'].rev[0]))
    assert.equal(renamed.tags['tag-a'].rev[1], 'rename-device')
    assert.deepEqual(renamed.outfits.left.tagIds, ['tag-z'])
    assert.deepEqual(renamed.outfits.right.tagIds, ['tag-a'])
    assert.deepEqual(renamed.outfits, original.outfits)
    assert.deepEqual(original, before)
    assert.deepEqual(listWardrobeTags(mergeWardrobeIndexes(renamed, original)), tags)
  }
})

test('renaming an alias group to another normalized tag name rejects the batch without changing input', () => {
  const original = apply(indexWithConcurrentTagAliases(), [{ type: 'put-tag', id: 'outside', name: 'Formal' }])
  const before = structuredClone(original)
  freezeDeep(original)
  for (const id of ['tag-a', 'tag-z']) {
    assert.throws(() => apply(original, [
      { type: 'put-outfit', id: 'left', changes: { name: 'This preceding edit must not leak' } },
      { type: 'rename-tag', id, name: ' Ｆｏｒｍａｌ ' },
    ]))
    assert.deepEqual(original, before)
  }
})

test('renaming a single tag preserves its identity and a missing tag ID cannot be renamed', () => {
  const original = apply(createWardrobeIndex(), [
    { type: 'put-tag', id: 'single', name: 'Casual' },
    outfit('one', 'One outfit', { tagIds: ['single'] }),
  ])
  const renamed = apply(original, [{ type: 'rename-tag', id: 'single', name: ' Formal ' }])
  assert.equal(renamed.tags.single.name, 'Formal')
  assert.equal(renamed.tags.single.id, 'single')
  assert.ok(renamed.tags.single.rev[0] > original.tags.single.rev[0])
  assert.deepEqual(listWardrobeTags(renamed)[0].aliasIds, ['single'])
  assert.deepEqual(renamed.outfits.one.tagIds, ['single'])
  assert.throws(() => apply(original, [{ type: 'rename-tag', id: 'missing', name: 'Formal' }]))
  assert.equal(original.tags.single.name, 'Casual')
})
