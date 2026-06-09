import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { hostWindow } from '@/utils/host-window.js'

const ACTIVE_TAB_KEY = 'vpw.workbench.activeTab'
const WARDROBE_UI_KEY = 'vpw.workbench.wardrobeUi'
const MOBILE_UI_KEY = 'vpw.workbench.mobileUi'

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
  fileViewMode: 'large',
  leftPanelCollapsed: false,
  rightPanelCollapsed: false
}

const defaultMobileUi = {
  mainTab: 'wardrobe',
  panes: {
    wardrobe: 'wardrobe',
    history: 'wardrobe'
  }
}

function createInitialState() {
  const persistedTab = safeLoadString(ACTIVE_TAB_KEY, 'wardrobe')
  const activeTab = TABS.includes(persistedTab) ? persistedTab : 'wardrobe'

  return {
    activeTab,
    lastTab: activeTab,
    tabVisitOrder: [activeTab],
    tabScrollState: {
      wardrobe: { x: 0, y: 0 },
      history: { x: 0, y: 0 },
      settings: { x: 0, y: 0 }
    },
    wardrobeUi: safeLoadJson(WARDROBE_UI_KEY, defaultWardrobeUi),
    mobileUi: safeLoadJson(MOBILE_UI_KEY, defaultMobileUi)
  }
}

const workbenchApi = createStore((set, get) => ({
  ...createInitialState(),

  setActiveTab(tab) {
    if (!TABS.includes(tab)) return

    const current = get()
    if (current.activeTab === tab) return

    const mobileUi = ['wardrobe', 'history', 'settings'].includes(tab)
      ? { ...current.mobileUi, mainTab: tab }
      : current.mobileUi

    set({
      activeTab: tab,
      lastTab: current.activeTab,
      tabVisitOrder: [
        ...current.tabVisitOrder.filter((t) => t !== tab),
        tab
      ].slice(-10),
      mobileUi
    })

    safeSave(ACTIVE_TAB_KEY, tab)
    if (mobileUi !== current.mobileUi) {
      safeSave(MOBILE_UI_KEY, JSON.stringify(mobileUi))
    }
  },

  switchToNextTab() {
    const current = get()
    const idx = TABS.indexOf(current.activeTab)
    const next = TABS[(idx + 1) % TABS.length]
    current.setActiveTab(next)
  },

  setTabScrollState(tab, state) {
    if (!TABS.includes(tab)) return

    set((current) => ({
      tabScrollState: {
        ...current.tabScrollState,
        [tab]: {
          x: Number(state?.x) || 0,
          y: Number(state?.y) || 0
        }
      }
    }))
  },

  setWardrobeUi(partial) {
    const wardrobeUi = {
      ...get().wardrobeUi,
      ...partial
    }

    set({ wardrobeUi })
    safeSave(WARDROBE_UI_KEY, JSON.stringify(wardrobeUi))
  },

  setMobileMainTab(tab) {
    if (!['wardrobe', 'history', 'settings'].includes(tab)) return

    const mobileUi = {
      ...get().mobileUi,
      mainTab: tab
    }

    set({ mobileUi })
    get().setActiveTab(tab)
    safeSave(MOBILE_UI_KEY, JSON.stringify(get().mobileUi))
  },

  setMobilePane(mainTab, pane) {
    if (!['wardrobe', 'history'].includes(mainTab)) return
    if (!['preview', 'wardrobe', 'filter'].includes(pane)) return

    const mobileUi = {
      ...get().mobileUi,
      panes: {
        ...get().mobileUi.panes,
        [mainTab]: pane
      }
    }

    set({ mobileUi })
    safeSave(MOBILE_UI_KEY, JSON.stringify(mobileUi))
  }
}))

export function useWorkbenchStore(selector) {
  return useStore(workbenchApi, selector)
}

useWorkbenchStore.getState = workbenchApi.getState
useWorkbenchStore.subscribe = workbenchApi.subscribe
useWorkbenchStore.api = workbenchApi
