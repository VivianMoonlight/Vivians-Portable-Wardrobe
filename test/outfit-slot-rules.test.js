import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  normalizeSlotMode,
  getGroupNameFromPart,
  groupPartsBySlot,
  buildPresenceSets,
  buildSlotPresenceMap,
  computeGroupSlotMode,
  nextGroupOperation,
  scopeModeState,
  buildOutfitBundle,
} from '../src/services/outfit-slot-rules.js'

test('group operations resolve both directions from original and incoming presence', () => {
  // Columns: absent, character only, incoming only, both present.
  const presence = [[false, false], [true, false], [false, true], [true, true]]
  const expected = {
    incoming: {
      add: ['incoming', 'original', 'incoming', 'original'],
      replace: ['original', 'original', 'incoming', 'incoming'],
      'full-replace': ['incoming', 'incoming', 'incoming', 'incoming'],
    },
    original: {
      add: ['original', 'original', 'incoming', 'incoming'],
      replace: ['incoming', 'original', 'incoming', 'original'],
      'full-replace': ['original', 'original', 'original', 'original'],
    },
  }
  for (const [source, operations] of Object.entries(expected)) {
    for (const [operation, modes] of Object.entries(operations)) {
      assert.deepEqual(presence.map(([original, incoming]) => computeGroupSlotMode(source, operation, original, incoming)), modes)
    }
  }
})

test('group cycles start at add, repeat after full replacement, and reset when the source changes', () => {
  assert.equal(nextGroupOperation(undefined, 'incoming'), 'add')
  assert.equal(nextGroupOperation({ mode: 'incoming', operation: 'add' }, 'incoming'), 'replace')
  assert.equal(nextGroupOperation({ mode: 'incoming', operation: 'replace' }, 'incoming'), 'full-replace')
  assert.equal(nextGroupOperation({ mode: 'incoming', operation: 'full-replace' }, 'incoming'), 'add')
  assert.equal(nextGroupOperation({ mode: 'incoming', operation: 'replace' }, 'original'), 'add')
  for (const mode of [null, undefined, '', 'auto', 'unknown', 1, {}]) assert.equal(normalizeSlotMode(mode), 'empty')
  for (const mode of ['original', 'incoming', 'empty']) assert.equal(normalizeSlotMode(mode), mode)
})

test('group aliases, repeated parts, and incomplete records produce consistent presence', () => {
  const shirt = { Group: 'Cloth', Asset: { Group: { Name: 'Ignored' } } }
  const skirt = { Asset: { Group: { Name: 'ClothLower' } } }
  const shoes = { Asset: { Group: { name: 'Shoes' } } }
  const character = [shirt, skirt, shirt, {}, null]
  const incoming = [shoes, { Group: 'Cloth' }]
  assert.equal(getGroupNameFromPart(shirt), 'Cloth')
  assert.deepEqual([...groupPartsBySlot(character)], [['Cloth', [shirt, shirt]], ['ClothLower', [skirt]]])
  assert.deepEqual(buildPresenceSets(character, incoming), {
    inCharacter: new Set(['Cloth', 'ClothLower']),
    inIncoming: new Set(['Shoes', 'Cloth']),
  })
  assert.deepEqual(buildSlotPresenceMap(character, incoming), {
    Cloth: { inCharacter: true, inHover: true },
    ClothLower: { inCharacter: true, inHover: false },
    Shoes: { inCharacter: false, inHover: true },
  })
  assert.equal(groupPartsBySlot(null).size, 0)
  assert.deepEqual(buildSlotPresenceMap(null, null), {})
})

function outfitFixture() {
  const original = [
    { Group: 'Cloth', Name: 'Shirt', Color: ['#ffffff'], Property: { Type: 'Open' }, Craft: { Name: 'Custom shirt' } },
    { Group: 'Shoes', Name: 'Boots' },
    { Group: 'Cloth', Name: 'Second layer' },
    { Group: 'Hat', Name: 'Cap' },
  ]
  const incoming = [
    { Group: 'Socks', Name: 'Stockings' },
    { Group: 'Cloth', Name: 'Dress', Color: ['#000000'], Property: { Type: 'Long' }, Craft: { Name: 'Custom dress' } },
    { Group: 'Cloth', Name: 'Dress layer' },
  ]
  return { original, incoming }
}

test('explicit slots preserve item details and source order while removing empty slots', () => {
  const { original, incoming } = outfitFixture()
  const controls = {
    Cloth: { mode: 'incoming' },
    Shoes: { mode: 'original' },
    Hat: { mode: 'empty' },
    Socks: { mode: 'incoming' },
    Missing: { mode: 'original' },
  }
  const snapshot = structuredClone({ original, incoming, controls })
  const result = buildOutfitBundle(original, incoming, controls)
  const expected = [incoming[1], incoming[2], original[1], incoming[0]]
  assert.deepEqual(result, expected)
  result.forEach((part, index) => assert.equal(part, expected[index]))
  assert.deepEqual({ original, incoming, controls }, snapshot)
  assert.deepEqual(buildOutfitBundle(original, incoming), [])
  assert.deepEqual(buildOutfitBundle(null, null, controls), [])
  assert.deepEqual(buildOutfitBundle(original, incoming, { Cloth: { mode: 'original' } }), [original[0], original[2]])
})

test('a missing full-replacement source clears output without moving its source control to empty', () => {
  const { original, incoming } = outfitFixture()
  const controls = Object.fromEntries(['Cloth', 'Shoes', 'Hat', 'Socks'].map(key => [key, { mode: 'incoming' }]))
  assert.deepEqual(buildOutfitBundle(original, incoming, controls), [incoming[1], incoming[2], incoming[0]])
  assert.equal(controls.Shoes.mode, 'incoming')
  assert.equal(controls.Hat.mode, 'incoming')
  const { inCharacter, inIncoming } = buildPresenceSets(original, incoming)
  assert.equal(scopeModeState(Object.keys(controls), 'incoming', controls, inCharacter, inIncoming), 'full')
})
