import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../../src/stores/fileSystemStore.js', import.meta.url))],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  packages: 'external',
  plugins: [{
    name: 'test-game-host',
    setup(build) {
      build.onResolve({ filter: /host-window(?:\.js)?$/ }, () => ({ path: 'test:game-host', external: true }))
    },
  }],
})

/** Load the real store and services; replace only the game host and canvas renderer. */
export function loadFileSystemStore() {
  const saved = new Map()
  const writes = []
  const timers = new Map()
  let nextTimer = 0
  const setTimeout = (callback) => {
    timers.set(++nextTimer, callback)
    return nextTimer
  }
  const clearTimeout = (id) => timers.delete(id)
  const hostWindow = {
    Player: { MemberNumber: 42, ExtensionSettings: {} },
    __VPW_WARDROBE_LOCK_OWNER: true,
    __VPW_WARDROBE_LOCK_MEMBER: '42',
    localStorage: {
      getItem: (key) => saved.get(key) ?? null,
      setItem(key, value) {
        saved.set(key, value)
        writes.push([key, value])
      },
    },
    setTimeout,
    clearTimeout,
  }
  const module = { exports: {} }
  runInNewContext(outputFiles[0].text, {
    module,
    exports: module.exports,
    console,
    TextEncoder,
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
    LZString: require('lz-string'),
    require(specifier) {
      if (specifier === 'test:game-host') {
        return { hostWindow, setTimeoutHost: setTimeout, clearTimeoutHost: clearTimeout }
      }
      return require(specifier)
    },
  })

  const hook = module.exports.useFileSystemStore
  const fs = hook.getState()
  const renders = []
  fs.renderer = { renderPreviewWithItem: (item) => renders.push(item) }
  return {
    fs,
    hook,
    hostWindow,
    renders,
    writes,
    flushNextTimer() {
      const entry = timers.entries().next().value
      if (!entry) return false
      const [id, callback] = entry
      timers.delete(id)
      callback()
      return true
    },
    flushTimers() {
      for (const [id, callback] of Array.from(timers)) {
        if (!timers.has(id)) continue
        timers.delete(id)
        callback()
      }
    },
  }
}
