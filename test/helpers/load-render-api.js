import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { build } from 'esbuild'

async function loadFixture() {
  if (!process.env.VPW_BC_SOURCE_DIR) return readFile(new URL('./bc-render-fixture.js', import.meta.url), 'utf8')
  const sources = [
    ['Drawing.js', ['DrawGetImage', 'DrawGetImageOnLoad', 'DrawGetImageOnError']],
    ['GLDraw.js', ['GLDrawLoadImage']],
    ['Appearance.js', ['CharacterAppearanceBuildCanvas']],
  ]
  const functions = []
  for (const [filename, names] of sources) {
    const directory = process.env.VPW_BC_SOURCE_DIR
    let source
    try { source = await readFile(join(directory, filename), 'utf8') }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      source = await readFile(join(directory, `bc-${filename}`), 'utf8')
    }
    for (const name of names) {
      const start = source.indexOf(`function ${name}(`)
      const end = source.indexOf('\n}', start)
      if (start < 0 || end < 0) throw new Error(`Cannot locate BC ${name} in ${filename}`)
      functions.push(source.slice(start, end + 2))
    }
  }
  return functions.join('\n\n')
}

// Optional integration mode extracts functions from a user-owned BC checkout;
// its source is never copied into this repository or required by normal tests.
const fixture = await loadFixture()
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../../src/utils/RenderApi.js', import.meta.url))],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  plugins: [{
    name: 'render-test-game-host',
    setup(build) {
      build.onResolve({ filter: /host-window\.js$/ }, () => ({ path: 'test:game-host', external: true }))
    },
  }],
})

/** Exercise the BC loader contract with controllable image events and canvas dependencies. */
export function loadRenderApi({ mode = '2d', layers = () => ['Assets/Female3DCG/Cloth/Shirt.png'] } = {}) {
  const calls = { naked: [], bundles: [], refresh: [], delete: [], draw: [], build: [], requests: [], bindings: [], refreshImages: [] }
  const frames = new Map()
  const timers = new Map()
  const createdImages = []
  const characters = []
  let sequence = 0
  class MockImage {
    complete = false
    naturalWidth = 0
    naturalHeight = 0
    listeners = new Map()
    constructor() { createdImages.push(this) }
    set src(value) {
      this.url = value
      this.complete = false
      this.naturalWidth = 0
      calls.requests.push(value)
    }
    get src() { return this.url }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set())
      this.listeners.get(type).add(listener)
    }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener) }
    listenerCount(type) { return this.listeners.get(type)?.size || 0 }
    dispatch(type) {
      this.complete = true
      this.naturalWidth = type === 'load' ? 500 : 0
      this.naturalHeight = type === 'load' ? 1000 : 0
      for (const listener of [...(this.listeners.get(type) || [])]) listener.call(this, { type })
    }
  }
  const ctx = { save() {}, restore() {}, setTransform() {}, clearRect() {} }
  const canvas = { width: 500, height: 1000, getContext: () => ctx }
  const gl = {
    textureCache: new Map(),
    createTexture: () => ({}), bindTexture() {}, texParameteri() {}, texImage2D() {},
    isContextLost: () => false,
  }
  const hostWindow = {
    console: { ...console, log() {} },
    Image: MockImage,
    DrawCacheImage: new Map(),
    GLDrawImageCache: new Map(),
    GLVersion: mode === 'gl' ? 'WebGL2' : 'No WebGL',
    GLDrawCanvas: { GL: gl },
    requestAnimationFrame(callback) { frames.set(++sequence, callback); return sequence },
    cancelAnimationFrame(id) { frames.delete(id) },
    setTimeout(callback, delay) { timers.set(++sequence, { callback, delay }); return sequence },
    clearTimeout(id) { timers.delete(id) },
    DrawRefreshCharacterForImage(image) { calls.refreshImages.push(image) },
    GLDrawBingImageToTextureInfo(gl, image, texture) {
      calls.bindings.push(image)
      texture.width = image.naturalWidth
      texture.height = image.naturalHeight
    },
    CharacterLoadSimple(name) {
      const character = { name, AssetFamily: 'Female3DCG', MustDraw: false, Appearance: [] }
      characters.push(character)
      return character
    },
    CharacterNaked(...args) { calls.naked.push(args) },
    ServerAppearanceLoadFromBundle(...args) { calls.bundles.push(args) },
    CharacterRefresh(...args) {
      calls.refresh.push(args)
      hostWindow.CharacterAppearanceBuildCanvas(args[0])
    },
    CharacterDelete(...args) { calls.delete.push(args) },
    DrawCharacter(...args) {
      calls.draw.push(args)
      if (args[0].MustDraw) {
        hostWindow.CharacterAppearanceBuildCanvas(args[0])
        args[0].MustDraw = false
      }
    },
    CommonDrawCanvasPrepare(character) {
      character.Canvas = character.CanvasBlink = canvas
    },
    CommonDrawAppearanceBuild(character, callbacks) {
      calls.build.push(character)
      for (const url of layers(character, calls)) callbacks.drawImage(url, 0, 0, {})
    },
    DrawImageCanvas(url) { return hostWindow.DrawGetImage(url) },
    GLDrawAppearanceBuild(character) {
      calls.build.push(character)
      for (const url of layers(character, calls)) hostWindow.GLDrawLoadImage(gl, url)
    },
  }
  const context = createContext(hostWindow)
  runInContext(fixture, context, { filename: 'bc-render-fixture.js' })
  const module = { exports: {} }
  context.module = module
  context.exports = module.exports
  context.require = (specifier) => {
    if (specifier !== 'test:game-host') throw new Error(`Unexpected dependency ${specifier}`)
    return { hostWindow }
  }
  runInContext(outputFiles[0].text, context, { filename: 'RenderApi.test-bundle.js' })
  const api = module.exports
  const modApi = {
    hookFunction(name, priority, callback) {
      const original = hostWindow[name]
      hostWindow[name] = (...args) => callback(args, nextArgs => original(...nextArgs))
      return () => { hostWindow[name] = original }
    },
  }
  const uninstall = api.installRenderHooks(modApi)
  const updates = []
  return {
    api, hostWindow, canvas, calls, frames, timers, gl, createdImages, characters, updates, uninstall,
    create(options = {}) {
      return api.createRenderSession({ canvas, onUpdate: (canvas, status) => updates.push(status), ...options })
    },
    image(url, cache = mode) {
      return (cache === 'gl' ? hostWindow.GLDrawImageCache : hostWindow.DrawCacheImage).get(url)
    },
    load(url) {
      return mode === 'gl' ? hostWindow.GLDrawLoadImage(gl, url) : hostWindow.DrawGetImage(url)
    },
    flushFrame() {
      const callbacks = [...frames.values()]
      frames.clear()
      for (const callback of callbacks) callback(0)
    },
  }
}
