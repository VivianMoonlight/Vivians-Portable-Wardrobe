import { hostWindow } from '@/utils/host-window.js'
import { HistoryRecord } from '@/utils/history_record.js'
import { AssetApi } from '@/utils/AssetApi'
import { WardrobeRepository } from '@/services/WardrobeRepository.js'
import { createWardrobeIndex, isWardrobeIndex, listWardrobeOutfits, listWardrobeTags } from '@/services/wardrobe-index.js'
import { migrateLegacyWardrobe, isLegacyWardrobe } from '@/services/wardrobe-migration.js'
import { EXTENSION_QUOTA_BYTES } from '@/services/extension-quota.js'

const clone = value => JSON.parse(JSON.stringify(value))
const newId = () => globalThis.crypto.randomUUID()

export function createLibraryState() {
  return {
    wardrobeIndex: createWardrobeIndex(), outfits: [], tags: [], selectedTagId: null,
    _repository: null, _activeLibraryMember: null,
    syncStatus: { state: 'idle', localSaved: false, error: '', recoveryAvailable: false },
    cloudQuota: {
      limitBytes: EXTENSION_QUOTA_BYTES, wardrobeBytes: 0, otherExtensionsBytes: 0,
      totalBytes: 0, remainingBytes: EXTENSION_QUOTA_BYTES, usageRatio: 0,
      isWarning: false, isOverLimit: false,
    },
  }
}

export const wardrobeLibraryActions = {
  _getRepository() {
    if (!this._repository) {
      this._repository = new WardrobeRepository({
        getPlayer: () => hostWindow.Player,
        localStorage: hostWindow.localStorage,
        send: () => typeof hostWindow.ServerPlayerExtensionSettingsSync === 'function'
          ? hostWindow.ServerPlayerExtensionSettingsSync('VPWardrobe') : false,
        isOnline: () => hostWindow.navigator?.onLine !== false && hostWindow.ServerSocket?.connected !== false,
        setTimeout: (fn, delay) => hostWindow.setTimeout(fn, delay),
        clearTimeout: id => hostWindow.clearTimeout(id),
        onChange: snapshot => this._acceptLibrarySnapshot(snapshot),
      })
    }
    return this._repository
  },

  _acceptLibrarySnapshot({ index, status, quota }) {
    const member = this._repository?.member
    if (member !== null && member !== this._activeLibraryMember) {
      this._activeLibraryMember = member
      this._persistedLoaded = status.localSaved ? member : false
      this.selectedTagId = null
      this.lockedItem = null
      this.character = hostWindow.Player
      try { this.characterItem = AssetApi.collectOutfitData(hostWindow.Player) } catch { this.characterItem = [] }
      this.activeItem = { data: clone(this.characterItem) }
      this.slotControlMap = {}
      this.groupOperations = {}
      const filter = this.history.filter
      this.history = new HistoryRecord('History', 100)
      this.history.filter = filter
      this.loadHistory()
      this.historyVersion++
      this.updatePreviewItem()
    }
    if (this.wardrobeIndex !== index) {
      const previous = new Map(this.outfits.map(item => [item.id, item]))
      const previousRecords = this.wardrobeIndex.outfits
      const lockedId = this.lockedItem?.id
      this.wardrobeIndex = index
      this.outfits = listWardrobeOutfits(index).map(record => {
        const old = previous.get(record.id)
        const cloudSync = index.cloudState[record.id]?.enabled !== false
        if (old && old.cloudSync === cloudSync
          && JSON.stringify(previousRecords[record.id]) === JSON.stringify(record)) return old
        return { ...record, cloudSync }
      })
      this.tags = listWardrobeTags(index)
      if (this.selectedTagId && this.selectedTagId !== 'untagged') {
        this.selectedTagId = this.tags.find(tag => tag.aliasIds.includes(this.selectedTagId))?.id || null
      }
      if (lockedId) {
        this.lockedItem = this.outfits.find(item => item.id === lockedId) || null
        this.activeItem = { data: this.lockedItem?.data || clone(this.characterItem) }
        this.updatePreviewItem({ preserveSlotControls: true })
      }
      this.fileTreeVersion++
    }
    this.syncStatus = status
    if (quota) this.cloudQuota = quota
  },

  loadAll() {
    const member = String(hostWindow.Player?.MemberNumber)
    const loaded = this._getRepository().open()
    this._persistedLoaded = loaded ? member : false
    this.loadHistory()
    return loaded
  },

  receiveCloud(event) {
    const repository = this._getRepository()
    const received = repository.receiveCloud({ ...event, fresh: true })
    if (repository.member !== null) {
      this._persistedLoaded = repository.status.localSaved ? repository.member : false
    }
    return received
  },

  syncNow() { return this._getRepository().flush({ force: true }) },
  refreshCloudQuotaStats() {
    this.cloudQuota = this._getRepository().measure()
    return this.cloudQuota
  },
  selectTag(id) { this.selectedTagId = id },
  createTag(name) {
    const id = newId()
    this._getRepository().apply([{ type: 'put-tag', id, name }])
    return id
  },
  renameTag(id, name) {
    this._getRepository().apply([{ type: 'rename-tag', id, name }])
    return true
  },
  deleteTag(id) {
    const ids = this.tags.find(tag => tag.aliasIds.includes(id))?.aliasIds || [id]
    this._getRepository().apply(ids.map(id => ({ type: 'delete-tag', id })))
    return true
  },
  addOutfit(file) {
    const id = newId()
    const { cloudSync = true, ...changes } = file
    changes.tagIds ||= this.selectedTagId && this.selectedTagId !== 'untagged' ? [this.selectedTagId] : []
    const operations = [{ type: 'put-outfit', id, changes }]
    if (!cloudSync) operations.push({ type: 'set-cloud', id, enabled: false })
    this._getRepository().apply(operations)
    return id
  },
  updateOutfit(id, changes) {
    this._getRepository().apply([{ type: 'put-outfit', id, changes }])
    return true
  },
  removeOutfit(id) {
    this._getRepository().apply([{ type: 'delete-outfit', id }])
    return true
  },
  setOutfitTags(id, tagIds) { return this.updateOutfit(id, { tagIds }) },
  setOutfitCloudSync(id, enabled) {
    this._getRepository().apply([{ type: 'set-cloud', id, enabled }])
    return true
  },
  exportWardrobe() { return clone(this.wardrobeIndex) },
  exportRecovery() { return this._getRepository().exportRecovery() },

  importWardrobe(parsed, { tagName = null } = {}) {
    let incoming
    if (isWardrobeIndex(parsed)) incoming = parsed
    else if (isLegacyWardrobe(parsed?.fs || parsed)) incoming = migrateLegacyWardrobe(parsed.fs || parsed)
    else {
      const file = Array.isArray(parsed) ? { name: 'Imported outfit', type: 'outfit', data: parsed } : parsed
      if (!file || !Array.isArray(file.data)) throw new Error('Unsupported wardrobe backup')
      incoming = migrateLegacyWardrobe({ name: 'Home', type: 'folder', children: [file] })
    }
    const operations = []
    const tagIds = new Map()
    const names = new Map(this.tags.map(tag => [tag.name.normalize('NFKC').trim(), tag.id]))
    const resolveTag = name => {
      const normalized = name.normalize('NFKC').trim()
      if (!names.has(normalized)) {
        const id = newId()
        operations.push({ type: 'put-tag', id, name: normalized })
        names.set(normalized, id)
      }
      return names.get(normalized)
    }
    for (const tag of listWardrobeTags(incoming)) {
      const id = resolveTag(tag.name)
      for (const alias of tag.aliasIds) tagIds.set(alias, id)
    }
    const extraTag = tagName ? resolveTag(tagName)
      : this.selectedTagId && this.selectedTagId !== 'untagged' ? this.selectedTagId : null
    const outfits = listWardrobeOutfits(incoming)
    for (const outfit of outfits) {
      const id = newId()
      const { rev, id: oldId, ...changes } = outfit
      changes.tagIds = [...new Set([...outfit.tagIds.map(id => tagIds.get(id)).filter(Boolean), ...(extraTag ? [extraTag] : [])])]
      operations.push({ type: 'put-outfit', id, changes })
      if (incoming.cloudState[oldId]?.enabled === false) operations.push({ type: 'set-cloud', id, enabled: false })
    }
    if (operations.length) this._getRepository().apply(operations)
    return { count: outfits.length }
  },
}
