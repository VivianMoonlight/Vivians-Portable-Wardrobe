import { defineStore } from 'pinia'
import { toRaw } from 'vue'
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
import { applyPlayerCraftingToBundle } from '@/studio/craft-resolver.js'

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

const SLOT_MODE_EMPTY = 'empty'
const SLOT_MODE_ORIGINAL = 'original'
const SLOT_MODE_INCOMING = 'incoming'
const SLOT_MODE_AUTO = 'auto'

const DEFAULT_REPLACE_MODE = 'merge-replace'
const REPLACE_MODE_SET = new Set(['fill-empty', 'merge-replace', 'full-replace'])
const SLOT_MODE_SET = new Set([SLOT_MODE_EMPTY, SLOT_MODE_ORIGINAL, SLOT_MODE_INCOMING, SLOT_MODE_AUTO])

function normalizeReplaceMode(mode) {
  return REPLACE_MODE_SET.has(mode) ? mode : DEFAULT_REPLACE_MODE
}

function normalizeSlotMode(mode) {
  return SLOT_MODE_SET.has(mode) ? mode : SLOT_MODE_EMPTY
}

function groupPartsBySlot(parts = []) {
  const grouped = new Map()
  for (const part of Array.isArray(parts) ? parts : []) {
    const slotKey = getGroupNameFromPart(part)
    if (!slotKey) continue
    if (!grouped.has(slotKey)) grouped.set(slotKey, [])
    grouped.get(slotKey).push(part)
  }
  return grouped
}

function getCharacterInitKey(character) {
  if (!character || typeof character !== 'object') return 'none'

  const memberNumber = Number(character.MemberNumber)
  if (Number.isFinite(memberNumber)) {
    return `member:${memberNumber}`
  }

  const name = typeof character.Name === 'string' ? character.Name : ''
  const family = typeof character.AssetFamily === 'string' ? character.AssetFamily : ''
  return `name:${name}|family:${family}`
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

    // 当前是否锁定到某个文件项（锁定时忽略 hover/focus 预览切换）
    lockedItem: null,

    characterItem: [],

    // filters: store the activeFilters array (names) for other consumers
    activeFilters: [],

    // default replacement mode used when selecting/focusing an item
    defaultReplaceMode: DEFAULT_REPLACE_MODE, // 'fill-empty' | 'merge-replace' | 'full-replace'

    // legacy alias kept for compatibility with existing callers
    applyMode: DEFAULT_REPLACE_MODE,

    // per-slot control state: { [slotKey]: { mode: 'empty' | 'original' | 'incoming' | 'auto', locked?: boolean } }
    slotControlMap: {},


    // FilterService instance (not serialized) and a reactive snapshot for UI
    filterService: null,
    filterSnapshot: { groups: [], items: [], visibleGroups: [] },

    // History tracking
    _loadingFromHistory: false,
    _historyDebounceTimer: null,

    // initialization lifecycle
    _persistedLoaded: false,
    _corePrewarmed: false,
    _corePrewarmPromise: null,
    _historyFilterInitPromise: null,
    _filterInitPromise: null,
    _lastInitializedCharacterKey: null

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

    _loadPersistedDataOnce() {
      if (this._persistedLoaded) return
      this.loadAll()
      this._persistedLoaded = true
    },

    async _ensureHistoryFilterInitialized() {
      if (Array.isArray(this.history?.filter) && this.history.filter.length > 0) {
        return true
      }

      if (this._historyFilterInitPromise) {
        await this._historyFilterInitPromise
        return true
      }

      this._historyFilterInitPromise = (async () => {
        try {
          await this.history.initFilter()
        } catch (e) {
          console.warn('history.initFilter failed', e)
        }
      })()

      try {
        await this._historyFilterInitPromise
      } finally {
        this._historyFilterInitPromise = null
      }

      return true
    },

    async preInitialize(character = null) {
      const target = character || hostWindow.CurrentCharacter || hostWindow.Player || null
      this.setCharacter(target)

      if (this._corePrewarmed) return true
      if (this._corePrewarmPromise) {
        await this._corePrewarmPromise
        return true
      }

      this._corePrewarmPromise = (async () => {
        this._loadPersistedDataOnce()
        await Promise.allSettled([
          this._ensureHistoryFilterInitialized(),
          this.initFilterServiceDefault()
        ])
        this._corePrewarmed = true
      })()

      try {
        await this._corePrewarmPromise
      } finally {
        this._corePrewarmPromise = null
      }

      return true
    },

    async initialize(character, options = {}) {
      const target = character || hostWindow.CurrentCharacter || hostWindow.Player || null
      this.setCharacter(target)

      if (options.preInitialize !== false) {
        await this.preInitialize(target)
      } else {
        this._loadPersistedDataOnce()
      }

      const characterKey = getCharacterInitKey(target)
      const hasCharacterData = Array.isArray(this.characterItem) && this.characterItem.length > 0
      const shouldRefreshCharacter = options.refreshCharacter !== false
        || !hasCharacterData
        || this._lastInitializedCharacterKey !== characterKey

      if (shouldRefreshCharacter) {
        this.characterItem = AssetApi.collectOutfitData(target)
      }

      if (options.keepSelection !== true) {
        this.lockedItem = null
        this.activeItem = { data: JSON.parse(JSON.stringify(this.characterItem || [])) }
      } else if (!Array.isArray(this.activeItem?.data)) {
        this.activeItem = { data: JSON.parse(JSON.stringify(this.characterItem || [])) }
      }

      this.previewItem = { data: [] }
      this._applyDefaultModeToUnlockedSlots(this.characterItem, this.activeItem.data, { mode: this.defaultReplaceMode })
      this.updatePreviewItem()
      this._lastInitializedCharacterKey = characterKey
    },


    // ----------------------
    // 更新绘画方法
    // ----------------------
    updatePreviewItem() {
      if (typeof this.renderer.renderPreviewWithItem === 'function') {
        this.previewItem = { data: [] } // 清理旧的
        const characterData = Array.isArray(this.characterItem) ? this.characterItem.slice() : []
        const sourceData = Array.isArray(this.activeItem?.data) ? this.activeItem.data : []

        this._ensureSlotControls(characterData, sourceData)
        this.previewItem.data = this._buildBundleBySlotControls(characterData, sourceData)
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

    setActiveItem(item, options = {}) {
      const { ignoreLock = false } = options
      if (item === -1) {
        this.activeItem = { data: JSON.parse(JSON.stringify(this.characterItem)) } // deep copy
        this._ensureSlotControls(this.characterItem, this.activeItem.data)
        this.updatePreviewItem()
        //this._scheduleHistoryAdd()
        return
      }
      if (!item || item.type === 'folder') {
        // 不发生变化（仅针对文件生效）
        return
      }

      if (!ignoreLock && this.lockedItem && item !== this.lockedItem) {
        // 预览锁定时，忽略来自 hover/focus 的切换
        return
      }

      this.activeItem = { data: item ? item.data : null }
      this._ensureSlotControls(this.characterItem, this.activeItem.data)
      this.updatePreviewItem()
      //this._scheduleHistoryAdd()
    },

    togglePreviewLock(item) {
      if (!item || item.type === 'folder') return false

      if (this.lockedItem === item) {
        this.clearPreviewLock()
        return false
      }

      this.lockedItem = item
      this.setActiveItem(item, { ignoreLock: true })
      return true
    },

    clearPreviewLock() {
      this.clearSelection()
    },

    clearSelection() {
      this.lockedItem = null
      this.setActiveItem(-1, { ignoreLock: true })
    },

    isPreviewLockedOn(item) {
      return !!item && this.lockedItem === item
    },

    // 兼容入口：外部仍可写 activeFilters，此时映射到未锁定 slot 的 empty/incoming 模式
    setActiveFilters(listOrSet) {
      const selected = new Set(
        (Array.isArray(listOrSet) ? listOrSet : Array.from(listOrSet || []))
          .filter(v => typeof v === 'string' && v)
      )
      this._ensureSlotControls()

      const next = { ...(this.slotControlMap || {}) }
      let changed = false
      for (const key of this._collectKnownSlotKeys()) {
        const prev = this.getSlotControlState(key)
        if (prev.locked) continue
        const nextMode = selected.has(key) ? SLOT_MODE_INCOMING : SLOT_MODE_EMPTY
        if (prev.mode !== nextMode) {
          next[key] = { mode: nextMode, locked: false }
          changed = true
        }
      }

      if (changed) {
        this.slotControlMap = next
      }
      this._syncActiveFiltersFromSlotControls()
      if (changed) {
        this.updatePreviewItem()
      }
    },

    setDefaultReplaceMode(mode) {
      const resolved = normalizeReplaceMode(mode)
      this.defaultReplaceMode = resolved
      this.applyMode = resolved
      this._syncActiveFiltersFromSlotControls()
      this.updatePreviewItem()
    },

    setApplyMode(mode) {
      this.setDefaultReplaceMode(mode)
    },

    _collectKnownSlotKeys(characterData = null, sourceData = null) {
      const keys = new Set(Object.keys(this.slotControlMap || {}))

      const snapshotItems = Array.isArray(this.filterSnapshot?.items) ? this.filterSnapshot.items : []
      for (const item of snapshotItems) {
        if (item?.key) keys.add(item.key)
      }

      const characterParts = Array.isArray(characterData)
        ? characterData
        : (Array.isArray(this.characterItem) ? this.characterItem : [])
      for (const part of characterParts) {
        const slotKey = getGroupNameFromPart(part)
        if (slotKey) keys.add(slotKey)
      }

      const incomingParts = Array.isArray(sourceData)
        ? sourceData
        : (Array.isArray(this.activeItem?.data) ? this.activeItem.data : [])
      for (const part of incomingParts) {
        const slotKey = getGroupNameFromPart(part)
        if (slotKey) keys.add(slotKey)
      }

      return Array.from(keys)
    },

    _ensureSlotControls(characterData = null, sourceData = null) {
      const keys = this._collectKnownSlotKeys(characterData, sourceData)
      const current = this.slotControlMap || {}
      const next = { ...current }
      let changed = false

      for (const key of keys) {
        const prev = current[key]
        if (!prev) {
          next[key] = { mode: SLOT_MODE_AUTO, locked: false }
          changed = true
          continue
        }
        const nextMode = normalizeSlotMode(prev.mode)
        if (nextMode !== prev.mode || !!prev.locked) {
          next[key] = { mode: nextMode, locked: false }
          changed = true
        }
      }

      if (changed) {
        this.slotControlMap = next
      }
      this._syncActiveFiltersFromSlotControls()
      return keys
    },

    _syncActiveFiltersFromSlotControls() {
      const keys = this._collectKnownSlotKeys()
      const characterData = Array.isArray(this.characterItem) ? this.characterItem : []
      const incomingData = Array.isArray(this.activeItem?.data) ? this.activeItem.data : []
      const inCharacter = new Set(characterData.map(getGroupNameFromPart).filter(Boolean))
      const inIncoming = new Set(incomingData.map(getGroupNameFromPart).filter(Boolean))

      const next = []
      for (const key of keys) {
        const mode = normalizeSlotMode(this.slotControlMap?.[key]?.mode)
        const effectiveMode = this._resolveEffectiveSlotMode(mode, {
          inCharacter: inCharacter.has(key),
          inIncoming: inIncoming.has(key)
        })
        if (effectiveMode !== SLOT_MODE_EMPTY) {
          next.push(key)
        }
      }
      this.activeFilters = Array.from(new Set(next))
    },

    _resolveEffectiveSlotMode(slotMode, { inCharacter = false, inIncoming = false, replaceMode = null } = {}) {
      const mode = normalizeSlotMode(slotMode)
      if (mode === SLOT_MODE_AUTO) {
        return this._resolveModeByDefaultReplace(
          replaceMode || this.defaultReplaceMode,
          inCharacter,
          inIncoming
        )
      }
      return mode
    },

    _resolveModeByDefaultReplace(defaultMode, inCharacter, inIncoming) {
      const resolvedMode = normalizeReplaceMode(defaultMode)

      if (resolvedMode === 'fill-empty') {
        if (inCharacter) return SLOT_MODE_ORIGINAL
        if (inIncoming) return SLOT_MODE_INCOMING
        return SLOT_MODE_ORIGINAL
      }

      if (resolvedMode === 'full-replace') {
        return SLOT_MODE_INCOMING
      }

      if (inIncoming) return SLOT_MODE_INCOMING
      if (inCharacter) return SLOT_MODE_ORIGINAL
      return SLOT_MODE_ORIGINAL
    },

    _setUnlockedSlotsToMode(mode, characterData = null, sourceData = null) {
      const nextMode = normalizeSlotMode(mode)
      const keys = this._collectKnownSlotKeys(characterData, sourceData)
      const current = this.slotControlMap || {}
      const next = { ...current }
      let changed = false

      for (const key of keys) {
        const prev = current[key]
        const prevMode = normalizeSlotMode(prev?.mode)
        if (!prev || prevMode !== nextMode || !!prev?.locked) {
          next[key] = { mode: nextMode, locked: false }
          changed = true
        }
      }

      if (changed) {
        this.slotControlMap = next
      }
      this._syncActiveFiltersFromSlotControls()
      return changed
    },

    _applyDefaultModeToUnlockedSlots(characterData = null, sourceData = null, { mode = null } = {}) {
      this._ensureSlotControls(characterData, sourceData)
      this._syncActiveFiltersFromSlotControls()
      return false
    },

    _buildBundleBySlotControls(characterData, sourceData, slotControlMapOverride = null, replaceModeOverride = null) {
      const characterParts = Array.isArray(characterData) ? characterData : []
      const incomingParts = Array.isArray(sourceData) ? sourceData : []
      const slotControlMap = slotControlMapOverride || this.slotControlMap || {}
      const replaceMode = normalizeReplaceMode(replaceModeOverride || this.defaultReplaceMode)

      const byCharacterSlot = groupPartsBySlot(characterParts)
      const byIncomingSlot = groupPartsBySlot(incomingParts)

      const slotOrder = []
      const seen = new Set()
      const pushSlot = (slotKey) => {
        if (!slotKey || seen.has(slotKey)) return
        seen.add(slotKey)
        slotOrder.push(slotKey)
      }

      for (const part of characterParts) pushSlot(getGroupNameFromPart(part))
      for (const part of incomingParts) pushSlot(getGroupNameFromPart(part))
      for (const slotKey of this._collectKnownSlotKeys(characterParts, incomingParts)) pushSlot(slotKey)

      const bundle = []
      for (const slotKey of slotOrder) {
        const mode = this._resolveEffectiveSlotMode(slotControlMap?.[slotKey]?.mode, {
          inCharacter: byCharacterSlot.has(slotKey),
          inIncoming: byIncomingSlot.has(slotKey),
          replaceMode
        })
        if (mode === SLOT_MODE_ORIGINAL) {
          const parts = byCharacterSlot.get(slotKey) || []
          bundle.push(...parts)
          continue
        }
        if (mode === SLOT_MODE_INCOMING) {
          const parts = byIncomingSlot.get(slotKey) || []
          bundle.push(...parts)
        }
      }
      return bundle
    },

    _buildBundleWithModeOverride(characterData, sourceData, overrideMode) {
      if (!overrideMode) {
        return this._buildBundleBySlotControls(characterData, sourceData)
      }
      return this._buildBundleBySlotControls(characterData, sourceData, null, overrideMode)
    },

    getSlotControlState(key) {
      const slotState = this.slotControlMap?.[key]
      return {
        mode: normalizeSlotMode(slotState?.mode),
        locked: false
      }
    },

    setSlotMode(key, mode) {
      if (!key) return false
      this._ensureSlotControls()

      const prev = this.getSlotControlState(key)
      const nextMode = normalizeSlotMode(mode)
      if (prev.mode === nextMode) return true

      this.slotControlMap = {
        ...(this.slotControlMap || {}),
        [key]: { mode: nextMode, locked: false }
      }
      this._syncActiveFiltersFromSlotControls()
      this.updatePreviewItem()
      return true
    },

    setAllSlotModes(mode) {
      this._ensureSlotControls()

      const nextMode = normalizeSlotMode(mode)
      const current = this.slotControlMap || {}
      const next = { ...current }
      let changed = false

      for (const key of this._collectKnownSlotKeys()) {
        const prev = this.getSlotControlState(key)
        if (prev.mode === nextMode) continue
        next[key] = { mode: nextMode, locked: false }
        changed = true
      }

      if (changed) {
        this.slotControlMap = next
        this._syncActiveFiltersFromSlotControls()
        this.updatePreviewItem()
      }
      return changed
    },

    setGroupSlotModes(groupID, mode) {
      const groupKeys = this._getGroupSlotKeys(groupID)
      if (groupKeys.length === 0) return false

      this._ensureSlotControls()

      const nextMode = normalizeSlotMode(mode)
      const current = this.slotControlMap || {}
      const next = { ...current }
      let changed = false

      for (const key of groupKeys) {
        const prev = this.getSlotControlState(key)
        if (prev.mode === nextMode) continue
        next[key] = { mode: nextMode, locked: false }
        changed = true
      }

      if (changed) {
        this.slotControlMap = next
        this._syncActiveFiltersFromSlotControls()
        this.updatePreviewItem()
      }
      return changed
    },

    setSlotLocked(key, locked = true) {
      return false
    },

    toggleSlotLock(key) {
      return false
    },

    setAllSlotLocks(locked = true) {
      return false
    },

    invertSlotLocks() {
      return false
    },

    _getGroupSlotKeys(groupID) {
      const groups = Array.isArray(this.filterSnapshot?.groups) ? this.filterSnapshot.groups : []
      const group = groups.find(g => g?.groupID === groupID)
      if (!group || !Array.isArray(group.itemList)) return []
      return group.itemList.map(item => item?.key).filter(Boolean)
    },

    setGroupSlotLocks(groupID, locked = true) {
      return false
    },

    invertGroupSlotLocks(groupID) {
      return false
    },

    applyFilteredOutfitToCharacter({ outfitData = null, mode = null } = {}) {
      const rawCharacter = this.character ? toRaw(this.character) : null
      const target = rawCharacter || hostWindow.CurrentCharacter || hostWindow.Player
      if (!target) return false

      const characterData = AssetApi.collectOutfitData(target)
      const sourceData = Array.isArray(outfitData)
        ? outfitData
        : (Array.isArray(this.activeItem?.data) ? this.activeItem.data : [])

      this._ensureSlotControls(characterData, sourceData)
      const bundle = this._buildBundleWithModeOverride(characterData, sourceData, mode)
      const hydratedBundle = applyPlayerCraftingToBundle(bundle, {
        player: hostWindow?.Player,
        assetGet: typeof hostWindow?.AssetGet === 'function' ? hostWindow.AssetGet.bind(hostWindow) : null
      })
      const ok = ExternalAdapter.applyOutfitToCharacter(target, hydratedBundle)
      if (ok) {
        this.characterItem = AssetApi.collectOutfitData(target)
        this.updatePreviewItem()
      }
      return !!ok
    },

    applyCurrentPreviewToCharacter() {
      return this.applyFilteredOutfitToCharacter()
    },

    removeSelectedSlotsFromCharacter() {
      const rawCharacter = this.character ? toRaw(this.character) : null
      const target = rawCharacter || hostWindow.CurrentCharacter || hostWindow.Player
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
      if (this.filterService) return true

      if (this._filterInitPromise) {
        await this._filterInitPromise
        return !!this.filterService
      }

      this._filterInitPromise = (async () => {
        try {
          const itemsArray = await fetchFilterData()
          this.initFilterService(itemsArray)
        } catch (e) {
          console.warn('initFilterServiceDefault failed', e)
        }
      })()

      try {
        await this._filterInitPromise
      } finally {
        this._filterInitPromise = null
      }

      return !!this.filterService
    },

    initFilterService(itemsArray) {
      // cleanup previous
      if (this.filterService && typeof this.filterService.offChange === 'function') {
        try { this.filterService.offChange(this._onFilterChange) } catch (e) { }
      }
      this.filterService = new FilterService(itemsArray || [])
      // subscribe
      this._onFilterChange = (snapshot) => {
        // update reactive snapshot and slot controls
        this.filterSnapshot = snapshot
        try {
          const hasSlotControls = Object.keys(this.slotControlMap || {}).length > 0
          const characterData = Array.isArray(this.characterItem) ? this.characterItem : []
          const sourceData = Array.isArray(this.activeItem?.data) ? this.activeItem.data : []

          this._ensureSlotControls(characterData, sourceData)
          if (!hasSlotControls) {
            this._applyDefaultModeToUnlockedSlots(characterData, sourceData, { mode: this.defaultReplaceMode })
          }

          this.updatePreviewItem()
        } catch (e) {
          // ignore
        }
      }
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

    // Wrapper methods for UI compatibility -> mode APIs (deprecated semantic bridge)
    filterToggle(key) {
      const currentMode = this.getSlotControlState(key).mode
      return this.setSlotMode(key, currentMode === SLOT_MODE_EMPTY ? SLOT_MODE_AUTO : SLOT_MODE_EMPTY)
    },
    filterSetActive(key, v) { return this.setSlotMode(key, v ? SLOT_MODE_AUTO : SLOT_MODE_EMPTY) },
    filterSetAll(v) { return this.setAllSlotModes(v ? SLOT_MODE_AUTO : SLOT_MODE_EMPTY) },
    filterInvertAll() {
      this._ensureSlotControls()
      const next = { ...(this.slotControlMap || {}) }
      let changed = false
      for (const key of this._collectKnownSlotKeys()) {
        const mode = this.getSlotControlState(key).mode
        const nextMode = mode === SLOT_MODE_EMPTY ? SLOT_MODE_AUTO : SLOT_MODE_EMPTY
        if (mode !== nextMode) {
          next[key] = { mode: nextMode, locked: false }
          changed = true
        }
      }
      if (changed) {
        this.slotControlMap = next
        this._syncActiveFiltersFromSlotControls()
        this.updatePreviewItem()
      }
      return changed
    },
    filterSetGroupAll(groupID, v) { return this.setGroupSlotModes(groupID, v ? SLOT_MODE_AUTO : SLOT_MODE_EMPTY) },
    filterInvertGroup(groupID) {
      const groupKeys = this._getGroupSlotKeys(groupID)
      if (groupKeys.length === 0) return false
      this._ensureSlotControls()
      const next = { ...(this.slotControlMap || {}) }
      let changed = false
      for (const key of groupKeys) {
        const mode = this.getSlotControlState(key).mode
        const nextMode = mode === SLOT_MODE_EMPTY ? SLOT_MODE_AUTO : SLOT_MODE_EMPTY
        if (mode !== nextMode) {
          next[key] = { mode: nextMode, locked: false }
          changed = true
        }
      }
      if (changed) {
        this.slotControlMap = next
        this._syncActiveFiltersFromSlotControls()
        this.updatePreviewItem()
      }
      return changed
    },

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
