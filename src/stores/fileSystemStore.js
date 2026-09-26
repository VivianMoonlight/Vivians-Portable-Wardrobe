import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { createLibraryState, wardrobeLibraryActions } from './wardrobe-library-actions.js'
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
import { applyPlayerCraftingToBundle } from '@/services/craft-resolver.js'
import { isBodySlot } from '@/services/body-slots.js'
import {
  normalizeSlotMode,
  getGroupNameFromPart,
  groupPartsBySlot,
  buildPresenceSets,
  buildSlotPresenceMap,
  computeGroupSlotMode,
  nextGroupOperation,
  scopeModeState,
  buildOutfitBundle,
} from '@/services/outfit-slot-rules.js'

const SLOT_MODE_EMPTY = 'empty'
const SLOT_MODE_ORIGINAL = 'original'
const SLOT_MODE_INCOMING = 'incoming'

function buildPartNameMapBySlot(parts = [], character = null) {
  const grouped = groupPartsBySlot(parts)
  const map = {}
  for (const [slotKey, slotParts] of grouped.entries()) {
    const names = slotParts
      .map(part => AssetApi.getPartDisplayName(part, character))
      .filter(Boolean)
    map[slotKey] = Array.from(new Set(names)).join(', ')
  }
  return map
}

// Keep this helper outside the action proxy: sharing the update must not add
// another nested action notification for every batch operation.
function setScopeSlotModes(store, keys, mode) {
  const current = store.slotControlMap || {}
  const next = { ...current }
  let changed = false
  for (const key of keys) {
    if (normalizeSlotMode(current[key]?.mode) === mode) continue
    next[key] = { mode, locked: false }
    changed = true
  }
  if (changed) {
    store.slotControlMap = next
    store._syncActiveFiltersFromSlotControls()
    store.updatePreviewItem()
  }
  return changed
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

function getPlayerMemberSuffix() {
  const memberNumber = hostWindow?.Player?.MemberNumber
  if (memberNumber === undefined || memberNumber === null || memberNumber === '') {
    return 'DEFAULT'
  }
  return String(memberNumber)
}

function buildPlayerScopedStorageKey(prefix) {
  return `${prefix}_${getPlayerMemberSuffix()}`
}

function cloneOutfitData(data) {
  return JSON.parse(JSON.stringify(Array.isArray(data) ? data : []))
}

function prepareOutfitBundle(bundle) {
  return applyPlayerCraftingToBundle(bundle, {
    player: hostWindow?.Player,
    assetGet: typeof hostWindow?.AssetGet === 'function' ? hostWindow.AssetGet.bind(hostWindow) : null
  })
}

function identityRaw(value) {
  return value
}

const fileSystemStoreDefinition = {
  state: () => ({
    ...createLibraryState(),
    fileTreeVersion: 0,
    history: new HistoryRecord('History', 100),
    historyVersion: 0,
    renderer: new RenderService({ drawCallbacks: RenderApi }),
    thumbnailRefreshVersion: 0,
    character: null,
    storage: new StorageAdapter({
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

    groupOperations: {},

    // per-slot control state: { [slotKey]: { mode: 'empty' | 'original' | 'incoming', locked?: boolean } }
    slotControlMap: {},


    // FilterService instance (not serialized) and a reactive snapshot for UI
    filterService: null,
    filterSnapshot: { groups: [], items: [], visibleGroups: [] },

    // initialization lifecycle
    _persistedLoaded: false,
    _corePrewarmed: false,
    _corePrewarmPromise: null,
    _historyFilterInitPromise: null,
    _filterInitPromise: null,
    _lastInitializedCharacterKey: null

  }),
  getters: {


    fullFilters: (state) => {
      const fullSet = state.filterService ? state.filterService.getFullSet() : new Set();
      return Array.from(fullSet);
    },

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

    characterPartNameBySlot: (state) => {
      const characterData = Array.isArray(state.characterItem) ? state.characterItem : []
      return buildPartNameMapBySlot(characterData, state.character || hostWindow?.CurrentCharacter || hostWindow?.Player)
    },

    incomingPartNameBySlot: (state) => {
      const hoverData = Array.isArray(state.activeItem?.data) ? state.activeItem.data : []
      return buildPartNameMapBySlot(hoverData, state.character || hostWindow?.CurrentCharacter || hostWindow?.Player)
    },

    cloudUsagePercent: (state) => {
      const ratio = Number(state.cloudQuota?.usageRatio || 0)
      const percent = ratio * 100
      if (!Number.isFinite(percent)) return 0
      return Math.max(0, Math.min(100, percent))
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
      const member = String(hostWindow.Player?.MemberNumber)
      if (this._persistedLoaded === member && this.syncStatus.localSaved) return
      this.loadAll()
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

      this._loadPersistedDataOnce()
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
      const preserveSlotControls = options.preserveSlotControls === true

      // Appearance is already available from BC; filter metadata must not delay
      // the first preview. Its eventual snapshot preserves current slot choices.
      const prewarming = options.preInitialize !== false ? this.preInitialize(target) : null
      if (!prewarming) this._loadPersistedDataOnce()

      const characterKey = getCharacterInitKey(target)
      const hasCharacterData = Array.isArray(this.characterItem) && this.characterItem.length > 0
      const shouldRefreshCharacter = options.refreshCharacter !== false
        || !hasCharacterData
        || this._lastInitializedCharacterKey !== characterKey

      if (shouldRefreshCharacter) {
        this.characterItem = cloneOutfitData(AssetApi.collectOutfitData(target))
      }

      if (options.keepSelection !== true) {
        this.lockedItem = null
        this.activeItem = { data: cloneOutfitData(this.characterItem) }
      } else if (!Array.isArray(this.activeItem?.data)) {
        this.activeItem = { data: cloneOutfitData(this.characterItem) }
      }

      this.previewItem = { data: [] }
      if (!preserveSlotControls) {
        this._resetSlotSources('incoming')
      } else {
        this._ensureSlotControls()
        this._resolveGroupOperations()
      }
      this.updatePreviewItem({ preserveSlotControls })
      this._lastInitializedCharacterKey = characterKey
      if (prewarming) await prewarming
    },


    // ----------------------
    // 更新绘画方法
    // ----------------------
    updatePreviewItem(options = {}) {
      if (typeof this.renderer.renderPreviewWithItem === 'function') {
        this.previewItem = { data: [] } // 清理旧的
        const characterData = Array.isArray(this.characterItem) ? this.characterItem.slice() : []
        const sourceData = Array.isArray(this.activeItem?.data) ? this.activeItem.data : []

        if (options.preserveSlotControls !== true) {
          this._ensureSlotControls(characterData, sourceData)
        }
        this.previewItem.data = this._preparePreviewBundle(characterData, sourceData)
        this.renderer.renderPreviewWithItem(this.previewItem)
      }
    },


    // ---------------------
    // FileSystem 操作方法
    // ---------------------
    ...wardrobeLibraryActions,

    startThumbnailGeneration(item0) {
      this.renderer.startThumbFor(item0)
    },

    refreshThumbnails(items = null) {
      const targets = Array.isArray(items)
        ? items
        : this.outfits
      const stamp = Date.now()
      targets.forEach((item, index) => {
        if (!item || item.type === 'folder') return
        try { this.renderer.removeCanvas(item) } catch (e) { }
        item.__thumbRefresh = stamp + index
      })
      this.thumbnailRefreshVersion = stamp
    },

    setActiveItem(item, options = {}) {
      const { ignoreLock = false } = options
      if (item === -1) {
        this.activeItem = { data: cloneOutfitData(this.characterItem) }
      } else {
        if (!item || item.type === 'folder') return
        if (!ignoreLock && this.lockedItem && item !== this.lockedItem) return
        this.activeItem = { data: item.data }
      }

      this._resetSlotSources('incoming')
      this.updatePreviewItem()
    },

    selectOutfit(item) {
      if (!item || item.type === 'folder' || !Array.isArray(item.data)) return false
      const target = this.character || hostWindow.CurrentCharacter || hostWindow.Player
      if (Array.isArray(target?.Appearance)) {
        this.characterItem = cloneOutfitData(AssetApi.collectOutfitData(target))
      }
      this.lockedItem = item
      this.setActiveItem(item, { ignoreLock: true })
      return true
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
      if (Object.keys(this.groupOperations).length) this.groupOperations = {}

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

    // Presence sets for slot resolution: which slot keys the character currently
    // wears (`inCharacter`) and which the selected/hovered outfit provides
    // (`inIncoming`). Defaults to the live characterItem / activeItem.
    _presenceSets(characterData = null, sourceData = null) {
      const characterParts = Array.isArray(characterData)
        ? characterData
        : (Array.isArray(this.characterItem) ? this.characterItem : [])
      const incomingParts = Array.isArray(sourceData)
        ? sourceData
        : (Array.isArray(this.activeItem?.data) ? this.activeItem.data : [])
      return buildPresenceSets(characterParts, incomingParts)
    },

    _ensureSlotControls(characterData = null, sourceData = null) {
      const keys = this._collectKnownSlotKeys(characterData, sourceData)
      const current = this.slotControlMap || {}
      const next = { ...current }
      let changed = false

      for (const key of keys) {
        const prev = current[key]
        if (!prev) {
          next[key] = { mode: SLOT_MODE_INCOMING, locked: false }
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

    _resetSlotSources(mode) {
      this.slotControlMap = Object.fromEntries(this._collectKnownSlotKeys().map(key => [key, { mode, locked: false }]))
      this.groupOperations = {}
      this._syncActiveFiltersFromSlotControls()
    },

    _syncActiveFiltersFromSlotControls() {
      const next = []
      for (const key of this._collectKnownSlotKeys()) {
        if (normalizeSlotMode(this.slotControlMap?.[key]?.mode) !== SLOT_MODE_EMPTY) {
          next.push(key)
        }
      }
      this.activeFilters = Array.from(new Set(next))
    },

    _clearGroupOperationsForKeys(keys) {
      const affected = new Set(keys)
      const next = { ...this.groupOperations }
      let changed = false
      for (const groupID of Object.keys(next)) {
        if (this._getGroupSlotKeys(groupID).some(key => affected.has(key))) {
          delete next[groupID]
          changed = true
        }
      }
      if (changed) this.groupOperations = next
    },

    cycleGroupSource(groupID, source) {
      const mode = normalizeSlotMode(source)
      const keys = this._getGroupSlotKeys(groupID)
      if (keys.length === 0 || mode === SLOT_MODE_EMPTY) return false
      this._ensureSlotControls()
      const operation = nextGroupOperation(this.groupOperations[groupID], mode)
      const { inCharacter, inIncoming } = this._presenceSets()
      const current = this.slotControlMap
      const next = { ...current }
      let changed = false
      for (const key of keys) {
        const slotMode = computeGroupSlotMode(mode, operation, inCharacter.has(key), inIncoming.has(key))
        if (current[key]?.mode !== slotMode) {
          next[key] = { mode: slotMode, locked: false }
          changed = true
        }
      }
      this.groupOperations = { ...this.groupOperations, [groupID]: { mode, operation } }
      if (changed) {
        this.slotControlMap = next
        this._syncActiveFiltersFromSlotControls()
        this.updatePreviewItem()
      }
      return operation
    },

    _resolveGroupOperations() {
      const { inCharacter, inIncoming } = this._presenceSets()
      const next = { ...this.slotControlMap }
      let changed = false
      for (const [groupID, { mode, operation }] of Object.entries(this.groupOperations)) {
        for (const key of this._getGroupSlotKeys(groupID)) {
          const slotMode = computeGroupSlotMode(mode, operation, inCharacter.has(key), inIncoming.has(key))
          if (next[key]?.mode === slotMode) continue
          next[key] = { mode: slotMode, locked: false }
          changed = true
        }
      }
      if (changed) {
        this.slotControlMap = next
        this._syncActiveFiltersFromSlotControls()
      }
    },

    replaceAllFromSource(mode) {
      return this.setAllSlotModes(mode)
    },

    preserveBody() {
      this._ensureSlotControls()
      const keys = this._getBodySlotKeys()
      this._clearGroupOperationsForKeys(keys)
      return setScopeSlotModes(this, keys, SLOT_MODE_ORIGINAL)
    },

    replaceBodyOnly() {
      this._ensureSlotControls()
      const bodyKeys = new Set(this._getBodySlotKeys())
      const next = {}
      let changed = false
      for (const key of this._collectKnownSlotKeys()) {
        const mode = bodyKeys.has(key) ? SLOT_MODE_INCOMING : SLOT_MODE_ORIGINAL
        if (this.slotControlMap[key]?.mode !== mode) changed = true
        next[key] = { mode, locked: false }
      }
      this.groupOperations = {}
      if (changed) {
        this.slotControlMap = next
        this._syncActiveFiltersFromSlotControls()
        this.updatePreviewItem()
      }
      return changed
    },

    _getBodySlotKeys() {
      const items = this.filterService?.items || this.filterSnapshot?.items || []
      const metadata = new Map(items.map(item => [item.key, item.data]))
      return this._collectKnownSlotKeys().filter(key => isBodySlot(key, metadata.get(key)))
    },

    getAllModeState(mode) {
      const { inCharacter, inIncoming } = this._presenceSets()
      return scopeModeState(this._collectKnownSlotKeys(), normalizeSlotMode(mode), this.slotControlMap, inCharacter, inIncoming)
    },

    getGroupModeState(groupID, mode) {
      const { inCharacter, inIncoming } = this._presenceSets()
      return scopeModeState(this._getGroupSlotKeys(groupID), normalizeSlotMode(mode), this.slotControlMap, inCharacter, inIncoming)
    },

    _buildBundleBySlotControls(characterData, sourceData) {
      return buildOutfitBundle(characterData, sourceData, this.slotControlMap)
    },

    _preparePreviewBundle(characterData, sourceData) {
      // Crafting may customize incoming items, but an original source must keep
      // the captured character's exact colors and properties.
      const incoming = prepareOutfitBundle(sourceData)
      return cloneOutfitData(this._buildBundleBySlotControls(characterData, incoming))
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
      this._clearGroupOperationsForKeys([key])
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
      if (Object.keys(this.groupOperations).length) this.groupOperations = {}
      return setScopeSlotModes(this, this._collectKnownSlotKeys(), normalizeSlotMode(mode))
    },

    setGroupSlotModes(groupID, mode) {
      const groupKeys = this._getGroupSlotKeys(groupID)
      if (groupKeys.length === 0) return false

      this._ensureSlotControls()
      this._clearGroupOperationsForKeys(groupKeys)
      return setScopeSlotModes(this, groupKeys, normalizeSlotMode(mode))
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

    applyFilteredOutfitToCharacter({ outfitData = null } = {}) {
      const rawCharacter = this.character ? identityRaw(this.character) : null
      const target = rawCharacter || hostWindow.CurrentCharacter || hostWindow.Player
      if (!target) return false

      let bundle
      if (Array.isArray(outfitData)) {
        this._ensureSlotControls(this.characterItem, outfitData)
        bundle = this._preparePreviewBundle(this.characterItem, outfitData)
      } else {
        // Apply exactly what was previewed, even if crafting changes while open.
        bundle = cloneOutfitData(this.previewItem?.data)
      }
      const ok = ExternalAdapter.applyOutfitToCharacter(target, bundle)
      // Keep the editing session's original source stable after applying.
      // Selecting another outfit or target captures the live character again.
      if (ok && Array.isArray(outfitData)) this.updatePreviewItem()
      return !!ok
    },

    applyCurrentPreviewToCharacter() {
      return this.applyFilteredOutfitToCharacter()
    },

    removeSelectedSlotsFromCharacter() {
      const rawCharacter = this.character ? identityRaw(this.character) : null
      const target = rawCharacter || hostWindow.CurrentCharacter || hostWindow.Player
      if (!target) return false

      const selectedGroups = new Set((this.activeFilters || []).filter(Boolean))
      if (selectedGroups.size === 0) return false

      const characterData = AssetApi.collectOutfitData(target)
      const next = (characterData || []).filter(part => !selectedGroups.has(getGroupNameFromPart(part)))
      const ok = ExternalAdapter.applyOutfitToCharacter(target, next)
      if (ok) {
        this.characterItem = cloneOutfitData(AssetApi.collectOutfitData(target))
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

          if (!hasSlotControls) {
            // Metadata cannot change an outfit selection or its slot choices.
            this._resetSlotSources('incoming')
          } else {
            // Register newly revealed slots without resetting current choices.
            this._ensureSlotControls(characterData, sourceData)
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

    // Wrapper methods for UI compatibility -> mode APIs (deprecated semantic bridge).
    // "active" maps to `incoming` (take from the selected outfit) now that `auto`
    // is gone — consistent with setActiveFilters().
    filterToggle(key) {
      const currentMode = this.getSlotControlState(key).mode
      return this.setSlotMode(key, currentMode === SLOT_MODE_EMPTY ? SLOT_MODE_INCOMING : SLOT_MODE_EMPTY)
    },
    filterSetActive(key, v) { return this.setSlotMode(key, v ? SLOT_MODE_INCOMING : SLOT_MODE_EMPTY) },
    filterSetAll(v) { return this.setAllSlotModes(v ? SLOT_MODE_INCOMING : SLOT_MODE_EMPTY) },
    filterInvertAll() {
      this._ensureSlotControls()
      if (Object.keys(this.groupOperations).length) this.groupOperations = {}
      const next = { ...(this.slotControlMap || {}) }
      let changed = false
      for (const key of this._collectKnownSlotKeys()) {
        const mode = this.getSlotControlState(key).mode
        const nextMode = mode === SLOT_MODE_EMPTY ? SLOT_MODE_INCOMING : SLOT_MODE_EMPTY
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
    filterSetGroupAll(groupID, v) { return this.setGroupSlotModes(groupID, v ? SLOT_MODE_INCOMING : SLOT_MODE_EMPTY) },
    filterInvertGroup(groupID) {
      const groupKeys = this._getGroupSlotKeys(groupID)
      if (groupKeys.length === 0) return false
      this._ensureSlotControls()
      this._clearGroupOperationsForKeys(groupKeys)
      const next = { ...(this.slotControlMap || {}) }
      let changed = false
      for (const key of groupKeys) {
        const mode = this.getSlotControlState(key).mode
        const nextMode = mode === SLOT_MODE_EMPTY ? SLOT_MODE_INCOMING : SLOT_MODE_EMPTY
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
        return this.outfits.filter(item => item.name.toLowerCase().includes(String(query).toLowerCase()))
      } catch (e) {
        console.warn('searchFiles failed', e)
        return []
      }
    },

    // ---------------------
    // History management methods
    // ---------------------

    /**
     * Record actual appearance changes received from the game history hook.
     */
    addToHistory(data) {
      if (!data || !Array.isArray(data) || data.length === 0) return
      try {
        const entry = this.history.addRecord(JSON.parse(JSON.stringify(data)))
        if (!entry) return
        this.historyVersion = (this.historyVersion || 0) + 1
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
        this.historyVersion = (this.historyVersion || 0) + 1
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
        const hadRecords = this.getHistoryRecords().length > 0
        this.history.clear()
        if (hadRecords) {
          this.historyVersion = (this.historyVersion || 0) + 1
        }
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
        this.activeItem = { data: cloneOutfitData(record.data) }
        this.updatePreviewItem()
      } catch (e) {
        console.warn('loadHistoryRecord failed', e)
      }
    },

    /**
     * Save history to storage
     */
    saveHistory() {
      try {
        const historyData = this.history.toJSON()
        const key = buildPlayerScopedStorageKey('VPWardrobe_history')
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
        const key = buildPlayerScopedStorageKey('VPWardrobe_history')
        const historyData = this.storage.loadLocal(key)
        if (historyData) {
          this.history.fromJSON(historyData)
          this.historyVersion = (this.historyVersion || 0) + 1
        }
      } catch (e) {
        console.warn('loadHistory failed', e)
      }
    }
  }
}

function createFileSystemStore() {
  let api = null
  let ctx = null

  const ensure = () => {
    if (api) return

    api = createStore(() => ({ ...fileSystemStoreDefinition.state(), __rev: 0 }))
    const getters = fileSystemStoreDefinition.getters
    const actions = fileSystemStoreDefinition.actions

    const notify = () => {
      const state = api.getState()
      api.setState({ ...state, __rev: (state.__rev ?? 0) + 1 }, true)
    }

    ctx = new Proxy(Object.create(null), {
      get(_target, prop) {
        if (typeof prop === 'symbol') return undefined
        if (prop === '$api') return api
        if (prop === '$notify') return notify
        if (prop in getters) return getters[prop](api.getState())
        if (prop in actions) {
          return (...args) => {
            const before = api.getState()
            const maybeNotify = () => {
              if (api.getState() !== before) notify()
            }
            const result = actions[prop].apply(ctx, args)
            if (result && typeof result.then === 'function') {
              return result.finally(maybeNotify)
            }
            maybeNotify()
            return result
          }
        }
        return api.getState()[prop]
      },
      set(_target, prop, value) {
        if (typeof prop === 'string') api.setState({ [prop]: value })
        return true
      },
      has(_target, prop) {
        const state = api.getState()
        return prop in state || prop in getters || prop in actions
      }
    })
  }

  const useBound = (selector) => {
    ensure()
    if (selector) return useStore(api, () => selector(ctx))
    useStore(api, (state) => state.__rev)
    return ctx
  }

  useBound.getState = () => {
    ensure()
    return ctx
  }
  useBound.subscribe = (listener) => {
    ensure()
    return api.subscribe(listener)
  }
  Object.defineProperty(useBound, 'api', {
    get() {
      ensure()
      return api
    }
  })

  return useBound
}

export const useFileSystemStore = createFileSystemStore()
