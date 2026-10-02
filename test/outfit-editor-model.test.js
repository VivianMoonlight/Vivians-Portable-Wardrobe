import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createOutfitDraft,
  listOutfitParts,
  setOutfitAsset,
  removeOutfitAsset,
  setOutfitColor,
} from '../src/services/outfit-editor-model.js'

const groups = new Map([
  ['Cloth', { Name: 'Cloth', Category: 'Appearance', AllowNone: true, ColorSchema: ['Default', 'Black'], Asset: [
    { Name: 'Shirt', ColorableLayerCount: 2 }, { Name: 'Jacket', ColorableLayerCount: 1 },
  ] }],
  ['Body', { Name: 'Body', Category: 'Appearance', AllowNone: false, Asset: [{ Name: 'Body1' }] }],
  ['ItemNeck', { Name: 'ItemNeck', Category: 'Item', AllowNone: true, Asset: [{ Name: 'Collar' }] }],
  ['ArmsLeft', { Name: 'ArmsLeft', Category: 'Appearance', AllowNone: false, Asset: [{ Name: 'Arm' }] }],
])
const resolveGroup = name => groups.get(name)
const resolveAsset = (group, name) => groups.get(group)?.Asset.find(asset => asset.Name === name)
const resolvers = { resolveGroup, resolveAsset }

test('saved outfit draft is deeply isolated and hidden groups are excluded from editing list', () => {
  const saved = [
    { Group: 'Cloth', Name: 'Shirt', Property: { TypeRecord: { a: 1 } }, Craft: { Name: 'Sewn' } },
    { Group: 'ArmsLeft', Name: 'Arm' },
    { Group: 'Cloth', Name: 'Jacket' },
  ]
  const draft = createOutfitDraft(saved)
  draft[0].Property.TypeRecord.a = 2
  assert.equal(saved[0].Property.TypeRecord.a, 1)
  const visible = listOutfitParts(saved)
  assert.deepEqual(visible.map(part => part.Group), ['Cloth'])
  visible[0].Craft.Name = 'Changed'
  assert.equal(saved[0].Craft.Name, 'Sewn')
})

test('replacing a group keeps order and unrelated records but resets old asset details', () => {
  const saved = [
    { Group: 'Body', Name: 'Body1', Property: { Keep: true } },
    { Group: 'Cloth', Name: 'Shirt', Color: '#AABBCC', Property: { TypeRecord: { a: 1 } }, Craft: { Name: 'Sewn' } },
    { Group: 'ItemNeck', Name: 'Collar' },
    { Group: 'Cloth', Name: 'Shirt' },
  ]
  const changed = setOutfitAsset(saved, 'Cloth', 'Jacket', resolvers)
  assert.deepEqual(changed, [saved[0], { Group: 'Cloth', Name: 'Jacket', IsItem: false }, saved[2]])
  assert.deepEqual(saved[1].Property, { TypeRecord: { a: 1 } })
  assert.deepEqual(setOutfitAsset([], 'ItemNeck', 'Collar', resolvers), [{ Group: 'ItemNeck', Name: 'Collar', IsItem: true }])
})

test('removing an optional group preserves others and mandatory groups cannot be removed', () => {
  const saved = [{ Group: 'Body', Name: 'Body1' }, { Group: 'Cloth', Name: 'Shirt' }]
  assert.deepEqual(removeOutfitAsset(saved, 'Cloth', resolvers), [saved[0]])
  assert.equal(saved.length, 2)
  assert.throws(() => removeOutfitAsset(saved, 'Body', resolvers), { code: 'required-group' })
})

test('color edits retain arbitrary appearance settings and validate BC colors and layers', () => {
  const saved = [{
    Group: 'Cloth', Name: 'Shirt', IsItem: false, Color: 'Black',
    Property: { TypeRecord: { nested: [1, 2] } }, Craft: { Details: { x: true } },
  }]
  const changed = setOutfitColor(saved, 'Cloth', ['#A0B0C0', 'Default'], resolvers)
  assert.deepEqual(changed[0].Color, ['#A0B0C0', 'Default'])
  assert.deepEqual(changed[0].Property, saved[0].Property)
  assert.deepEqual(changed[0].Craft, saved[0].Craft)
  changed[0].Property.TypeRecord.nested.push(3)
  assert.deepEqual(saved[0].Property.TypeRecord.nested, [1, 2])
  assert.deepEqual(setOutfitColor(saved, 'Cloth', null, resolvers), [
    { Group: 'Cloth', Name: 'Shirt', IsItem: false, Property: saved[0].Property, Craft: saved[0].Craft },
  ])
  for (const invalid of ['red', '#AA', ['Black', 'Default', '#ffffff'], [], ['broken']]) {
    assert.throws(() => setOutfitColor(saved, 'Cloth', invalid, resolvers), { code: 'invalid-color' })
  }
})

test('invalid groups and assets cannot enter a saved bundle, and protected body slots cannot be edited', () => {
  assert.throws(() => setOutfitAsset([], 'NotAGroup', 'Anything', resolvers), { code: 'invalid-group' })
  assert.throws(() => setOutfitAsset([], 'Cloth', 'Imaginary', resolvers), { code: 'invalid-asset' })
  assert.throws(() => setOutfitAsset([], ' Cloth ', 'Shirt', resolvers), { code: 'invalid-group' })
  const saved = [{ Group: 'ArmsLeft', Name: 'Arm' }]
  assert.throws(() => setOutfitAsset(saved, 'ArmsLeft', 'Arm', resolvers), { code: 'protected-group' })
  assert.throws(() => removeOutfitAsset(saved, 'ArmsLeft', resolvers), { code: 'protected-group' })
  assert.throws(() => setOutfitColor(saved, 'ArmsLeft', '#123456', resolvers), { code: 'protected-group' })
  assert.deepEqual(saved, [{ Group: 'ArmsLeft', Name: 'Arm' }])
})
