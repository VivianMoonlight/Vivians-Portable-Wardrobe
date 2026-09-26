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
const FORCE_SELF_APPLY_KEY = member => `vpw.forceSelfApply.v1.${member}`
const MOBILE_UI_KEY = 'vpw.workbench.mobileUi'
const defaultWardrobeUi = {
  searchScope: 'current',
  sortBy: 'recent',
  fileViewMode: 'card',
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
}

function loadStore(entries = {}, { failReads = false, failWrites = false, memberNumber = 42 } = {}) {
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
  const hostWindow = { localStorage, Player: { MemberNumber: memberNumber } }
  const module = { exports: {} }
  runInNewContext(code, {
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier === '@/utils/host-window.js') return { hostWindow }
      return require(specifier)
    },
  })
  return { store: module.exports.useWorkbenchStore, isForceSelfApplyEnabled: module.exports.isForceSelfApplyEnabled, hostWindow, saved, writes }
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

test('force apply opt-in is off by default and scoped to the current BC account', () => {
  const fixture = loadStore()
  const { store, saved, writes, hostWindow, isForceSelfApplyEnabled } = fixture
  assert.equal(isForceSelfApplyEnabled(), false)
  assert.equal(store.getState().setForceSelfApplyEnabled(true), true)
  assert.equal(isForceSelfApplyEnabled(), true)
  assert.deepEqual(writes, [[FORCE_SELF_APPLY_KEY(42), '1']])

  hostWindow.Player = { MemberNumber: 43 }
  assert.equal(isForceSelfApplyEnabled(), false)
  assert.equal(store.getState().setForceSelfApplyEnabled(true), true)
  assert.equal(isForceSelfApplyEnabled(), true)
  hostWindow.Player = { MemberNumber: 42 }
  assert.equal(isForceSelfApplyEnabled(), true)
  assert.equal(store.getState().setForceSelfApplyEnabled(false), true)
  assert.equal(isForceSelfApplyEnabled(), false)
  assert.equal(saved.get(FORCE_SELF_APPLY_KEY(43)), '1')
  assert.equal(saved.get(FORCE_SELF_APPLY_KEY(42)), '0')

  saved.set(FORCE_SELF_APPLY_KEY(42), '1')
  assert.equal(isForceSelfApplyEnabled(), true, 'the execution guard reads the current setting each time')
})

test('force apply remains off without a valid account or readable local setting', () => {
  for (const memberNumber of [null, 0, -1, '42']) {
    const { store, writes, isForceSelfApplyEnabled } = loadStore({}, { memberNumber })
    assert.equal(isForceSelfApplyEnabled(), false)
    assert.equal(store.getState().setForceSelfApplyEnabled(true), false)
    assert.deepEqual(writes, [])
  }

  const noMember = loadStore()
  noMember.hostWindow.Player = null
  assert.equal(noMember.isForceSelfApplyEnabled(), false)
  assert.equal(noMember.store.getState().setForceSelfApplyEnabled(true), false)

  const unreadable = loadStore({ [FORCE_SELF_APPLY_KEY(42)]: '1' }, { failReads: true })
  assert.equal(unreadable.isForceSelfApplyEnabled(), false)
  assert.equal(unreadable.store.getState().setForceSelfApplyEnabled(true), false)
  const unwritable = loadStore({}, { failWrites: true })
  assert.equal(unwritable.store.getState().setForceSelfApplyEnabled(true), false)
  assert.equal(unwritable.isForceSelfApplyEnabled(), false)
})
