import { defineStore } from 'pinia'
import { FileSystem } from '@/services/FileSystem'
import { RenderService } from '@/services/RenderService'
import { StorageAdapter } from '@/services/StorageAdapter'
import { RenderApi } from '@/utils/RenderApi'
import { FilterService } from '@/services/FilterService'
import { fetchFilterData } from '@/utils/filter_api'
import { AssetApi } from '@/utils/AssetApi'
import { classifyToGroup, getGroupMeta, isHiddenGroup } from '@/config/filterGroupConfig'
import { hostWindow } from '@/utils/host-window.js'
import { HistoryRecord } from '@/utils/history_record.js'
import { ExternalAdapter } from '@/utils/external_adapters.js'

function getGroupNameFromPart(part) {
  if (!part) return ''
  return part.Group || part.Asset?.Group?.Name || part.Asset?.Group?.name || ''
}

function buildSlotPresenceMap(characterData = [], hoverData = []) {
  const inCharacter = new Set((characterData || []).map(getGroupNameFromPart).filter(Boolean))
  const inHover = new Set((hoverData || []).map(getGroupNameFromPart).filter(Boolean))
  const keys = new Set([...inCharacter, ...inHover])
  const map = {}
  for (const key of keys) {
    map[key] = {
      inCharacter: inCharacter.has(key),
      inHover: inHover.has(key)
    }
  }
  return map
}

export const useFileSystemStore = defineStore('fs', {
  state: () => ({
    fs: new FileSystem('Home'),
    history: new HistoryRecord('History', 100),
    currentPath: ['Home'],
    renderer: new RenderService({ drawCallbacks: RenderApi }),
    character: null,
    storage: new StorageAdapter({
      online: {
        get: (k) => hostWindow.Player.ExtensionSettings?.VPWardrobe,
        set: (k, val) => {
          hostWindow.Player.ExtensionSettings.VPWardrobe = val;
          hostWindow.ServerPlayerExtensionSettingsSync("VPWardrobe");
        }
      },
      local: {
        get: (k) => hostWindow.localStorage.getItem(k),
        set: (k, val) => hostWindow.localStorage.setItem(k, val)
      },
      compressor: {
        compress: (str) => LZString.compressToBase64(str),
        decompress: (str) => LZString.decompressFromBase64(str)
      }
    }),
    // preview 相关
    previewItem: { data: [] },

    activeItem: { data: [] },

    characterItem: [],

    // filters: store the activeFilters array (names) for other consumers
    activeFilters: [],

    // outfit apply mode for selected filters
    applyMode: 'merge-replace', // 'fill-empty' | 'merge-replace' | 'full-replace'


    // FilterService instance (not serialized) and a reactive snapshot for UI
    filterService: null,
    filterSnapshot: { groups: [], items: [], visibleGroups: [] },

    // History tracking
    _loadingFromHistory: false,
    _historyDebounceTimer: null

  }),
  getters: {
    currentNode: state => state.fs.getNode(state.currentPath),

    fullFilters: (state) => {
      const fullSet = state.filterService ? state.filterService.getFullSet() : new Set();
      return Array.from(fullSet);
    },

    // filteredItems: 根据 activeFilters 进行过滤；空 activeFilters 表示不过滤（返回全部）
    filteredItems: (state) => {
      const node = state.fs.getNode(state.currentPath)
      const children = node?.children ?? []
      if (!state.activeFilters || state.activeFilters.length === 0) return children
      const set = new Set(state.activeFilters)
      return children.filter(item => set.has(item.name))
    },

    // 获取可见分组（用于 UI 渲染）
    visibleGroups: (state) => {
      return state.filterSnapshot.visibleGroups ?? []
    },

    // 获取所有分组（包括隐藏分组）
    allGroups: (state) => {
      return state.filterSnapshot.groups ?? []
    },

    slotPresenceMap: (state) => {
      const characterData = Array.isArray(state.characterItem) ? state.characterItem : []
      const hoverData = Array.isArray(state.activeItem?.data) ? state.activeItem.data : []
      return buildSlotPresenceMap(characterData, hoverData)
    },

    // 兼容性的直接访问 renderer canvas（如果需要）
    previewCanvas: state => state.renderer.getCanvas(state.previewItem),
    _previewCanvas: state => state.renderer._getCanvas(state.previewItem)
  },
  actions: {

    // ------------------------
    // 初始化和清理方法
    // ------------------------
    setCharacter(character) {
      this.character = character
    },

    initialize(character) {
      this.setCharacter(character)
      this.loadAll()
      this.history.initFilter()
      //this.loadHistory()
      this.initFilterServiceDefault()
      this.characterItem = AssetApi.collectOutfitData(character)
      this.activeItem = { data: JSON.parse(JSON.stringify(this.characterItem)) } // deep copy
      this.previewItem = { data: [] }
      this.updatePreviewItem()
    },


    // ----------------------
    // 更新绘画方法
    // ----------------------
    updatePreviewItem() {
      if (typeof this.renderer.renderPreviewWithItem === 'function') {
        this.previewItem = { data: [] } // 清理旧的
        const filterSet = new Set(this.activeFilters || [])
        const characterData = Array.isArray(this.characterItem) ? this.characterItem.slice() : []
        const sourceData = Array.isArray(this.activeItem?.data) ? this.activeItem.data : []
        const resolvedMode = this.applyMode || 'merge-replace'

        this.previewItem.data = this._buildBundleByMode(characterData, sourceData, filterSet, resolvedMode)
        this.renderer.renderPreviewWithItem(this.previewItem)
      }
    },


    // ---------------------
    // FileSystem 操作方法
    // ---------------------
    addFile(file) {
      this.fs.addFile(this.currentPath, file)
      this.saveAll()
    },

    // 删除文件/节点（基于给定父路径或当前路径）
    removeFile(item, parentPath) {
      try {
        const path = Array.isArray(parentPath) ? parentPath : this.currentPath
        const ok = this.fs.removeFile(path, item)
        if (ok) this.saveAll()
      } catch (e) {
        console.warn('removeFile failed', e)
      }
    },

    /**
     * Move a file/folder from source path to destination path.
     * name: item name (string)
     * fromPath: array 或者 omitted（表示当前路径）
     * toPath: array 或者 omitted（表示当前路径）
     */
    moveFile(name, fromPath, toPath) {
      try {
        const srcPath = Array.isArray(fromPath) ? fromPath : this.currentPath
        const dstPath = Array.isArray(toPath) ? toPath : this.currentPath

        // quick no-op if identical path
        if (JSON.stringify(srcPath) === JSON.stringify(dstPath)) return

        const srcNode = this.fs.getNode(srcPath)
        const dstNode = this.fs.getNode(dstPath)
        if (!srcNode || !Array.isArray(srcNode.children) || !dstNode || dstNode.type !== 'folder') {
          console.warn('moveFile: invalid src/dst', { srcPath, dstPath })
          return
        }

        const idx = srcNode.children.findIndex(c => c.name === name)
        if (idx === -1) {
          console.warn('moveFile: item not found in source', name, srcPath)
          return
        }

        const item = srcNode.children[idx]
        // Use FileSystem.moveItem which has cycle prevention and merge logic
        const moved = this.fs.moveItem(srcPath, item, dstPath)
        if (moved) {
          this.saveAll()
        } else {
          // moveItem returned false -> either invalid move (cycle) or other failure
          console.warn('moveFile: moveItem failed (possible cycle or invalid move)', { name, srcPath, dstPath })
        }
      } catch (e) {
        console.warn('moveFile failed', e)
      }
    },

    saveAll() {
      try {
        this.storage.saveOnline('key', this.fs.toJSON())
        this.storage.saveLocal('VPWardrobe_local' + hostWindow.Player ? hostWindow.Player.MemberNumber : 'DEFAULT', this.fs.toJSON())
      } catch (e) {
        console.warn('saveAll failed', e)
      }
    },
    loadAll() {
      try {
        const Onlinedata = this.storage.loadOnline('key')
        const Localdata = this.storage.loadLocal('VPWardrobe_local' + hostWindow.Player ? hostWindow.Player.MemberNumber : 'DEFAULT')
        if (Localdata || Onlinedata) this.fs.fromMultipleJSON([Onlinedata, Localdata])
      } catch (e) {
        console.warn('loadAll failed', e)
      }
    },
    moveTo(path) {
      const node = this.fs.getNode(path)
      if (node && node.type === 'folder') {
        this.currentPath = path
      }
    },
    startThumbnailGeneration(item0) {
      this.renderer.startThumbFor(item0)
    },

    setActiveItem(item) {
      if (item === -1) {
        this.activeItem = { data: JSON.parse(JSON.stringify(this.characterItem)) } // deep copy
        this.updatePreviewItem()
        //this._scheduleHistoryAdd()
        return
      }
      if (!item || item.type === 'folder') {
        // 不发生变化（仅针对文件生效）
        return
      }

      this.activeItem = { data: item ? item.data : null }
      this.updatePreviewItem()
      //this._scheduleHistoryAdd()
    },

    // 新：从 FilterPanel 更新 activeFilters（传入数组或 Set）
    setActiveFilters(listOrSet) {
      const arr = Array.isArray(listOrSet) ? listOrSet : Array.from(listOrSet || [])
      this.activeFilters = arr
    },

    setApplyMode(mode) {
      const allowed = new Set(['fill-empty', 'merge-replace', 'full-replace'])
      this.applyMode = allowed.has(mode) ? mode : 'merge-replace'
      this.updatePreviewItem()
    },

    _buildBundleByMode(characterData, outfitData, filterSet, mode) {
      const selectedGroups = new Set(Array.from(filterSet || []).filter(Boolean))
      if (selectedGroups.size === 0) return Array.isArray(characterData) ? characterData.slice() : []

      const base = Array.isArray(characterData) ? characterData.slice() : []
      const incoming = Array.isArray(outfitData)
        ? outfitData.filter(part => selectedGroups.has(getGroupNameFromPart(part)))
        : []

      if (mode === 'fill-empty') {
        const existing = new Set(base.map(getGroupNameFromPart).filter(Boolean))
        const toAdd = incoming.filter(part => !existing.has(getGroupNameFromPart(part)))
        return base.concat(toAdd)
      }

      if (mode === 'full-replace') {
        const preserved = base.filter(part => !selectedGroups.has(getGroupNameFromPart(part)))
        return preserved.concat(incoming)
      }

      const incomingGroups = new Set(incoming.map(getGroupNameFromPart).filter(Boolean))
      const preserved = base.filter(part => !incomingGroups.has(getGroupNameFromPart(part)))
      return preserved.concat(incoming)
    },

    applyFilteredOutfitToCharacter({ outfitData = null, mode = null } = {}) {
      const target = this.character || hostWindow.CurrentCharacter || hostWindow.Player
      if (!target) return false

      const characterData = AssetApi.collectOutfitData(target)
      const sourceData = Array.isArray(outfitData)
        ? outfitData
        : (Array.isArray(this.activeItem?.data) ? this.activeItem.data : [])
      const filterSet = new Set(this.activeFilters || [])
      const resolvedMode = mode || this.applyMode || 'merge-replace'

      const bundle = this._buildBundleByMode(characterData, sourceData, filterSet, resolvedMode)
      const ok = ExternalAdapter.applyOutfitToCharacter(target, bundle)
      if (ok) {
        this.characterItem = AssetApi.collectOutfitData(target)
        this.updatePreviewItem()
      }
      return !!ok
    },

    removeSelectedSlotsFromCharacter() {
      const target = this.character || hostWindow.CurrentCharacter || hostWindow.Player
      if (!target) return false

      const selectedGroups = new Set((this.activeFilters || []).filter(Boolean))
      if (selectedGroups.size === 0) return false

      const characterData = AssetApi.collectOutfitData(target)
      const next = (characterData || []).filter(part => !selectedGroups.has(getGroupNameFromPart(part)))
      const ok = ExternalAdapter.applyOutfitToCharacter(target, next)
      if (ok) {
        this.characterItem = AssetApi.collectOutfitData(target)
        this.updatePreviewItem()
      }
      return !!ok
    },

    // ---------------------
    // FilterService 管理方法
    // ---------------------

    // Initialize/rebuild FilterService from an items array (array of { key, data })
    async initFilterServiceDefault() {
      if (!this.filterService) {
        const itemsArray = await fetchFilterData()
        this.initFilterService(itemsArray)
      }
    },

    initFilterService(itemsArray) {
      // cleanup previous
      if (this.filterService && typeof this.filterService.offChange === 'function') {
        try { this.filterService.offChange(this._onFilterChange) } catch (e) { }
      }
      this.filterService = new FilterService(itemsArray || [])
      // subscribe
      this._onFilterChange = (snapshot) => {
        // update reactive snapshot and activeFilters
        this.filterSnapshot = snapshot
        try {
          const active = Array.from(this.filterService.getActiveSet())
          this.activeFilters = active
          // 更新预览
          this.updatePreviewItem()
        } catch (e) {
          // ignore
        }
      }
      const active = Array.from(this.filterService.getActiveSet())
      this.activeFilters = active
      this.filterService.onChange(this._onFilterChange)
      try { this.filterService.emitChange() } catch (e) { }
    },

    // ---------------------
    // 分组工具方法（使用统一配置）
    // ---------------------

    /**
     * 根据 data 对象获取其所属分组 ID
     * @param {Object} data
     * @returns {string} groupID
     */
    getGroupIDForData(data) {
      return classifyToGroup(data)
    },

    /**
     * 获取分组的元数据
     * @param {string} groupID
     * @returns {Object} { displayName, isHiddenGroup, priority }
     */
    getGroupMeta(groupID) {
      return getGroupMeta(groupID)
    },

    /**
     * 检查分组是否为隐藏分组
     * @param {string} groupID
     * @returns {boolean}
     */
    isHiddenGroup(groupID) {
      return isHiddenGroup(groupID)
    },

    // Wrapper methods for UI -> service
    filterToggle(key) { if (this.filterService) this.filterService.toggle(key) },
    filterSetActive(key, v) { if (this.filterService) this.filterService.setActive(key, !!v) },
    filterSetAll(v) { if (this.filterService) this.filterService.setAll(!!v) },
    filterInvertAll() { if (this.filterService) this.filterService.invertAll() },
    filterSetGroupAll(groupID, v) { if (this.filterService) this.filterService.setGroupAll(groupID, !!v) },
    filterInvertGroup(groupID) { if (this.filterService) this.filterService.invertGroup(groupID) },

    // ---------------------
    // Search wrapper
    // ---------------------

    /**
     * Search files/folders by query string (case-insensitive).
     * Returns array of { item, path } where path is an array starting with root name.
     */
    searchFiles(query) {
      try {
        return this.fs.search(query) || []
      } catch (e) {
        console.warn('searchFiles failed', e)
        return []
      }
    },

    // ---------------------
    // History management methods
    // ---------------------

    /**
     * Schedule adding activeItem to history with debounce (2 seconds)
     * Only records if not loading from history and data is different from last record
     */
    _scheduleHistoryAdd() {
      // Skip if we're loading from history (prevent loops)
      if (this._loadingFromHistory) return

      // Clear existing timer
      if (this._historyDebounceTimer) {
        clearTimeout(this._historyDebounceTimer)
      }

      // Schedule new add after 2 seconds of stability
      this._historyDebounceTimer = setTimeout(() => {
        this._historyDebounceTimer = null
        const data = this.activeItem?.data
        if (!data || !Array.isArray(data) || data.length === 0) return
        
        // Check if data is different from last record
        const records = this.getHistoryRecords()
        if (records.length > 0) {
          const lastRecord = records[0]
          if (lastRecord && lastRecord.data) {
            try {
              if (JSON.stringify(lastRecord.data) === JSON.stringify(data)) {
                console.log('[History] Skipping duplicate record')
                return
              }
            } catch (e) {
              // If comparison fails, proceed with adding
            }
          }
        }

        this.addToHistory(data)
      }, 2000)
    },

    /**
     * Add record to history (auto-called when activeItem changes)
     */
    addToHistory(data) {
      if (!data || !Array.isArray(data) || data.length === 0) return
      try {
        this.history.addRecord(JSON.parse(JSON.stringify(data)))
        this.saveHistory()
      } catch (e) {
        console.warn('addToHistory failed', e)
      }
    },

    /**
     * Get all history records (sorted by time, newest first)
     */
    getHistoryRecords() {
      try {
        return this.history.getAllRecords() || []
      } catch (e) {
        console.warn('getHistoryRecords failed', e)
        return []
      }
    },

    /**
     * Delete single history record
     */
    deleteHistoryRecord(record) {
      try {
        const root = this.history.fs.getNode([this.history.fs.root.name])
        if (!root || !root.children) return false
        const idx = root.children.findIndex(r => r === record)
        if (idx === -1) return false
        root.children.splice(idx, 1)
        this.saveHistory()
        return true
      } catch (e) {
        console.warn('deleteHistoryRecord failed', e)
        return false
      }
    },

    /**
     * Clear all history
     */
    clearHistory() {
      try {
        this.history.clear()
        this.saveHistory()
      } catch (e) {
        console.warn('clearHistory failed', e)
      }
    },

    /**
     * Load history record into activeItem
     */
    loadHistoryRecord(record) {
      if (!record || !record.data) return
      try {
        this._loadingFromHistory = true
        this.activeItem = { data: JSON.parse(JSON.stringify(record.data)) }
        this.updatePreviewItem()
        // Reset flag after a short delay to allow the update to complete
        setTimeout(() => {
          this._loadingFromHistory = false
        }, 100)
      } catch (e) {
        console.warn('loadHistoryRecord failed', e)
        this._loadingFromHistory = false
      }
    },

    /**
     * Save history to storage
     */
    saveHistory() {
      try {
        const historyData = this.history.toJSON()
        const key = 'VPWardrobe_history_' + (hostWindow.Player ? hostWindow.Player.MemberNumber : 'DEFAULT')
        this.storage.saveLocal(key, historyData)
      } catch (e) {
        console.warn('saveHistory failed', e)
      }
    },

    /**
     * Load history from storage
     */
    loadHistory() {
      try {
        const key = 'VPWardrobe_history_' + (hostWindow.Player ? hostWindow.Player.MemberNumber : 'DEFAULT')
        const historyData = this.storage.loadLocal(key)
        if (historyData) {
          this.history.fromJSON(historyData)
        }
      } catch (e) {
        console.warn('loadHistory failed', e)
      }
    }
  }
})
