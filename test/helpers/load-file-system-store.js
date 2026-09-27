import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { IDBFactory } from 'fake-indexeddb'

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
    indexedDB: new IDBFactory(),
    localStorage: {
      getItem: (key) => saved.get(key) ?? null,
      setItem(key, value) {
        saved.set(key, value)
        writes.push([key, value])
      },
      removeItem(key) {
        saved.delete(key)
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
  const historySaved = new Map()
  const historyArchives = new Map()
  fs._historyPersistence = {
    async read(member) { return historySaved.get(member) ?? null },
    async write(member, data) { historySaved.set(member, JSON.parse(JSON.stringify(data))) },
    async archiveLegacy(member, raw) {
      const copies = historyArchives.get(member) || []
      if (!copies.some(copy => copy.raw === raw)) historyArchives.set(member, [...copies, { raw, archivedAt: 'test' }])
    },
    async listLegacyArchives(member) { return historyArchives.get(member) || [] },
  }
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
