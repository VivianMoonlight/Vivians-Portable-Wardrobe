import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { build } from 'esbuild'

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/services/RenderService.js', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node',
  plugins: [{
    name: 'render-test-host',
    setup(build) {
      build.onResolve({ filter: /host-window(?:\.js)?$/ }, () => ({ path: 'test:host', external: true }))
    },
  }],
})
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports, console,
  require: () => ({ hostWindow: {}, setTimeoutHost: setTimeout, clearTimeoutHost: clearTimeout }),
})
const { RenderService } = module.exports
const item = (name) => ({ name, type: 'outfit', data: [{ Group: 'Cloth', Name: name }] })

function setup(options = {}) {
  const frames = new Map()
  const sessions = []
  let nextFrame = 0
  const service = new RenderService({
    canvasFactory: (width, height) => ({ width, height, getContext() { throw new Error('No pixel readbacks allowed') } }),
    scheduleFrame: (callback) => { frames.set(++nextFrame, callback); return nextFrame },
    cancelFrame: (id) => frames.delete(id),
    drawCallbacks: {
      createRenderSession(args) {
        const session = {
          ...args, disposed: 0,
          update(state, error) { args.onUpdate(args.canvas, { state, error }) },
          dispose() { session.disposed++ },
        }
        sessions.push(session)
        session.update(options.warm ? 'ready' : 'loading')
        return session
      },
    },
    ...options,
  })
  function frame() {
    const next = frames.entries().next().value
    assert.ok(next, 'a frame should have been scheduled')
    frames.delete(next[0])
    next[1]()
  }
  return { service, sessions, frames, frame }
}

test('warm BC assets finish on the first frame and cached observers are notified synchronously', async () => {
  const { service, sessions, frames, frame } = setup({ warm: true })
  const outfit = item('Warm')
  const events = []
  service.observe(outfit, (canvas, status) => events.push([canvas, status.state]))
  assert.equal(events[0][1], 'loading')
  frame()
  assert.equal(events.at(-1)[1], 'ready')
  assert.equal(sessions[0].disposed, 1)
  assert.equal(frames.size, 0)
  let cached
  service.observe({ ...outfit, name: 'Renamed', tagIds: ['new-tag'] }, (canvas, status) => { cached = [canvas, status.state] })
  assert.equal(cached[0], sessions[0].canvas)
  assert.equal(cached[1], 'ready')
  assert.equal(await service.getCanvas(outfit), sessions[0].canvas)
  assert.equal(sessions.length, 1)
  assert.equal(frames.size, 0)
})

test('hidden queued thumbnails allocate no canvas and cancel their scheduled frame', () => {
  const { service, sessions, frames } = setup()
  const outfit = item('Hidden')
  const unsubscribe = service.observe(outfit, () => {})
  assert.equal(service._getCanvas(outfit), null)
  unsubscribe()
  unsubscribe()
  assert.equal(frames.size, 0)
  assert.equal(sessions.length, 0)
  assert.equal(service.entries.size, 0)
})

test('identical data shares a session, and it stays alive until its last visible consumer leaves', () => {
  const { service, sessions, frames, frame } = setup()
  const outfit = item('Shared')
  const unsubscribeA = service.observe(outfit, () => {})
  const unsubscribeB = service.observe({ ...outfit }, () => {})
  frame()
  assert.equal(sessions.length, 1)
  unsubscribeA()
  assert.equal(sessions[0].disposed, 0)
  unsubscribeB()
  assert.equal(sessions[0].disposed, 1)
  sessions[0].update('ready')
  assert.equal(service.entries.size, 0)
  assert.equal(service.activeThumbnails, 0)
  assert.equal(frames.size, 0)
})

test('preview starts before queued thumbnails and has a separate slot from two cold thumbnails', () => {
  const { service, sessions, frames, frame } = setup()
  for (const name of ['A', 'B', 'C']) service.observe(item(name), () => {})
  service.observe(item('Preview'), () => {}, { preview: true })
  frame()
  assert.deepEqual(sessions.map((session) => session.data[0].Name), ['Preview', 'A'])
  frame()
  assert.deepEqual(sessions.map((session) => session.data[0].Name), ['Preview', 'A', 'B'])
  assert.equal(frames.size, 0)
  assert.equal(service.activeThumbnails, 2)
  assert.equal(service.activePreviews, 1)
  sessions[1].update('ready')
  frame()
  assert.equal(sessions[3].data[0].Name, 'C')
})

test('a new preview is not blocked by two already loading thumbnails', () => {
  const { service, sessions, frame } = setup()
  service.observe(item('A'), () => {})
  service.observe(item('B'), () => {})
  frame()
  service.observe(item('Preview'), () => {}, { preview: true })
  frame()
  assert.equal(sessions[2].data[0].Name, 'Preview')
  assert.equal(service.activeThumbnails, 2)
})

test('preparing a preview is lazy and rapid hover cancels obsolete queued and active previews', () => {
  const { service, sessions, frames, frame } = setup()
  const first = item('First')
  const second = item('Second')
  const third = item('Third')
  service.renderPreviewWithItem(first)
  assert.equal(frames.size, 0)
  service.observe(first, () => {}, { preview: true })
  service.renderPreviewWithItem(second)
  assert.equal(frames.size, 0)
  service.observe(second, () => {}, { preview: true })
  frame()
  const oldSession = sessions[0]
  const updates = []
  service.renderPreviewWithItem(third)
  assert.equal(oldSession.disposed, 1)
  service.observe(third, (canvas, status) => updates.push([canvas, status.state]), { preview: true })
  frame()
  oldSession.update('ready')
  assert.equal(updates.at(-1)[1], 'loading')
  sessions[1].update('ready')
  assert.equal(updates.at(-1)[0], sessions[1].canvas)
  assert.equal(updates.at(-1)[1], 'ready')
  assert.equal(sessions.length, 2)
})

test('ready canvas LRU respects a byte budget and weak item lookups do not retain evicted canvases', () => {
  const { service, sessions, frame } = setup({ warm: true, thumbwidth: 10, thumbheight: 10, maxCacheBytes: 800 })
  const first = item('First')
  const second = item('Second')
  const third = item('Third')
  service.observe(first, () => {})
  service.observe(second, () => {})
  frame()
  assert.equal(service.cacheBytes, 800)
  service._getCanvas(first)
  service.observe(third, () => {})
  frame()
  assert.equal(service._getCanvas(second), null)
  assert.equal(service._getCanvas(first), sessions[0].canvas)
  assert.equal(service.cacheBytes, 800)
  assert.equal('canvas' in service.registry.get(second), false)
  assert.equal(service.registry.get(second).observers.size, 0)
  service.observe(second, () => {})
  frame()
  assert.equal(sessions.length, 4)
  assert.equal(service.cacheBytes, 800)
})

test('large completed canvases are delivered once without exceeding the cache budget', () => {
  const { service, frames, frame } = setup({ warm: true, maxCacheBytes: 1 })
  let delivered
  service.observe(item('Large'), (canvas, status) => { if (status.state === 'ready') delivered = canvas })
  frame()
  assert.ok(delivered)
  assert.equal(service.cacheBytes, 0)
  assert.equal(service.entries.size, 0)
  assert.equal(frames.size, 0)
})

test('explicit thumbnail refresh invalidates its shared content cache while preserving unrelated canvases', () => {
  const { service, sessions, frame } = setup({ warm: true })
  const outfit = item('Refresh')
  const duplicate = { ...outfit }
  const other = item('Other')
  service.observe(outfit, () => {})
  service.observe(duplicate, () => {})
  service.observe(other, () => {})
  frame()
  const otherCanvas = service._getCanvas(other)
  service.removeCanvas(outfit)
  assert.equal(service._getCanvas(duplicate), null)
  assert.equal(service._getCanvas(other), otherCanvas)
  service.observe(outfit, () => {})
  frame()
  assert.equal(sessions.length, 3)
  assert.notEqual(service._getCanvas(outfit), sessions[0].canvas)
  assert.equal(service._getCanvas(other), otherCanvas)
})

test('failed rendering releases its character and slot, and only a later subscription retries', () => {
  const { service, sessions, frames, frame } = setup({ maxThumbnails: 1 })
  const broken = item('Broken')
  const errors = []
  service.observe(broken, (_canvas, status) => { if (status.error) errors.push(status.error) })
  service.observe(item('Next'), () => {})
  frame()
  sessions[0].update('error', new Error('Asset failed'))
  assert.equal(errors[0].message, 'Asset failed')
  assert.equal(sessions[0].disposed, 1)
  frame()
  assert.equal(sessions[1].data[0].Name, 'Next')
  sessions[1].update('ready')
  assert.equal(frames.size, 0)
  service.observe(broken, () => {})
  frame()
  assert.equal(sessions.length, 3)
})

test('synchronous session exceptions release slots even when no canvas can be created', () => {
  const { service, frames, frame } = setup({
    canvasFactory() { throw new Error('No canvas') },
  })
  let failure
  service.observe(item('Broken'), (canvas, status) => { if (status.error) failure = [canvas, status.error] })
  frame()
  assert.equal(failure[0], null)
  assert.equal(failure[1].message, 'No canvas')
  assert.equal(service.activeThumbnails, 0)
  assert.equal(frames.size, 0)
})

test('an error observer can immediately retry the same outfit without losing its new subscription', () => {
  const { service, sessions, frame } = setup()
  const outfit = item('Retry during error')
  const retryUpdates = []
  service.observe(outfit, (_canvas, status) => {
    if (status.state === 'error') {
      service.observe(outfit, (canvas, nextStatus) => retryUpdates.push([canvas, nextStatus.state]))
    }
  })
  frame()
  sessions[0].update('error', new Error('Asset failed'))
  assert.equal(sessions[0].disposed, 1)
  assert.equal(retryUpdates.at(-1)[1], 'loading')
  frame()
  sessions[1].update('ready')
  assert.equal(retryUpdates.at(-1)[0], sessions[1].canvas)
  assert.equal(retryUpdates.at(-1)[1], 'ready')
  assert.equal(service._getCanvas(outfit), sessions[1].canvas)
})

test('cancellation callbacks can stop and resubscribe without recursion or deleting the new item lookup', () => {
  for (const method of ['stopFor', 'removeCanvas']) {
    const { service, sessions, frame } = setup()
    const outfit = item(`Restart during ${method}`)
    const retryUpdates = []
    let cancelled = 0
    service.observe(outfit, (_canvas, status) => {
      if (status.state === 'error') {
        cancelled++
        service[method](outfit)
        service.observe(outfit, (canvas, nextStatus) => retryUpdates.push([canvas, nextStatus.state]))
      }
    })
    frame()
    service[method](outfit)
    assert.equal(cancelled, 1)
    assert.equal(sessions[0].disposed, 1)
    frame()
    sessions[0].update('ready')
    assert.equal(retryUpdates.at(-1)[1], 'loading')
    sessions[1].update('ready')
    assert.equal(retryUpdates.at(-1)[0], sessions[1].canvas)
    assert.equal(retryUpdates.at(-1)[1], 'ready')
    assert.equal(service._getCanvas(outfit), sessions[1].canvas)
    assert.ok(service.registry.get(outfit))
  }
})

test('editing data cancels the old generation and stale image callbacks cannot populate the new canvas', () => {
  const { service, sessions, frame } = setup()
  const outfit = item('Before')
  service.observe(outfit, () => {})
  frame()
  outfit.data = item('After').data
  let last
  service.observe(outfit, (canvas, status) => { last = [canvas, status.state] })
  frame()
  assert.equal(sessions[0].disposed, 1)
  sessions[0].update('ready')
  assert.equal(last[1], 'loading')
  sessions[1].update('ready')
  assert.equal(last[0], sessions[1].canvas)
  assert.equal(service._getCanvas(outfit), sessions[1].canvas)
})

test('legacy start/get/stop callers still receive canvases and cancellation errors', async () => {
  const { service, sessions, frame } = setup()
  const outfit = item('Legacy')
  const canvas = service.startThumbFor(outfit)
  assert.ok(canvas)
  const pending = service.getCanvas(outfit)
  frame()
  sessions[0].update('ready')
  assert.equal(await pending, canvas)
  service.removeCanvas(outfit)
  assert.equal(service._getCanvas(outfit), null)

  const cancelled = item('Cancelled')
  const rejected = service.getCanvas(cancelled)
  service.stopFor(cancelled)
  await assert.rejects(rejected, /Rendering cancelled/)
})
