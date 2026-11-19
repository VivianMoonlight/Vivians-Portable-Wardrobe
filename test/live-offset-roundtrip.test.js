import assert from 'node:assert/strict'
import test from 'node:test'
import { markLiveOffsets, prepareOutfitOffsets } from '../src/services/migrate-outfit-offsets.js'

test('saving and applying a live outfit preserves compensated and native translations', () => {
  const host = { localStorage: { getItem: () => 'true' } }
  const source = [{ Property: { LayerTranslationX: { Left: -13 } } }]
  const applied = prepareOutfitOffsets(source, host, {})
  assert.equal(applied[0].Property.LayerTranslationX.Left, -7)
  const worn = [...applied, { Property: { TranslationY: 15 } }]
  const saved = JSON.parse(JSON.stringify(worn.map(markLiveOffsets)))
  assert.deepEqual(prepareOutfitOffsets(saved, host, {}), worn)
  assert.equal(source[0].Property.LayerTranslationX.Left, -13)
})
