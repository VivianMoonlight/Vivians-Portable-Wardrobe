/**
 * UndoRedoManager - Lightweight undo/redo manager with transaction support
 *
 * Features:
 * - Snapshot-based history tracking (stores minimal necessary state)
 * - Transaction support for merging high-frequency operations
 * - Automatic deduplication to avoid redundant history entries
 * - Configurable capacity limits (default 100)
 * - Debounce support for continuous operations
 *
 * Usage:
 * ```js
 * const manager = new UndoRedoManager({
 *   captureState: () => ({ stacks: store.stacks, paletteMap: store.paletteMap }),
 *   restoreState: (snapshot) => { store.stacks = snapshot.stacks; ... },
 *   maxHistory: 100
 * })
 *
 * // Discrete operations
 * manager.pushSnapshot()
 *
 * // Continuous operations
 * manager.startTransaction('color-drag')
 * // ... multiple changes during drag ...
 * manager.endTransaction()
 *
 * // Undo/Redo
 * manager.undo()
 * manager.redo()
 * ```
 */

import { fastClone } from '@/utils/clone.js'

const SNAPSHOT_META_KEYS = Object.freeze(['_timestamp', '_description', '_historyMeta'])
const SNAPSHOT_META_KEY_SET = new Set([...SNAPSHOT_META_KEYS, '_fingerprint'])

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193
const MAX_HASH_DEPTH = 6
const MAX_HASH_ARRAY_ITEMS = 24
const MAX_HASH_OBJECT_KEYS = 48

function fnvMix(hash, value) {
  let mixed = hash >>> 0
  mixed ^= value & 0xff
  mixed = Math.imul(mixed, FNV_PRIME) >>> 0
  return mixed
}

function fnvMixString(hash, text) {
  const source = String(text)
  let mixed = hash >>> 0
  const limit = source.length > 128 ? 128 : source.length
  for (let i = 0; i < limit; i++) {
    mixed = fnvMix(mixed, source.charCodeAt(i))
  }
  // Include full length so long strings with same prefix do not collide trivially.
  mixed = fnvMix(mixed, source.length)
  return mixed
}

function fnvMixNumber(hash, value) {
  if (!Number.isFinite(value)) {
    return fnvMixString(hash, `num:${value}`)
  }

  // Preserve number variance while keeping operations cheap.
  const integral = Math.trunc(value)
  const fraction = Math.trunc((value - integral) * 1000000)
  let mixed = hash >>> 0
  mixed = fnvMixString(mixed, `n:${integral}`)
  mixed = fnvMixString(mixed, `f:${fraction}`)
  return mixed
}

function mixSnapshotValue(hash, value, depth, visited) {
  if (depth > MAX_HASH_DEPTH) {
    return fnvMixString(hash, '#depth')
  }

  if (value === null) return fnvMixString(hash, 'null')
  if (value === undefined) return fnvMixString(hash, 'undefined')

  const valueType = typeof value
  if (valueType === 'string') return fnvMixString(hash, `s:${value}`)
  if (valueType === 'number') return fnvMixNumber(hash, value)
  if (valueType === 'boolean') return fnvMixString(hash, value ? 'b:1' : 'b:0')
  if (valueType === 'bigint') return fnvMixString(hash, `bi:${value.toString()}`)

  if (valueType !== 'object') {
    return fnvMixString(hash, `t:${valueType}`)
  }

  if (visited.has(value)) {
    return fnvMixString(hash, '#cycle')
  }
  visited.add(value)

  let mixed = hash >>> 0

  if (Array.isArray(value)) {
    mixed = fnvMixString(mixed, `arr:${value.length}`)
    const limit = Math.min(value.length, MAX_HASH_ARRAY_ITEMS)
    for (let i = 0; i < limit; i++) {
      mixed = fnvMixNumber(mixed, i)
      mixed = mixSnapshotValue(mixed, value[i], depth + 1, visited)
    }
    if (value.length > limit) {
      mixed = fnvMixString(mixed, `arr+${value.length - limit}`)
      mixed = mixSnapshotValue(mixed, value[value.length - 1], depth + 1, visited)
    }
    visited.delete(value)
    return mixed
  }

  const keys = Object.keys(value)
  mixed = fnvMixString(mixed, `obj:${keys.length}`)
  let mixedCount = 0
  for (const key of keys) {
    if (SNAPSHOT_META_KEY_SET.has(key)) continue
    mixed = fnvMixString(mixed, key)
    mixed = mixSnapshotValue(mixed, value[key], depth + 1, visited)
    mixedCount++
    if (mixedCount >= MAX_HASH_OBJECT_KEYS) {
      mixed = fnvMixString(mixed, `obj+${keys.length - mixedCount}`)
      break
    }
  }

  visited.delete(value)
  return mixed
}

function computeSnapshotFingerprint(snapshot) {
  const visited = new WeakSet()
  const hash = mixSnapshotValue(FNV_OFFSET_BASIS, snapshot, 0, visited)
  return hash >>> 0
}

function getSnapshotFingerprint(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return 0
  if (typeof snapshot._fingerprint === 'number') {
    return snapshot._fingerprint >>> 0
  }
  const fingerprint = computeSnapshotFingerprint(snapshot)
  snapshot._fingerprint = fingerprint
  return fingerprint
}

function snapshotsStrictEqual(a, b) {
  const visited = new WeakMap()

  const compare = (left, right) => {
    if (left === right) return true

    const leftType = typeof left
    const rightType = typeof right
    if (leftType !== rightType) return false

    if (left === null || right === null) return left === right
    if (leftType !== 'object') return Object.is(left, right)

    const leftIsArray = Array.isArray(left)
    const rightIsArray = Array.isArray(right)
    if (leftIsArray !== rightIsArray) return false

    let rightSet = visited.get(left)
    if (!rightSet) {
      rightSet = new WeakSet()
      visited.set(left, rightSet)
    } else if (rightSet.has(right)) {
      return true
    }
    rightSet.add(right)

    if (leftIsArray) {
      if (left.length !== right.length) return false
      for (let i = 0; i < left.length; i++) {
        if (!compare(left[i], right[i])) return false
      }
      return true
    }

    const leftKeys = Object.keys(left).filter(key => !SNAPSHOT_META_KEY_SET.has(key))
    const rightKeys = Object.keys(right).filter(key => !SNAPSHOT_META_KEY_SET.has(key))

    if (leftKeys.length !== rightKeys.length) return false

    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(right, key)) return false
      if (!compare(left[key], right[key])) return false
    }

    return true
  }

  return compare(a, b)
}

function normalizeHistoryMeta(historyMeta = null) {
  if (!historyMeta || typeof historyMeta !== 'object') return null

  const actionType = String(historyMeta.actionType || '').trim()
  if (!actionType) return null

  const normalized = { actionType }
  const interactionKind = String(historyMeta.interactionKind || '').trim()
  const source = String(historyMeta.source || '').trim()

  if (interactionKind) normalized.interactionKind = interactionKind
  if (source) normalized.source = source

  const changedParts = Number(historyMeta.changedParts)
  if (Number.isFinite(changedParts) && changedParts > 0) {
    normalized.changedParts = changedParts
  }

  const deltaCount = Number(historyMeta.deltaCount)
  if (Number.isFinite(deltaCount) && deltaCount > 0) {
    normalized.deltaCount = deltaCount
  }

  return normalized
}

function resolveSnapshotDescription(historyMeta, transactionTag) {
  if (historyMeta?.actionType) return historyMeta.actionType
  return transactionTag || 'State Change'
}

function mergeHistoryMeta(previous = null, next = null) {
  if (!next) return previous || null
  if (!previous) return next

  const merged = { ...previous, ...next }
  if (previous.actionType && next.actionType && previous.actionType !== next.actionType) {
    merged.previousActionType = previous.actionType
  }

  return merged
}

const DEFAULT_COALESCE_ACTION_TYPES = Object.freeze([
  'batch.updateOffset',
  'batch.updatePriority',
  'batch.updateOpacity',
  'batch.updateColor',
  'part.applyLayerDeltas'
])

const DEFAULT_COALESCE_ACTION_PREFIXES = Object.freeze([
  'palette.'
])

/**
 * Compare two snapshots for equality
 */
function snapshotsEqual(a, b) {
  if (a === b) return true

  const leftFingerprint = getSnapshotFingerprint(a)
  const rightFingerprint = getSnapshotFingerprint(b)
  if (leftFingerprint !== rightFingerprint) return false

  // Fingerprint match is a fast pre-check; strict compare prevents collisions
  // from accidentally dropping valid history entries.
  return snapshotsStrictEqual(a, b)
}

export class UndoRedoManager {
  /**
   * Create a new UndoRedoManager
   * @param {Object} options Configuration options
   * @param {Function} options.captureState Function that returns current state snapshot
   * @param {Function} options.restoreState Function that restores state from snapshot
   * @param {number} [options.maxHistory=100] Maximum number of history entries
   * @param {number} [options.debounceInterval=150] Debounce interval in ms for auto-push
   * @param {number} [options.throttleInterval=150] Legacy alias of debounceInterval
   * @param {boolean} [options.enableLogging=false] Enable debug logging
   */
  constructor(options = {}) {
    this.captureState = options.captureState
    this.restoreState = options.restoreState
    this.maxHistory = options.maxHistory || 100
    const resolvedDebounceInterval = Number(options.debounceInterval ?? options.throttleInterval)
    this.debounceInterval = Number.isFinite(resolvedDebounceInterval)
      ? Math.max(0, resolvedDebounceInterval)
      : 150
    this.throttleInterval = this.debounceInterval
    this.enableLogging = options.enableLogging || false
    this.onChange = typeof options.onChange === 'function' ? options.onChange : null
    this.coalesceWindowMs = Number.isFinite(options.coalesceWindowMs)
      ? Math.max(0, Number(options.coalesceWindowMs))
      : 700
    this.coalesceActionTypes = (options.coalesceActionTypes instanceof Set)
      ? options.coalesceActionTypes
      : new Set(DEFAULT_COALESCE_ACTION_TYPES)
    this.coalesceActionPrefixes = Array.isArray(options.coalesceActionPrefixes)
      ? options.coalesceActionPrefixes.map(prefix => String(prefix || '').trim()).filter(Boolean)
      : [...DEFAULT_COALESCE_ACTION_PREFIXES]

    // Timeline-based history state (source of truth)
    this.timeline = []
    this.cursorIndex = -1
    this.nextEntryId = 1

    // Lookup indexes for fast jumps
    this.idToIndex = new Map()
    this.timestampIndex = new Map()

    // Transaction state
    this.inTransaction = false
    this.transactionStartSnapshot = null
    this.transactionTag = null
    this.transactionMeta = null

    // Debounce state
    this.debounceTimer = null
    this.pendingSnapshotMeta = null
    this.pendingSnapshotActionType = null

    // Restore lock (to prevent recording during undo/redo)
    this.isRestoring = false

    // Ensure there is always a baseline/current snapshot in undo stack.
    this._ensureInitialSnapshot()

    this._log('UndoRedoManager initialized with maxHistory:', this.maxHistory)
  }

  _ensureInitialSnapshot() {
    if (this.timeline.length > 0) return
    const initialSnapshot = this._captureSnapshot({ actionType: 'Initial State' })
    this._appendEntry(initialSnapshot)
    this._notifyChange()
  }

  _notifyChange() {
    if (!this.onChange) return
    try {
      this.onChange({
        undoCount: this.getUndoCount(),
        redoCount: this.getRedoCount(),
        inTransaction: this.inTransaction
      })
    } catch (e) {
      this._log('onChange callback failed:', e)
    }
  }

  _createEntry(snapshot) {
    return {
      id: this.nextEntryId++,
      snapshot,
      timestamp: snapshot?._timestamp || Date.now(),
      description: snapshot?._description || 'State Change',
      historyMeta: snapshot?._historyMeta || null
    }
  }

  _indexTimestamp(entry) {
    const ts = Number(entry?.timestamp)
    if (!Number.isFinite(ts)) return

    let ids = this.timestampIndex.get(ts)
    if (!ids) {
      ids = []
      this.timestampIndex.set(ts, ids)
    }
    ids.push(entry.id)
  }

  _removeTimestampIndex(entry) {
    const ts = Number(entry?.timestamp)
    if (!Number.isFinite(ts)) return

    const ids = this.timestampIndex.get(ts)
    if (!Array.isArray(ids) || ids.length === 0) return

    if (ids[ids.length - 1] === entry.id) {
      ids.pop()
    } else if (ids[0] === entry.id) {
      ids.shift()
    } else {
      const idx = ids.indexOf(entry.id)
      if (idx >= 0) ids.splice(idx, 1)
    }

    if (ids.length === 0) {
      this.timestampIndex.delete(ts)
    }
  }

  _reindexTimeline(from = 0) {
    const start = Math.max(0, Number(from) || 0)
    for (let i = start; i < this.timeline.length; i++) {
      this.idToIndex.set(this.timeline[i].id, i)
    }
  }

  _appendEntry(snapshot) {
    const entry = this._createEntry(snapshot)
    const index = this.timeline.length
    this.timeline.push(entry)
    this.cursorIndex = index
    this.idToIndex.set(entry.id, index)
    this._indexTimestamp(entry)
    return entry
  }

  _dropFutureEntries() {
    if (this.cursorIndex >= this.timeline.length - 1) return

    while (this.timeline.length > this.cursorIndex + 1) {
      const removed = this.timeline.pop()
      if (!removed) break
      this.idToIndex.delete(removed.id)
      this._removeTimestampIndex(removed)
    }
  }

  _trimHistoryToCapacity() {
    while (this.timeline.length > this.maxHistory) {
      const removed = this.timeline.shift()
      if (!removed) break
      this.idToIndex.delete(removed.id)
      this._removeTimestampIndex(removed)
      this.cursorIndex = Math.max(0, this.cursorIndex - 1)
      this._reindexTimeline(0)
    }
  }

  _getCurrentEntry() {
    if (this.cursorIndex < 0 || this.cursorIndex >= this.timeline.length) return null
    return this.timeline[this.cursorIndex] || null
  }

  _buildHistoryItem(entry, index) {
    if (!entry) return null
    return {
      index,
      timestamp: entry.timestamp || null,
      description: entry.description || 'State Change',
      historyMeta: entry.historyMeta || null,
      data: entry.snapshot
    }
  }

  _resolveSnapshotActionType(snapshot) {
    const actionType = String(snapshot?._historyMeta?.actionType || '').trim()
    if (actionType) return actionType
    return String(snapshot?._description || '').trim()
  }

  _isActionCoalescible(actionType) {
    if (!actionType) return false
    if (this.coalesceActionTypes.has(actionType)) return true
    for (const prefix of this.coalesceActionPrefixes) {
      if (actionType.startsWith(prefix)) return true
    }
    return false
  }

  _canCoalesceSnapshots(currentSnapshot, incomingSnapshot) {
    if (!currentSnapshot || !incomingSnapshot) return false
    if (this.coalesceWindowMs <= 0) return false
    if (this.cursorIndex !== this.timeline.length - 1) return false

    const currentActionType = this._resolveSnapshotActionType(currentSnapshot)
    const incomingActionType = this._resolveSnapshotActionType(incomingSnapshot)
    if (!currentActionType || currentActionType !== incomingActionType) return false
    if (!this._isActionCoalescible(currentActionType)) return false

    const currentTimestamp = Number(currentSnapshot._timestamp || 0)
    const incomingTimestamp = Number(incomingSnapshot._timestamp || 0)
    if (!Number.isFinite(currentTimestamp) || !Number.isFinite(incomingTimestamp)) return false

    return (incomingTimestamp - currentTimestamp) <= this.coalesceWindowMs
  }

  _replaceCurrentEntrySnapshot(snapshot) {
    const entry = this._getCurrentEntry()
    if (!entry) return false

    this._removeTimestampIndex(entry)
    entry.snapshot = snapshot
    entry.timestamp = snapshot?._timestamp || Date.now()
    entry.description = snapshot?._description || 'State Change'
    entry.historyMeta = snapshot?._historyMeta || null
    this._indexTimestamp(entry)
    return true
  }

  /**
   * Internal logging
   */
  _log(...args) {
    if (this.enableLogging) {
      console.log('[UndoRedoManager]', ...args)
    }
  }

  /**
   * Start a transaction for merging high-frequency operations
   * @param {string} [tag] Optional tag for the transaction
   */
  startTransaction(tag = null, historyMeta = null) {
    if (this.inTransaction) {
      this._log('Warning: Already in transaction, ignoring startTransaction')
      return
    }

    this.inTransaction = true
    this.transactionTag = tag
    this.transactionMeta = normalizeHistoryMeta(historyMeta)
    this.transactionStartSnapshot = this._captureSnapshot(this.transactionMeta)
    this._log('Transaction started:', tag)
  }

  /**
   * End the current transaction and create a merged history entry
   * Only creates an entry if state changed during the transaction
   */
  endTransaction() {
    if (!this.inTransaction) {
      this._log('Warning: No active transaction, ignoring endTransaction')
      return
    }

    const endSnapshot = this._captureSnapshot(this.transactionMeta)
    const changed = !snapshotsEqual(this.transactionStartSnapshot, endSnapshot)

    if (changed) {
      // Push the final state after transaction
      this._pushToHistory(endSnapshot)
      this._log('Transaction ended with changes:', this.transactionTag)
    } else {
      this._log('Transaction ended without changes:', this.transactionTag)
    }

    // Clear transaction state
    this.inTransaction = false
    this.transactionStartSnapshot = null
    this.transactionTag = null
    this.transactionMeta = null
  }

  /**
   * Cancel the current transaction without recording
   */
  cancelTransaction() {
    if (!this.inTransaction) {
      return
    }

    this._log('Transaction cancelled:', this.transactionTag)
    this.inTransaction = false
    this.transactionStartSnapshot = null
    this.transactionTag = null
    this.transactionMeta = null
  }

  /**
   * Push a snapshot to history (with automatic deduplication)
   * If in transaction, this is ignored (state is captured at transaction end)
   */
  pushSnapshot(historyMeta = null) {
    if (this.isRestoring) {
      this._log('Skipping pushSnapshot during restore')
      return
    }

    if (this.inTransaction) {
      this._log('Skipping pushSnapshot during transaction')
      return
    }

    const snapshot = this._captureSnapshot(historyMeta)
    this._pushToHistory(snapshot)
  }

  _resolvePendingActionType(historyMeta = null) {
    const actionType = String(historyMeta?.actionType || '').trim()
    return actionType || '__unknown__'
  }

  _commitPendingDebouncedSnapshot() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    const pendingMeta = this.pendingSnapshotMeta
    this.pendingSnapshotMeta = null
    this.pendingSnapshotActionType = null
    this.pushSnapshot(pendingMeta)
  }

  _cancelPendingDebouncedSnapshot() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.pendingSnapshotMeta = null
    this.pendingSnapshotActionType = null
  }

  /**
   * Push a snapshot with debounce (useful for rapid updates of the same action type)
   * @param {number} [delay] Optional custom delay (uses debounceInterval if not provided)
   */
  pushSnapshotDebounced(delay = null, historyMeta = null) {
    if (this.isRestoring || this.inTransaction) {
      return
    }

    let resolvedDelay = delay
    let resolvedMeta = historyMeta
    if (resolvedDelay && typeof resolvedDelay === 'object' && resolvedMeta === null) {
      resolvedMeta = resolvedDelay
      resolvedDelay = null
    }

    const normalizedMeta = normalizeHistoryMeta(resolvedMeta)
    const incomingActionType = this._resolvePendingActionType(normalizedMeta)

    // Different action types should not keep resetting each other's debounce window.
    if (
      this.debounceTimer &&
      this.pendingSnapshotActionType &&
      this.pendingSnapshotActionType !== incomingActionType
    ) {
      this._commitPendingDebouncedSnapshot()
    }

    if (!this.pendingSnapshotActionType) {
      this.pendingSnapshotActionType = incomingActionType
    }

    this.pendingSnapshotMeta = mergeHistoryMeta(this.pendingSnapshotMeta, normalizedMeta)

    const actualDelay = resolvedDelay !== null ? resolvedDelay : this.debounceInterval

    // Clear existing timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    // Schedule snapshot
    this.debounceTimer = setTimeout(() => {
      this._commitPendingDebouncedSnapshot()
    }, actualDelay)
  }

  pushSnapshotThrottled(delay = null, historyMeta = null) {
    this.pushSnapshotDebounced(delay, historyMeta)
  }

  /**
   * Internal: Capture current state snapshot
   */
  _captureSnapshot(historyMeta = null) {
    if (!this.captureState || typeof this.captureState !== 'function') {
      throw new Error('captureState function not provided')
    }

    const state = this.captureState()
    const snapshot = fastClone(state)
    const normalizedHistoryMeta = normalizeHistoryMeta(historyMeta) || this.transactionMeta

    // Add metadata
    snapshot._timestamp = Date.now()
    snapshot._description = resolveSnapshotDescription(normalizedHistoryMeta, this.transactionTag)
    if (normalizedHistoryMeta) {
      snapshot._historyMeta = normalizedHistoryMeta
    }
    snapshot._fingerprint = computeSnapshotFingerprint(snapshot)

    return snapshot
  }

  /**
   * Internal: Push snapshot to history with deduplication and capacity control
   */
  _pushToHistory(snapshot) {
    // Deduplicate against current cursor snapshot.
    const currentEntry = this._getCurrentEntry()
    if (currentEntry?.snapshot && snapshotsEqual(currentEntry.snapshot, snapshot)) {
        this._log('Skipping duplicate snapshot')
        return
    }

    if (currentEntry?.snapshot && this._canCoalesceSnapshots(currentEntry.snapshot, snapshot)) {
      if (this._replaceCurrentEntrySnapshot(snapshot)) {
        this._log('Coalesced snapshot into current history entry')
        this._notifyChange()
        return
      }
    }

    // Branching write: drop future timeline then append.
    this._dropFutureEntries()
    this._appendEntry(snapshot)
    this._trimHistoryToCapacity()

    this._log('Snapshot pushed, timeline size:', this.timeline.length)

    this._notifyChange()
  }

  /**
   * Undo the last action
   * @returns {boolean} True if undo was performed, false if nothing to undo
   */
  undo(steps = 1) {
    if (!this.canUndo()) {
      this._log('Nothing to undo')
      return false
    }

    const maxUndoSteps = this.getUndoCount()
    const actualSteps = Math.min(Math.max(steps, 1), maxUndoSteps)
    const targetIndex = this.cursorIndex - actualSteps
    return this.jumpToIndex(targetIndex)
  }

  /**
   * Redo the last undone action
   * @param {number} steps - Number of steps to redo
   * @returns {boolean} True if redo was performed, false if nothing to redo
   */
  redo(steps = 1) {
    if (!this.canRedo()) {
      this._log('Nothing to redo')
      return false
    }

    const actualSteps = Math.min(Math.max(steps, 1), this.getRedoCount())
    const targetIndex = this.cursorIndex + actualSteps
    return this.jumpToIndex(targetIndex)
  }

  jumpToIndex(targetIndex) {
    if (!Number.isFinite(targetIndex)) return false
    if (this.timeline.length === 0) return false

    const normalized = Math.trunc(targetIndex)
    const clamped = Math.min(Math.max(normalized, 0), this.timeline.length - 1)
    if (clamped === this.cursorIndex) return false

    const entry = this.timeline[clamped]
    if (!entry?.snapshot) return false

    this.cursorIndex = clamped
    this._restoreSnapshot(entry.snapshot)
    this._notifyChange()
    this._log('History jumped to index:', clamped)
    return true
  }

  jumpToTimestamp(timestamp, policy = 'latest') {
    const ts = Number(timestamp)
    if (!Number.isFinite(ts)) return false

    const ids = this.timestampIndex.get(ts)
    if (!Array.isArray(ids) || ids.length === 0) return false

    let selectedId = null
    const normalizedPolicy = String(policy || 'latest').toLowerCase()

    if (normalizedPolicy === 'earliest') {
      selectedId = ids[0]
    } else if (normalizedPolicy === 'nearest') {
      let bestDistance = Number.POSITIVE_INFINITY
      for (const id of ids) {
        const idx = this.idToIndex.get(id)
        if (!Number.isInteger(idx)) continue
        const distance = Math.abs(idx - this.cursorIndex)
        if (distance < bestDistance) {
          bestDistance = distance
          selectedId = id
        }
      }
    } else {
      selectedId = ids[ids.length - 1]
    }

    if (!Number.isInteger(selectedId)) return false
    const targetIndex = this.idToIndex.get(selectedId)
    if (!Number.isInteger(targetIndex)) return false
    return this.jumpToIndex(targetIndex)
  }

  /**
   * Internal: Restore state from snapshot
   */
  _restoreSnapshot(snapshot) {
    if (!this.restoreState || typeof this.restoreState !== 'function') {
      throw new Error('restoreState function not provided')
    }

    this.isRestoring = true
    try {
      this.restoreState(snapshot)
    } finally {
      this.isRestoring = false
    }
  }

  /**
   * Clear all history
   */
  clearHistory() {
    this.timeline = []
    this.cursorIndex = -1
    this.idToIndex = new Map()
    this.timestampIndex = new Map()
    this._cancelPendingDebouncedSnapshot()
    this._ensureInitialSnapshot()
    this._log('History cleared')
  }

  /**
   * Get history information
   * @returns {Object} History info with canUndo, canRedo, undoCount, redoCount
   */
  getHistory() {
    const undoCount = this.getUndoCount()
    const redoCount = this.getRedoCount()

    return {
      canUndo: undoCount > 0,
      canRedo: redoCount > 0,
      undoCount,
      redoCount,
      inTransaction: this.inTransaction
    }
  }

  /**
   * Get full history stacks with metadata
   * @returns {Object} Full history info with undo and redo stacks
   */
  getFullHistory() {
    const undoCount = this.getUndoCount()
    const redoCount = this.getRedoCount()

    const undoEntries = this.timeline
      .slice(0, this.cursorIndex + 1)
      .map((entry, index) => this._buildHistoryItem(entry, index))

    const redoEntries = this.timeline
      .slice(this.cursorIndex + 1)
      .reverse()
      .map((entry, index) => this._buildHistoryItem(entry, index))

    const currentEntry = this._getCurrentEntry()

    return {
      undoStack: undoEntries,
      redoStack: redoEntries,
      current: currentEntry ? this._buildHistoryItem(currentEntry, this.cursorIndex) : null,
      canUndo: undoCount > 0,
      canRedo: redoCount > 0,
      undoCount,
      redoCount,
      inTransaction: this.inTransaction
    }
  }

  getHistoryView(options = {}) {
    const maxPast = Number.isFinite(options?.maxPast) ? Math.max(0, Math.trunc(options.maxPast)) : null
    const maxFuture = Number.isFinite(options?.maxFuture) ? Math.max(0, Math.trunc(options.maxFuture)) : null

    const total = this.timeline.length
    const current = this._getCurrentEntry()
    const currentIndex = this.cursorIndex

    const pastAll = (currentIndex > 0) ? this.timeline.slice(0, currentIndex) : []
    const futureAll = (currentIndex >= 0) ? this.timeline.slice(currentIndex + 1) : []

    const pastSlice = (maxPast === null) ? pastAll : pastAll.slice(Math.max(0, pastAll.length - maxPast))
    const futureSlice = (maxFuture === null) ? futureAll : futureAll.slice(0, maxFuture)

    const toMeta = (entry, absoluteIndex) => ({
      id: entry.id,
      index: absoluteIndex,
      timestamp: entry.timestamp || null,
      description: entry.description || 'State Change',
      historyMeta: entry.historyMeta || null
    })

    return {
      totalCount: total,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoCount: this.getUndoCount(),
      redoCount: this.getRedoCount(),
      current: current ? toMeta(current, currentIndex) : null,
      pastMeta: pastSlice.map((entry) => {
        const idx = this.idToIndex.get(entry.id)
        return toMeta(entry, Number.isInteger(idx) ? idx : -1)
      }),
      futureMeta: futureSlice.map((entry) => {
        const idx = this.idToIndex.get(entry.id)
        return toMeta(entry, Number.isInteger(idx) ? idx : -1)
      })
    }
  }

  /**
   * Check if undo is available
   * @returns {boolean}
   */
  canUndo() {
    return this.getUndoCount() > 0
  }

  /**
   * Check if redo is available
   * @returns {boolean}
   */
  canRedo() {
    return this.getRedoCount() > 0
  }

  /**
   * Get the number of undo entries
   * @returns {number}
   */
  getUndoCount() {
    if (this.timeline.length === 0 || this.cursorIndex < 0) return 0
    return Math.max(0, this.cursorIndex)
  }

  /**
   * Get the number of redo entries
   * @returns {number}
   */
  getRedoCount() {
    if (this.timeline.length === 0 || this.cursorIndex < 0) return 0
    return Math.max(0, this.timeline.length - 1 - this.cursorIndex)
  }

  /**
   * Jump to a specific state in history
   * @param {number} steps - Number of steps to jump (positive for redo, negative for undo)
   * @returns {boolean} True if jump was performed
   */
  jumpToState(steps) {
    const numericSteps = Number(steps)
    if (!Number.isFinite(numericSteps) || numericSteps === 0) return false
    if (this.timeline.length === 0) return false

    const targetIndex = this.cursorIndex + Math.trunc(numericSteps)
    return this.jumpToIndex(targetIndex)
  }

  /**
   * Check if currently in a transaction
   * @returns {boolean}
   */
  isInTransaction() {
    return this.inTransaction
  }
}

export default UndoRedoManager
