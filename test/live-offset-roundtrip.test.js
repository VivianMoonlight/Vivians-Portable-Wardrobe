import assert from 'node:assert/strict'
import test from 'node:test'
import { outfitRenderData, prepareOutfitOffsets } from '../src/services/migrate-outfit-offsets.js'

test('explicit outfit format controls conversion without mutating the undo source', () => {
  const host = { localStorage: { getItem: () => 'false' } }
  const data = [{ Property: { LayerTranslationX: { Left: -13 } } }]
  assert.deepEqual(outfitRenderData({ data }), data)
  const converted = prepareOutfitOffsets(data, host, {}, true)
  assert.equal(converted[0].Property.LayerTranslationX.Left, -7)
  host.localStorage.getItem = () => 'true'
  assert.deepEqual(prepareOutfitOffsets(outfitRenderData({ data: converted, offsetFormat: 'new' }), host, {}), converted)
  assert.deepEqual(prepareOutfitOffsets(outfitRenderData({ data, offsetFormat: 'new' }), host, {}), data)
  assert.equal(data[0].Property.LayerTranslationX.Left, -13)
})
