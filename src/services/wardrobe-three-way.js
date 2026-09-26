import { createWardrobeIndex, validateWardrobeIndex } from './wardrobe-index.js'

const absent = Symbol('absent')
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0

function clone(value) {
  if (Array.isArray(value)) return value.map(clone)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]))
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort(compareText).map(key => [key, canonical(value[key])]))
}

function same(left, right) {
  if (left === absent || right === absent) return left === right
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

function set(table, id, value) {
  Object.defineProperty(table, id, { value, enumerable: true, configurable: true, writable: true })
}

function get(table, id) {
  return own(table, id) ? table[id] : null
}

function field(record, key) {
  return record && own(record, key) ? record[key] : absent
}

function content(record) {
  if (!record) return absent
  const value = clone(record)
  delete value.id
  delete value.rev
  return value
}

function maximumClock(index) {
  let clock = index.clock
  for (const table of [index.outfits, index.tags, index.cloudState]) {
    for (const record of Object.values(table)) clock = Math.max(clock, record.rev[0])
  }
  for (const table of Object.values(index.tombstones)) {
    for (const revision of Object.values(table)) clock = Math.max(clock, revision[0])
  }
  return clock
}

function compareRevision(left, right) {
  return left[0] - right[0] || compareText(left[1], right[1])
}

function newestRevision(...revisions) {
  return revisions.filter(Boolean).sort(compareRevision).at(-1)
}

function nextRevision(index, replicaId) {
  if (index.clock >= Number.MAX_SAFE_INTEGER) throw new Error('Wardrobe revision counter exhausted')
  return [++index.clock, replicaId]
}

function ids(...tables) {
  return [...new Set(tables.flatMap(table => Object.keys(table)))].sort(compareText)
}

function conflictValue(value) {
  return value === absent ? null : clone(value)
}

function addConflict(conflicts, { kind, id, field: name, type, base, local, remote, ...extra }) {
  conflicts.push({ kind, id, field: name, type,
    base: conflictValue(base), local: conflictValue(local), remote: conflictValue(remote),
    present: { base: base !== absent, local: local !== absent, remote: remote !== absent },
    ...extra })
}

function chooseField(base, local, remote, details, conflicts) {
  if (same(local, remote)) return local
  if (same(local, base)) return remote
  if (same(remote, base)) return local
  addConflict(conflicts, { ...details, type: 'concurrent-edit', base, local, remote })
  // The local candidate remains visible, but the caller must not upload it
  // while this conflict is unresolved.
  return local
}

function mergeTagIds(base, local, remote) {
  const original = new Set(base === absent ? [] : base)
  const left = new Set(local === absent ? [] : local)
  const right = new Set(remote === absent ? [] : remote)
  return [...new Set([...original, ...left, ...right])]
    .filter(id => original.has(id) ? left.has(id) && right.has(id) : left.has(id) || right.has(id))
    .sort(compareText)
}

function mergedRevision(index, merged, candidates, replicaId) {
  const matching = candidates.filter(candidate => candidate && same(content(candidate), content(merged)))
  if (matching.length) return clone(newestRevision(...matching.map(candidate => candidate.rev)))
  return nextRevision(index, replicaId)
}

function mergeRecord(index, kind, id, baseRecord, localRecord, remoteRecord, conflicts, replicaId) {
  // Omission without a tombstone is not deletion. In particular, a cloud
  // projection omits private outfit payloads.
  const local = localRecord || baseRecord
  const remote = remoteRecord || baseRecord
  if (!local && !remote) return null
  if (!local) return clone(remote)
  if (!remote) return clone(local)

  const merged = { id }
  for (const key of ids(baseRecord || {}, local, remote)) {
    if (key === 'id' || key === 'rev') continue
    const baseValue = field(baseRecord, key)
    const localValue = field(local, key)
    const remoteValue = field(remote, key)
    const value = kind === 'outfit' && key === 'tagIds'
      ? mergeTagIds(baseValue, localValue, remoteValue)
      : chooseField(baseValue, localValue, remoteValue,
        { kind, id, field: key }, conflicts)
    if (value !== absent) merged[key] = clone(value)
  }
  merged.rev = mergedRevision(index, merged, [baseRecord, localRecord, remoteRecord], replicaId)
  return merged
}

function changedSince(baseRecord, candidate) {
  return !!candidate && !same(content(baseRecord), content(candidate))
}

function mergeCloudState(index, id, baseState, localState, remoteState, conflicts, replicaId) {
  const local = localState || baseState
  const remote = remoteState || baseState
  if (!local && !remote) return null
  if (!local) return clone(remote)
  if (!remote) return clone(local)
  const merged = {}
  for (const key of ids(baseState || {}, local, remote)) {
    if (key === 'rev' || key === 'localOnly') continue
    const value = chooseField(field(baseState, key), field(local, key), field(remote, key),
      { kind: 'cloud-state', id, field: key }, conflicts)
    if (value !== absent) merged[key] = clone(value)
  }
  if (!merged.enabled && (localState?.localOnly || remoteState?.localOnly)) merged.localOnly = true
  merged.rev = mergedRevision(index, merged, [baseState, localState, remoteState], replicaId)
  return merged
}

/** Merge two descendants of the same verified cloud snapshot without silently losing edits. */
export function mergeWardrobeIndexesThreeWay(base, local, remote, { replicaId = 'vpw-merge' } = {}) {
  validateWardrobeIndex(base)
  validateWardrobeIndex(local)
  validateWardrobeIndex(remote)
  if (typeof replicaId !== 'string' || !replicaId.trim()) throw new Error('Wardrobe replicaId is required')

  const merged = createWardrobeIndex()
  merged.clock = Math.max(maximumClock(base), maximumClock(local), maximumClock(remote))
  const conflicts = []

  for (const table of ['outfits', 'tags']) {
    const kind = table === 'outfits' ? 'outfit' : 'tag'
    for (const id of ids(base[table], local[table], remote[table],
      base.tombstones[table], local.tombstones[table], remote.tombstones[table])) {
      const baseRecord = get(base[table], id)
      const localRecord = get(local[table], id)
      const remoteRecord = table === 'outfits' && get(remote.cloudState, id)?.enabled === false
        ? null : get(remote[table], id)
      const tombstone = newestRevision(get(base.tombstones[table], id),
        get(local.tombstones[table], id), get(remote.tombstones[table], id))
      if (tombstone) {
        set(merged.tombstones[table], id, clone(tombstone))
        const localDeleted = !!get(local.tombstones[table], id)
        const remoteDeleted = !!get(remote.tombstones[table], id)
        if ((localDeleted && !remoteDeleted && changedSince(baseRecord, remoteRecord))
          || (remoteDeleted && !localDeleted && changedSince(baseRecord, localRecord))) {
          addConflict(conflicts, { kind, id, field: '$record', type: 'delete-edit',
            base: baseRecord || absent, local: localDeleted ? absent : localRecord || absent,
            remote: remoteDeleted ? absent : remoteRecord || absent,
            localCloudState: kind === 'outfit' ? clone(get(local.cloudState, id)) : null,
            remoteCloudState: kind === 'outfit' ? clone(get(remote.cloudState, id)) : null })
        }
        continue
      }
      if (table === 'outfits' && get(local.cloudState, id)?.enabled === false) {
        // Keep this device's private copy separate from any public candidate.
        if (localRecord) set(merged.outfits, id, clone(localRecord))
        continue
      }
      const record = mergeRecord(merged, kind, id, baseRecord, localRecord, remoteRecord,
        conflicts, replicaId)
      if (record) set(merged[table], id, record)
    }
  }

  for (const id of ids(base.cloudState, local.cloudState, remote.cloudState)) {
    if (own(merged.tombstones.outfits, id)) continue
    const baseState = get(base.cloudState, id)
    const localState = get(local.cloudState, id)
    const remoteState = get(remote.cloudState, id)
    const state = mergeCloudState(merged, id, baseState, localState, remoteState,
      conflicts, replicaId)
    if (!state) continue

    const localPrivate = localState?.enabled === false
    const remotePublic = remoteState?.enabled === true
    const remoteChanged = changedSince(get(base.outfits, id), get(remote.outfits, id))
    if (localPrivate && remotePublic && (state.enabled || remoteChanged)) {
      // A private local outfit must never be combined into a public payload.
      state.enabled = false
      if (localState.localOnly) state.localOnly = true
      else delete state.localOnly
      state.rev = clone(newestRevision(state.rev, localState.rev))
      if (get(local.outfits, id)) set(merged.outfits, id, clone(local.outfits[id]))
      else delete merged.outfits[id]
      if (!conflicts.some(conflict => conflict.kind === 'cloud-state'
        && conflict.id === id && conflict.field === 'enabled')) {
        addConflict(conflicts, { kind: 'cloud-state', id, field: 'enabled', type: 'privacy',
          base: baseState ? baseState.enabled : absent,
          local: localState.enabled,
          remote: remoteState.enabled,
          localOutfit: clone(get(local.outfits, id)),
          remoteOutfit: clone(get(remote.outfits, id)) })
      }
    }
    if (remoteState?.enabled === false) {
      // The cloud may contain a payload written by an older client before it
      // became private. It is never a source for a public outfit on this device.
      if (get(local.outfits, id)) set(merged.outfits, id, clone(local.outfits[id]))
      else delete merged.outfits[id]
      if (state.enabled && !get(local.outfits, id)) {
        state.enabled = false
        addConflict(conflicts, { kind: 'cloud-state', id, field: 'enabled', type: 'privacy',
          base: baseState ? baseState.enabled : absent,
          local: localState ? localState.enabled : absent,
          remote: remoteState.enabled,
          localOutfit: null, remoteOutfit: null })
      }
    }
    for (const conflict of conflicts) {
      if (conflict.kind === 'cloud-state' && conflict.id === id && conflict.field === 'enabled') {
        conflict.baseOutfit ??= clone(get(base.outfits, id))
        conflict.localOutfit ??= clone(get(local.outfits, id))
        conflict.remoteOutfit ??= remoteState?.enabled === true ? clone(get(remote.outfits, id)) : null
      }
    }
    set(merged.cloudState, id, state)
  }

  return { merged: validateWardrobeIndex(merged), conflicts, canUpload: conflicts.length === 0 }
}

function allocateId(kind, index) {
  let id
  do {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      id = `${kind}_${globalThis.crypto.randomUUID()}`
    } else if (typeof globalThis.crypto?.getRandomValues === 'function') {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
      id = `${kind}_${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
    } else throw new Error('Secure wardrobe ID generation is unavailable')
  }
  while (own(index[`${kind}s`], id) || own(index.tombstones[`${kind}s`], id))
  return id
}

function chosenValue(conflict, choice) {
  const side = choice === 'cloud' ? 'remote' : choice === 'discard' ? 'base' : 'local'
  return conflict.present[side] ? clone(conflict[side]) : absent
}

/** Apply explicit user choices; unresolved conflicts keep uploads blocked. */
export function resolveWardrobeConflicts(result, choices, { replicaId = 'vpw-resolution' } = {}) {
  if (!result || !Array.isArray(result.conflicts) || !Array.isArray(choices)) {
    throw new Error('Wardrobe conflicts and choices are required')
  }
  if (typeof replicaId !== 'string' || !replicaId.trim()) throw new Error('Wardrobe replicaId is required')
  const merged = clone(validateWardrobeIndex(result.merged))
  const remaining = result.conflicts.map(clone)
  for (const resolution of choices) {
    if (!['local', 'cloud', 'discard'].includes(resolution.choice)) {
      throw new Error('Choose local, cloud, or discard for a wardrobe conflict')
    }
    const position = remaining.findIndex(conflict => conflict.kind === resolution.kind
      && conflict.id === resolution.id && conflict.field === resolution.field)
    if (position < 0) throw new Error('Wardrobe conflict was not found')
    const [conflict] = remaining.splice(position, 1)

    if (conflict.type === 'delete-edit') {
      const selected = resolution.choice === 'discard' ? absent : chosenValue(conflict, resolution.choice)
      if (selected !== absent) {
        const table = `${conflict.kind}s`
        const id = resolution.newId || allocateId(conflict.kind, merged)
        if (typeof id !== 'string' || !id.trim() || own(merged[table], id)
          || own(merged.tombstones[table], id)) throw new Error('Restored wardrobe ID must be new')
        selected.id = id
        selected.rev = nextRevision(merged, replicaId)
        set(merged[table], id, selected)
        if (conflict.kind === 'outfit') {
          const source = resolution.choice === 'cloud' ? conflict.remoteCloudState : conflict.localCloudState
          set(merged.cloudState, id, { enabled: source?.enabled !== false,
            rev: clone(selected.rev), ...(source?.localOnly ? { localOnly: true } : {}) })
        } else {
          for (const outfit of Object.values(merged.outfits)) {
            if (!outfit.tagIds.includes(conflict.id)) continue
            outfit.tagIds = [...new Set(outfit.tagIds.map(tagId => tagId === conflict.id ? id : tagId))]
            outfit.rev = nextRevision(merged, replicaId)
          }
        }
      }
      continue
    }

    if (conflict.kind === 'cloud-state' && conflict.field === 'enabled') {
      const value = chosenValue(conflict, resolution.choice)
      if (value === absent) throw new Error('Cloud state cannot be removed by this choice')
      const state = merged.cloudState[conflict.id]
      if (!state) throw new Error('Wardrobe cloud state was not found')
      state.enabled = value
      if (value) {
        delete state.localOnly
        const chosenOutfit = resolution.choice === 'cloud' ? conflict.remoteOutfit
          : resolution.choice === 'local' ? conflict.localOutfit : conflict.baseOutfit
        if (!chosenOutfit) throw new Error('Public outfit is unavailable for this choice')
        const publicOutfit = clone(chosenOutfit)
        publicOutfit.rev = nextRevision(merged, replicaId)
        set(merged.outfits, conflict.id, publicOutfit)
      }
      state.rev = nextRevision(merged, replicaId)
      continue
    }

    const table = conflict.kind === 'outfit' ? merged.outfits
      : conflict.kind === 'tag' ? merged.tags : merged.cloudState
    const record = get(table, conflict.id)
    if (!record) throw new Error('Wardrobe conflict record was not found')
    const value = chosenValue(conflict, resolution.choice)
    if (value === absent) delete record[conflict.field]
    else record[conflict.field] = value
    record.rev = nextRevision(merged, replicaId)
  }
  validateWardrobeIndex(merged)
  return { merged, conflicts: remaining, canUpload: remaining.length === 0 }
}
