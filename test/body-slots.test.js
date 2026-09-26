import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isBodySlot } from '../src/services/body-slots.js'

test('body shortcuts work before filter metadata loads, including face and hair', () => {
  const bodySlots = [
    'Height', 'BodyStyle', 'BodyUpper', 'BodyLower',
    'ArmsLeft', 'ArmsRight', 'HandsLeft', 'HandsRight',
    'Head', 'Eyes', 'Eyes2', 'Eyebrows', 'EyeShadow', 'Mouth', 'Blush',
    'HairFront', 'HairBack', 'FacialHair', 'Nipples', 'Pussy', 'Penis',
    'BodyMarkings', 'FaceMarkings',
  ]
  for (const key of bodySlots) assert.equal(isBodySlot(key), true, key)
})

test('body shortcuts include known modded face, hair and tattoo slots without metadata', () => {
  for (const key of ['新前发_Luzi', '新后发_Luzi', '额外头发_Luzi',
    '新前发_Luzi_stack', '新后发_Luzi_stack', '左眼_Luzi', '右眼_Luzi',
    'BodyMarkings2_Luzi', '身体痕迹_Luzi']) {
    assert.equal(isBodySlot(key), true, key)
  }
})

test('unknown appearance slots require explicit non-clothing BC metadata', () => {
  assert.equal(isBodySlot('CustomBody', { Category: 'Appearance', Clothing: false }), true)
  assert.equal(isBodySlot('CustomBody', { Category: 'Appearance', Clothing: false, BodyCosplay: true }), true)
  assert.equal(isBodySlot('CustomClothing', { Category: 'Appearance', Clothing: true }), false)
  assert.equal(isBodySlot('Unknown', { Category: 'Appearance' }), false)
  assert.equal(isBodySlot('Unknown', { Clothing: false }), false)
  assert.equal(isBodySlot('Unknown'), false)
})

test('clothing, accessories, restraints and visual indicators stay outside body shortcuts', () => {
  for (const key of ['Cloth', 'ClothLower', 'Hat', 'Mask', 'Glasses',
    'HairAccessory1', 'HairAccessory2', 'Necklace', 'Wings', 'TailStraps',
    'Decals', 'Fluids', 'Emoticon', 'Pronouns', 'ItemArms', 'ItemHair']) {
    assert.equal(isBodySlot(key), false, key)
  }
  for (const key of ['Fluids', 'Emoticon', 'Pronouns', 'Decals', 'ItemCustom']) {
    assert.equal(isBodySlot(key, { Category: 'Appearance', Clothing: false }), false, key)
  }
  assert.equal(isBodySlot('BodyUpper', { Category: 'Item', Clothing: false }), false)
  assert.equal(isBodySlot('Eyes', { Category: 'Script', Clothing: false }), false)
  assert.equal(isBodySlot('CustomScript', { Category: 'Script', Clothing: false }), false)
  assert.equal(isBodySlot('HairFront', { Category: 'Appearance', Clothing: true }), false)
})

test('eye makeup remains facial appearance despite BC clothing and cosplay flags', () => {
  assert.equal(isBodySlot('EyeShadow', { Category: 'Appearance', Clothing: true, BodyCosplay: true }), true)
  assert.equal(isBodySlot('EyeShadow', { Category: 'Item', Clothing: true }), false)
})

test('invalid or absent slot keys do not match unrelated metadata', () => {
  for (const key of [undefined, null, '', 7, {}, []]) {
    assert.equal(isBodySlot(key, { Category: 'Appearance', Clothing: false }), false)
  }
})
