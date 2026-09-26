import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { hostWindow } from '@/utils/host-window.js'

const ACTIVE_TAB_KEY = 'vpw.workbench.activeTab'
const WARDROBE_UI_KEY = 'vpw.workbench.wardrobeUi'
const FORCE_SELF_APPLY_KEY_PREFIX = 'vpw.forceSelfApply.v1.'

const TABS = ['wardrobe', 'history', 'settings']

function forceSelfApplyStorageKey() {
  const memberNumber = hostWindow.Player?.MemberNumber
  if (!Number.isSafeInteger(memberNumber) || memberNumber <= 0) return null
  return `${FORCE_SELF_APPLY_KEY_PREFIX}${memberNumber}`
}

export function isForceSelfApplyEnabled() {
  const key = forceSelfApplyStorageKey()
  if (!key) return false
  try {
    return hostWindow.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function saveForceSelfApplyEnabled(enabled) {
  const key = forceSelfApplyStorageKey()
  if (!key) return false
  try {
    hostWindow.localStorage.setItem(key, enabled ? '1' : '0')
    return hostWindow.localStorage.getItem(key) === (enabled ? '1' : '0')
  } catch {
    return false
  }
}

function safeLoadJson(key, fallback) {
  try {
    const raw = hostWindow.localStorage.getItem(key)
    if (!raw) return fallback
    return { ...fallback, ...JSON.parse(raw) }
  } catch (e) {
    return fallback
  }
}

function safeLoadString(key, fallback) {
  try {
    const value = hostWindow.localStorage.getItem(key)
    return value || fallback
  } catch (e) {
    return fallback
  }
}

function safeSave(key, value) {
  try {
    hostWindow.localStorage.setItem(key, value)
  } catch (e) {
    // ignore storage failures
  }
}

const defaultWardrobeUi = {
  searchScope: 'current',
  sortBy: 'recent',
  fileViewMode: 'card',
  leftPanelCollapsed: false,
  rightPanelCollapsed: false
}

function normalizeWardrobeUi(preferences) {
  return {
    ...preferences,
    fileViewMode: preferences.fileViewMode === 'list' ? 'list' : 'card'
  }
}

function createInitialState() {
  const persistedTab = safeLoadString(ACTIVE_TAB_KEY, 'wardrobe')
  const activeTab = TABS.includes(persistedTab) ? persistedTab : 'wardrobe'

  return {
    activeTab,
    wardrobeUi: normalizeWardrobeUi(safeLoadJson(WARDROBE_UI_KEY, defaultWardrobeUi)),
    forceSelfApplyRevision: 0
  }
}

const workbenchApi = createStore((set, get) => ({
  ...createInitialState(),

  setActiveTab(tab) {
    if (!TABS.includes(tab)) return

    if (get().activeTab === tab) return

    set({ activeTab: tab })
    safeSave(ACTIVE_TAB_KEY, tab)
  },

  setWardrobeUi(partial) {
    const wardrobeUi = normalizeWardrobeUi({
      ...get().wardrobeUi,
      ...partial
    })

    set({ wardrobeUi })
    safeSave(WARDROBE_UI_KEY, JSON.stringify(wardrobeUi))
  },

  setForceSelfApplyEnabled(enabled) {
    if (typeof enabled !== 'boolean' || !saveForceSelfApplyEnabled(enabled)) return false
    set({ forceSelfApplyRevision: get().forceSelfApplyRevision + 1 })
    return true
  }
}))

export function useWorkbenchStore(selector) {
  return useStore(workbenchApi, selector)
}

useWorkbenchStore.getState = workbenchApi.getState
useWorkbenchStore.subscribe = workbenchApi.subscribe
useWorkbenchStore.api = workbenchApi
