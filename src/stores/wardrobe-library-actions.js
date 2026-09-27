import { hostWindow } from '@/utils/host-window.js'
import { HistoryRecord } from '@/utils/history_record.js'
import { AssetApi } from '@/utils/AssetApi'
import { WardrobeRepository } from '@/services/WardrobeRepository.js'
import { WardrobePersistence } from '@/services/wardrobe-persistence.js'
import { createWardrobeIndex, isWardrobeIndex, listWardrobeOutfits, listWardrobeTags } from '@/services/wardrobe-index.js'
import { migrateLegacyWardrobe, isLegacyWardrobe } from '@/services/wardrobe-migration.js'
import { EXTENSION_QUOTA_BYTES } from '@/services/extension-quota.js'
import { measureObservedExtensionQuota } from '@/services/extension-quota.js'
import {
  CLOUDFLARE_KEY_SETTING, CloudflareWardrobeClient, generateCloudflareRecoveryKey,
  isCloudflareRecoveryKey,
} from '@/services/cloudflare-wardrobe-client.js'
import { syncCloudflareRepository } from '@/services/cloudflare-wardrobe-sync.js'

const clone = value => JSON.parse(JSON.stringify(value))
const newId = () => globalThis.crypto.randomUUID()
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value
const sameRecord = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
const hasLegacyBcSnapshot = settings => Boolean(settings?.VPWardrobe)
  || Object.entries(settings || {}).some(([key, value]) => key.startsWith('VPW4_M_') && value != null)
const bcWardrobeSignature = settings => JSON.stringify(Object.entries(settings || {})
  .filter(([key]) => key === 'VPWardrobe' || key.startsWith('VPW4_M_'))
  .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))

function unavailableCloudQuota() {
  return {
    limitBytes: EXTENSION_QUOTA_BYTES, wardrobeBytes: 0, otherExtensionsBytes: 0,
    totalBytes: 0, remainingBytes: EXTENSION_QUOTA_BYTES, usageRatio: 0,
    isWarning: false, isOverLimit: false, proposalAvailable: false,
  }
}

function idleCloudflareStatus(ready = false) {
  return { enabled: false, ready, syncing: false, pending: false, error: '', errorCode: null,
    lastSyncedAt: null, keyAvailable: false, keySavedToBC: false,
    bcLegacyRetained: null, bcLegacyChanged: false }
}

export function createLibraryState() {
  return {
    wardrobeIndex: createWardrobeIndex(), outfits: [], tags: [], selectedTagId: null,
    _repository: null, _activeLibraryMember: null,
    syncStatus: { state: 'idle', localSaved: false, error: '', recoveryAvailable: false, conflicts: [] },
    cloudQuota: unavailableCloudQuota(),
    cloudflareSyncStatus: idleCloudflareStatus(),
    _cloudflareKey: null, _cloudflareMember: null, _cloudflareTask: null, _cloudflareTimer: null,
    _cloudflareClient: null, _cloudflareFreshSettings: null, _cloudflareCleanupSubmitted: false,
    _cloudflareEpoch: 0,
  }
}

export const wardrobeLibraryActions = {
  _getRepository() {
    if (!this._repository) {
      const canWrite = member => hostWindow.__VPW_WARDROBE_LOCK_OWNER === true
        && hostWindow.__VPW_WARDROBE_LOCK_MEMBER === String(member)
        && String(hostWindow.Player?.MemberNumber) === String(member)
      this._repository = new WardrobeRepository({
        getPlayer: () => hostWindow.Player,
        localStorage: hostWindow.localStorage,
        persistence: new WardrobePersistence(() => hostWindow.indexedDB, canWrite),
        canWrite,
        send: (fields, expectedMember) => {
          if (hostWindow.__VPW_WARDROBE_LOCK_OWNER !== true
            || hostWindow.__VPW_WARDROBE_LOCK_MEMBER !== String(expectedMember)
            || String(hostWindow.Player?.MemberNumber) !== String(expectedMember)) return false
          if (typeof hostWindow.ServerSend !== 'function') return false
          const keys = Object.keys(fields || {})
          if (keys.length !== 2 || !keys.includes('ExtensionSettings.VPWardrobe')
            || !keys.some(key => /^ExtensionSettings\.VPW4_M_[0-9a-f]{32}$/.test(key))) {
            throw new Error('Wardrobe sync must update its snapshot and device marker together')
          }
          hostWindow.ServerSend('AccountUpdate', fields)
          return true
        },
        isOnline: () => hostWindow.__VPW_WARDROBE_LOCK_OWNER === true
          && hostWindow.__VPW_WARDROBE_LOCK_MEMBER === String(hostWindow.Player?.MemberNumber)
          && hostWindow.navigator?.onLine !== false && hostWindow.ServerSocket?.connected !== false,
        setTimeout: (fn, delay) => hostWindow.setTimeout(fn, delay),
        clearTimeout: id => hostWindow.clearTimeout(id),
        onChange: snapshot => this._acceptLibrarySnapshot(snapshot),
      })
    }
    return this._repository
  },

  _acceptLibrarySnapshot({ index, status, quota }) {
    const member = this._repository?.member
    if (member !== null) this._persistedAttemptedMember = member
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
      this._cloudflareKey = null
      this._cloudflareMember = null
      this._cloudflareFreshSettings = null
      this._cloudflareCleanupSubmitted = false
      this.cloudflareSyncStatus = idleCloudflareStatus(this._cloudflareClient?.available || false)
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
          && sameRecord(previousRecords[record.id], record)) return old
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
    this.cloudQuota = quota || unavailableCloudQuota()
  },

  async loadAll() {
    const member = String(hostWindow.Player?.MemberNumber)
    this._cloudflareEpoch++
    if (this._cloudflareTimer !== null) hostWindow.clearTimeout(this._cloudflareTimer)
    this._cloudflareTimer = null
    this._cloudflareTask = null
    this._persistedAttemptedMember = member
    const repository = this._getRepository()
    const client = this._cloudflareClient || (this._cloudflareClient = new CloudflareWardrobeClient())
    const saved = repository.persistence
      ? await repository.persistence.readMeta(member, 'cloudflareSync') : null
    if (String(hostWindow.Player?.MemberNumber) !== member) {
      throw new Error('Wardrobe account changed while opening')
    }
    repository.setCloudflareMode(saved?.enabled === true)
    const loaded = await repository.open()
    if (String(hostWindow.Player?.MemberNumber) !== member || repository.member !== member) {
      throw new Error('Wardrobe account changed while opening')
    }
    this._persistedLoaded = loaded ? member : false
    const bcKey = hostWindow.Player?.ExtensionSettings?.[CLOUDFLARE_KEY_SETTING]
    const key = isCloudflareRecoveryKey(saved?.key) ? saved.key
      : isCloudflareRecoveryKey(bcKey) ? bcKey : null
    this._cloudflareKey = key
    this._cloudflareMember = member
    this._cloudflareFreshSettings = null
    this._cloudflareCleanupSubmitted = false
    this.cloudflareSyncStatus = { ...idleCloudflareStatus(client.available),
      enabled: saved?.enabled === true, keyAvailable: Boolean(key),
      pending: saved?.enabled === true,
      keySavedToBC: Boolean(key && (bcKey === key || saved?.keySubmittedToBC)),
      error: saved?.enabled && !key ? 'Cloudflare recovery key is missing' : '' }
    this.loadHistory()
    if (loaded && saved?.enabled && key && client.available) this._queueCloudflareSync(0)
    return loaded
  },

  async receiveCloud(event) {
    const repository = this._getRepository()
    if (this.cloudflareSyncStatus.enabled) {
      const member = repository.member
      if (String(event?.memberNumber) !== member
        || String(hostWindow.Player?.MemberNumber) !== member
        || this._cloudflareMember !== member) return false
      const settings = event?.extensionSettings
      const key = settings?.[CLOUDFLARE_KEY_SETTING]
      this._cloudflareFreshSettings = settings ? { ...settings } : null
      this._cloudflareCleanupSubmitted = false
      if (settings && typeof settings === 'object') {
        const retained = hasLegacyBcSnapshot(settings)
        const baseline = repository.document?.cloudflareBcBaseline
        this.cloudflareSyncStatus = { ...this.cloudflareSyncStatus,
          bcLegacyRetained: retained,
          bcLegacyChanged: retained && (typeof baseline !== 'string'
            || bcWardrobeSignature(settings) !== baseline) }
      }
      this.cloudflareSyncStatus = { ...this.cloudflareSyncStatus,
        keySavedToBC: key === this._cloudflareKey }
      this._clearLegacyBcSnapshot()
      this.cloudflareSyncStatus = { ...this.cloudflareSyncStatus, pending: true }
      this._queueCloudflareSync(0)
      return true
    }
    const received = await repository.receiveCloud({ ...event, fresh: true })
    if (repository.member !== null) {
      this._persistedLoaded = repository.status.localSaved ? repository.member : false
    }
    return received
  },

  async syncNow() {
    if (this.cloudflareSyncStatus.enabled) return this.syncCloudflareNow()
    if (!this.syncStatus.localSaved) return this.loadAll()
    if (this.syncStatus.errorCode === 'local-storage-quota') return this._getRepository().flush()
    return this._getRepository().flush({ force: true })
  },
  _queueCloudflareSync(delay = 800) {
    if (!this.cloudflareSyncStatus.enabled || !this._cloudflareKey) return
    if (this._cloudflareTimer !== null) hostWindow.clearTimeout(this._cloudflareTimer)
    this._cloudflareTimer = hostWindow.setTimeout(() => {
      this._cloudflareTimer = null
      void this.syncCloudflareNow()
    }, delay)
  },
  async syncCloudflareNow() {
    if (!this.cloudflareSyncStatus.enabled) return false
    if (this._cloudflareTask) return this._cloudflareTask
    const client = this._cloudflareClient || (this._cloudflareClient = new CloudflareWardrobeClient())
    const key = this._cloudflareKey
    const member = this._cloudflareMember
    const repository = this._getRepository()
    const epoch = this._cloudflareEpoch
    const isActive = () => this._cloudflareEpoch === epoch && this._cloudflareMember === member
      && this._cloudflareKey === key && this.cloudflareSyncStatus.enabled
      && repository.member === member && String(hostWindow.Player?.MemberNumber) === member
      && hostWindow.__VPW_WARDROBE_LOCK_OWNER === true
      && hostWindow.__VPW_WARDROBE_LOCK_MEMBER === member
    if (!client.available || !key || !this.syncStatus.localSaved) {
      this.cloudflareSyncStatus = { ...this.cloudflareSyncStatus,
        error: !client.available ? 'Cloudflare sync has not been configured'
          : !key ? 'Cloudflare recovery key is missing' : 'Local wardrobe is not ready' }
      return false
    }
    const task = (async () => {
      this.cloudflareSyncStatus = { ...this.cloudflareSyncStatus,
        syncing: true, error: '', errorCode: null }
      try {
        const result = await syncCloudflareRepository(repository, client, key, { isActive })
        if (!isActive()) return false
        this.cloudflareSyncStatus = { ...this.cloudflareSyncStatus, syncing: false,
          error: result.state === 'pending' ? 'New local changes still need to sync' : '', errorCode: null,
          pending: result.state !== 'verified',
          lastSyncedAt: result.state === 'verified' ? Date.now() : this.cloudflareSyncStatus.lastSyncedAt }
        if (result.state === 'verified') {
          if (!this._clearLegacyBcSnapshot()) await this._submitCloudflareKeyToBC(key)
        }
        if (result.state === 'pending') this._queueCloudflareSync(1200)
        return result.state === 'verified'
      } catch (error) {
        if (isActive()) {
          this.cloudflareSyncStatus = { ...this.cloudflareSyncStatus, syncing: false,
            error: error?.message || 'Cloudflare sync failed',
            errorCode: error?.serverCode || error?.code || null, pending: true }
        }
        return false
      }
    })()
    this._cloudflareTask = task
    try { return await task }
    finally { if (this._cloudflareTask === task) this._cloudflareTask = null }
  },
  async _submitCloudflareKeyToBC(key) {
    const member = this._cloudflareMember
    const player = hostWindow.Player
    const repository = this._getRepository()
    if (!isCloudflareRecoveryKey(key) || String(player?.MemberNumber) !== member
      || this._cloudflareKey !== key || !this.cloudflareSyncStatus.enabled
      || this.cloudflareSyncStatus.pending || !this.cloudflareSyncStatus.lastSyncedAt
      || repository.member !== member || !repository.cloudflareMode
      || !Number.isSafeInteger(repository.document?.cloudflareRevision)
      || repository.document.cloudflareRevision < 1 || repository.document?.pending
      || repository.document?.conflicts?.length
      || hostWindow.__VPW_WARDROBE_LOCK_OWNER !== true
      || hostWindow.__VPW_WARDROBE_LOCK_MEMBER !== member
      || typeof hostWindow.ServerSend !== 'function'
      || hostWindow.ServerSocket?.connected === false) return false
    const settings = player.ExtensionSettings || (player.ExtensionSettings = {})
    if (settings[CLOUDFLARE_KEY_SETTING] !== key
      || (this._cloudflareFreshSettings
        && this._cloudflareFreshSettings[CLOUDFLARE_KEY_SETTING] !== key)) {
      const proposed = { ...settings, [CLOUDFLARE_KEY_SETTING]: key }
      try { if (measureObservedExtensionQuota(proposed).isOverLimit) return false }
      catch { return false }
      const prior = settings[CLOUDFLARE_KEY_SETTING]
      settings[CLOUDFLARE_KEY_SETTING] = key
      try {
        if (hostWindow.ServerSend('AccountUpdate', {
          [`ExtensionSettings.${CLOUDFLARE_KEY_SETTING}`]: key,
        }) === false) throw new Error('BC did not accept the recovery key')
      } catch {
        if (prior === undefined) delete settings[CLOUDFLARE_KEY_SETTING]
        else settings[CLOUDFLARE_KEY_SETTING] = prior
        return false
      }
    }
    if (this._cloudflareMember !== member) return false
    try {
      await this._getRepository().persistence.writeMeta(member, 'cloudflareSync', {
        enabled: this.cloudflareSyncStatus.enabled, key, keySubmittedToBC: true,
      })
    } catch { return false }
    this.cloudflareSyncStatus = { ...this.cloudflareSyncStatus, keySavedToBC: true }
    return true
  },
  _clearLegacyBcSnapshot() {
    const repository = this._getRepository()
    if (!this.cloudflareSyncStatus.enabled || !this._cloudflareKey
      || this._cloudflareCleanupSubmitted || this.cloudflareSyncStatus.bcLegacyRetained === false
      || this.cloudflareSyncStatus.bcLegacyChanged
      || !this._cloudflareFreshSettings
      || typeof repository.document?.cloudflareBcBaseline !== 'string'
      || bcWardrobeSignature(this._cloudflareFreshSettings) !== repository.document.cloudflareBcBaseline
      || !Number.isSafeInteger(repository.document?.cloudflareRevision)
      || repository.document.cloudflareRevision < 1 || repository.document?.pending
      || repository.document?.conflicts?.length) return false
    const member = this._cloudflareMember
    const player = hostWindow.Player
    if (String(player?.MemberNumber) !== member || hostWindow.__VPW_WARDROBE_LOCK_OWNER !== true
      || hostWindow.__VPW_WARDROBE_LOCK_MEMBER !== member
      || typeof hostWindow.ServerSend !== 'function'
      || hostWindow.ServerSocket?.connected === false) return false
    const settings = player.ExtensionSettings || (player.ExtensionSettings = {})
    const observed = this._cloudflareFreshSettings || settings
    if (bcWardrobeSignature(settings) !== repository.document.cloudflareBcBaseline) {
      this.cloudflareSyncStatus = { ...this.cloudflareSyncStatus, bcLegacyChanged: true }
      return false
    }
    const keys = ['VPWardrobe', ...Object.keys(observed).filter(key => key.startsWith('VPW4_M_'))]
      .filter(key => observed[key] != null)
    if (!keys.length) return false
    const previous = new Map([...keys, CLOUDFLARE_KEY_SETTING].map(key => [key, settings[key]]))
    const fields = { ...Object.fromEntries(keys.map(key => [`ExtensionSettings.${key}`, null])),
      [`ExtensionSettings.${CLOUDFLARE_KEY_SETTING}`]: this._cloudflareKey }
    const proposed = { ...observed, ...Object.fromEntries(keys.map(key => [key, null])),
      [CLOUDFLARE_KEY_SETTING]: this._cloudflareKey }
    try { if (measureObservedExtensionQuota(proposed).isOverLimit) return false }
    catch { return false }
    for (const key of keys) settings[key] = null
    settings[CLOUDFLARE_KEY_SETTING] = this._cloudflareKey
    try {
      if (hostWindow.ServerSend('AccountUpdate', fields) === false) {
        throw new Error('BC did not accept the cleanup')
      }
    } catch {
      for (const [key, value] of previous) {
        if (value === undefined) delete settings[key]
        else settings[key] = value
      }
      return false
    }
    this._cloudflareCleanupSubmitted = true
    this.cloudflareSyncStatus = { ...this.cloudflareSyncStatus,
      keySavedToBC: true, bcLegacyRetained: null }
    return true
  },
  async enableCloudflareSync() {
    const client = this._cloudflareClient || (this._cloudflareClient = new CloudflareWardrobeClient())
    if (!client.available) {
      this.cloudflareSyncStatus = { ...this.cloudflareSyncStatus,
        error: 'Cloudflare sync has not been configured' }
      return false
    }
    const repository = this._getRepository()
    if (!this.syncStatus.localSaved) await this.loadAll()
    if (!repository.status.localSaved) throw new Error('Local wardrobe is not ready')
    if (repository.status.conflicts?.length) throw new Error('Resolve current sync conflicts before switching storage')
    const member = repository.member
    const bcKey = hostWindow.Player?.ExtensionSettings?.[CLOUDFLARE_KEY_SETTING]
    const key = this._cloudflareKey || (isCloudflareRecoveryKey(bcKey) ? bcKey : generateCloudflareRecoveryKey())
    await repository.saveCloudflareBcBaseline(repository.freshCloudObserved
      ? bcWardrobeSignature(repository.lastFreshSettings) : null)
    await repository.persistence.writeMeta(member, 'cloudflareSync', {
      enabled: true, key, keySubmittedToBC: bcKey === key,
    })
    if (String(hostWindow.Player?.MemberNumber) !== member || repository.member !== member) {
      throw new Error('Wardrobe account changed while switching sync')
    }
    this._cloudflareKey = key
    this._cloudflareMember = member
    repository.setCloudflareMode(true)
    this.cloudflareSyncStatus = { ...this.cloudflareSyncStatus, enabled: true, ready: true,
      keyAvailable: true, keySavedToBC: bcKey === key, pending: true, error: '' }
    this._queueCloudflareSync(0)
    return true
  },
  async disableCloudflareSync() {
    if (!this.cloudflareSyncStatus.enabled) return true
    const member = this._cloudflareMember
    if (this._cloudflareTimer !== null) hostWindow.clearTimeout(this._cloudflareTimer)
    this._cloudflareTimer = null
    if (this._cloudflareTask) await this._cloudflareTask
    if (this._cloudflareMember !== member || String(hostWindow.Player?.MemberNumber) !== member) {
      throw new Error('Wardrobe account changed while switching sync')
    }
    const repository = this._getRepository()
    await repository.leaveCloudflareMode()
    if (repository.member !== member) throw new Error('Wardrobe account changed while switching sync')
    await repository.persistence.writeMeta(member, 'cloudflareSync', {
      enabled: false, key: this._cloudflareKey,
      keySubmittedToBC: this.cloudflareSyncStatus.keySavedToBC,
    })
    repository.setCloudflareMode(false)
    repository.invalidateFreshness()
    this.cloudflareSyncStatus = { ...this.cloudflareSyncStatus, enabled: false,
      syncing: false, pending: false, error: '', lastSyncedAt: null,
      bcLegacyRetained: null, bcLegacyChanged: false }
    return true
  },
  async importCloudflareKey(key) {
    const normalized = String(key || '').trim()
    if (!isCloudflareRecoveryKey(normalized)) throw new Error('Invalid Cloudflare recovery key')
    if (this.cloudflareSyncStatus.enabled && this._cloudflareKey !== normalized) {
      throw new Error('Turn off Cloudflare sync before switching recovery keys')
    }
    const member = this._getRepository().member
    if (this._cloudflareKey !== normalized) {
      await this._getRepository().resetCloudflareReference()
    }
    await this._getRepository().persistence.writeMeta(member, 'cloudflareSync', {
      enabled: this.cloudflareSyncStatus.enabled, key: normalized, keySubmittedToBC: false,
    })
    if (String(hostWindow.Player?.MemberNumber) !== member) {
      throw new Error('Wardrobe account changed while saving the recovery key')
    }
    this._cloudflareKey = normalized
    this._cloudflareMember = member
    this.cloudflareSyncStatus = { ...this.cloudflareSyncStatus, keyAvailable: true,
      keySavedToBC: false, pending: this.cloudflareSyncStatus.enabled, error: '' }
    if (this.cloudflareSyncStatus.enabled) this._queueCloudflareSync(0)
    return true
  },
  async exportCloudflareKey() {
    if (!this._cloudflareKey) throw new Error('Cloudflare recovery key is not available')
    return this._cloudflareKey
  },
  async resolveSyncConflict(resolutions) {
    const result = await this._getRepository().resolveSyncConflict(resolutions)
    if (this.cloudflareSyncStatus.enabled) {
      this.cloudflareSyncStatus = { ...this.cloudflareSyncStatus, pending: true }
      this._queueCloudflareSync()
    }
    return result
  },
  refreshCloudQuotaStats() {
    this.cloudQuota = this._getRepository().measure()
    return this.cloudQuota
  },
  async _applyLibraryOperations(operations) {
    const result = await this._getRepository().apply(operations)
    if (this.cloudflareSyncStatus.enabled) {
      this.cloudflareSyncStatus = { ...this.cloudflareSyncStatus,
        pending: Boolean(this._getRepository().document?.pending) }
      this._queueCloudflareSync()
    }
    return result
  },
  selectTag(id) { this.selectedTagId = id },
  async createTag(name) {
    const id = newId()
    await this._applyLibraryOperations([{ type: 'put-tag', id, name }])
    return id
  },
  async renameTag(id, name) {
    await this._applyLibraryOperations([{ type: 'rename-tag', id, name }])
    return true
  },
  async deleteTag(id) {
    const ids = this.tags.find(tag => tag.aliasIds.includes(id))?.aliasIds || [id]
    await this._applyLibraryOperations(ids.map(id => ({ type: 'delete-tag', id })))
    return true
  },
  async addOutfit(file) {
    const id = newId()
    const { cloudSync = true, ...changes } = file
    changes.tagIds ||= this.selectedTagId && this.selectedTagId !== 'untagged' ? [this.selectedTagId] : []
    const operations = [{ type: 'put-outfit', id, changes }]
    if (!cloudSync) operations.push({ type: 'set-cloud', id, enabled: false })
    await this._applyLibraryOperations(operations)
    return id
  },
  async updateOutfit(id, changes) {
    await this._applyLibraryOperations([{ type: 'put-outfit', id, changes }])
    return true
  },
  async removeOutfit(id) {
    await this._applyLibraryOperations([{ type: 'delete-outfit', id }])
    return true
  },
  setOutfitTags(id, tagIds) { return this.updateOutfit(id, { tagIds }) },
  async setOutfitCloudSync(id, enabled) {
    await this._applyLibraryOperations([{ type: 'set-cloud', id, enabled }])
    return true
  },
  exportWardrobe() { return clone(this.wardrobeIndex) },
  exportRecovery() { return this._getRepository().exportRecovery() },

  async importWardrobe(parsed, { tagName = null } = {}) {
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
    if (operations.length) await this._applyLibraryOperations(operations)
    return { count: outfits.length }
  },
}
