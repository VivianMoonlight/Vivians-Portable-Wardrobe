import assert from 'node:assert/strict'
import test from 'node:test'
import { loadRenderApi } from './helpers/load-render-api.js'

const shirt = 'Assets/Female3DCG/Cloth/Shirt.png'
const skirt = 'Assets/Female3DCG/ClothLower/Skirt.png'

for (const mode of ['2d', 'gl']) {
  test(`${mode}: a warm BC cache renders synchronously without downloads or polling`, () => {
    const h = loadRenderApi({ mode })
    h.load(shirt)
    h.image(shirt).dispatch('load')
    const requests = h.calls.requests.length
    const session = h.create({ data: [{ Group: 'Cloth', Name: 'Shirt' }] })

    assert.equal(h.updates.length, 1)
    assert.equal(h.updates[0].state, 'ready')
    assert.equal(h.calls.requests.length, requests)
    assert.equal(h.createdImages.length, 1)
    assert.equal(h.frames.size, 0)
    assert.equal(h.timers.size, 1)
    assert.equal([...h.timers.values()][0].delay, 20000, 'only a failure deadline, no fixed readiness delay')
    assert.equal(h.calls.naked.length, 1)
    assert.equal(h.calls.naked[0][1], false)
    assert.equal(h.calls.bundles.length, 1)
    assert.equal(h.calls.refresh.length, 1)
    assert.deepEqual(h.calls.refresh[0].slice(1), [false, false])
    assert.equal(h.calls.draw.length, 1)

    session.dispose()
    assert.equal(h.timers.size, 0)
  })

  test(`${mode}: cold images redraw once after load without rebuilding the appearance bundle`, () => {
    const h = loadRenderApi({ mode })
    const session = h.create()
    assert.equal(h.updates.at(-1).state, 'loading')
    assert.equal(h.frames.size, 0)
    h.image(shirt).dispatch('load')
    assert.equal(h.frames.size, 1)
    assert.equal(h.calls.draw.length, 1, 'image event does not synchronously render')
    h.flushFrame()

    assert.equal(h.updates.at(-1).state, 'ready')
    assert.equal(h.calls.requests.length, 1)
    assert.equal(h.calls.draw.length, 2)
    assert.equal(h.calls.build.length, 2)
    assert.equal(h.calls.naked.length, 1)
    assert.equal(h.calls.bundles.length, 1)
    assert.equal(h.calls.refresh.length, 1)
    assert.equal(h.frames.size, 0)
    session.dispose()
  })

  test(`${mode}: BC owns the first two retries and the third error ends loading`, () => {
    const h = loadRenderApi({ mode })
    const session = h.create()
    const image = h.image(shirt)
    for (let attempt = 1; attempt <= 2; attempt++) {
      image.dispatch('error')
      assert.equal(image.errorcount, attempt)
      assert.equal(h.calls.requests.length, attempt + 1)
      assert.equal(h.frames.size, 0)
      assert.equal(h.updates.length, 1)
      assert.equal(h.updates[0].state, 'loading')
    }
    image.dispatch('error')
    assert.equal(image.errorcount, 3)
    assert.equal(h.calls.requests.length, 3)
    assert.equal(h.frames.size, 1)
    h.flushFrame()
    assert.equal(h.updates.at(-1).state, 'error')
    assert.match(h.updates.at(-1).error, /failed to load/)
    assert.equal(h.calls.bundles.length, 1)
    session.dispose()
  })

  test(`${mode}: explicit retry restarts only exhausted images and keeps BC cache entries`, () => {
    const data = [{ Group: 'Cloth', Name: 'Shirt' }]
    const h = loadRenderApi({ mode, layers: () => [shirt, skirt] })
    h.load(skirt)
    const healthyImage = h.image(skirt)
    healthyImage.dispatch('load')
    const session = h.create({ data })
    const failedImage = h.image(shirt)
    for (let attempt = 0; attempt < 3; attempt++) failedImage.dispatch('error')
    h.flushFrame()
    assert.equal(h.updates.at(-1).state, 'error')
    session.dispose()

    const requests = h.calls.requests.length
    const ordinarySession = h.create({ data })
    assert.equal(h.updates.at(-1).state, 'error', 'scrolling back does not automatically retry exhausted requests')
    assert.equal(h.calls.requests.length, requests)
    ordinarySession.dispose()

    const listeners = failedImage.listenerCount('load')
    const texture = h.gl.textureCache.get(shirt)
    assert.equal(h.api.retryFailedImagesForOutfit(data), 1)
    assert.equal(h.calls.requests.length, requests + 1)
    assert.equal(failedImage.errorcount, 0)
    assert.equal(h.image(shirt), failedImage)
    assert.equal(h.image(skirt), healthyImage)
    assert.equal(failedImage.listenerCount('load'), listeners, 'reuse BC listeners, including its texture binding')
    if (mode === 'gl') assert.equal(h.gl.textureCache.get(shirt), texture)
    assert.equal(h.api.retryFailedImagesForOutfit(data), 0, 'a pending retry cannot be duplicated')

    const retrySession = h.create({ data })
    assert.equal(h.updates.at(-1).state, 'loading')
    failedImage.dispatch('load')
    h.flushFrame()
    assert.equal(h.updates.at(-1).state, 'ready')
    assert.equal(h.calls.requests.length, requests + 1)
    assert.equal(h.api.retryFailedImagesForOutfit(data), 0)
    retrySession.dispose()
  })
}

test('explicit retry cannot restart failed images belonging only to a different outfit', () => {
  const first = [{ Group: 'Cloth', Name: 'Shirt' }]
  const other = [{ Group: 'ClothLower', Name: 'Skirt' }]
  const h = loadRenderApi()
  const session = h.create({ data: first })
  for (let attempt = 0; attempt < 3; attempt++) h.image(shirt).dispatch('error')
  h.flushFrame()
  session.dispose()
  assert.equal(h.api.retryFailedImagesForOutfit(other), 0)
  assert.equal(h.calls.requests.length, 3)
  assert.equal(h.api.retryFailedImagesForOutfit(first), 1)
  assert.equal(h.calls.requests.length, 4)
})

test('WebGL cache readiness is independent of the 2D cache for the same URL', () => {
  const h = loadRenderApi({ mode: 'gl' })
  const canvasImage = h.hostWindow.DrawGetImage(shirt)
  canvasImage.dispatch('load')
  const session = h.create()
  const glImage = h.image(shirt)
  assert.notEqual(glImage, canvasImage)
  assert.equal(h.updates.at(-1).state, 'loading')
  assert.equal(h.createdImages.length, 2, 'one image per game cache, no third preview download')
  glImage.dispatch('load')
  h.flushFrame()
  assert.equal(h.updates.at(-1).state, 'ready')
  assert.equal(h.createdImages.length, 2)
  session.dispose()
})

test('a burst of dependency loads is coalesced into one animation frame', () => {
  const urls = [shirt, skirt, 'Assets/Female3DCG/Shoes/Heels.png']
  const h = loadRenderApi({ layers: () => urls })
  const session = h.create()
  for (const url of urls) h.image(url).dispatch('load')
  assert.equal(h.frames.size, 1)
  h.flushFrame()
  assert.equal(h.updates.at(-1).state, 'ready')
  assert.equal(h.calls.draw.length, 2)
  assert.equal(h.calls.bundles.length, 1)
  session.dispose()
})

test('a dynamic layer discovered on redraw must finish before ready', () => {
  const h = loadRenderApi({ layers: (_, calls) => calls.build.length === 1 ? [shirt] : [shirt, skirt] })
  const session = h.create()
  h.image(shirt).dispatch('load')
  h.flushFrame()
  assert.equal(h.updates.at(-1).state, 'loading')
  assert.ok(h.image(skirt))
  h.image(skirt).dispatch('load')
  h.flushFrame()
  assert.equal(h.updates.at(-1).state, 'ready')
  assert.equal(h.calls.draw.length, 3)
  assert.equal(h.calls.bundles.length, 1)
  assert.equal(h.calls.refresh.length, 1)
  session.dispose()
})

test('cancellation removes preview listeners and frames but retains BC caches', () => {
  const h = loadRenderApi()
  const session = h.create()
  const image = h.image(shirt)
  assert.equal(image.listenerCount('load'), 2)
  assert.equal(image.listenerCount('error'), 2)
  image.dispatch('load')
  assert.equal(h.frames.size, 1)
  session.dispose()
  session.dispose()
  assert.equal(h.frames.size, 0)
  assert.equal(h.timers.size, 0)
  assert.equal(image.listenerCount('load'), 1, 'BC listener is kept')
  assert.equal(image.listenerCount('error'), 1, 'BC retry listener is kept')
  assert.equal(h.calls.delete.length, 1)
  assert.equal(h.calls.delete[0][0], h.characters[0])
  assert.equal(h.calls.delete[0][1], false, 'do not clear shared game caches')
  assert.equal(h.image(shirt), image)
  image.dispatch('load')
  assert.equal(h.frames.size, 0)
  assert.equal(h.updates.length, 1)
})

test('another character and its image loads cannot trigger this preview', () => {
  const h = loadRenderApi({ layers: character => character.name === 'Other' ? [skirt] : [shirt] })
  const session = h.create()
  h.hostWindow.CharacterAppearanceBuildCanvas({ name: 'Other' })
  h.image(skirt).dispatch('load')
  assert.equal(h.frames.size, 0)
  assert.equal(h.updates.length, 1)
  assert.equal(h.image(skirt).listenerCount('load'), 1)
  assert.equal(h.calls.draw.length, 1)
  session.dispose()
})

test('a BC-initiated rebuild of this character schedules a canvas refresh without reloading its bundle', () => {
  const h = loadRenderApi()
  const session = h.create()
  h.image(shirt).dispatch('load')
  h.flushFrame()
  h.hostWindow.CharacterAppearanceBuildCanvas(h.characters[0])
  assert.equal(h.frames.size, 1)
  h.flushFrame()
  assert.equal(h.calls.draw.length, 3)
  assert.equal(h.calls.bundles.length, 1)
  assert.equal(h.calls.refresh.length, 1)
  session.dispose()
})

test('a stalled request reports a retryable error instead of caching a partial success', () => {
  const h = loadRenderApi()
  const session = h.create()
  const [{ callback, delay }] = [...h.timers.values()]
  assert.equal(delay, 20000)
  callback()
  assert.equal(h.updates.at(-1).state, 'error')
  assert.match(h.updates.at(-1).error, /timed out/)
  assert.equal(h.updates.some(status => status.state === 'ready'), false)
  session.dispose()
})

test('uninstall disposes pending sessions and restores original BC loaders', () => {
  const h = loadRenderApi()
  h.create()
  h.image(shirt).dispatch('load')
  h.uninstall()
  h.uninstall()
  assert.equal(h.calls.delete.length, 1)
  assert.equal(h.frames.size, 0)
  assert.equal(h.timers.size, 0)
  assert.equal(h.image(shirt).listenerCount('load'), 1)
  const updates = []
  h.api.createRenderSession({ canvas: h.canvas, onUpdate: (_, status) => updates.push(status) })
  assert.equal(updates[0].state, 'error')
  assert.match(updates[0].error, /not available/)
  assert.equal(h.characters.length, 1)
})
