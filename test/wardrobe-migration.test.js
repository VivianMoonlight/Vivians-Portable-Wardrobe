import test from 'node:test'
import assert from 'node:assert/strict'
import { isLegacyWardrobe, migrateLegacyWardrobe } from '../src/services/wardrobe-migration.js'
import { listWardrobeOutfits, listWardrobeTags, mergeWardrobeIndexes, validateWardrobeIndex } from '../src/services/wardrobe-index.js'

const folder = (name, children = [], extra = {}) => ({ name, type: 'folder', children, ...extra })
const outfit = (name, extra = {}) => ({ name, type: 'outfit', data: [{ Name: name }], ...extra })
const root = children => folder('Home', children)
const byName = values => Object.fromEntries(Object.values(values).map(value => [value.name, value]))
const identities = state => Object.values(state.outfits).map(value => [value.name, value.id, [...value.tagIds].sort()]).sort()

test('folder paths become unique tags and each outfit receives all ancestor tags', () => {
  const source = root([
    outfit('Loose', { __vpwNodeId: 'loose' }),
    folder('Daily', [folder('Summer', [outfit('Dress', { __vpwNodeId: 'dress' })], { __vpwNodeId: 'summer' })], { __vpwNodeId: 'daily' })
  ])
  const state = migrateLegacyWardrobe(source)
  assert.equal(state.schemaVersion, 3)
  assert.deepEqual(Object.values(state.tags).map(tag => tag.name), ['Daily', 'Daily / Summer'])
  assert.deepEqual(state.outfits.loose.tagIds, [])
  assert.deepEqual(state.outfits.dress.tagIds, ['daily', 'summer'])
  assert.deepEqual(Object.values(state.outfits).map(item => item.order), [0, 1])
  assert.equal(Object.keys(state.tags).length, 2)
})

test('missing IDs and duplicate folder names are stable under sibling and folder reorders', () => {
  const first = folder('Same', [outfit('A'), outfit('B')])
  const second = folder('Same', [outfit('C')])
  const forward = migrateLegacyWardrobe(root([first, second, outfit('Root outfit')]))
  const reverse = migrateLegacyWardrobe(root([outfit('Root outfit'), second, { ...first, children: [...first.children].reverse() }]))
  assert.deepEqual(identities(forward), identities(reverse))
  assert.deepEqual(byName(forward.tags), byName(reverse.tags))
  assert.equal(new Set(Object.values(forward.tags).map(tag => tag.name)).size, 2)
  assert.equal(new Set(Object.keys(forward.outfits)).size, 4)
})

test('identical siblings keep their multiplicity and IDs do not depend on object key order', () => {
  const first = migrateLegacyWardrobe(root([outfit('Same'), outfit('Same')]))
  const second = migrateLegacyWardrobe(root([
    { data: [{ Name: 'Same' }], type: 'outfit', name: 'Same' },
    { type: 'outfit', name: 'Same', data: [{ Name: 'Same' }] }
  ]))
  assert.equal(Object.keys(first.outfits).length, 2)
  assert.deepEqual(Object.keys(first.outfits).sort(), Object.keys(second.outfits).sort())
})

test('duplicate persisted identities are repaired deterministically without collapsing content', () => {
  const a = folder('A', [outfit('One', { __vpwNodeId: 'duplicate' })])
  const b = folder('B', [outfit('Two', { __vpwNodeId: 'duplicate' })])
  const forward = migrateLegacyWardrobe(root([a, b]))
  const reverse = migrateLegacyWardrobe(root([b, a]))
  assert.deepEqual(identities(forward), identities(reverse))
  assert.equal(Object.keys(forward.outfits).length, 2)
  assert.equal(Object.values(forward.outfits).filter(item => item.id === 'duplicate').length, 1)
})

test('generated identities cannot take an identity reserved by a later persisted node', () => {
  const [generatedId] = Object.keys(migrateLegacyWardrobe(root([outfit('Generated')])).outfits)
  const state = migrateLegacyWardrobe(root([outfit('Generated'), outfit('Existing', { __vpwNodeId: generatedId })]))
  assert.equal(state.outfits[generatedId].name, 'Existing')
  assert.equal(Object.keys(state.outfits).length, 2)
})

test('global tag names distinguish nested paths, literal separators and same-path folders', () => {
  const state = migrateLegacyWardrobe(root([
    folder('A', [folder('B', [outfit('Nested')])]),
    folder('A / B', [outfit('Literal')]),
    folder('A / B', [outfit('Second literal')])
  ]))
  const names = Object.values(state.tags).map(tag => tag.name)
  assert.equal(names.length, 4)
  assert.equal(new Set(names).size, 4)
  assert.equal(Object.keys(state.outfits).length, 3)
})

test('tag names stay unique after the index normalizes Unicode and whitespace', () => {
  const state = migrateLegacyWardrobe(root([folder('A', [outfit('ASCII')]), folder(' Ａ ', [outfit('Wide')])]))
  assert.equal(listWardrobeTags(state).length, 2)
  assert.equal(new Set(Object.values(state.tags).map(tag => tag.name)).size, 2)
})

test('cloud defaults inherit down the old tree while explicit child overrides survive', () => {
  const source = root([
    folder('Local', [outfit('Inherited'), outfit('Explicit cloud', { cloudSync: true }),
      folder('Nested local', [outfit('Nested')])], { cloudSync: false, inheritCloudSync: false }),
    outfit('Default cloud')
  ])
  const state = migrateLegacyWardrobe(source)
  const names = byName(state.outfits)
  assert.equal(state.cloudState[names.Inherited.id].enabled, false)
  assert.equal(state.cloudState[names.Nested.id].enabled, false)
  assert.equal(state.cloudState[names['Explicit cloud'].id].enabled, true)
  assert.equal(state.cloudState[names['Default cloud'].id].enabled, true)
  assert.equal(byName(state.tags).Local.inheritCloudSync, false)
})

test('legacy tombstones remove every stale occurrence without rebirthing duplicate IDs', () => {
  const source = root([
    outfit('Deleted', { __vpwNodeId: 'deleted' }),
    outfit('Stale duplicate', { __vpwNodeId: 'deleted' }),
    folder('Deleted tag', [outfit('Still live', { __vpwNodeId: 'survivor' })], { __vpwNodeId: 'dead-folder' })
  ])
  source.__vpwSync = {
    version: 2, counter: 8, records: { survivor: { rev: { counter: 11, replica: 'old' } } },
    tombstones: {
      deleted: { rev: { counter: 10, replica: 'remote' } },
      'dead-folder': { rev: { counter: 9, replica: 'remote' } },
      'absent-backup-id': { rev: { counter: 4, replica: 'old' } }
    }
  }
  const state = migrateLegacyWardrobe(source, { replicaId: 'upgrade' })
  assert.deepEqual(Object.keys(state.outfits), ['survivor'])
  assert.deepEqual(state.outfits.survivor.tagIds, [])
  assert.deepEqual(state.tags, {})
  assert.deepEqual(state.tombstones.outfits.deleted, [10, 'remote'])
  assert.deepEqual(state.tombstones.tags['dead-folder'], [9, 'remote'])
  assert.ok(state.tombstones.outfits['absent-backup-id'])
  assert.equal(state.clock, 12)
  assert.deepEqual(state.outfits.survivor.rev, [12, 'upgrade'])
  assert.equal(validateWardrobeIndex(state), state)
  const stale = migrateLegacyWardrobe(root([outfit('Deleted', { __vpwNodeId: 'deleted' })]))
  const merged = mergeWardrobeIndexes(state, stale)
  assert.deepEqual(listWardrobeOutfits(merged).map(item => item.id), ['survivor'])
})

test('all nonfolder business types and nested outfit data survive without mutating the input', () => {
  const data = [{ Name: 'Dress', Color: ['#abc'], Property: { LockedBy: 'Padlock' }, Craft: { Name: 'Made by me' }, custom: { children: [1] } }]
  const canvas = { self: null }
  canvas.self = canvas
  const source = root([
    { name: 'Character', type: 'character', data, custom: { preserved: true }, __vpwNodeId: 'character', thumbCanvas: canvas, isThumbGenerated: true, __thumbRefresh: 5 },
    { name: 'Unknown', type: 'custom-format', data: { arbitrary: true }, extra: 7 },
    { name: 'Untyped', custom: 'keep' }
  ])
  const state = migrateLegacyWardrobe(source)
  const migrated = state.outfits.character
  assert.deepEqual(migrated.data, data)
  assert.notEqual(migrated.data, data)
  assert.deepEqual(migrated.custom, { preserved: true })
  assert.equal(migrated.thumbCanvas, undefined)
  assert.equal(migrated.isThumbGenerated, undefined)
  assert.equal(migrated.__thumbRefresh, undefined)
  assert.equal(migrated.__vpwNodeId, undefined)
  assert.equal(source.children[0].thumbCanvas, canvas)
  assert.equal(source.children[0].__vpwNodeId, 'character')
  assert.equal(byName(state.outfits).Unknown.type, 'custom-format')
  assert.deepEqual(byName(state.outfits).Unknown.data, { arbitrary: true })
  assert.equal(byName(state.outfits).Untyped.type, 'file')
})

test('business fields that collide with indexed fields remain available in legacyFields', () => {
  const source = root([outfit('Collision', { id: 'business-id', tagIds: ['business-tag'], rev: 'business-revision', order: 98, legacyFields: { previous: true } })])
  const migrated = Object.values(migrateLegacyWardrobe(source).outfits)[0]
  assert.deepEqual(migrated.legacyFields, {
    id: 'business-id', tagIds: ['business-tag'], rev: 'business-revision', order: 98, legacyFields: { previous: true }
  })
})

test('reserved dictionary keys are stored as own data and inherited IDs are ignored', () => {
  const inherited = Object.assign(Object.create({ __vpwNodeId: 'inherited' }), outfit('Inherited'))
  const source = root([outfit('Safe', { __vpwNodeId: '__proto__' }), inherited])
  source.__vpwSync = JSON.parse('{"version":2,"counter":2,"tombstones":{"constructor":{"rev":{"counter":2,"replica":"old"}}}}')
  const state = migrateLegacyWardrobe(source)
  assert.equal(Object.hasOwn(state.outfits, '__proto__'), true)
  assert.equal(state.outfits.__proto__.name, 'Safe')
  assert.equal(Object.getPrototypeOf(state.outfits), Object.prototype)
  assert.equal(Object.hasOwn(state.tombstones.outfits, 'constructor'), true)
  assert.equal(Object.hasOwn(state.outfits, 'inherited'), false)
})

test('malformed or future-schema inputs fail instead of silently discarding nodes', () => {
  assert.equal(isLegacyWardrobe({ schemaVersion: 3, children: [] }), false)
  assert.equal(isLegacyWardrobe({ schemaVersion: 9, children: [] }), false)
  assert.equal(isLegacyWardrobe({ children: [] }), true)
  assert.equal(isLegacyWardrobe([]), false)
  assert.throws(() => migrateLegacyWardrobe(root([null])), /non-object/)
  assert.throws(() => migrateLegacyWardrobe(root([folder('Broken', {})])), /array/)
  assert.throws(() => migrateLegacyWardrobe({ ...root([]), __vpwSync: { version: 99 } }), /Unsupported/)
  assert.throws(() => migrateLegacyWardrobe({ ...root([]), __vpwSync: { version: 2, counter: Number.MAX_SAFE_INTEGER } }), /exhausted/)
  assert.throws(() => migrateLegacyWardrobe({ ...root([]), __vpwSync: { version: 2, counter: Number.MAX_SAFE_INTEGER + 1 } }), /invalid/)
  const cyclic = root([])
  cyclic.children.push(cyclic)
  assert.throws(() => migrateLegacyWardrobe(cyclic), /cycle/)
})
