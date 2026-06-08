import { defineStore } from './optionsStore'
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
        settings: { x: 0, y: 0 }
      },
      wardrobeUi: safeLoadJson(WARDROBE_UI_KEY, defaultWardrobeUi),
      mobileUi: safeLoadJson(MOBILE_UI_KEY, defaultMobileUi)
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
      if (tab === 'wardrobe' || tab === 'history' || tab === 'settings') {
        this.mobileUi.mainTab = tab
        safeSave(MOBILE_UI_KEY, JSON.stringify(this.mobileUi))
      }
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
    },
    setMobileMainTab(tab) {
      if (!['wardrobe', 'history', 'settings'].includes(tab)) return
      this.mobileUi.mainTab = tab
      this.setActiveTab(tab)
      safeSave(MOBILE_UI_KEY, JSON.stringify(this.mobileUi))
    },
    setMobilePane(mainTab, pane) {
      if (!['wardrobe', 'history'].includes(mainTab)) return
      if (!['preview', 'wardrobe', 'filter'].includes(pane)) return
      this.mobileUi.panes = {
        ...this.mobileUi.panes,
        [mainTab]: pane
      }
      safeSave(MOBILE_UI_KEY, JSON.stringify(this.mobileUi))
    }
  }
})
