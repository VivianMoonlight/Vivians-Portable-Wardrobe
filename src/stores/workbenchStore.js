import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { hostWindow } from '@/utils/host-window.js'

const ACTIVE_TAB_KEY = 'vpw.workbench.activeTab'
const WARDROBE_UI_KEY = 'vpw.workbench.wardrobeUi'

const TABS = ['wardrobe', 'history', 'settings']

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
    wardrobeUi: normalizeWardrobeUi(safeLoadJson(WARDROBE_UI_KEY, defaultWardrobeUi))
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
  }
}))

export function useWorkbenchStore(selector) {
  return useStore(workbenchApi, selector)
}

useWorkbenchStore.getState = workbenchApi.getState
useWorkbenchStore.subscribe = workbenchApi.subscribe
useWorkbenchStore.api = workbenchApi
