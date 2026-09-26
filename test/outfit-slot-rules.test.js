import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SLOT_MODES,
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
import { isHiddenBodySlot, preserveHiddenBodySlots } from '../src/services/hidden-body-slots.js'

test('group add and replace preserve the current source in slots they do not affect', () => {
  for (const source of ['incoming', 'original']) {
    for (const current of ['incoming', 'original', 'empty']) {
      for (const original of [false, true]) {
        for (const incoming of [false, true]) {
          const sourcePresent = source === 'original' ? original : incoming
          const occupied = current === 'original' ? original : current === 'incoming' && incoming
          assert.equal(computeGroupSlotMode(source, 'add', current, original, incoming), sourcePresent && !occupied ? source : current)
          assert.equal(computeGroupSlotMode(source, 'replace', current, original, incoming), sourcePresent ? source : current)
          assert.equal(computeGroupSlotMode(source, 'full-replace', current, original, incoming), source)
        }
      }
    }
  }
})

test('the next group operation follows contents and remains full replacement after completion', () => {
  const keys = ['Cloth', 'Shoes', 'Gloves']
  const source = [{ Group: 'Cloth', Name: 'shirt' }, { Group: 'Shoes', Name: 'shoes' }]
  const otherShirt = { Group: 'Cloth', Name: 'other-shirt' }
  assert.equal(nextGroupOperation(keys, [], source), 'add')
  assert.equal(nextGroupOperation(keys, [otherShirt], source), 'add')
  assert.equal(nextGroupOperation(keys, [otherShirt, source[1]], source), 'replace')
  assert.equal(nextGroupOperation(keys, [...source, { Group: 'Gloves', Name: 'gloves' }], source), 'full-replace')
  assert.equal(nextGroupOperation(keys, source, source), 'full-replace')
  assert.equal(nextGroupOperation(keys, source, []), 'full-replace')
  assert.equal(nextGroupOperation(keys, [...source, { Group: 'Hair', Name: 'hair' }], source), 'full-replace')
})

test('covered groups compare complete part details, repeated layers and unordered object keys', () => {
  const source = [{ Group: 'Cloth', Name: 'shirt', Color: ['red'], Property: { TypeRecord: { b: 2, a: 1 } }, Craft: { Name: 'custom' } }]
  const same = [{ Craft: { Name: 'custom' }, Property: { TypeRecord: { a: 1, b: 2 } }, Color: ['red'], Name: 'shirt', Group: 'Cloth' }]
  assert.equal(nextGroupOperation(['Cloth'], same, source), 'full-replace')
  for (const field of ['Color', 'Property', 'Craft']) {
    const different = structuredClone(same)
    delete different[0][field]
    assert.equal(nextGroupOperation(['Cloth'], different, source), 'replace', field)
  }
  assert.equal(nextGroupOperation(['Cloth'], [...same, { Group: 'Cloth', Name: 'layer' }], source), 'replace')
  assert.equal(nextGroupOperation(['Cloth'], [same[0]], [...source, source[0]]), 'replace')
})

test('individual source normalization remains direct', () => {
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

test('every BC hidden-body group keeps the original in preview regardless of selected mode', () => {
  const protectedGroups = ['Blush', 'ArmsLeft', 'ArmsRight', 'HandsLeft', 'HandsRight', 'Emoticon', 'Fluids']
  const original = protectedGroups.map(Group => ({ Group, Name: `original-${Group}` }))
  const incoming = protectedGroups.map(Group => ({ Group, Name: `incoming-${Group}` }))
  incoming.push({ Group: 'Cloth', Name: 'new-shirt' })
  for (const mode of SLOT_MODES) {
    const controls = Object.fromEntries([...protectedGroups, 'Cloth'].map(Group => [Group, { mode }]))
    const result = buildOutfitBundle(original, incoming, controls)
    assert.deepEqual(result.filter(part => isHiddenBodySlot(part.Group)), original)
    assert.deepEqual(result.filter(part => part.Group === 'Cloth'), mode === 'incoming' ? [incoming.at(-1)] : [])
  }
  assert.deepEqual(buildOutfitBundle([], incoming, Object.fromEntries(protectedGroups.map(Group => [Group, { mode: 'incoming' }]))), [])
})

test('final-boundary normalization retains live hidden-body values when a bundle omits or changes them', () => {
  const current = [
    { Group: 'Blush', Name: 'live-expression', Property: { Expression: 'Low' } },
    { Group: 'ArmsLeft', Name: 'live-arm' },
    { Group: 'Cloth', Name: 'old-shirt' },
  ]
  const requested = [
    { Group: 'Blush', Name: 'saved-expression' },
    { Group: 'Cloth', Name: 'new-shirt' },
    { Group: 'Fluids', Name: 'saved-fluids' },
  ]
  const result = preserveHiddenBodySlots(current, requested)
  assert.deepEqual(result, [current[0], requested[1], current[1]])
  assert.deepEqual(current[0].Property, { Expression: 'Low' })
  assert.equal(requested[0].Name, 'saved-expression')
  assert.equal(isHiddenBodySlot('Cloth'), false)
  assert.equal(isHiddenBodySlot('ItemArms'), false)
})
