/**
 * Indexed wardrobe state. Entity revisions order edits; permanent tombstones
 * prevent stale replicas from reviving a deletion. Cloud opt-in has its own
 * revision so editing an old copy cannot silently opt a private outfit back in.
 */
export const WARDROBE_INDEX_VERSION = 3

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const validId = value => typeof value === 'string' && value.trim().length > 0
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0

function clone(value) {
  if (Array.isArray(value)) return value.map(clone)
  if (!isObject(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]))
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!isObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort(compareText).map(key => [key, canonical(value[key])]))
}

function sameValue(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

function assert(condition, message) {
  if (!condition) throw new Error(`Invalid wardrobe index: ${message}`)
}

function isRevision(value) {
  return Array.isArray(value) && value.length === 2
    && Number.isSafeInteger(value[0]) && value[0] >= 0 && validId(value[1])
}

function compareRevision(left, right) {
  if (left[0] !== right[0]) return left[0] - right[0]
  return compareText(left[1], right[1])
}

function newest(left, right) {
  if (!left) return right
  if (!right) return left
  const order = compareRevision(left.rev, right.rev)
  if (order !== 0) return order > 0 ? left : right
  // A malformed duplicate revision must still resolve deterministically.
  return compareText(JSON.stringify(canonical(left)), JSON.stringify(canonical(right))) >= 0 ? left : right
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

function tagName(value) {
  if (typeof value !== 'string') throw new Error('Tag name must be a string')
  const name = value.normalize('NFKC').trim()
  if (!name) throw new Error('Tag name cannot be empty')
  return name
}

function allocateId(kind) {
  if (typeof globalThis.crypto?.randomUUID === 'function') return `${kind}_${globalThis.crypto.randomUUID()}`
  if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new Error('Secure wardrobe ID generation is unavailable')
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return `${kind}_${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function setRecord(table, id, record) {
  Object.defineProperty(table, id, { value: record, enumerable: true, configurable: true, writable: true })
}

export function createWardrobeIndex() {
  return {
    schemaVersion: WARDROBE_INDEX_VERSION,
    clock: 0,
    outfits: {},
    tags: {},
    tombstones: { outfits: {}, tags: {} },
    cloudState: {}
  }
}

export function validateWardrobeIndex(value) {
  assert(isObject(value) && value.schemaVersion === WARDROBE_INDEX_VERSION, 'unsupported schema version')
  assert(Number.isSafeInteger(value.clock) && value.clock >= 0, 'clock must be a nonnegative safe integer')
  assert(isObject(value.tombstones), 'tombstones must be an object')
  for (const kind of ['outfits', 'tags']) {
    assert(isObject(value[kind]) && isObject(value.tombstones[kind]), `${kind} tables must be objects`)
    for (const [id, record] of Object.entries(value[kind])) {
      assert(validId(id) && isObject(record) && record.id === id, `${kind} record ID does not match its key`)
      assert(typeof record.name === 'string', `${kind} record name must be a string`)
      assert(isRevision(record.rev), `${kind} record revision is invalid`)
      if (kind === 'outfits') {
        assert(typeof record.type === 'string' && record.type.length > 0, 'outfit type is required')
        assert(Array.isArray(record.tagIds) && record.tagIds.every(validId), 'outfit tagIds must be IDs')
      } else {
        assert(record.name.normalize('NFKC').trim().length > 0, 'tag name cannot be empty')
      }
    }
    for (const [id, revision] of Object.entries(value.tombstones[kind])) {
      assert(validId(id) && isRevision(revision), `${kind} tombstone is invalid`)
    }
  }
  assert(isObject(value.cloudState), 'cloudState must be an object')
  for (const [id, state] of Object.entries(value.cloudState)) {
    assert(validId(id) && isObject(state) && typeof state.enabled === 'boolean' && isRevision(state.rev), 'cloud state is invalid')
  }
  return value
}

export function isWardrobeIndex(value) {
  try {
    validateWardrobeIndex(value)
    return true
  } catch {
    return false
  }
}

function mergeTable(left, right, choose) {
  return Object.fromEntries(Array.from(new Set([...Object.keys(left), ...Object.keys(right)]))
    .sort(compareText)
    .map(id => [id, clone(choose(hasOwn(left, id) ? left[id] : null, hasOwn(right, id) ? right[id] : null))]))
}

/** Missing remote records mean unavailable/private, never deleted. */
export function mergeWardrobeIndexes(local, remote) {
  validateWardrobeIndex(local)
  validateWardrobeIndex(remote)
  const merged = createWardrobeIndex()
  merged.clock = Math.max(maximumClock(local), maximumClock(remote))
  for (const kind of ['outfits', 'tags']) {
    merged.tombstones[kind] = mergeTable(local.tombstones[kind], remote.tombstones[kind], (left, right) => {
      if (!left) return right
      if (!right) return left
      return compareRevision(left, right) >= 0 ? left : right
    })
  }
  merged.cloudState = mergeTable(local.cloudState, remote.cloudState, (left, right) => {
    if (left && right && compareRevision(left.rev, right.rev) === 0 && left.enabled !== right.enabled) {
      return left.enabled ? right : left
    }
    return newest(left, right)
  })
  merged.tags = mergeTable(local.tags, remote.tags, newest)
  merged.outfits = mergeTable(local.outfits, remote.outfits, newest)
  for (const kind of ['outfits', 'tags']) {
    for (const id of Object.keys(merged.tombstones[kind])) delete merged[kind][id]
  }
  for (const id of Object.keys(merged.tombstones.outfits)) delete merged.cloudState[id]
  for (const [id, state] of Object.entries(merged.cloudState)) {
    if (state.enabled || hasOwn(merged.tombstones.outfits, id)) continue
    // Privacy is directional: this device keeps its own copy, but a stale cloud
    // copy cannot populate a private outfit that this device did not already own.
    if (hasOwn(local.outfits, id)) setRecord(merged.outfits, id, clone(local.outfits[id]))
    else delete merged.outfits[id]
  }
  return merged
}

export function projectWardrobeCloudIndex(index) {
  validateWardrobeIndex(index)
  const projected = mergeWardrobeIndexes(index, createWardrobeIndex())
  for (const [id, state] of Object.entries(projected.cloudState)) {
    if (!state.enabled) delete projected.outfits[id]
  }
  return projected
}

export function listWardrobeOutfits(index) {
  validateWardrobeIndex(index)
  return Object.values(index.outfits).filter(outfit => !hasOwn(index.tombstones.outfits, outfit.id))
}

/** Concurrent equal names share one display row while retaining both identities. */
export function listWardrobeTags(index) {
  validateWardrobeIndex(index)
  const groups = new Map()
  for (const tag of Object.values(index.tags)) {
    if (hasOwn(index.tombstones.tags, tag.id)) continue
    const name = tagName(tag.name)
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(tag)
  }
  return Array.from(groups.entries()).map(([name, tags]) => {
    tags.sort((left, right) => compareText(left.id, right.id))
    return { ...tags[0], name, aliasIds: tags.map(tag => tag.id) }
  }).sort((left, right) => compareText(left.name, right.name) || compareText(left.id, right.id))
}

export function applyWardrobeOperations(index, operations, { replicaId } = {}) {
  validateWardrobeIndex(index)
  if (!validId(replicaId)) throw new Error('Wardrobe replicaId is required')
  if (!Array.isArray(operations)) throw new Error('Wardrobe operations must be an array')
  const next = mergeWardrobeIndexes(index, createWardrobeIndex())
  const revision = () => {
    if (next.clock >= Number.MAX_SAFE_INTEGER) throw new Error('Wardrobe revision counter exhausted')
    next.clock += 1
    return [next.clock, replicaId]
  }
  for (const operation of operations) {
    if (!isObject(operation)) throw new Error('Invalid wardrobe operation')
    let id = operation.id
    if (id == null && operation.type === 'put-tag') id = allocateId('tag')
    if (id == null && operation.type === 'put-outfit') id = allocateId('outfit')
    if (!validId(id)) throw new Error('Wardrobe operation ID is required')
    switch (operation.type) {
      case 'put-outfit': {
        if (hasOwn(next.tombstones.outfits, id)) throw new Error('Deleted outfits require a new ID to restore')
        if (!isObject(operation.changes)) throw new Error('Outfit changes must be an object')
        const previous = hasOwn(next.outfits, id) ? next.outfits[id] : null
        const changes = clone(operation.changes)
        delete changes.id
        delete changes.rev
        const outfit = { name: 'Untitled', type: 'outfit', data: [], tagIds: [], ...previous, ...changes, id }
        if (!Array.isArray(outfit.tagIds)) throw new Error('Outfit tagIds must be an array')
        outfit.tagIds = [...new Set(outfit.tagIds)]
        if (previous && sameValue(previous, outfit)) break
        outfit.rev = revision()
        setRecord(next.outfits, id, outfit)
        if (!hasOwn(next.cloudState, id)) setRecord(next.cloudState, id, { enabled: true, rev: [...outfit.rev] })
        break
      }
      case 'put-tag': {
        if (hasOwn(next.tombstones.tags, id)) throw new Error('Deleted tags require a new ID to restore')
        const name = tagName(operation.name)
        const previous = hasOwn(next.tags, id) ? next.tags[id] : null
        if (previous?.name === name) break
        const duplicate = Object.values(next.tags).find(tag => tag.id !== id && tagName(tag.name) === name)
        if (duplicate) throw new Error(`Tag already exists: ${name}`)
        setRecord(next.tags, id, { ...previous, id, name, rev: revision() })
        break
      }
      case 'rename-tag': {
        if (!hasOwn(next.tags, id)) throw new Error('Cannot rename a missing tag')
        const previousName = tagName(next.tags[id].name)
        const name = tagName(operation.name)
        const aliases = Object.values(next.tags).filter(tag => tagName(tag.name) === previousName)
        const duplicate = Object.values(next.tags).find(tag => tagName(tag.name) !== previousName && tagName(tag.name) === name)
        if (duplicate) throw new Error(`Tag already exists: ${name}`)
        if (aliases.every(tag => tag.name === name)) break
        const rev = revision()
        for (const tag of aliases) setRecord(next.tags, tag.id, { ...tag, name, rev: [...rev] })
        break
      }
      case 'delete-outfit':
      case 'delete-tag': {
        const kind = operation.type === 'delete-outfit' ? 'outfits' : 'tags'
        if (hasOwn(next.tombstones[kind], id)) break
        setRecord(next.tombstones[kind], id, revision())
        delete next[kind][id]
        if (kind === 'outfits') delete next.cloudState[id]
        break
      }
      case 'set-cloud': {
        if (typeof operation.enabled !== 'boolean') throw new Error('Cloud enabled must be a boolean')
        if (!hasOwn(next.outfits, id)) throw new Error('Cannot change cloud sync without a local outfit')
        const previous = hasOwn(next.cloudState, id) ? next.cloudState[id].enabled : true
        if (previous === operation.enabled) break
        setRecord(next.cloudState, id, { enabled: operation.enabled, rev: revision() })
        break
      }
      default:
        throw new Error(`Unknown wardrobe operation: ${operation.type}`)
    }
  }
  return validateWardrobeIndex(next)
}
