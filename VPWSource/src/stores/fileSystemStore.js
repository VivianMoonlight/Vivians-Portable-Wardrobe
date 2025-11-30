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

export const useFileSystemStore = defineStore('fs', {
  state: () => ({
    fs: new FileSystem('Home'),
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

    characterItem: { data: [] },

    // filters: store the activeFilters array (names) for other consumers
    activeFilters: [],

    // FilterService instance (not serialized) and a reactive snapshot for UI
    filterService: null,
    filterSnapshot: { groups: [], items: [], visibleGroups: [] }
  }),
  getters: {
    currentNode: state => state.fs.getNode(state.currentPath),

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
        this.previewItem.data = AssetApi.assembleBundle({
          baseCharacter: this.character,
          outfitData: this.activeItem.data,
          filterSet: filterSet
        })
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
        return
      }
      if (!item || item.type === 'folder') {
        // 不发生变化（仅针对文件生效）
        return
      }

      this.activeItem = { data: item ? item.data : null }
      this.updatePreviewItem()
    },

    // 新：从 FilterPanel 更新 activeFilters（传入数组或 Set）
    setActiveFilters(listOrSet) {
      const arr = Array.isArray(listOrSet) ? listOrSet : Array.from(listOrSet || [])
      this.activeFilters = arr
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
    }
  }
})
