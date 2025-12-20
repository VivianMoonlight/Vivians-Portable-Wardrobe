/**
 * UndoRedoManager - Lightweight undo/redo manager with transaction support
 * 
 * Features:
 * - Snapshot-based history tracking (stores minimal necessary state)
 * - Transaction support for merging high-frequency operations
 * - Automatic deduplication to avoid redundant history entries
 * - Configurable capacity limits (default 100)
 * - Throttling support for continuous operations
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

/**
 * Fast deep clone using structuredClone when available, fallback to JSON
 * Note: This function is intentionally duplicated from studioStore.js for module independence.
 * The undo_redo module is designed to be reusable and framework-agnostic.
 */
function fastClone(v) {
  if (v === null || v === undefined) return v
  if (typeof v !== 'object') return v

  // Use structuredClone for modern browsers
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(v)
    } catch (e) {
      // Fall through to JSON fallback
    }
  }

  // JSON fallback
  try {
    return JSON.parse(JSON.stringify(v))
  } catch (e) {
    // Shallow fallback for non-serializable
    if (Array.isArray(v)) return v.slice()
    if (v && typeof v === 'object') return Object.assign({}, v)
    return v
  }
}

/**
 * Compare two snapshots for equality
 */
function snapshotsEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch (e) {
    return false
  }
}

export class UndoRedoManager {
  /**
   * Create a new UndoRedoManager
   * @param {Object} options Configuration options
   * @param {Function} options.captureState Function that returns current state snapshot
   * @param {Function} options.restoreState Function that restores state from snapshot
   * @param {number} [options.maxHistory=100] Maximum number of history entries
   * @param {number} [options.throttleInterval=150] Throttle interval in ms for auto-push
   * @param {boolean} [options.enableLogging=false] Enable debug logging
   */
  constructor(options = {}) {
    this.captureState = options.captureState
    this.restoreState = options.restoreState
    this.maxHistory = options.maxHistory || 100
    this.throttleInterval = options.throttleInterval || 150
    this.enableLogging = options.enableLogging || false

    // History stacks
    this.undoStack = []
    this.redoStack = []

    // Transaction state
    this.inTransaction = false
    this.transactionStartSnapshot = null
    this.transactionTag = null

    // Throttle state
    this.throttleTimer = null
    this.pendingSnapshot = null

    // Restore lock (to prevent recording during undo/redo)
    this.isRestoring = false

    this._log('UndoRedoManager initialized with maxHistory:', this.maxHistory)
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
  startTransaction(tag = null) {
    if (this.inTransaction) {
      this._log('Warning: Already in transaction, ignoring startTransaction')
      return
    }

    this.inTransaction = true
    this.transactionTag = tag
    this.transactionStartSnapshot = this._captureSnapshot()
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

    const endSnapshot = this._captureSnapshot()
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
  }

  /**
   * Push a snapshot to history (with automatic deduplication)
   * If in transaction, this is ignored (state is captured at transaction end)
   */
  pushSnapshot() {
    if (this.isRestoring) {
      this._log('Skipping pushSnapshot during restore')
      return
    }

    if (this.inTransaction) {
      this._log('Skipping pushSnapshot during transaction')
      return
    }

    const snapshot = this._captureSnapshot()
    this._pushToHistory(snapshot)
  }

  /**
   * Push a snapshot with throttling (useful for keyboard input, etc.)
   * @param {number} [delay] Optional custom delay (uses throttleInterval if not provided)
   */
  pushSnapshotThrottled(delay = null) {
    if (this.isRestoring || this.inTransaction) {
      return
    }

    const actualDelay = delay !== null ? delay : this.throttleInterval

    // Clear existing timer
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer)
    }

    // Schedule snapshot
    this.throttleTimer = setTimeout(() => {
      this.pushSnapshot()
      this.throttleTimer = null
    }, actualDelay)
  }

  /**
   * Internal: Capture current state snapshot
   */
  _captureSnapshot() {
    if (!this.captureState || typeof this.captureState !== 'function') {
      throw new Error('captureState function not provided')
    }

    const state = this.captureState()
    const snapshot = fastClone(state)

    // Add metadata
    snapshot._timestamp = Date.now()
    snapshot._description = this.transactionTag || 'State Change'

    return snapshot
  }

  /**
   * Internal: Push snapshot to history with deduplication and capacity control
   */
  _pushToHistory(snapshot) {
    // Deduplicate: skip if identical to last entry
    if (this.undoStack.length > 0) {
      const lastSnapshot = this.undoStack[this.undoStack.length - 1]
      if (snapshotsEqual(lastSnapshot, snapshot)) {
        this._log('Skipping duplicate snapshot')
        return
      }
    }

    // Add to undo stack
    this.undoStack.push(snapshot)
    this._log('Snapshot pushed, undo stack size:', this.undoStack.length)

    // Clear redo stack (new action invalidates redo history)
    if (this.redoStack.length > 0) {
      this.redoStack = []
      this._log('Redo stack cleared')
    }

    // Enforce capacity limit (ring buffer behavior)
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift()
      this._log('History limit reached, removed oldest entry')
    }
  }

  /**
   * Undo the last action
   * @returns {boolean} True if undo was performed, false if nothing to undo
   */
  undo(steps = 1) {
    if (this.undoStack.length === 0) {
      this._log('Nothing to undo')
      return false
    }

    const actualSteps = Math.min(Math.max(steps, 1), this.undoStack.length)
    let performedSteps = 0
    let snapshot = null

    for (let i = 0; i < actualSteps; i++) {
      if (this.undoStack.length === 0) break

      // Capture current state before popping
      const currentSnapshot = this._captureSnapshot()
      this.redoStack.push(currentSnapshot)

      // Enforce redo stack capacity
      if (this.redoStack.length > this.maxHistory) {
        this.redoStack.shift()
        this._log('Redo history limit reached, removed oldest entry')
      }

      // Pop and restore
      snapshot = this.undoStack.pop()
      
      performedSteps++
    }
    if (snapshot) {
      this._restoreSnapshot(snapshot)
    }

    this._log(`Undo performed ${performedSteps} step(s), undo stack size: ${this.undoStack.length}`)
    return performedSteps > 0
  }

  /**
   * Redo the last undone action
   * @param {number} steps - Number of steps to redo
   * @returns {boolean} True if redo was performed, false if nothing to redo
   */
  redo(steps = 1) {
    if (this.redoStack.length === 0) {
      this._log('Nothing to redo')
      return false
    }

    const actualSteps = Math.min(Math.max(steps, 1), this.redoStack.length)
    let performedSteps = 0
    let snapshot = null

    for (let i = 0; i < actualSteps; i++) {
      if (this.redoStack.length === 0) break

      // Capture current state before popping
      const currentSnapshot = this._captureSnapshot()
      this.undoStack.push(currentSnapshot)

      // Enforce undo stack capacity
      if (this.undoStack.length > this.maxHistory) {
        this.undoStack.shift()
        this._log('Undo history limit reached, removed oldest entry')
      }

      // Pop from redo stack and restore
      snapshot = this.redoStack.pop()
      
      performedSteps++
    }

    if (snapshot) {
      this._restoreSnapshot(snapshot)
    }

    this._log(`Redo performed ${performedSteps} step(s), redo stack size: ${this.redoStack.length}`)
    return performedSteps > 0
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
    this.undoStack = []
    this.redoStack = []
    this._log('History cleared')
  }

  /**
   * Get history information
   * @returns {Object} History info with canUndo, canRedo, undoCount, redoCount
   */
  getHistory() {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      inTransaction: this.inTransaction
    }
  }

  /**
   * Get full history stacks with metadata
   * @returns {Object} Full history info with undo and redo stacks
   */
  getFullHistory() {
    return {
      undoStack: this.undoStack.map((snapshot, index) => ({
        index,
        timestamp: snapshot._timestamp || null,
        description: snapshot._description || 'State Change',
        data: snapshot
      })),
      redoStack: this.redoStack.map((snapshot, index) => ({
        index,
        timestamp: snapshot._timestamp || null,
        description: snapshot._description || 'State Change',
        data: snapshot
      })),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      inTransaction: this.inTransaction
    }
  }

  /**
   * Check if undo is available
   * @returns {boolean}
   */
  canUndo() {
    return this.undoStack.length > 0
  }

  /**
   * Check if redo is available
   * @returns {boolean}
   */
  canRedo() {
    return this.redoStack.length > 0
  }

  /**
   * Get the number of undo entries
   * @returns {number}
   */
  getUndoCount() {
    return this.undoStack.length
  }

  /**
   * Get the number of redo entries
   * @returns {number}
   */
  getRedoCount() {
    return this.redoStack.length
  }

  /**
   * Jump to a specific state in history
   * @param {number} steps - Number of steps to jump (positive for redo, negative for undo)
   * @returns {boolean} True if jump was performed
   */
  jumpToState(steps) {
    if (steps === 0) return false

    if (steps < 0) {
      // Undo multiple steps
      const actualSteps = Math.min(this.undoStack.length-Math.abs(steps)+1, this.undoStack.length)
      //for (let i = 0; i < actualSteps; i++) {
      //  if (!this.undo()) break
      //}
      this.undo(actualSteps)
      return actualSteps > 0
    } else {
      // Redo multiple steps
      const actualSteps = Math.min(steps, this.redoStack.length)
      //for (let i = 0; i < actualSteps; i++) {
      //  if (!this.redo()) break
      //}
      this.redo(actualSteps)
      return actualSteps > 0
    }
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
