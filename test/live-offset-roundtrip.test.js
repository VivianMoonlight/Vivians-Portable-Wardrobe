import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareSavedOutfit, prepareOutfitOffsets } from '../src/services/migrate-outfit-offsets.js'

test('preview and save convert copies, retaining native values and skipped originals', () => {
  const warnings = []
  const host = {
    Player: { AssetFamily: 'F' }, GameVersion: 'R134', GLVersion: 'WebGL',
    GLDrawCanvas: { GL: { isContextLost: () => false } },
    ServerBundledItemToAppearanceItem: () => ({ Asset: { Layer: [{ Name: 'Front' }] } }),
    PropertyLayerOrigin: { getOriginal: () => ({ Front: { '': 10 } }) },
    alert: message => warnings.push(message),
  }
  const old = { Group: 'Cloth', Name: 'A', Property: { LayerOverrides: [{ DrawingLeft: { '': -3 } }] } }
  const native = { Property: { TranslationY: -13 } }
  const data = [old, native]
  const saved = prepareSavedOutfit(data, host)
  assert.equal(saved.offsetFormat, 'new')
  assert.deepEqual(prepareOutfitOffsets(data, host), saved.data)
  assert.equal(saved.data[0].Property.LayerTranslationX.Front, -7)
  assert.equal(saved.data[1], native)
  assert.deepEqual(prepareOutfitOffsets(saved.data, host), saved.data)
  assert.equal(old.Property.LayerOverrides[0].DrawingLeft[''], -3)
  assert.equal(warnings.length, 0)
  host.GLVersion = null
  assert.equal(prepareSavedOutfit(data, host).data[0], old)
  assert.equal(warnings.length, 0)
  host.GLVersion = "WebGL"
  const bad = { ...old, Property: { LayerOverrides: [{ DrawingLeft: { "": 2010 } }] } }
  const result = prepareSavedOutfit([bad, old], host)
  assert.equal(result.data[0], bad)
  assert.equal(result.offsetFormat, "old")
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /Cloth\/A.*DrawingLeft\[Front\].*2010.*1000/)
})
