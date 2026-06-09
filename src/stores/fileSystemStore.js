import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
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
import { applyPlayerCraftingToBundle } from '@/services/craft-resolver.js'

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

const DEFAULT_REPLACE_MODE = 'merge-replace'
const REPLACE_MODE_PRESERVE = 'preserve'
const REPLACE_MODE_SET = new Set(['fill-empty', 'merge-replace', 'full-replace', REPLACE_MODE_PRESERVE])
// Slot has three explicit states only: original (keep character) / incoming
// (take from selected outfit) / empty. The former lazy `auto` state is gone —
// the default replacement mode is applied eagerly on outfit selection.
const SLOT_MODE_SET = new Set([SLOT_MODE_EMPTY, SLOT_MODE_ORIGINAL, SLOT_MODE_INCOMING])

function normalizeReplaceMode(mode) {
  return REPLACE_MODE_SET.has(mode) ? mode : DEFAULT_REPLACE_MODE
}

function normalizeSlotMode(mode) {
  return SLOT_MODE_SET.has(mode) ? mode : SLOT_MODE_EMPTY
}

/**
 * Eagerly resolve a slot's explicit mode from the default replacement mode and
 * the slot's presence. Replaces the old lazy `auto` resolution.
 */
function computeModeFromReplace(replaceMode, inChar, inIncoming) {
  const mode = normalizeReplaceMode(replaceMode)
  if (mode === REPLACE_MODE_PRESERVE) return SLOT_MODE_EMPTY
  if (mode === 'fill-empty') {
    if (inChar) return SLOT_MODE_ORIGINAL
    if (inIncoming) return SLOT_MODE_INCOMING
    return SLOT_MODE_EMPTY
  }
  if (mode === 'full-replace') {
    return inIncoming ? SLOT_MODE_INCOMING : SLOT_MODE_EMPTY
  }
  // merge-replace (default)
  if (inIncoming) return SLOT_MODE_INCOMING
  if (inChar) return SLOT_MODE_ORIGINAL
  return SLOT_MODE_EMPTY
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

// Legacy key from the old precedence bug:
// 'VPWardrobe_local' + hostWindow.Player ? hostWindow.Player.MemberNumber : 'DEFAULT'
function getLegacyBuggyWardrobeLocalKey() {
  return hostWindow?.Player ? hostWindow.Player.MemberNumber : 'DEFAULT'
}

const CLOUD_QUOTA_LIMIT_BYTES = 180 * 1024
const CLOUD_QUOTA_WARN_RATIO = 0.8

function buildCloudSyncTreeFromSnapshot(node, options = {}) {
  const { forceIncludeRoot = false } = options
  if (!node || typeof node !== 'object') return null

  const isFolder = node.type === 'folder' && Array.isArray(node.children)
  const enabled = node.cloudSync !== false

  if (!isFolder) {
    if (!enabled) return null
    return { ...node }
  }

  const children = []
  for (const child of node.children || []) {
    const picked = buildCloudSyncTreeFromSnapshot(child)
    if (picked) children.push(picked)
  }

  if (!forceIncludeRoot && !enabled && children.length === 0) {
    return null
  }

  return {
    ...node,
    type: 'folder',
    inheritCloudSync: typeof node.inheritCloudSync === 'boolean' ? node.inheritCloudSync : true,
    children
  }
}

function collectCloudSyncStatsFromSnapshot(snapshot) {
  const stats = {
    totalNodes: 0,
    totalFolders: 0,
    totalLeaves: 0,
    enabledNodes: 0,
    enabledFolders: 0,
    enabledLeaves: 0
  }

  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    const isFolder = node.type === 'folder' && Array.isArray(node.children)
    const enabled = node.cloudSync !== false

    stats.totalNodes += 1
    if (enabled) stats.enabledNodes += 1

    if (isFolder) {
      stats.totalFolders += 1
      if (enabled) stats.enabledFolders += 1
      for (const child of node.children || []) walk(child)
    } else {
      stats.totalLeaves += 1
      if (enabled) stats.enabledLeaves += 1
    }
  }

  walk(snapshot)
  return stats
}

function applyNodeCloudSync(node, enabled, recursive) {
  if (!node || typeof node !== 'object') return false
  const nextEnabled = !!enabled
  let changed = false

  const applyOne = (target) => {
    if (!target || typeof target !== 'object') return
    if (target.cloudSync !== nextEnabled) {
      target.cloudSync = nextEnabled
      changed = true
    }
    target.updatedAt = Date.now()
    const isFolder = target.type === 'folder' && Array.isArray(target.children)
    if (recursive && isFolder) {
      for (const child of target.children) applyOne(child)
    }
  }

  applyOne(node)
  return changed
}

function identityRaw(value) {
  return value
}

const fileSystemStoreDefinition = {
  state: () => ({
    fs: new FileSystem('Home'),
    history: new HistoryRecord('History', 100),
    currentPath: ['Home'],
    renderer: new RenderService({ drawCallbacks: RenderApi }),
    thumbnailRefreshVersion: 0,
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

    cloudQuota: {
      limitBytes: CLOUD_QUOTA_LIMIT_BYTES,
      warnRatio: CLOUD_QUOTA_WARN_RATIO,
      usedBytes: 0,
      usageRatio: 0,
      isWarning: false,
      isOverLimit: false,
      lastMeasuredAt: null,
      lastError: ''
    },
    cloudSyncStats: {
      totalNodes: 0,
      totalFolders: 0,
      totalLeaves: 0,
      enabledNodes: 0,
      enabledFolders: 0,
      enabledLeaves: 0,
      payloadBytes: 0
    },
    cloudSyncTreePreview: null,

    // default replacement mode used when selecting/focusing an item
    defaultReplaceMode: DEFAULT_REPLACE_MODE, // 'fill-empty' | 'merge-replace' | 'full-replace'

    // legacy alias kept for compatibility with existing callers
    applyMode: DEFAULT_REPLACE_MODE,

    // per-slot control state: { [slotKey]: { mode: 'empty' | 'original' | 'incoming', locked?: boolean } }
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
        this.activeItem = { data: cloneOutfitData(this.characterItem) }
      } else if (!Array.isArray(this.activeItem?.data)) {
        this.activeItem = { data: cloneOutfitData(this.characterItem) }
      }

      this.previewItem = { data: [] }
      this._applyReplaceModeToAllSlots(this.defaultReplaceMode)
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

    _buildCloudSyncTreeFromSnapshot(node, options = {}) {
      return buildCloudSyncTreeFromSnapshot(node, options)
    },

    _collectCloudSyncStatsFromSnapshot(snapshot) {
      return collectCloudSyncStatsFromSnapshot(snapshot)
    },

    buildCloudSyncTree() {
      const snapshot = this.fs.toJSON()
      const tree = buildCloudSyncTreeFromSnapshot(snapshot, { forceIncludeRoot: true })
      if (tree) return tree
      return {
        name: snapshot?.name || 'Home',
        type: 'folder',
        children: [],
        cloudSync: false,
        inheritCloudSync: true,
        updatedAt: Date.now()
      }
    },

    collectCloudSyncStats() {
      const snapshot = this.fs.toJSON()
      const stats = collectCloudSyncStatsFromSnapshot(snapshot)
      const cloudTree = buildCloudSyncTreeFromSnapshot(snapshot, { forceIncludeRoot: true }) || {
        name: snapshot?.name || 'Home',
        type: 'folder',
        children: []
      }
      const payloadBytes = this.storage.estimatePayloadBytes(cloudTree)
      return {
        ...stats,
        payloadBytes
      }
    },

    refreshCloudQuotaStats(snapshot = null) {
      const sourceSnapshot = snapshot || this.fs.toJSON()
      const cloudTree = buildCloudSyncTreeFromSnapshot(sourceSnapshot, { forceIncludeRoot: true }) || {
        name: sourceSnapshot?.name || 'Home',
        type: 'folder',
        children: []
      }
      const stats = collectCloudSyncStatsFromSnapshot(sourceSnapshot)
      const payloadBytes = this.storage.estimatePayloadBytes(cloudTree)

      const limitBytes = Number(this.cloudQuota?.limitBytes || CLOUD_QUOTA_LIMIT_BYTES)
      const warnRatio = Number(this.cloudQuota?.warnRatio || CLOUD_QUOTA_WARN_RATIO)
      const usageRatio = limitBytes > 0 ? (payloadBytes / limitBytes) : 0
      const isOverLimit = limitBytes > 0 ? payloadBytes > limitBytes : false
      const isWarning = !isOverLimit && usageRatio >= warnRatio
      const lastError = isOverLimit
        ? `Cloud payload exceeds quota: ${payloadBytes}/${limitBytes}`
        : ''

      this.cloudSyncTreePreview = cloudTree
      this.cloudSyncStats = {
        ...stats,
        payloadBytes
      }
      this.cloudQuota = {
        ...this.cloudQuota,
        usedBytes: payloadBytes,
        usageRatio,
        isWarning,
        isOverLimit,
        lastMeasuredAt: Date.now(),
        lastError
      }

      return this.cloudQuota
    },

    _applyNodeCloudSync(node, enabled, recursive) {
      return applyNodeCloudSync(node, enabled, recursive)
    },

    setNodeCloudSync(node, enabled, options = {}) {
      if (!node || typeof node !== 'object') return false
      const recursive = node.type === 'folder' ? options.recursive !== false : false
      const changed = applyNodeCloudSync(node, enabled, recursive)
      if (changed) {
        this.saveAll()
      } else {
        this.refreshCloudQuotaStats()
      }
      return changed
    },

    setPathCloudSync(path, enabled, options = {}) {
      if (!Array.isArray(path) || path.length === 0) return false
      const node = this.fs.getNode(path)
      if (!node) return false
      return this.setNodeCloudSync(node, enabled, options)
    },

    saveAll() {
      try {
        const snapshot = this.fs.toJSON()
        const localKey = buildPlayerScopedStorageKey('VPWardrobe_local')

        // Local remains full snapshot regardless of cloud quota.
        this.storage.saveLocal(localKey, snapshot)

        const quota = this.refreshCloudQuotaStats(snapshot)
        const cloudTree = this.cloudSyncTreePreview || buildCloudSyncTreeFromSnapshot(snapshot, { forceIncludeRoot: true })

        if (quota?.isOverLimit) {
          console.warn('saveAll skipped cloud sync due to quota limit', {
            usedBytes: quota.usedBytes,
            limitBytes: quota.limitBytes
          })
          return
        }

        // Cloud persistence now stores only cloudSync-enabled subtree.
        this.storage.saveOnline('key', cloudTree)
      } catch (e) {
        console.warn('saveAll failed', e)
      }
    },
    loadAll() {
      try {
        const onlineData = this.storage.loadOnline('key')
        const localKey = buildPlayerScopedStorageKey('VPWardrobe_local')
        let localData = this.storage.loadLocal(localKey)

        if (!localData) {
          const legacyLocalKey = getLegacyBuggyWardrobeLocalKey()
          if (legacyLocalKey !== undefined && legacyLocalKey !== null) {
            localData = this.storage.loadLocal(legacyLocalKey)
            if (localData) {
              this.storage.saveLocal(localKey, localData)
            }
          }
        }

        // Local snapshot is authoritative for full filesystem to avoid stale cloud data
        // resurrecting locally deleted items when cloud sync is skipped by quota.
        if (localData) {
          this.fs.fromJSON(localData)
        } else if (onlineData) {
          this.fs.fromJSON(onlineData)
          this.storage.saveLocal(localKey, onlineData)
        }

        this.refreshCloudQuotaStats()
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

    refreshThumbnails(items = null) {
      const targets = Array.isArray(items)
        ? items
        : ((this.currentNode?.children || []).filter(item => item?.type !== 'folder'))
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
        if (this.defaultReplaceMode === REPLACE_MODE_PRESERVE) {
          this._ensureSlotControls(this.characterItem, this.activeItem.data)
        } else {
          // New selection → (re)apply the default replacement mode to all slots.
          this._applyReplaceModeToAllSlots(this.defaultReplaceMode)
        }
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
      if (this.defaultReplaceMode === REPLACE_MODE_PRESERVE) {
        this._ensureSlotControls(this.characterItem, this.activeItem?.data)
      } else {
        // New outfit selected → reset every slot from the default replacement mode.
        this._applyReplaceModeToAllSlots(this.defaultReplaceMode)
      }
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
      if (resolved === REPLACE_MODE_PRESERVE) {
        this._ensureSlotControls()
        this.updatePreviewItem()
        return
      }
      // Changing the default re-applies it to all slots immediately.
      this._applyReplaceModeToAllSlots(resolved)
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
      return {
        inCharacter: new Set(characterParts.map(getGroupNameFromPart).filter(Boolean)),
        inIncoming: new Set(incomingParts.map(getGroupNameFromPart).filter(Boolean)),
      }
    },

    _ensureSlotControls(characterData = null, sourceData = null) {
      const keys = this._collectKnownSlotKeys(characterData, sourceData)
      const current = this.slotControlMap || {}
      const next = { ...current }
      let changed = false

      const { inCharacter, inIncoming } = this._presenceSets(characterData, sourceData)

      for (const key of keys) {
        const prev = current[key]
        if (!prev) {
          // Brand-new slot: seed its explicit mode from the default replacement mode.
          const mode = computeModeFromReplace(this.defaultReplaceMode, inCharacter.has(key), inIncoming.has(key))
          next[key] = { mode, locked: false }
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

    // Eagerly (re)apply the default replacement mode to every known slot,
    // overwriting the whole slotControlMap. Used when an outfit is selected or
    // the default mode changes.
    _applyReplaceModeToAllSlots(replaceMode = null) {
      const mode = normalizeReplaceMode(replaceMode || this.defaultReplaceMode)
      const keys = this._collectKnownSlotKeys()
      const { inCharacter, inIncoming } = this._presenceSets()
      const next = {}
      for (const key of keys) {
        next[key] = { mode: computeModeFromReplace(mode, inCharacter.has(key), inIncoming.has(key)), locked: false }
      }
      this.slotControlMap = next
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

    // ---- escalating scope toggles (global / per-group) ----
    // For original/incoming: first press sets the slots that have a source
    // (inCharacter / inIncoming) to the target mode without touching the rest
    // (non-exclusive merge); once those are all set, a second press extends the
    // target to every slot in scope (exclusive / full replace). For empty: set
    // every slot in scope to empty.
    _smartSetScope(keys, targetMode) {
      const mode = normalizeSlotMode(targetMode)
      const { inCharacter, inIncoming } = this._presenceSets()
      let apply = keys
      if (mode === SLOT_MODE_ORIGINAL || mode === SLOT_MODE_INCOMING) {
        const presence = mode === SLOT_MODE_ORIGINAL ? inCharacter : inIncoming
        const relevant = keys.filter((k) => presence.has(k))
        const relevantAllTarget =
          relevant.length > 0 && relevant.every((k) => normalizeSlotMode(this.slotControlMap?.[k]?.mode) === mode)
        apply = relevantAllTarget ? keys : (relevant.length > 0 ? relevant : keys)
      }

      const current = this.slotControlMap || {}
      const next = { ...current }
      let changed = false
      for (const key of apply) {
        if (normalizeSlotMode(current[key]?.mode) === mode) continue
        next[key] = { mode, locked: false }
        changed = true
      }
      if (changed) {
        this.slotControlMap = next
        this._syncActiveFiltersFromSlotControls()
        this.updatePreviewItem()
      }
      return changed
    },

    // Tri-state for button styling: 'full' = every slot in scope is target;
    // 'partial' = the relevant subset is all target (State A reached) but not
    // every slot; 'none' otherwise.
    _scopeModeState(keys, targetMode) {
      const mode = normalizeSlotMode(targetMode)
      if (keys.length === 0) return 'none'
      const isTarget = (k) => normalizeSlotMode(this.slotControlMap?.[k]?.mode) === mode
      if (keys.every(isTarget)) return 'full'
      if (mode === SLOT_MODE_EMPTY) return 'none'
      const { inCharacter, inIncoming } = this._presenceSets()
      const presence = mode === SLOT_MODE_ORIGINAL ? inCharacter : inIncoming
      const relevant = keys.filter((k) => presence.has(k))
      if (relevant.length > 0 && relevant.every(isTarget)) return 'partial'
      return 'none'
    },

    smartSetAllMode(mode) {
      this._ensureSlotControls()
      return this._smartSetScope(this._collectKnownSlotKeys(), mode)
    },

    smartSetGroupMode(groupID, mode) {
      const keys = this._getGroupSlotKeys(groupID)
      if (keys.length === 0) return false
      this._ensureSlotControls()
      return this._smartSetScope(keys, mode)
    },

    getAllModeState(mode) {
      return this._scopeModeState(this._collectKnownSlotKeys(), mode)
    },

    getGroupModeState(groupID, mode) {
      return this._scopeModeState(this._getGroupSlotKeys(groupID), mode)
    },

    reapplyDefaultMode() {
      this._applyReplaceModeToAllSlots(this.defaultReplaceMode)
      this.updatePreviewItem()
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
      // An explicit replaceMode override means "resolve every slot from this
      // mode now" (used by direct applies); otherwise use the stored per-slot modes.
      const useOverride = !!replaceModeOverride
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
        const mode = useOverride
          ? computeModeFromReplace(replaceMode, byCharacterSlot.has(slotKey), byIncomingSlot.has(slotKey))
          : normalizeSlotMode(slotControlMap?.[slotKey]?.mode)
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
      const rawCharacter = this.character ? identityRaw(this.character) : null
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
      const rawCharacter = this.character ? identityRaw(this.character) : null
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

          if (!hasSlotControls) {
            // First snapshot: seed all slots from the default replacement mode.
            this._applyReplaceModeToAllSlots(this.defaultReplaceMode)
          } else {
            // Later snapshots only register newly-revealed slot keys (seeded
            // from the default mode), preserving existing per-slot choices.
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
        this.activeItem = { data: cloneOutfitData(record.data) }
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
