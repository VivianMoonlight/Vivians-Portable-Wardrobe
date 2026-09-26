const NODE_ID = '__vpwNodeId'
const RUNTIME_FIELDS = new Set(['thumbCanvas', 'isThumbGenerated', '__thumbRefresh'])
const SYNC_FIELDS = new Set([NODE_ID, '__vpwSync', '__vpwPersistedAt', '__vpwRev', '__vpwParentId', '__vpwOrder'])

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function put(object, key, value) {
  Object.defineProperty(object, key, { value, enumerable: true, configurable: true, writable: true })
}

function nodeId(node) {
  return own(node, NODE_ID) && typeof node[NODE_ID] === 'string' && node[NODE_ID].trim()
    ? node[NODE_ID].trim()
    : null
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (!isObject(value)) return JSON.stringify(value)
  return `{${Object.keys(value).sort(compare).map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function hash(value) {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

function nodePayload(node) {
  const result = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === 'children' || RUNTIME_FIELDS.has(key) || SYNC_FIELDS.has(key)) continue
    const serialized = JSON.stringify(value)
    if (serialized !== undefined) put(result, key, JSON.parse(serialized))
  }
  return result
}

/** Recognizes persisted folder trees, without treating indexed/future schemas as trees. */
export function isLegacyWardrobe(value) {
  return isObject(value)
    && !own(value, 'schemaVersion')
    && Array.isArray(value.children)
    && (value.type === undefined || value.type === 'folder')
}

function describeTree(tree) {
  const descriptors = []
  const visiting = new WeakSet()
  const walk = (node, parent, path) => {
    if (!isObject(node)) throw new TypeError('Legacy wardrobe contains a non-object node')
    if (visiting.has(node)) throw new TypeError('Legacy wardrobe contains a folder cycle')
    visiting.add(node)
    const folder = !parent || node.type === 'folder' || Array.isArray(node.children)
    if (folder && node.children !== undefined && !Array.isArray(node.children)) {
      throw new TypeError('Legacy folder children must be an array')
    }
    const name = typeof node.name === 'string' && node.name.trim() ? node.name : 'Untitled'
    const descriptor = {
      node, parent, folder, name, path: parent ? [...path, name] : [],
      payload: nodePayload(node), existingId: nodeId(node), id: null, children: []
    }
    descriptors.push(descriptor)
    descriptor.children = (folder ? node.children || [] : []).map(child => walk(child, descriptor, descriptor.path))
    descriptor.signature = hash(stableStringify({
      payload: descriptor.payload,
      id: descriptor.existingId,
      children: descriptor.children.map(child => child.signature).sort(compare)
    }))
    visiting.delete(node)
    return descriptor
  }
  const root = walk(tree, null, [])
  root.id = 'root'
  return { root, descriptors }
}

function assignIds(root, descriptors, deletedIds) {
  const reserved = new Set(['root', ...deletedIds])
  const candidates = new Map()
  for (const descriptor of descriptors.slice(1)) {
    if (!descriptor.existingId) continue
    reserved.add(descriptor.existingId)
    const matches = candidates.get(descriptor.existingId) || []
    matches.push(descriptor)
    candidates.set(descriptor.existingId, matches)
  }
  for (const [id, matches] of candidates) {
    // A tombstoned identity must never be repaired into a fresh live copy.
    if (deletedIds.has(id)) {
      matches.forEach(descriptor => { descriptor.id = id })
      continue
    }
    if (id === 'root') continue
    matches.sort((left, right) => compare(
      stableStringify([left.path, left.signature, left.parent.signature]),
      stableStringify([right.path, right.signature, right.parent.signature])
    ))
    matches[0].id = id
  }

  const assignChildren = parent => {
    const generated = new Map()
    for (const child of parent.children) {
      if (child.id) continue
      const key = child.folder
        ? stableStringify(['tag', child.name])
        : stableStringify(['outfit', child.payload])
      const siblings = generated.get(key) || []
      siblings.push(child)
      generated.set(key, siblings)
    }
    for (const [key, siblings] of Array.from(generated).sort(([a], [b]) => compare(a, b))) {
      siblings.sort((left, right) => compare(left.signature, right.signature))
      siblings.forEach((child, ordinal) => {
        const seed = stableStringify([parent.id, key, ordinal])
        let attempt = 0
        let id
        do {
          id = `legacy_${child.folder ? 'tag' : 'outfit'}_${hash(`${seed}|${attempt++}`)}`
        } while (reserved.has(id))
        child.id = id
        reserved.add(id)
      })
    }
    parent.children.forEach(assignChildren)
  }
  assignChildren(root)
}

function uniqueTagNames(descriptors, deletedIds) {
  const folders = descriptors.filter(descriptor => descriptor.parent && descriptor.folder && !deletedIds.has(descriptor.id))
  const counts = new Map()
  for (const folder of folders) {
    folder.tagName = folder.path.join(' / ').normalize('NFKC').trim()
    counts.set(folder.tagName, (counts.get(folder.tagName) || 0) + 1)
  }
  const unavailable = new Set(counts.keys())
  folders.sort((left, right) => compare(left.id, right.id))
  for (const folder of folders) {
    if (counts.get(folder.tagName) === 1) continue
    const base = folder.tagName
    let attempt = 0
    do {
      folder.tagName = `${base} · ${hash(`${folder.id}|${attempt++}`).slice(0, 8)}`
    } while (unavailable.has(folder.tagName))
    unavailable.add(folder.tagName)
  }
}

function oldRevision(value, fallbackReplica) {
  const counter = Array.isArray(value) ? value[0] : value?.counter
  const replica = Array.isArray(value) ? value[1] : value?.replica
  if (!Number.isSafeInteger(counter) || counter < 0) return null
  return [counter, typeof replica === 'string' && replica.trim() ? replica : fallbackReplica]
}

function readLegacySync(tree, replicaId) {
  const sync = own(tree, '__vpwSync') ? tree.__vpwSync : null
  if (sync != null && (!isObject(sync) || ![1, 2].includes(Number(sync.version)))) {
    throw new TypeError('Unsupported legacy wardrobe sync metadata')
  }
  if (sync?.counter !== undefined && (!Number.isSafeInteger(sync.counter) || sync.counter < 0)) {
    throw new TypeError('Legacy wardrobe revision counter is invalid')
  }
  if (sync?.records !== undefined && !isObject(sync.records)) {
    throw new TypeError('Legacy wardrobe records must be an object')
  }
  let clock = oldRevision({ counter: sync?.counter }, replicaId)?.[0] ?? 0
  const deletions = new Map()
  const tombstones = sync?.tombstones
  if (tombstones !== undefined && !isObject(tombstones)) {
    throw new TypeError('Legacy tombstones must be an object')
  }
  for (const [id, tombstone] of Object.entries(tombstones || {})) {
    if (!id.trim() || id === 'root') continue
    const revision = oldRevision(tombstone?.rev, replicaId)
    if (revision) clock = Math.max(clock, revision[0])
    deletions.set(id, revision)
    if (id !== id.trim()) deletions.set(id.trim(), revision)
  }
  for (const record of Object.values(sync?.records || {})) {
    const revision = oldRevision(record?.rev, replicaId)
    if (revision) clock = Math.max(clock, revision[0])
  }
  if (clock >= Number.MAX_SAFE_INTEGER) throw new RangeError('Legacy wardrobe revision counter is exhausted')
  return { clock: clock + 1, deletions }
}

function indexedRecord(payload, fields) {
  const result = { ...payload }
  const displaced = {}
  for (const [key, value] of Object.entries(fields)) {
    if (own(result, key) && stableStringify(result[key]) !== stableStringify(value)) {
      put(displaced, key, result[key])
    }
    put(result, key, value)
  }
  if (Object.keys(displaced).length) {
    if (own(result, 'legacyFields')) put(displaced, 'legacyFields', result.legacyFields)
    put(result, 'legacyFields', displaced)
  }
  return result
}

/**
 * One-time, offline conversion. Source selection, recovery backups and the
 * migration marker belong to the persistence controller, before this runs.
 */
export function migrateLegacyWardrobe(tree, { replicaId = 'migration' } = {}) {
  if (!isLegacyWardrobe(tree)) throw new TypeError('Expected a legacy wardrobe folder tree')
  if (typeof replicaId !== 'string' || !replicaId.trim()) throw new TypeError('Migration replica ID is required')
  const { clock, deletions } = readLegacySync(tree, replicaId)
  const revision = [clock, replicaId]
  const { root, descriptors } = describeTree(tree)
  const deletedIds = new Set(deletions.keys())
  assignIds(root, descriptors, deletedIds)
  uniqueTagNames(descriptors, deletedIds)
  const result = {
    schemaVersion: 3, clock, outfits: {}, tags: {},
    tombstones: { outfits: {}, tags: {} }, cloudState: {}
  }
  // Old tombstones have no node kind. Retaining them in both independent maps
  // protects against an old backup returning that identity under either kind.
  for (const [id, oldRev] of deletions) {
    put(result.tombstones.outfits, id, oldRev || [...revision])
    put(result.tombstones.tags, id, oldRev || [...revision])
  }

  let order = 0
  const migrate = (descriptor, ancestorTags, inheritedCloud) => {
    const enabled = typeof descriptor.node.cloudSync === 'boolean' ? descriptor.node.cloudSync : inheritedCloud
    let tagIds = ancestorTags
    if (descriptor.parent && descriptor.folder && !deletedIds.has(descriptor.id)) {
      const tag = indexedRecord(descriptor.payload, {
        id: descriptor.id, name: descriptor.tagName, rev: [...revision],
        legacyPath: [...descriptor.path]
      })
      put(result.tags, descriptor.id, tag)
      tagIds = [...ancestorTags, descriptor.id]
    } else if (!descriptor.folder && !deletedIds.has(descriptor.id)) {
      const outfit = indexedRecord(descriptor.payload, {
        id: descriptor.id, name: descriptor.name,
        type: typeof descriptor.node.type === 'string' && descriptor.node.type ? descriptor.node.type : 'file',
        tagIds: [...tagIds], rev: [...revision], order: order++
      })
      if (!own(outfit, 'data')) outfit.data = []
      put(result.outfits, descriptor.id, outfit)
      put(result.cloudState, descriptor.id, { enabled, rev: [...revision] })
    }
    descriptor.children.forEach(child => migrate(child, tagIds, enabled))
  }
  migrate(root, [], true)
  return result
}
