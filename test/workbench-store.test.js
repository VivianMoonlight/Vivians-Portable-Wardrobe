import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { transform } from 'esbuild'

const require = createRequire(import.meta.url)
const source = await readFile(new URL('../src/stores/workbenchStore.js', import.meta.url), 'utf8')
const { code } = await transform(source, { format: 'cjs', sourcefile: 'workbenchStore.js' })
const ACTIVE_TAB_KEY = 'vpw.workbench.activeTab'
const WARDROBE_UI_KEY = 'vpw.workbench.wardrobeUi'
const MOBILE_UI_KEY = 'vpw.workbench.mobileUi'
const defaultWardrobeUi = {
  searchScope: 'current',
  sortBy: 'recent',
  fileViewMode: 'card',
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
}

function loadStore(entries = {}, { failReads = false, failWrites = false } = {}) {
  const saved = new Map(Object.entries(entries))
  const writes = []
  const localStorage = {
    getItem(key) {
      if (failReads) throw new Error('Storage unavailable')
      return saved.get(key) ?? null
    },
    setItem(key, value) {
      if (failWrites) throw new Error('Storage unavailable')
      writes.push([key, value])
      saved.set(key, value)
    },
  }
  const module = { exports: {} }
  runInNewContext(code, {
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier === '@/utils/host-window.js') return { hostWindow: { localStorage } }
      return require(specifier)
    },
  })
  return { store: module.exports.useWorkbenchStore, saved, writes }
}

function wardrobeUi(store) {
  // Normalize the VM object's prototype before comparing its persisted data.
  return JSON.parse(JSON.stringify(store.getState().wardrobeUi))
}

test('restores active tab and merges existing wardrobe preferences with defaults', () => {
  const { store } = loadStore({
    [ACTIVE_TAB_KEY]: 'history',
    [WARDROBE_UI_KEY]: JSON.stringify({ searchScope: 'all', fileViewMode: 'list', extra: 'preserved' }),
  })

  assert.equal(store.getState().activeTab, 'history')
  assert.deepEqual(wardrobeUi(store), {
    ...defaultWardrobeUi,
    searchScope: 'all',
    fileViewMode: 'list',
    extra: 'preserved',
  })
  assert.equal(store.getState, store.api.getState)
  assert.equal(store.subscribe, store.api.subscribe)
})

test('missing, invalid, and inaccessible saved preferences use existing defaults', () => {
  for (const fixture of [
    loadStore(),
    loadStore({ [ACTIVE_TAB_KEY]: 'studio', [WARDROBE_UI_KEY]: '{broken' }),
    loadStore({ [ACTIVE_TAB_KEY]: '', [WARDROBE_UI_KEY]: '' }),
    loadStore({}, { failReads: true }),
  ]) {
    assert.equal(fixture.store.getState().activeTab, 'wardrobe')
    assert.deepEqual(wardrobeUi(fixture.store), defaultWardrobeUi)
    assert.deepEqual(fixture.writes, [])
  }
})

test('changing a tab notifies subscribers and persists only the active tab', () => {
  const oldMobilePreferences = JSON.stringify({ mainTab: 'wardrobe', panes: { wardrobe: 'preview' } })
  const { store, saved, writes } = loadStore({ [MOBILE_UI_KEY]: oldMobilePreferences })
  const transitions = []
  const unsubscribe = store.subscribe((next, previous) => {
    transitions.push([previous.activeTab, next.activeTab])
  })

  store.getState().setActiveTab('history')
  store.getState().setActiveTab('history')
  store.getState().setActiveTab('studio')
  store.getState().setActiveTab(null)
  store.getState().setActiveTab('settings')

  assert.deepEqual(transitions, [['wardrobe', 'history'], ['history', 'settings']])
  assert.deepEqual(writes, [[ACTIVE_TAB_KEY, 'history'], [ACTIVE_TAB_KEY, 'settings']])
  assert.equal(saved.get(MOBILE_UI_KEY), oldMobilePreferences)
  assert.equal(loadStore(Object.fromEntries(saved)).store.getState().activeTab, 'settings')

  unsubscribe()
  store.getState().setActiveTab('wardrobe')
  assert.equal(transitions.length, 2)
})

test('updating wardrobe preferences keeps the existing shape and survives reload', () => {
  const { store, saved, writes } = loadStore({
    [WARDROBE_UI_KEY]: JSON.stringify({ searchScope: 'all', extra: 'preserved' }),
  })
  store.getState().setWardrobeUi({ fileViewMode: 'list' })

  const expected = { ...defaultWardrobeUi, searchScope: 'all', fileViewMode: 'list', extra: 'preserved' }
  assert.deepEqual(wardrobeUi(store), expected)
  assert.deepEqual(writes, [[WARDROBE_UI_KEY, JSON.stringify(expected)]])
  assert.deepEqual(wardrobeUi(loadStore(Object.fromEntries(saved)).store), expected)
})

test('legacy thumbnail sizes restore as cards while lists remain lists', () => {
  for (const oldMode of ['large', 'small', 'card', null, 'unknown']) {
    const { store, saved } = loadStore({
      [WARDROBE_UI_KEY]: JSON.stringify({ fileViewMode: oldMode, extra: 'preserved' }),
    })
    assert.equal(store.getState().wardrobeUi.fileViewMode, 'card')
    store.getState().setWardrobeUi({ sortBy: 'name' })
    assert.equal(JSON.parse(saved.get(WARDROBE_UI_KEY)).fileViewMode, 'card')
    assert.equal(store.getState().wardrobeUi.extra, 'preserved')
  }
})

test('storage write failures do not prevent in-memory interactions', () => {
  const { store } = loadStore({}, { failWrites: true })
  assert.doesNotThrow(() => store.getState().setActiveTab('history'))
  assert.doesNotThrow(() => store.getState().setWardrobeUi({ searchScope: 'all' }))
  assert.equal(store.getState().activeTab, 'history')
  assert.equal(store.getState().wardrobeUi.searchScope, 'all')
})
