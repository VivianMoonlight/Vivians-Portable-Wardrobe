import LZString from 'lz-string'
import {
  createWardrobeIndex, isWardrobeIndex, validateWardrobeIndex,
  mergeWardrobeIndexes, projectWardrobeCloudIndex, applyWardrobeOperations,
} from './wardrobe-index.js'
import { isLegacyWardrobe, migrateLegacyWardrobe } from './wardrobe-migration.js'
import { measureExtensionQuota } from './extension-quota.js'

const clone = value => JSON.parse(JSON.stringify(value))
const encode = value => LZString.compressToBase64(JSON.stringify(value))
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key)

function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Wardrobe payload must be an object')
  return value
}

function settingSignatures(settings) {
  return new Map(Object.entries(settings || {}).map(([key, value]) => {
    try { return [key, JSON.stringify(value)] } catch { return [key, null] }
  }))
}

export function decodeWardrobePayload(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'object') return requireObject(clone(raw))
  if (typeof raw !== 'string') throw new Error('Invalid wardrobe storage value')
  let parsed
  try { parsed = JSON.parse(raw) } catch { /* Older clients store compressed JSON. */ }
  if (parsed !== undefined) return requireObject(parsed)
  const json = LZString.decompressFromBase64(raw)
  if (!json) throw new Error('Wardrobe data could not be decoded')
  return requireObject(JSON.parse(json))
}

function accountId(player) {
  const id = player?.MemberNumber
  if (!Number.isSafeInteger(id) || id < 0) throw new Error('Log in before saving your wardrobe')
  return String(id)
}

function fingerprint(raw) {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(16)
}

/** Local durable outbox with a game transport that does not acknowledge writes. */
export class WardrobeRepository {
  constructor({ getPlayer, localStorage, send, isOnline = () => true,
    onChange = () => {}, setTimeout: schedule = globalThis.setTimeout,
    clearTimeout: cancel = globalThis.clearTimeout, replicaId = null, random = Math.random } = {}) {
    this.getPlayer = getPlayer
    this.local = localStorage
    this.send = send
    this.isOnline = isOnline
    this.onChange = onChange
    this.schedule = schedule
    this.cancel = cancel
    this.random = random
    this.replicaId = replicaId || globalThis.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random()}`
    this.index = createWardrobeIndex()
    this.member = null
    this.timer = null
    this.attempt = 0
    this.document = null
    this.remoteRaw = undefined
    this.lastObservedHostRaw = undefined
    this.freshRemoteRaw = undefined
    this.submittedRaw = null
    this.freshSettings = null
    this.pendingRemote = null
    this.hostSettingSignatures = new Map()
    this.remoteError = null
    this.quota = null
    this.status = { state: 'idle', localSaved: false, error: '', recoveryAvailable: false,
      lastSubmittedAt: null, lastVerifiedAt: null }
  }

  get key() { return `VPWardrobe_index_${this.member}` }

  emit(patch = {}) {
    this.status = { ...this.status, ...patch,
      recoveryAvailable: (this.document?.recoveryKeys?.length || 0) > 0 }
    this.onChange({ index: this.index, status: this.status, quota: this.quota })
  }

  writeDocument(index, changes = {}) {
    const document = { ...this.document, ...changes, index }
    const result = this.local.setItem(this.key, encode(document))
    if (result === false) throw new Error('Local wardrobe could not be saved')
    this.document = document
    this.index = index
  }

  readDocument() {
    const raw = this.local.getItem(this.key)
    if (!raw) return null
    const document = decodeWardrobePayload(raw)
    validateWardrobeIndex(document?.index)
    return document
  }

  archive(reason, data) {
    const baseKey = `${this.key}_recovery_${fingerprint(data)}`
    let key = baseKey
    let suffix = 0
    // Hashes only name backups; compare their contents before reusing a key.
    while (this.local.getItem(key)) {
      const previous = decodeWardrobePayload(this.local.getItem(key))
      if (equal(previous.data, data)) break
      key = `${baseKey}_${++suffix}`
    }
    if (!this.local.getItem(key)) {
      if (this.local.setItem(key, encode({ reason, data, createdAt: Date.now() })) === false) {
        throw new Error('Migration backup could not be saved')
      }
    }
    this.document.recoveryKeys = [...new Set([...(this.document.recoveryKeys || []), key])]
  }

  legacyLocalSources() {
    const keys = [`VPWardrobe_VPWardrobe_local_${this.member}`, `VPWardrobe_${this.member}`, `VPWardrobe${this.member}`]
    return keys.flatMap(key => {
      const raw = this.local.getItem(key)
      if (!raw) return []
      const value = decodeWardrobePayload(raw)
      if (!isLegacyWardrobe(value)) throw new Error(`Unrecognized legacy wardrobe at ${key}`)
      return [{ key, value, raw }]
    })
  }

  open({ extensionSettings = this.getPlayer()?.ExtensionSettings, fresh = true } = {}) {
    this.cancelPending()
    this.member = null
    this.index = createWardrobeIndex()
    this.document = { index: this.index, pending: false, recoveryKeys: [] }
    this.remoteRaw = undefined
    this.lastObservedHostRaw = this.getPlayer()?.ExtensionSettings?.VPWardrobe
    this.freshRemoteRaw = undefined
    this.submittedRaw = null
    this.freshSettings = null
    this.pendingRemote = null
    this.hostSettingSignatures = new Map()
    this.remoteError = null
    this.quota = null
    this.status = { state: 'idle', localSaved: false, error: '', recoveryAvailable: false,
      lastSubmittedAt: null, lastVerifiedAt: null }
    let committed = false
    try {
      this.member = accountId(this.getPlayer())
      const stored = this.readDocument()
      const raw = extensionSettings?.VPWardrobe
      let online = null
      try { online = decodeWardrobePayload(raw) } catch (error) { this.remoteError = error }
      if (online !== null && !isWardrobeIndex(online) && !isLegacyWardrobe(online)) {
        this.remoteError = new Error('Unrecognized cloud wardrobe; automatic upload stopped')
        online = null
      }
      if (stored) {
        this.document = stored
        this.index = stored.index
      } else {
        const legacy = this.legacyLocalSources()
        // Once the account has an indexed cloud replica, stale unversioned
        // trees are recovery material, never new additions to that index.
        if (isWardrobeIndex(online)) this.index = mergeWardrobeIndexes(createWardrobeIndex(), online)
        else if (legacy.length) this.index = migrateLegacyWardrobe(legacy[0].value)
        else if (isLegacyWardrobe(online)) this.index = migrateLegacyWardrobe(online)
        if (legacy.length || isLegacyWardrobe(online)) {
          this.archive('before-index-migration', { local: legacy, online, onlineRaw: raw })
        }
      }
      if (isWardrobeIndex(online)) this.index = mergeWardrobeIndexes(this.index, online)
      else if (stored && isLegacyWardrobe(online)) this.archive('older-client-cloud-snapshot', { online, onlineRaw: raw })
      this.remoteRaw = raw
      this.observeSettings(extensionSettings, fresh)
      const verified = fresh && isWardrobeIndex(online)
        && equal(projectWardrobeCloudIndex(this.index), projectWardrobeCloudIndex(online))
      this.writeDocument(this.index, { pending: !verified,
        lastVerifiedAt: verified ? Date.now() : this.document.lastVerifiedAt,
        lastVerifiedPayload: verified ? encode(projectWardrobeCloudIndex(this.index)) : this.document.lastVerifiedPayload })
      committed = true
      this.measure()
      this.emit({ localSaved: true, lastSubmittedAt: this.document.lastSubmittedAt || null,
        lastVerifiedAt: this.document.lastVerifiedAt || null,
        state: this.remoteError ? 'error' : this.quota.isOverLimit ? 'quota' : verified ? 'verified' : 'pending',
        error: this.remoteError?.message || '' })
      if (!verified && !this.remoteError && !this.quota.isOverLimit) this.queue()
      return true
    } catch (error) {
      this.emit({ state: 'error', error: error.message, localSaved: committed })
      return committed
    }
  }

  ensureAccount() {
    if (accountId(this.getPlayer()) !== this.member) {
      this.open()
      throw new Error('Account changed; repeat the action in the current wardrobe')
    }
    if (!this.status.localSaved) throw new Error(this.status.error || 'Wardrobe storage is not ready')
  }

  mergeStored() {
    const stored = this.readDocument()
    if (stored) {
      // This is the same device's durable copy, including newer private edits
      // from another tab. It is the local side of the directional cloud merge.
      this.index = mergeWardrobeIndexes(stored.index, this.index)
      const recoveryKeys = [...new Set([...(this.document.recoveryKeys || []), ...(stored.recoveryKeys || [])])]
      const pending = stored.pending || !equal(projectWardrobeCloudIndex(stored.index), projectWardrobeCloudIndex(this.index))
      this.document = { ...stored, pending, recoveryKeys }
    }
  }

  apply(operations) {
    this.ensureAccount()
    const before = this.index
    let committed = false
    try {
      this.mergeStored()
      this.observeHostChanges()
      if (this.remoteError) {
        // A damaged remote replica blocks uploads, but local editing remains
        // available. Never treat the unreadable replica as an empty wardrobe.
        this.cancelPending()
      }
      const next = applyWardrobeOperations(this.index, operations, { replicaId: this.replicaId })
      this.writeDocument(next, { pending: true })
      committed = true
      this.measure()
      this.emit({ state: this.remoteError ? 'error' : this.quota.isOverLimit ? 'quota' : 'pending',
        localSaved: true, error: this.remoteError?.message || '' })
      if (!this.remoteError && !this.quota.isOverLimit) this.queue()
      return next
    } catch (error) {
      this.cancelPending()
      if (committed) {
        this.emit({ state: 'error', error: error.message, localSaved: true })
        return this.index
      }
      this.index = this.document?.index || before
      this.emit({ state: 'error', error: error.message })
      throw error
    }
  }

  observeSettings(extensionSettings, fresh) {
    this.lastObservedHostRaw = this.getPlayer()?.ExtensionSettings?.VPWardrobe
    if (!fresh) return
    this.freshRemoteRaw = extensionSettings?.VPWardrobe
    this.freshSettings = extensionSettings == null ? {} : extensionSettings
    if (typeof this.freshSettings === 'object' && !Array.isArray(this.freshSettings)) {
      this.freshSettings = { ...this.freshSettings }
    }
    this.hostSettingSignatures = settingSignatures(this.getPlayer()?.ExtensionSettings)
  }

  observeHostChanges() {
    if (this.pendingRemote) {
      const observedHostRaw = this.lastObservedHostRaw
      const hostSignatures = this.hostSettingSignatures
      if (!this.receiveCloud({ ...this.pendingRemote, schedule: false })) {
        throw new Error(this.status.error || 'Cloud changes could not be saved locally')
      }
      // Replaying an older observation must not consume a host update that
      // arrived while local storage was unavailable.
      this.lastObservedHostRaw = observedHostRaw
      this.hostSettingSignatures = hostSignatures
    }
    const settings = this.getPlayer()?.ExtensionSettings
    if (settings?.VPWardrobe === this.lastObservedHostRaw) return
    this.receiveCloud({ extensionSettings: settings, fresh: false, schedule: false })
  }

  measure(extensionSettings = this.getPlayer()?.ExtensionSettings) {
    this.quota = null
    const payload = encode(projectWardrobeCloudIndex(this.index))
    const hostQuota = measureExtensionQuota(extensionSettings, payload)
    let conservativeSettings = this.freshSettings
    const signatures = settingSignatures(extensionSettings)
    if (conservativeSettings !== null) {
      if (typeof conservativeSettings !== 'object' || Array.isArray(conservativeSettings)) {
        throw new Error('Fresh extension settings must be an object')
      }
      conservativeSettings = { ...conservativeSettings }
      // A fresh login can precede updates to Player. Retain that server budget
      // until a particular host field actually changes after the observation.
      const keys = new Set([...this.hostSettingSignatures.keys(), ...signatures.keys()])
      for (const key of keys) {
        if (this.hostSettingSignatures.has(key) === signatures.has(key)
          && this.hostSettingSignatures.get(key) === signatures.get(key)) continue
        if (own(extensionSettings, key)) {
          Object.defineProperty(conservativeSettings, key, {
            value: extensionSettings[key], enumerable: true, configurable: true, writable: true,
          })
        }
        else delete conservativeSettings[key]
      }
      const freshQuota = measureExtensionQuota(conservativeSettings, payload)
      this.quota = freshQuota.totalBytes > hostQuota.totalBytes ? freshQuota : hostQuota
    } else this.quota = hostQuota
    this.freshSettings = conservativeSettings
    this.hostSettingSignatures = signatures
    return this.quota
  }

  cancelPending({ resetAttempts = true } = {}) {
    if (this.timer !== null) this.cancel(this.timer)
    this.timer = null
    if (resetAttempts) this.attempt = 0
  }

  queue(delay = 800, { retry = false } = {}) {
    if (this.timer !== null) this.cancel(this.timer)
    if (!retry) this.attempt = 0
    this.timer = this.schedule(() => { this.timer = null; this.flush() }, delay)
  }

  retrySend() {
    if (this.attempt >= 5) return
    const baseDelay = Math.min(30000, 1000 * 2 ** this.attempt)
    this.attempt += 1
    const delay = Math.min(60000, Math.round(baseDelay * (0.8 + 0.4 * this.random())))
    this.queue(delay, { retry: true })
  }

  flush({ force = false } = {}) {
    this.cancelPending({ resetAttempts: force })
    let transportFailed = false
    try {
      this.ensureAccount()
      this.mergeStored()
      this.observeHostChanges()
      if (this.remoteError) throw this.remoteError
      this.writeDocument(this.index)
      this.measure()
      if (this.quota.isOverLimit) {
        this.emit({ state: 'quota', error: '' })
        return false
      }
      if (!this.isOnline()) {
        this.emit({ state: 'offline', error: '' })
        return false
      }
      const payload = encode(projectWardrobeCloudIndex(this.index))
      if (!force && !this.document.pending && payload === this.document.lastVerifiedPayload) {
        this.emit({ state: 'verified', localSaved: true, error: '' })
        return true
      }
      if (!force && payload === this.submittedRaw) {
        this.emit({ state: 'submitted', localSaved: true, error: '' })
        return true
      }
      const player = this.getPlayer()
      const settings = player.ExtensionSettings || (player.ExtensionSettings = {})
      const hadValue = Object.prototype.hasOwnProperty.call(settings, 'VPWardrobe')
      const previous = settings.VPWardrobe
      settings.VPWardrobe = payload
      try {
        if (this.send() === false) throw new Error('The game did not accept the upload')
      } catch (error) {
        if (hadValue) settings.VPWardrobe = previous
        else delete settings.VPWardrobe
        transportFailed = true
        throw error
      }
      this.remoteRaw = payload
      this.lastObservedHostRaw = payload
      this.submittedRaw = payload
      this.attempt = 0
      const time = Date.now()
      // No server acknowledgment exists. Keep the durable outbox pending until
      // a fresh login response verifies it; avoid requeueing the same payload.
      this.writeDocument(this.index, { lastSubmittedPayload: payload, lastSubmittedAt: time })
      this.emit({ state: 'submitted', localSaved: true, error: '', lastSubmittedAt: time })
      return true
    } catch (error) {
      this.emit({ state: 'error', error: error.message })
      if (transportFailed) this.retrySend()
      return false
    }
  }

  receiveCloud({ extensionSettings, fresh = true, memberNumber = this.getPlayer()?.MemberNumber, schedule = true } = {}) {
    let committed = false
    let beforeRemote = null
    try {
      if (String(memberNumber) !== accountId(this.getPlayer())) return false
      if (String(memberNumber) !== this.member) return this.open({ extensionSettings, fresh })
      this.cancelPending()
      const raw = extensionSettings?.VPWardrobe
      this.observeSettings(extensionSettings, fresh)
      let online
      try {
        online = decodeWardrobePayload(raw)
        if (online !== null && !isWardrobeIndex(online) && !isLegacyWardrobe(online)) {
          throw new Error('Unrecognized cloud wardrobe; automatic upload stopped')
        }
      } catch (error) {
        this.pendingRemote = null
        this.remoteError = error
        throw error
      }
      this.remoteError = null
      this.pendingRemote = { extensionSettings: { ...extensionSettings }, fresh, memberNumber }
      this.mergeStored()
      beforeRemote = { index: this.index, document: { ...this.document } }
      if (isWardrobeIndex(online)) this.index = mergeWardrobeIndexes(this.index, online)
      else if (isLegacyWardrobe(online)) this.archive('older-client-cloud-snapshot', { online, onlineRaw: raw })
      this.remoteRaw = raw
      const payload = encode(projectWardrobeCloudIndex(this.index))
      const freshMatch = fresh && isWardrobeIndex(online)
        && equal(projectWardrobeCloudIndex(this.index), projectWardrobeCloudIndex(online))
      const verified = freshMatch || (!fresh && !this.document.pending && payload === this.document.lastVerifiedPayload)
      // A fresh mismatch is evidence that an unacknowledged earlier send was
      // lost. It permits retransmission even if the local payload is unchanged.
      if (fresh && !freshMatch) this.submittedRaw = null
      this.writeDocument(this.index, { pending: !verified,
        lastVerifiedAt: freshMatch ? Date.now() : this.document.lastVerifiedAt,
        lastVerifiedPayload: freshMatch ? payload : this.document.lastVerifiedPayload })
      committed = true
      this.pendingRemote = null
      this.measure()
      let state = verified ? 'verified' : 'pending'
      if (!verified && payload === this.submittedRaw) state = 'submitted'
      if (this.quota.isOverLimit) state = 'quota'
      this.emit({ state, localSaved: true, error: '',
        lastVerifiedAt: this.document.lastVerifiedAt || null })
      if (schedule && !verified && payload !== this.submittedRaw && !this.quota.isOverLimit) this.queue()
      return true
    } catch (error) {
      this.cancelPending()
      if (!committed && beforeRemote) {
        this.index = beforeRemote.index
        this.document = beforeRemote.document
      }
      this.emit({ state: 'error', error: error.message,
        localSaved: committed || this.status.localSaved })
      return committed
    }
  }

  exportRecovery() {
    return (this.document?.recoveryKeys || []).map(key => ({ key, ...decodeWardrobePayload(this.local.getItem(key)) }))
  }
}
