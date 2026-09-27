const DATABASE_NAME = 'VPWardrobeLocalWardrobe'
const STORE_NAME = 'records'
const documentKey = member => `document:${member}`
const archivePrefix = member => `archive:${member}:`
const metaKey = (member, key) => `meta:${member}:${key}`

function accountKey(member) {
  const value = String(member)
  if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error('Invalid wardrobe account')
  }
  return value
}

function requiredKey(key) {
  if (typeof key !== 'string' || !key) throw new Error('Wardrobe storage key is required')
  return key
}

function same(left, right) {
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
      : value
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

/** Only remove a legacy key if no other tab has changed its value since it was read. */
export function removeLegacyKeysIfUnchanged(storage, entries) {
  const removed = []
  for (const { key, raw } of entries) {
    if (typeof key !== 'string' || typeof raw !== 'string') continue
    try {
      if (storage.getItem(key) !== raw) continue
      storage.removeItem(key)
      if (storage.getItem(key) === null) removed.push(key)
    } catch { /* The committed IndexedDB copy remains available on the next launch. */ }
  }
  return removed
}

/** Durable local wardrobe document and recovery archive storage, scoped by BC member number. */
export class WardrobePersistence {
  constructor(getIndexedDB, canWrite = () => true) {
    if (typeof canWrite !== 'function') throw new Error('Wardrobe writer check must be a function')
    this.getIndexedDB = getIndexedDB
    this.canWrite = canWrite
    this.database = null
    this.connection = null
  }

  removeLegacyKeysIfUnchanged(storage, entries) {
    return removeLegacyKeysIfUnchanged(storage, entries)
  }

  open() {
    if (this.database) return this.database
    const indexedDB = this.getIndexedDB?.()
    if (!indexedDB?.open) return Promise.reject(new Error('IndexedDB is unavailable'))

    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1)
      let blocked = false
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME)
        }
      }
      request.onsuccess = () => {
        const database = request.result
        if (blocked) {
          database.close()
          return
        }
        this.connection = database
        const invalidate = () => {
          if (this.connection !== database) return
          database.close()
          this.connection = null
          this.database = null
        }
        database.onversionchange = invalidate
        database.onclose = invalidate
        resolve(database)
      }
      request.onerror = () => reject(request.error || new Error('Wardrobe database open failed'))
      request.onblocked = () => {
        blocked = true
        reject(new Error('Wardrobe database open blocked'))
      }
    }).catch(error => {
      this.database = null
      throw error
    })
    return this.database
  }

  async transact(mode, operation, member) {
    const account = accountKey(member)
    for (let attempt = 0; attempt < 2; attempt++) {
      const database = await this.open()
      try {
        return await new Promise((resolve, reject) => {
          let transaction
          let result
          let settled = false
          const fail = error => {
            if (settled) return
            settled = true
            try { transaction?.abort() } catch { /* Already aborted or completed. */ }
            reject(error)
          }
          const request = (idbRequest, callback) => {
            idbRequest.onsuccess = () => {
              try { callback(idbRequest.result) } catch (error) { fail(error) }
            }
          }
          try {
            if (mode === 'readwrite' && this.canWrite(account) !== true) {
              throw Object.assign(new Error('Wardrobe writer lock was lost'), { code: 'writer-lost' })
            }
            transaction = database.transaction(STORE_NAME, mode)
            transaction.oncomplete = () => {
              if (settled) return
              settled = true
              resolve(result)
            }
            transaction.onerror = event => fail(transaction.error || event?.target?.error
              || new Error('Wardrobe database transaction failed'))
            transaction.onabort = () => fail(transaction.error
              || new Error('Wardrobe database transaction aborted'))
            operation(transaction.objectStore(STORE_NAME), request, value => { result = value }, fail)
          } catch (error) { fail(error) }
        })
      } catch (error) {
        if (attempt === 0 && error?.name === 'InvalidStateError') {
          this.connection?.close()
          this.connection = null
          this.database = null
          continue
        }
        throw error
      }
    }
  }

  read(member) {
    const key = documentKey(accountKey(member))
    return this.transact('readonly', (store, request, result) => {
      request(store.get(key), value => result(value ?? null))
    }, member)
  }

  write(member, document) {
    const key = documentKey(accountKey(member))
    if (!document || typeof document !== 'object') throw new Error('Wardrobe document is required')
    return this.transact('readwrite', (store, _request, result) => {
      store.put(document, key)
      result(undefined)
    }, member)
  }

  /** transform must be synchronous, so the transaction remains active. */
  update(member, transform) {
    const key = documentKey(accountKey(member))
    if (typeof transform !== 'function') throw new Error('Wardrobe update transform is required')
    return this.transact('readwrite', (store, request, result) => {
      request(store.get(key), value => {
        const previous = value ?? null
        const document = transform(previous)
        if (!document || typeof document !== 'object') {
          throw new Error('Wardrobe update must return a document')
        }
        store.put(document, key)
        result({ previous, document })
      })
    }, member)
  }

  readMeta(member, key) {
    const storageKey = metaKey(accountKey(member), requiredKey(key))
    return this.transact('readonly', (store, request, result) => {
      request(store.get(storageKey), value => result(value ?? null))
    }, member)
  }

  writeMeta(member, key, value) {
    const storageKey = metaKey(accountKey(member), requiredKey(key))
    return this.transact('readwrite', (store, _request, result) => {
      store.put(value, storageKey)
      result(undefined)
    }, member)
  }

  getOrCreateMeta(member, key, create) {
    const storageKey = metaKey(accountKey(member), requiredKey(key))
    if (typeof create !== 'function') throw new Error('Wardrobe metadata factory is required')
    return this.transact('readwrite', (store, request, result) => {
      request(store.get(storageKey), value => {
        if (value !== undefined) return result(value)
        const created = create()
        store.put(created, storageKey)
        result(created)
      })
    }, member)
  }

  /** Resolve archive-key collisions without overwriting a different recovery copy. */
  saveArchive(store, request, prefix, desiredKey, record, done, suffix = 0) {
    const key = suffix ? `${desiredKey}_${suffix}` : desiredKey
    request(store.get(prefix + key), existing => {
      if (existing === undefined) {
        store.put(record, prefix + key)
        done(key)
      } else if (same(existing?.data, record?.data)) {
        done(key)
      } else {
        this.saveArchive(store, request, prefix, desiredKey, record, done, suffix + 1)
      }
    })
  }

  archive(member, desiredKey, record) {
    const prefix = archivePrefix(accountKey(member))
    requiredKey(desiredKey)
    if (!record || typeof record !== 'object' || !Object.hasOwn(record, 'data')) {
      throw new Error('Wardrobe recovery record is required')
    }
    return this.transact('readwrite', (store, request, result) => {
      this.saveArchive(store, request, prefix, desiredKey, record, result)
    }, member)
  }

  /** Keep a recovery decision and the document it protects in one commit. */
  writeWithArchive(member, document, desiredKey, record) {
    const account = accountKey(member)
    const primaryKey = documentKey(account)
    const prefix = archivePrefix(account)
    requiredKey(desiredKey)
    if (!document || typeof document !== 'object' || !record || typeof record !== 'object'
      || !Object.hasOwn(record, 'data')) {
      throw new Error('Wardrobe document and recovery record are required')
    }
    return this.transact('readwrite', (store, request, result) => {
      request(store.get(primaryKey), current => {
        this.saveArchive(store, request, prefix, desiredKey, record, archiveKey => {
          const saved = { ...document, recoveryKeys: [...new Set([
            ...(current?.recoveryKeys || []), ...(document.recoveryKeys || []), archiveKey,
          ])] }
          store.put(saved, primaryKey)
          result({ document: saved, archiveKey })
        })
      })
    }, member)
  }

  readArchive(member, key) {
    const storageKey = archivePrefix(accountKey(member)) + requiredKey(key)
    return this.transact('readonly', (store, request, result) => {
      request(store.get(storageKey), value => result(value ?? null))
    }, member)
  }

  listArchives(member) {
    const prefix = archivePrefix(accountKey(member))
    return this.transact('readonly', (store, request, result) => {
      const archives = []
      const range = globalThis.IDBKeyRange?.bound(prefix, `${prefix}\uffff`)
      request(store.openCursor(range), cursor => {
        if (!cursor) return result(archives)
        if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
          archives.push({ key: cursor.key.slice(prefix.length), record: cursor.value })
        }
        cursor.continue()
      })
    }, member)
  }

  /** Copy localStorage data in one transaction; an existing IDB document always wins. */
  migrate(member, { document = null, archives = [] } = {}) {
    const account = accountKey(member)
    const primaryKey = documentKey(account)
    const prefix = archivePrefix(account)
    if (!Array.isArray(archives)) throw new Error('Wardrobe migration archives must be an array')
    for (const entry of archives) {
      requiredKey(entry.key)
      if (!entry.record || typeof entry.record !== 'object'
        || !Object.hasOwn(entry.record, 'data')) {
        throw new Error('Wardrobe migration recovery record is required')
      }
    }

    return this.transact('readwrite', (store, request, result) => {
      request(store.get(primaryKey), current => {
        const existing = current ?? null
        const migrated = []
        const remappedKeys = new Map()
        const pending = archives.map(entry => ({ ...entry }))
        const legacyDocumentArchived = Boolean(existing && document && !same(existing, document))
        if (legacyDocumentArchived) {
          pending.push({ key: `VPWardrobe_index_${account}_recovery_legacy_document`,
            record: { reason: 'superseded-local-document', data: document, createdAt: Date.now() } })
        }
        const next = () => {
          const entry = pending.shift()
          if (entry) {
            this.saveArchive(store, request, prefix, entry.key, entry.record, key => {
              migrated.push(key)
              remappedKeys.set(entry.key, key)
              next()
            })
            return
          }
          const primary = existing || document
          if (!primary) {
            result({ document: null, archiveKeys: migrated, legacyDocumentArchived })
            return
          }
          const recoveryKeys = [...new Set([
            ...(primary.recoveryKeys || []).map(key => existing ? key : remappedKeys.get(key) || key),
            ...migrated,
          ])]
          const saved = { ...primary, recoveryKeys }
          if (!existing || !same(saved, existing)) store.put(saved, primaryKey)
          result({ document: saved, archiveKeys: migrated, legacyDocumentArchived })
        }
        next()
      })
    }, member)
  }
}
