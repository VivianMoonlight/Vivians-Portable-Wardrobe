import LZString from 'lz-string'
import {
  createWardrobeIndex, isWardrobeIndex, validateWardrobeIndex,
  mergeWardrobeIndexes, projectWardrobeCloudIndex, applyWardrobeOperations,
} from './wardrobe-index.js'
import { isLegacyWardrobe, migrateLegacyWardrobe } from './wardrobe-migration.js'
import { measureExtensionQuota, measureObservedExtensionQuota } from './extension-quota.js'
import {
  getOrCreateWardrobeDeviceId, generateWardrobeDeviceId, markerKeyForDevice, createWardrobeSyncMarker,
  encodeWardrobeSyncMarker, decodeWardrobeSyncMarker, readWardrobeSyncMarkers,
  findUnappliedWardrobeMarkers, MAX_WARDROBE_DEVICE_MARKERS,
} from './wardrobe-sync-marker.js'
import { mergeWardrobeIndexesThreeWay, resolveWardrobeConflicts } from './wardrobe-three-way.js'

const clone = value => JSON.parse(JSON.stringify(value))
const encode = value => LZString.compressToBase64(JSON.stringify(value))
const LOCAL_PAYLOAD_PREFIX = 'VPW-LZ16:'
const encodeLocal = value => LOCAL_PAYLOAD_PREFIX + LZString.compressToUTF16(JSON.stringify(value))
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key)
const V4_PROTOCOL = 'VPW4'

function storageError(error, indexed = false) {
  if (error?.name !== 'QuotaExceededError' && error?.code !== 22 && error?.code !== 1014) return error
  return Object.assign(new Error(indexed ? 'Browser rejected the local wardrobe database write'
    : 'Browser rejected the local wardrobe write'),
  { code: indexed ? 'indexeddb-quota' : 'local-storage-quota', cause: error })
}

function maxAppliedSequences(base, extra) {
  const result = { ...base }
  for (const [id, sequence] of Object.entries(extra || {})) {
    result[id] = Math.max(result[id] || 0, sequence)
  }
  return result
}

function markerSignature(settings) {
  return JSON.stringify(Object.entries(settings || {})
    .filter(([key]) => key.startsWith('VPW4_M_'))
    .sort(([left], [right]) => left.localeCompare(right)))
}

function cloudEnvelope(index, applied = {}) {
  return { protocol: V4_PROTOCOL, index: projectWardrobeCloudIndex(index), a: { ...applied } }
}

function cloudSnapshot(raw) {
  const decoded = decodeWardrobePayload(raw)
  if (decoded === null) return { kind: 'empty', index: createWardrobeIndex(), a: {} }
  if (decoded.protocol === V4_PROTOCOL) {
    validateWardrobeIndex(decoded.index)
    if (!decoded.a || typeof decoded.a !== 'object' || Array.isArray(decoded.a)) {
      throw new Error('Invalid wardrobe cloud receipts')
    }
    return { kind: 'v4', index: projectWardrobeCloudIndex(decoded.index), a: decoded.a }
  }
  if (isWardrobeIndex(decoded)) return { kind: 'v3', index: projectWardrobeCloudIndex(decoded), a: {} }
  if (isLegacyWardrobe(decoded)) return { kind: 'legacy', index: migrateLegacyWardrobe(decoded), a: {} }
  throw new Error('Unrecognized cloud wardrobe; automatic upload stopped')
}

function quarantineCloudContent(merged, local) {
  const result = clone(merged)
  result.outfits = Object.fromEntries(Object.entries(result.outfits)
    .filter(([id]) => local.cloudState[id]?.enabled === false))
  const privateTagIds = new Set(Object.values(result.outfits).flatMap(outfit => outfit.tagIds))
  result.tags = Object.fromEntries(Object.entries(result.tags)
    .filter(([id]) => privateTagIds.has(id)))
  return result
}

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
  if (raw.startsWith(LOCAL_PAYLOAD_PREFIX)) {
    const json = LZString.decompressFromUTF16(raw.slice(LOCAL_PAYLOAD_PREFIX.length))
    if (!json) throw new Error('Wardrobe data could not be decoded')
    return requireObject(JSON.parse(json))
  }
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
  constructor({ getPlayer, localStorage, persistence = null, send, isOnline = () => true,
    canWrite = () => true,
    onChange = () => {}, setTimeout: schedule = globalThis.setTimeout,
    clearTimeout: cancel = globalThis.clearTimeout, replicaId = null, random = Math.random } = {}) {
    this.getPlayer = getPlayer
    this.local = localStorage
    this.persistence = persistence
    this.send = send
    this.isOnline = isOnline
    this.canWrite = canWrite
    this.onChange = onChange
    this.schedule = schedule
    this.cancel = cancel
    this.random = random
    this.replicaId = replicaId || globalThis.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random()}`
    this.deviceId = null
    this.markerKey = null
    this.index = createWardrobeIndex()
    this.member = null
    this.timer = null
    this.attempt = 0
    this.document = null
    this.remoteRaw = undefined
    this.lastObservedHostRaw = undefined
    this.lastObservedMarkerSignature = '[]'
    this.freshRemoteRaw = undefined
    this.freshCloudObserved = false
    this.verifiedPayloadInSession = null
    this.provisionalCloudPayload = null
    this.sessionLocalEdit = false
    this.submittedRaw = null
    this.freshSettings = null
    this.lastFreshSettings = null
    this.pendingRemote = null
    this.hostSettingSignatures = new Map()
    this.remoteError = null
    this.quota = null
    this.localRecoveryKeysOnDisk = new Set()
    this.unrecognizedLocalDocumentKey = null
    this.rawLegacySourceKeys = new Set()
    this.status = { state: 'idle', localSaved: false, error: '', conflicts: [], recoveryAvailable: false,
      lastSubmittedAt: null, lastVerifiedAt: null }
    this.operationTail = Promise.resolve()
  }

  get key() { return `VPWardrobe_index_${this.member}` }

  serialize(operation) {
    const result = this.operationTail.then(operation, operation)
    this.operationTail = result.catch(() => {})
    return result
  }

  ensureWriter() {
    if (accountId(this.getPlayer()) !== this.member || !this.canWrite(this.member)) {
      throw new Error('Wardrobe account or writer tab changed; reopen before saving')
    }
  }

  async database(operation) {
    try { return await operation() }
    catch (error) {
      if (error?.code === 'indexeddb-error' || error?.code === 'indexeddb-quota') throw error
      const quota = storageError(error, true)
      if (quota !== error) throw quota
      throw Object.assign(new Error(error?.message || 'Local wardrobe database failed'),
        { code: 'indexeddb-error', cause: error })
    }
  }

  hasSubmittedCurrentIndex() {
    const submission = this.document?.submission
    return submission?.submittedAt != null && submission.payload === this.document.lastSubmittedPayload
      && submission.projectionJson === JSON.stringify(canonical(projectWardrobeCloudIndex(this.index)))
  }

  emit(patch = {}) {
    if (patch.state && patch.state !== 'error') patch.errorCode = null
    this.status = { ...this.status, ...patch,
      recoveryAvailable: (this.document?.recoveryKeys?.length || 0) > 0
        || this.localRecoveryKeysOnDisk.size > 0 || this.unrecognizedLocalDocumentKey !== null
        || this.rawLegacySourceKeys.size > 0 }
    this.onChange({ index: this.index, status: this.status, quota: this.quota })
  }

  persistLocalPayload(key, value) {
    const compact = encodeLocal(value)
    const previous = this.local.getItem(key)
    if (previous === compact) return
    const write = encoded => {
      let result
      try { result = this.local.setItem(key, encoded) } catch (error) { throw storageError(error) }
      if (result === false) throw new Error('Local wardrobe could not be saved')
    }
    try { write(compact) }
    catch (error) {
      if (error.code !== 'local-storage-quota') throw error
      // Quota accounting varies; Base64 can be smaller in byte-counted stores.
      const base64 = encode(value)
      if (previous !== base64) write(base64)
    }
  }

  async writeDocument(index, changes = {}) {
    this.ensureWriter()
    const document = { ...this.document, ...changes, index }
    if (this.persistence) await this.database(() => this.persistence.write(this.member, document))
    else this.persistLocalPayload(this.key, document)
    this.ensureWriter()
    this.document = document
    this.index = index
  }

  async writeDocumentWithArchive(index, changes, reason, data) {
    if (!this.persistence) {
      await this.archive(reason, data)
      return this.writeDocument(index, changes)
    }
    this.ensureWriter()
    const desiredKey = `${this.key}_recovery_${fingerprint(data)}`
    const document = { ...this.document, ...changes, index }
    const result = await this.database(() => this.persistence.writeWithArchive(this.member,
      document, desiredKey, { reason, data, createdAt: Date.now() }))
    this.ensureWriter()
    this.document = result.document
    this.index = index
  }

  async readDocument(raw) {
    const document = this.persistence && raw === undefined
      ? await this.database(() => this.persistence.read(this.member))
      : decodeWardrobePayload(raw === undefined ? this.local.getItem(this.key) : raw)
    if (!document) return null
    validateWardrobeIndex(document?.index)
    if (document.baseCloudIndex) validateWardrobeIndex(document.baseCloudIndex)
    if (document.recoveryKeys !== undefined
      && (!Array.isArray(document.recoveryKeys)
        || document.recoveryKeys.some(key => typeof key !== 'string'))) {
      throw new Error('Invalid local wardrobe recovery keys')
    }
    for (const entry of document.submittedVersions || []) {
      if (!Number.isSafeInteger(entry.sequence) || entry.sequence < 0) {
        throw new Error('Invalid local wardrobe submission sequence')
      }
      validateWardrobeIndex(entry.index)
    }
    return document
  }

  compactLocalPayload(key, raw, value) {
    if (typeof raw !== 'string' || raw.startsWith(LOCAL_PAYLOAD_PREFIX)) return
    const compact = encodeLocal(value)
    if (compact.length >= raw.length || this.local.getItem(key) !== raw) return
    let result
    try { result = this.local.setItem(key, compact) } catch (error) { throw storageError(error) }
    if (result === false) throw new Error('Local wardrobe could not be saved')
  }

  compactRecoveryArchives(keys) {
    if (!Array.isArray(keys)) return
    for (const key of keys) {
      if (typeof key !== 'string' || !key.startsWith(`${this.key}_recovery_`)) continue
      try {
        const raw = this.local.getItem(key)
        if (!raw || raw.startsWith(LOCAL_PAYLOAD_PREFIX)) continue
        const backup = decodeWardrobePayload(raw)
        if (typeof backup.reason !== 'string' || !own(backup, 'data')) continue
        this.compactLocalPayload(key, raw, backup)
      } catch { /* Keep an unreadable or unwritable recovery archive untouched. */ }
    }
  }

  async archive(reason, data) {
    this.ensureWriter()
    const baseKey = `${this.key}_recovery_${fingerprint(data)}`
    if (this.persistence) {
      const key = await this.database(() => this.persistence.archive(this.member, baseKey,
        { reason, data, createdAt: Date.now() }))
      this.ensureWriter()
      this.document = { ...this.document,
        recoveryKeys: [...new Set([...(this.document.recoveryKeys || []), key])] }
      return
    }
    let key = baseKey
    let suffix = 0
    // Hashes only name backups; compare their contents before reusing a key.
    while (this.local.getItem(key)) {
      const previous = decodeWardrobePayload(this.local.getItem(key))
      if (equal(previous.data, data)) break
      key = `${baseKey}_${++suffix}`
    }
    if (!this.local.getItem(key)) {
      this.persistLocalPayload(key, { reason, data, createdAt: Date.now() })
    }
    this.document = { ...this.document,
      recoveryKeys: [...new Set([...(this.document.recoveryKeys || []), key])] }
  }

  legacySourceKeys() {
    return [`VPWardrobe_VPWardrobe_local_${this.member}`, `VPWardrobe_${this.member}`, `VPWardrobe${this.member}`]
  }

  legacyLocalSources({ tolerateInvalid = false } = {}) {
    return this.legacySourceKeys().flatMap(key => {
      const raw = this.local.getItem(key)
      if (!raw) return []
      try {
        const value = decodeWardrobePayload(raw)
        if (!isLegacyWardrobe(value)) throw new Error(`Unrecognized legacy wardrobe at ${key}`)
        return [{ key, value, raw }]
      } catch (error) {
        if (tolerateInvalid) return []
        throw error
      }
    })
  }

  localRecoveryKeys(referenced = []) {
    const prefix = `${this.key}_recovery_`
    const keys = new Set(referenced.filter(key => typeof key === 'string' && key.startsWith(prefix)))
    if (typeof this.local.length !== 'number' || typeof this.local.key !== 'function') return [...keys]
    for (let index = 0; index < this.local.length; index++) {
      const key = this.local.key(index)
      if (typeof key === 'string' && key.startsWith(prefix)) keys.add(key)
    }
    return [...keys]
  }

  open(options) { return this.serialize(() => this.openNow(options)) }

  async openNow({ extensionSettings = this.getPlayer()?.ExtensionSettings, fresh = false } = {}) {
    this.cancelPending()
    this.member = null
    this.deviceId = null
    this.markerKey = null
    this.index = createWardrobeIndex()
    this.document = { index: this.index, pending: false, recoveryKeys: [],
      baseCloudIndex: null, baseCloudSequence: 0, baseAppliedSeq: {}, submittedVersions: [],
      conflicts: [] }
    this.remoteRaw = undefined
    this.lastObservedHostRaw = this.getPlayer()?.ExtensionSettings?.VPWardrobe
    this.lastObservedMarkerSignature = markerSignature(this.getPlayer()?.ExtensionSettings)
    this.freshRemoteRaw = undefined
    this.freshCloudObserved = false
    this.verifiedPayloadInSession = null
    this.provisionalCloudPayload = null
    this.sessionLocalEdit = false
    this.submittedRaw = null
    this.freshSettings = null
    this.lastFreshSettings = null
    this.pendingRemote = null
    this.hostSettingSignatures = new Map()
    this.remoteError = null
    this.quota = null
    this.localRecoveryKeysOnDisk = new Set()
    this.unrecognizedLocalDocumentKey = null
    this.rawLegacySourceKeys = new Set()
    this.status = { state: 'idle', localSaved: false, error: '', conflicts: [], recoveryAvailable: false,
      lastSubmittedAt: null, lastVerifiedAt: null }
    let committed = false
    try {
      this.member = accountId(this.getPlayer())
      if (extensionSettings != null) {
        try {
          const observed = measureObservedExtensionQuota(extensionSettings)
          this.quota = { ...observed, observed, observedSource: fresh ? 'login-response' : 'player-cache',
            packetBytes: 0, proposalAvailable: false }
        } catch { /* A malformed cloud setting must not hide the saved local index. */ }
      }
      const storedRaw = this.local.getItem(this.key)
      this.unrecognizedLocalDocumentKey = storedRaw ? this.key : null
      this.localRecoveryKeysOnDisk = new Set(this.localRecoveryKeys()
        .filter(key => this.local.getItem(key) !== null))
      this.rawLegacySourceKeys = new Set(this.legacySourceKeys()
        .filter(key => this.local.getItem(key) !== null))
      let localDocument = null
      let localError = null
      try { localDocument = await this.readDocument(storedRaw) }
      catch (error) { localError = error }
      if (localDocument) {
        this.document = localDocument
        this.index = localDocument.index
      }
      let stored = this.persistence ? await this.readDocument() : localDocument
      if (stored) {
        this.document = stored
        this.index = stored.index
      }
      if (this.persistence) {
        const legacyEntries = []
        const archives = []
        for (const key of this.localRecoveryKeys([
          ...(stored?.recoveryKeys || []), ...(localDocument?.recoveryKeys || []),
        ])) {
          const raw = this.local.getItem(key)
          if (!raw) continue
          this.localRecoveryKeysOnDisk.add(key)
          try {
            const record = decodeWardrobePayload(raw)
            if (typeof record.reason !== 'string' || !own(record, 'data')) {
              continue
            }
            archives.push({ key, record })
            legacyEntries.push({ key, raw })
          } catch { /* Leave the raw key available for recovery export. */ }
        }
        if (localError && !stored) throw localError
        if (localError && stored && storedRaw) this.unrecognizedLocalDocumentKey = this.key
        if (localDocument || archives.length) {
          this.ensureWriter()
          const migrated = await this.database(() => this.persistence.migrate(this.member,
            { document: localDocument, archives }))
          this.ensureWriter()
          stored = migrated.document
          if (localDocument) legacyEntries.push({ key: this.key, raw: storedRaw })
          this.persistence.removeLegacyKeysIfUnchanged(this.local, legacyEntries)
        }
      } else if (localError) throw localError
      let legacySources = []
      if (this.persistence) {
        legacySources = this.legacyLocalSources({ tolerateInvalid: true })
      }
      if (stored) {
        this.document = stored
        this.index = stored.index
        if (!this.persistence) {
          // Preserve the older localStorage path for existing direct repository clients.
          try { this.compactLocalPayload(this.key, storedRaw, stored) }
          catch { /* An unchanged legacy document remains readable if compaction is refused. */ }
          this.compactRecoveryArchives(stored.recoveryKeys)
        }
        if (legacySources.length) {
          await this.archive('legacy-local-source', {
            local: legacySources.map(({ key, raw }) => ({ key, raw })) })
        }
      }
      if (this.persistence) {
        const archives = await this.database(() => this.persistence.listArchives(this.member))
        this.document = { ...this.document, recoveryKeys: [...new Set([
          ...(this.document.recoveryKeys || []), ...archives.map(({ key }) => key),
        ])] }
      }
      if (this.persistence) {
        let oldDeviceId = this.local.getItem(`VPW4_device_${this.member}`)
        try { if (oldDeviceId !== null) markerKeyForDevice(oldDeviceId) }
        catch { oldDeviceId = null /* Keep the malformed legacy key untouched. */ }
        this.ensureWriter()
        this.deviceId = await this.database(() => this.persistence.getOrCreateMeta(this.member, 'deviceId',
          () => oldDeviceId || generateWardrobeDeviceId()))
        this.ensureWriter()
      } else this.deviceId = getOrCreateWardrobeDeviceId(this.local, Number(this.member))
      this.markerKey = markerKeyForDevice(this.deviceId)
      const raw = extensionSettings?.VPWardrobe
      let online = null
      try { online = cloudSnapshot(raw) } catch (error) { this.remoteError = error }
      if (!stored) {
        const legacy = this.persistence ? legacySources : this.legacyLocalSources()
        if (online?.kind === 'v4' || online?.kind === 'v3') this.index = online.index
        else if (legacy.length) this.index = migrateLegacyWardrobe(legacy[0].value)
        else if (online?.kind === 'legacy') this.index = online.index
        if (legacy.length || online?.kind === 'legacy' || online?.kind === 'v3') {
          await this.archive('before-v4-migration', { local: this.persistence
            ? legacy.map(({ key, raw }) => ({ key, raw })) : legacy, onlineRaw: raw })
        }
        this.document.baseCloudIndex = online?.index || null
        this.document.baseAppliedSeq = online?.a || {}
        this.document.baseCloudSequence = online?.a?.[this.deviceId] || 0
      }
      if (stored?.protocolVersion === 4 && online && online.kind !== 'v4' && online.kind !== 'empty') {
        await this.archive('older-client-cloud-snapshot', { onlineRaw: raw })
        this.remoteError = new Error('Older client replaced the v4 cloud snapshot; automatic upload stopped')
      }
      this.remoteRaw = raw
      if (!fresh && online) this.provisionalCloudPayload = raw
      this.observeSettings(extensionSettings, fresh)
      const changes = { pending: this.document.pending || online?.kind !== 'v4',
        protocolVersion: this.document.protocolVersion || (online?.kind === 'v4' ? 4 : undefined) }
      const nextDocument = { ...this.document, ...changes, index: this.index }
      if (stored && (this.persistence || this.local.getItem(this.key) === storedRaw)
        && equal(stored, nextDocument)) {
        this.document = nextDocument
      } else await this.writeDocument(this.index, changes)
      this.ensureWriter()
      if (this.persistence) this.persistence.removeLegacyKeysIfUnchanged(this.local,
        legacySources.map(({ key, raw }) => ({ key, raw })))
      this.unrecognizedLocalDocumentKey = this.local.getItem(this.key) ? this.key : null
      this.localRecoveryKeysOnDisk = new Set(this.localRecoveryKeys()
        .filter(key => this.local.getItem(key) !== null))
      this.rawLegacySourceKeys = new Set(this.legacySourceKeys()
        .filter(key => this.local.getItem(key) !== null))
      committed = true
      this.measure()
      this.emit({ localSaved: true, lastSubmittedAt: this.document.lastSubmittedAt || null,
        lastVerifiedAt: this.document.lastVerifiedAt || null,
        state: this.remoteError ? 'error' : this.document.conflicts?.length ? 'conflict'
          : this.quota.isOverLimit ? 'quota' : this.hasSubmittedCurrentIndex() ? 'submitted' : 'pending',
        conflicts: this.document.conflicts || [], error: this.remoteError?.message || '' })
      if (fresh && !this.remoteError) return await this.receiveCloudNow({ extensionSettings, fresh: true })
      return true
    } catch (error) {
      const reported = storageError(error, !!this.persistence)
      this.emit({ state: 'error', error: reported.message, errorCode: reported.code || null,
        localSaved: committed })
      return committed
    }
  }

  async ensureAccount() {
    if (accountId(this.getPlayer()) !== this.member) {
      await this.openNow()
      throw new Error('Account changed; repeat the action in the current wardrobe')
    }
    if (!this.status.localSaved) throw new Error(this.status.error || 'Wardrobe storage is not ready')
  }

  async mergeStored() {
    const stored = await this.readDocument()
    this.ensureWriter()
    if (stored) {
      // This is the same device's durable copy, including newer private edits
      // from another tab. It is the local side of the directional cloud merge.
      this.index = mergeWardrobeIndexes(stored.index, this.index, { bothLocal: true })
      const recoveryKeys = [...new Set([...(this.document.recoveryKeys || []), ...(stored.recoveryKeys || [])])]
      const pending = stored.pending || !equal(projectWardrobeCloudIndex(stored.index), projectWardrobeCloudIndex(this.index))
      this.document = { ...stored, pending, recoveryKeys }
    }
  }

  apply(operations) { return this.serialize(() => this.applyNow(operations)) }

  async applyNow(operations) {
    await this.ensureAccount()
    const before = this.index
    let committed = false
    try {
      await this.mergeStored()
      await this.observeHostChanges()
      if (this.remoteError) {
        // A damaged remote replica blocks uploads, but local editing remains
        // available. Never treat the unreadable replica as an empty wardrobe.
        this.cancelPending()
      }
      const context = this.document.conflictContext
      const local = context
        ? applyWardrobeOperations(context.local, operations, { replicaId: this.replicaId })
        : null
      const rawResult = context
        ? mergeWardrobeIndexesThreeWay(context.base, local, context.guardedRemote,
          { replicaId: this.replicaId }) : null
      const editedIds = new Set(operations.map(operation => operation.id).filter(Boolean))
      const resolvedChoices = (context?.resolvedChoices || [])
        .filter(choice => !editedIds.has(choice.id)
          && rawResult.conflicts.some(conflict => conflict.kind === choice.kind
            && conflict.id === choice.id && conflict.field === choice.field))
      const result = rawResult && resolvedChoices.length
        ? resolveWardrobeConflicts(rawResult, resolvedChoices, { replicaId: this.replicaId })
        : rawResult
      const conflicts = context
        ? [...result.conflicts, ...this.document.conflicts.filter(conflict => conflict.type === 'missing-device')]
        : this.document.conflicts || []
      const next = result ? clone(result.merged)
        : applyWardrobeOperations(this.index, operations, { replicaId: this.replicaId })
      const visible = conflicts.some(conflict => conflict.type === 'missing-device')
        ? quarantineCloudContent(next, local) : next
      const pending = this.document.pending || !equal(projectWardrobeCloudIndex(next),
        projectWardrobeCloudIndex(this.index))
      await this.writeDocument(visible, { pending, conflicts,
        conflictContext: context ? { ...context, local, result, resolvedChoices } : null })
      committed = true
      this.sessionLocalEdit = true
      this.measure()
      this.emit({ state: this.remoteError ? 'error' : this.document.conflicts?.length ? 'conflict'
        : this.quota.isOverLimit ? 'quota'
          : pending ? 'pending' : this.freshCloudObserved ? 'verified' : 'pending',
        conflicts: this.document.conflicts || [], localSaved: true, error: this.remoteError?.message || '' })
      if (pending && !this.remoteError && !this.document.conflicts?.length && !this.quota.isOverLimit) this.queue()
      return visible
    } catch (error) {
      const reported = storageError(error, !!this.persistence)
      this.cancelPending()
      if (committed) {
        this.emit({ state: 'error', error: reported.message, errorCode: reported.code || null,
          localSaved: true })
        return this.index
      }
      this.index = this.document?.index || before
      this.emit({ state: 'error', error: reported.message, errorCode: reported.code || null })
      throw reported
    }
  }

  observeSettings(extensionSettings, fresh) {
    this.lastObservedHostRaw = this.getPlayer()?.ExtensionSettings?.VPWardrobe
    this.lastObservedMarkerSignature = markerSignature(this.getPlayer()?.ExtensionSettings)
    if (!fresh) return
    this.freshRemoteRaw = extensionSettings?.VPWardrobe
    try { this.lastFreshSettings = extensionSettings == null ? {} : clone(extensionSettings) }
    catch { this.lastFreshSettings = extensionSettings }
    this.freshSettings = this.lastFreshSettings
    if (typeof this.freshSettings === 'object' && !Array.isArray(this.freshSettings)) {
      this.freshSettings = { ...this.freshSettings }
    }
    this.hostSettingSignatures = settingSignatures(this.getPlayer()?.ExtensionSettings)
  }

  async observeHostChanges() {
    if (this.pendingRemote) {
      const observedHostRaw = this.lastObservedHostRaw
      const hostSignatures = this.hostSettingSignatures
      if (!await this.receiveCloudNow({ ...this.pendingRemote, schedule: false })) {
        throw new Error(this.status.error || 'Cloud changes could not be saved locally')
      }
      // Replaying an older observation must not consume a host update that
      // arrived while local storage was unavailable.
      this.lastObservedHostRaw = observedHostRaw
      this.hostSettingSignatures = hostSignatures
    }
    const settings = this.getPlayer()?.ExtensionSettings
    if (settings?.VPWardrobe === this.lastObservedHostRaw
      && markerSignature(settings) === this.lastObservedMarkerSignature) return
    await this.receiveCloudNow({ extensionSettings: settings, fresh: false, schedule: false })
  }

  proposal(settings = this.freshSettings || this.getPlayer()?.ExtensionSettings || {}) {
    const projection = projectWardrobeCloudIndex(this.index)
    const projectionJson = JSON.stringify(canonical(projection))
    const baseJson = JSON.stringify(canonical(this.document.baseCloudIndex || createWardrobeIndex()))
    const appliedJson = JSON.stringify(canonical(this.document.baseAppliedSeq || {}))
    const markers = readWardrobeSyncMarkers(settings)
    const registered = new Set([...markers.keys(), ...Object.keys(this.document.baseAppliedSeq || {})])
    if (registered.size > MAX_WARDROBE_DEVICE_MARKERS
      || (!registered.has(this.deviceId) && registered.size >= MAX_WARDROBE_DEVICE_MARKERS)) {
      throw Object.assign(new Error(`Cloud wardrobe has reached its ${MAX_WARDROBE_DEVICE_MARKERS}-device marker limit`),
        { code: 'device-limit' })
    }
    const prior = this.document.submission
    if (prior && prior.projectionJson === projectionJson && prior.baseJson === baseJson
      && prior.appliedJson === appliedJson
      && prior.marker?.s >= (markers.get(this.deviceId)?.s || 0)) {
      return { ...prior, marker: decodeWardrobeSyncMarker(prior.markerValue) }
    }
    const existing = markers.get(this.deviceId) || createWardrobeSyncMarker()
    const sequence = Math.max(existing.s, this.document.markerSequence || 0,
      this.document.baseAppliedSeq?.[this.deviceId] || 0) + 1
    const marker = createWardrobeSyncMarker({ sequence })
    const markerValue = encodeWardrobeSyncMarker(marker)
    const applied = { ...(this.document.baseAppliedSeq || {}), [this.deviceId]: sequence }
    const payload = encode(cloudEnvelope(this.index, applied))
    return { payload, markerValue, marker, projectionJson, baseJson, appliedJson }
  }

  measure(extensionSettings = this.getPlayer()?.ExtensionSettings) {
    const observed = measureObservedExtensionQuota(this.lastFreshSettings ?? extensionSettings)
    const observedSource = this.lastFreshSettings === null ? 'player-cache' : 'login-response'
    this.quota = { ...observed, packetBytes: 0, isWarning: false, isOverLimit: false,
      observed, observedSource, proposalAvailable: false }
    const { payload, markerValue } = this.proposal()
    const options = { markerKey: this.markerKey, markerValue }
    const hostQuota = measureExtensionQuota(extensionSettings, payload, options)
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
      const freshQuota = measureExtensionQuota(conservativeSettings, payload, options)
      this.quota = freshQuota.totalBytes > hostQuota.totalBytes ? freshQuota : hostQuota
    } else this.quota = hostQuota
    this.quota.observed = observed
    this.quota.observedSource = observedSource
    this.quota.proposalAvailable = true
    this.freshSettings = conservativeSettings
    this.hostSettingSignatures = signatures
    return this.quota
  }

  cancelPending({ resetAttempts = true } = {}) {
    if (this.timer !== null) this.cancel(this.timer)
    this.timer = null
    if (resetAttempts) this.attempt = 0
  }

  invalidateFreshness() {
    this.cancelPending()
    this.freshCloudObserved = false
    this.verifiedPayloadInSession = null
    this.submittedRaw = null
    const state = ['verified', 'submitted'].includes(this.status.state) ? 'pending' : this.status.state
    this.emit({ state })
  }

  queue(delay = 800, { retry = false } = {}) {
    if (this.timer !== null) this.cancel(this.timer)
    if (!retry) this.attempt = 0
    this.timer = this.schedule(() => { this.timer = null; return this.flush() }, delay)
  }

  retrySend() {
    if (this.attempt >= 5) return
    const baseDelay = Math.min(30000, 1000 * 2 ** this.attempt)
    this.attempt += 1
    const delay = Math.min(60000, Math.round(baseDelay * (0.8 + 0.4 * this.random())))
    this.queue(delay, { retry: true })
  }

  flush(options) { return this.serialize(() => this.flushNow(options)) }

  async flushNow({ force = false } = {}) {
    this.cancelPending({ resetAttempts: force })
    let transportFailed = false
    try {
      await this.ensureAccount()
      await this.mergeStored()
      await this.observeHostChanges()
      if (this.remoteError) throw this.remoteError
      if (this.document.conflicts?.length) {
        this.emit({ state: 'conflict', conflicts: this.document.conflicts, error: '' })
        return false
      }
      await this.writeDocument(this.index)
      this.measure()
      if (this.quota.isOverLimit) {
        this.emit({ state: 'quota', error: '' })
        return false
      }
      if (!this.isOnline()) {
        this.emit({ state: 'offline', error: '' })
        return false
      }
      if (!this.freshCloudObserved) {
        this.emit({ state: 'pending', localSaved: true, error: '' })
        return false
      }
      if (!this.document.pending && this.verifiedPayloadInSession === this.freshRemoteRaw) {
        this.emit({ state: 'verified', localSaved: true, error: '' })
        return true
      }
      const proposal = this.proposal()
      const { payload, markerValue } = proposal
      if (!force && payload === this.submittedRaw) {
        if (this.document.submission?.submittedAt == null) {
          const time = Date.now()
          await this.writeDocument(this.index, { lastSubmittedPayload: payload, lastSubmittedAt: time,
            submission: { ...proposal, submittedAt: time } })
        }
        this.emit({ state: 'submitted', localSaved: true, error: '',
          lastSubmittedAt: this.document.lastSubmittedAt || null })
        return true
      }
      const player = this.getPlayer()
      const settings = player.ExtensionSettings || (player.ExtensionSettings = {})
      const hadValue = own(settings, 'VPWardrobe')
      const hadMarker = own(settings, this.markerKey)
      const previous = settings.VPWardrobe
      const previousMarker = settings[this.markerKey]
      const previousMarkerSignature = markerSignature(settings)
      const submittedVersions = [...(this.document.submittedVersions || [])
        .filter(entry => entry.sequence !== proposal.marker.s),
      { sequence: proposal.marker.s, index: projectWardrobeCloudIndex(this.index) }].slice(-8)
      await this.writeDocument(this.index, { pending: true, protocolVersion: 4,
        markerSequence: proposal.marker.s, submittedVersions,
        submission: { ...proposal, submittedAt: null } })
      this.ensureWriter()
      if (this.getPlayer() !== player || player.ExtensionSettings !== settings
        || settings.VPWardrobe !== previous
        || markerSignature(settings) !== previousMarkerSignature) {
        this.invalidateFreshness()
        throw new Error('Wardrobe host session changed before upload; sign in again to reconcile')
      }
      settings.VPWardrobe = payload
      settings[this.markerKey] = markerValue
      try {
        const fields = { 'ExtensionSettings.VPWardrobe': payload,
          [`ExtensionSettings.${this.markerKey}`]: markerValue }
        this.ensureWriter()
        if (await this.send(fields, this.member) === false) throw new Error('The game did not accept the upload')
      } catch (error) {
        if (hadValue) settings.VPWardrobe = previous
        else delete settings.VPWardrobe
        if (hadMarker) settings[this.markerKey] = previousMarker
        else delete settings[this.markerKey]
        transportFailed = true
        throw error
      }
      this.remoteRaw = payload
      this.lastObservedHostRaw = payload
      this.lastObservedMarkerSignature = markerSignature(settings)
      this.submittedRaw = payload
      this.attempt = 0
      const time = Date.now()
      await this.writeDocument(this.index, { lastSubmittedPayload: payload, lastSubmittedAt: time,
        submission: { ...proposal, submittedAt: time } })
      this.emit({ state: 'submitted', localSaved: true, error: '', lastSubmittedAt: time })
      return true
    } catch (error) {
      const reported = storageError(error, !!this.persistence)
      this.emit({ state: 'error', error: reported.message, errorCode: reported.code || null })
      if (transportFailed) this.retrySend()
      return false
    }
  }

  receiveCloud(event) { return this.serialize(() => this.receiveCloudNow(event)) }

  async receiveCloudNow({ extensionSettings, fresh = false, memberNumber = this.getPlayer()?.MemberNumber, schedule = true } = {}) {
    let committed = false
    let beforeRemote = null
    try {
      if (String(memberNumber) !== accountId(this.getPlayer())) return false
      if (String(memberNumber) !== this.member) return await this.openNow({ extensionSettings, fresh })
      this.cancelPending()
      const raw = extensionSettings?.VPWardrobe
      const previousMarkerSignature = this.lastObservedMarkerSignature
      this.observeSettings(extensionSettings, fresh)
      if (!fresh) {
        if ((raw !== this.submittedRaw && raw !== this.freshRemoteRaw)
          || markerSignature(extensionSettings) !== previousMarkerSignature) {
          this.freshCloudObserved = false
          this.verifiedPayloadInSession = null
          this.submittedRaw = null
          this.emit({ state: 'pending', error: '' })
        }
        this.provisionalCloudPayload = raw
        this.remoteRaw = raw
        return true
      }
      const online = cloudSnapshot(raw)
      const markers = readWardrobeSyncMarkers(extensionSettings || {})
      const settled = maxAppliedSequences(online.a, this.document.discardedSeqByDevice)
      const missing = findUnappliedWardrobeMarkers(markers, settled)
      if (this.document.protocolVersion === 4 && online.kind !== 'v4'
        && !(online.kind === 'empty' && !this.document.lastVerifiedPayload)) {
        await this.archive('older-client-cloud-snapshot', { onlineRaw: raw })
        throw new Error('Older client replaced the v4 cloud snapshot; automatic upload stopped')
      }
      this.remoteError = null
      this.pendingRemote = { extensionSettings: { ...extensionSettings }, fresh, memberNumber }
      await this.mergeStored()
      beforeRemote = { index: this.index, document: { ...this.document } }
      const cloudSequence = online.a[this.deviceId] || 0
      const knownVersion = (this.document.submittedVersions || [])
        .find(entry => entry.sequence === cloudSequence)
      const baselineKnown = cloudSequence === 0 || !!knownVersion
        || this.document.baseCloudSequence === cloudSequence
      const base = this.document.conflictContext?.base || knownVersion?.index
        || this.document.baseCloudIndex || createWardrobeIndex()
      const local = this.document.conflictContext?.local || this.index
      const remote = online.index
      const rawResult = mergeWardrobeIndexesThreeWay(base, local, remote, { replicaId: this.replicaId })
      const resolvedChoices = equal(remote, this.document.conflictContext?.remote)
        ? (this.document.conflictContext?.resolvedChoices || []).filter(choice =>
          rawResult.conflicts.some(conflict => conflict.kind === choice.kind
            && conflict.id === choice.id && conflict.field === choice.field)) : []
      const result = resolvedChoices.length
        ? resolveWardrobeConflicts(rawResult, resolvedChoices, { replicaId: this.replicaId })
        : rawResult
      const missingConflicts = missing.filter(item => {
        if (item.deviceId !== this.deviceId) return true
        const version = (this.document.submittedVersions || [])
          .find(entry => entry.sequence === item.marker.s)
        return !baselineKnown || !version
          || !(this.document.submission?.markerValue === extensionSettings?.[this.markerKey]
          || (this.document.baseCloudSequence === item.marker.s
            && equal(this.document.baseCloudIndex, version.index)))
      })
        .map(item => ({ kind: 'device', id: item.deviceId, field: 'sequence', type: 'missing-device',
          sequence: item.marker.s, appliedSequence: item.appliedSequence, local: null, remote: null }))
      const conflicts = [...result.conflicts, ...missingConflicts]
      const conflictContext = conflicts.length ? { base, local,
        remote: online.index, guardedRemote: remote, result, missing, resolvedChoices } : null
      const merged = missingConflicts.length
        ? quarantineCloudContent(result.merged, local) : clone(result.merged)
      const sameCloud = equal(projectWardrobeCloudIndex(merged), online.index)
      const discardsPublished = Object.entries(this.document.discardedSeqByDevice || {})
        .every(([id, sequence]) => (online.a[id] || 0) >= sequence)
      const verified = online.kind === 'v4' && conflicts.length === 0 && sameCloud
        && discardsPublished
        && (!this.document.submission || (online.a[this.deviceId] || 0) >= this.document.submission.marker.s)
      this.remoteRaw = raw
      if (!verified) this.submittedRaw = null
      await this.writeDocument(merged, { pending: !verified, conflicts, conflictContext,
        baseCloudIndex: conflicts.length ? base : online.index,
        baseCloudSequence: conflicts.length ? this.document.baseCloudSequence : cloudSequence,
        baseAppliedSeq: settled, protocolVersion: online.kind === 'v4' ? 4 : this.document.protocolVersion,
        submittedVersions: verified
          ? [...(this.document.submittedVersions || [])
            .filter(entry => entry.sequence !== cloudSequence),
          { sequence: cloudSequence, index: online.index }].slice(-8)
          : this.document.submittedVersions,
        submission: verified ? null : this.document.submission,
        lastVerifiedAt: verified ? Date.now() : this.document.lastVerifiedAt,
        lastVerifiedPayload: verified ? raw : this.document.lastVerifiedPayload })
      committed = true
      this.freshCloudObserved = true
      this.verifiedPayloadInSession = verified ? raw : null
      this.pendingRemote = null
      this.measure()
      const state = conflicts.length ? 'conflict' : this.quota.isOverLimit ? 'quota'
        : verified ? 'verified' : 'pending'
      this.emit({ state, conflicts, localSaved: true, error: '',
        lastVerifiedAt: this.document.lastVerifiedAt || null })
      if (schedule && !verified && !conflicts.length && !this.quota.isOverLimit) this.queue()
      return true
    } catch (error) {
      const reported = storageError(error, !!this.persistence)
      this.cancelPending()
      if (!committed && beforeRemote) {
        this.index = beforeRemote.index
        this.document = beforeRemote.document
      }
      if (!beforeRemote || !committed) this.remoteError = reported
      this.emit({ state: 'error', error: reported.message, errorCode: reported.code || null,
        localSaved: committed || this.status.localSaved })
      return committed
    }
  }

  resolveSyncConflict(resolutions) { return this.serialize(() => this.resolveSyncConflictNow(resolutions)) }

  async resolveSyncConflictNow(resolutions) {
    await this.ensureAccount()
    if (!Array.isArray(resolutions) || !resolutions.length) {
      throw new Error('Choose a sync conflict to resolve')
    }
    const context = this.document.conflictContext
    if (!context || !this.document.conflicts?.length) {
      throw new Error('No sync conflict needs a decision')
    }
    const missingChoices = resolutions.filter(choice => choice.kind === 'device')
    const mergeChoices = resolutions.filter(choice => choice.kind !== 'device')
    for (const choice of missingChoices) {
      if (choice.field !== 'sequence' || choice.choice !== 'discard'
        || !this.document.conflicts.some(conflict => conflict.type === 'missing-device'
          && conflict.id === choice.id)) {
        throw new Error('Unknown device changes can only be explicitly discarded')
      }
    }
    const discarded = { ...(this.document.discardedSeqByDevice || {}) }
    for (const choice of missingChoices) {
      const entry = context.missing.find(item => item.deviceId === choice.id)
      if (!entry) throw new Error('Missing device marker was not found')
      discarded[choice.id] = entry.marker.s
    }
    const activeMissing = context.missing.filter(item => (discarded[item.deviceId] || 0) < item.marker.s)
    const recalculated = mergeWardrobeIndexesThreeWay(context.base, context.local,
      context.remote, { replicaId: this.replicaId })
    const allChoices = [...(context.resolvedChoices || []), ...mergeChoices]
      .filter(choice => recalculated.conflicts.some(conflict => conflict.kind === choice.kind
        && conflict.id === choice.id && conflict.field === choice.field))
    const updated = allChoices.length
      ? resolveWardrobeConflicts(recalculated, allChoices, { replicaId: this.replicaId })
      : recalculated
    const remainingDevice = this.document.conflicts.filter(conflict => conflict.type === 'missing-device'
      && !missingChoices.some(choice => choice.id === conflict.id))
    const conflicts = [...updated.conflicts, ...remainingDevice]
    const next = remainingDevice.length
      ? quarantineCloudContent(updated.merged, context.local) : clone(updated.merged)
    // Recovery records preserve both candidates and the explicit decision.
    const recovery = { resolutions, conflicts: this.document.conflicts,
      local: context.local, remote: context.remote, missing: context.missing }
    const baseAppliedSeq = maxAppliedSequences(this.document.baseAppliedSeq, discarded)
    await this.writeDocumentWithArchive(next, { pending: true, conflicts,
      conflictContext: conflicts.length ? { ...context, result: updated,
        guardedRemote: context.remote, missing: activeMissing, resolvedChoices: allChoices } : null,
      baseCloudIndex: conflicts.length ? context.base : context.remote,
      baseAppliedSeq, discardedSeqByDevice: discarded, submission: null },
    'sync-conflict-decision', recovery)
    this.submittedRaw = null
    this.measure()
    this.emit({ state: conflicts.length ? 'conflict' : this.quota.isOverLimit ? 'quota' : 'pending',
      conflicts, localSaved: true, error: '' })
    if (!conflicts.length && !this.quota.isOverLimit) this.queue()
    return next
  }

  exportRecovery() { return this.serialize(() => this.exportRecoveryNow()) }

  async exportRecoveryNow() {
    if (accountId(this.getPlayer()) !== this.member) {
      throw new Error('Account changed; reopen the wardrobe before exporting recovery')
    }
    if (this.persistence) {
      let archives = []
      let databaseError = null
      try { archives = await this.database(() => this.persistence.listArchives(this.member)) }
      catch (error) { databaseError = error }
      const result = archives.map(({ key, record }) => ({ key, ...record }))
      const archivedByKey = new Map(archives.map(({ key, record }) => [key, record]))
      for (const key of this.localRecoveryKeys(this.document?.recoveryKeys || [])) {
        const raw = this.local.getItem(key)
        if (!raw) continue
        try {
          const record = decodeWardrobePayload(raw)
          if (typeof record.reason === 'string' && own(record, 'data')) {
            if (!archivedByKey.has(key) || !equal(record, archivedByKey.get(key))) {
              result.push({ key, ...record, source: 'localStorage' })
            }
          } else if (typeof record.reason !== 'string' || !own(record, 'data')) {
            result.push({ key, reason: 'unreadable-legacy-recovery', data: { raw } })
          }
        } catch { result.push({ key, reason: 'unreadable-legacy-recovery', data: { raw } }) }
      }
      const primaryRaw = this.local.getItem(this.key)
      if (primaryRaw) {
        let reason = 'legacy-local-document-raw'
        try { await this.readDocument(primaryRaw) }
        catch { reason = 'unreadable-legacy-document' }
        result.push({ key: this.key, reason, data: { raw: primaryRaw } })
      }
      for (const key of this.legacySourceKeys()) {
        const raw = this.local.getItem(key)
        if (raw) result.push({ key, reason: 'legacy-local-source-raw', data: { raw } })
      }
      if (databaseError && !result.length) throw databaseError
      return result
    }
    return (this.document?.recoveryKeys || []).map(key => ({ key, ...decodeWardrobePayload(this.local.getItem(key)) }))
  }
}
