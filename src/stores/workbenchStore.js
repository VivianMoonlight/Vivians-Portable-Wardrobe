import { defineStore } from 'pinia'
import { hostWindow } from '@/utils/host-window.js'

const ACTIVE_TAB_KEY = 'vpw.workbench.activeTab'
const WARDROBE_UI_KEY = 'vpw.workbench.wardrobeUi'

const TABS = ['wardrobe', 'history', 'studio', 'settings']

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

export const useWorkbenchStore = defineStore('workbench', {
  state: () => {
    const persistedTab = safeLoadString(ACTIVE_TAB_KEY, 'wardrobe')
    const activeTab = TABS.includes(persistedTab) ? persistedTab : 'wardrobe'

    return {
      activeTab,
      lastTab: activeTab,
      tabVisitOrder: [activeTab],
      tabScrollState: {
        wardrobe: { x: 0, y: 0 },
        history: { x: 0, y: 0 },
        studio: { x: 0, y: 0 },
        settings: { x: 0, y: 0 }
      },
      wardrobeUi: safeLoadJson(WARDROBE_UI_KEY, defaultWardrobeUi)
    }
  },
  actions: {
    setActiveTab(tab) {
      if (!TABS.includes(tab) || this.activeTab === tab) return
      this.lastTab = this.activeTab
      this.activeTab = tab
      this.tabVisitOrder = [
        ...this.tabVisitOrder.filter((t) => t !== tab),
        tab
      ].slice(-10)
      safeSave(ACTIVE_TAB_KEY, tab)
    },
    switchToNextTab() {
      const idx = TABS.indexOf(this.activeTab)
      const next = TABS[(idx + 1) % TABS.length]
      this.setActiveTab(next)
    },
    setTabScrollState(tab, state) {
      if (!TABS.includes(tab)) return
      this.tabScrollState[tab] = {
        x: Number(state?.x) || 0,
        y: Number(state?.y) || 0
      }
    },
    setWardrobeUi(partial) {
      this.wardrobeUi = {
        ...this.wardrobeUi,
        ...partial
      }
      safeSave(WARDROBE_UI_KEY, JSON.stringify(this.wardrobeUi))
    }
  }
})
