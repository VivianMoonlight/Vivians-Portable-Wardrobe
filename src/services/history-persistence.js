const DATABASE_NAME = 'VPWardrobeLocalHistory'
const STORE_NAME = 'history'
const legacyCopiesKey = member => `legacyCopies:${member}`

export class HistoryPersistence {
  constructor(getIndexedDB, canWrite = () => true) {
    this.getIndexedDB = getIndexedDB
    this.canWrite = canWrite
    this.database = null
    this.connection = null
  }

  open() {
    if (this.database) return this.database
    const indexedDB = this.getIndexedDB()
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
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'))
      request.onblocked = () => {
        blocked = true
        reject(new Error('IndexedDB open blocked'))
      }
    }).catch(error => {
      this.database = null
      throw error
    })
    return this.database
  }

  async read(member) {
    const database = await this.open()
    return new Promise((resolve, reject) => {
      let transaction
      try {
        transaction = database.transaction(STORE_NAME, 'readonly')
      } catch (error) {
        this.database = null
        reject(error)
        return
      }
      const request = transaction.objectStore(STORE_NAME).get(member)
      transaction.oncomplete = () => resolve(request.result ?? null)
      transaction.onerror = () => reject(transaction.error || new Error('History read failed'))
      transaction.onabort = () => reject(transaction.error || new Error('History read aborted'))
    })
  }

  async write(member, data) {
    const database = await this.open()
    if (this.canWrite(String(member)) !== true) {
      throw Object.assign(new Error('History writer lock was lost'), { code: 'writer-lost' })
    }
    return new Promise((resolve, reject) => {
      let transaction
      try {
        transaction = database.transaction(STORE_NAME, 'readwrite')
      } catch (error) {
        this.database = null
        reject(error)
        return
      }
      transaction.objectStore(STORE_NAME).put(data, member)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error || new Error('History save failed'))
      transaction.onabort = () => reject(transaction.error || new Error('History save aborted'))
    })
  }

  async archiveLegacy(member, raw) {
    const database = await this.open()
    if (this.canWrite(String(member)) !== true) {
      throw Object.assign(new Error('History writer lock was lost'), { code: 'writer-lost' })
    }
    return new Promise((resolve, reject) => {
      let transaction
      try {
        transaction = database.transaction(STORE_NAME, 'readwrite')
      } catch (error) {
        this.database = null
        reject(error)
        return
      }
      const store = transaction.objectStore(STORE_NAME)
      const key = legacyCopiesKey(member)
      const request = store.get(key)
      request.onsuccess = () => {
        if (this.canWrite(String(member)) !== true) {
          transaction.abort()
          reject(Object.assign(new Error('History writer lock was lost'), { code: 'writer-lost' }))
          return
        }
        const copies = Array.isArray(request.result) ? request.result : []
        if (copies.some(copy => copy.raw === raw)) return
        store.put([...copies, { raw, archivedAt: new Date().toISOString() }], key)
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error || new Error('History archive failed'))
      transaction.onabort = () => reject(transaction.error || new Error('History archive aborted'))
    })
  }

  async listLegacyArchives(member) {
    const database = await this.open()
    return new Promise((resolve, reject) => {
      let transaction
      try {
        transaction = database.transaction(STORE_NAME, 'readonly')
      } catch (error) {
        this.database = null
        reject(error)
        return
      }
      const request = transaction.objectStore(STORE_NAME).get(legacyCopiesKey(member))
      transaction.oncomplete = () => resolve(Array.isArray(request.result) ? request.result : [])
      transaction.onerror = () => reject(transaction.error || new Error('History archive read failed'))
      transaction.onabort = () => reject(transaction.error || new Error('History archive read aborted'))
    })
  }

}
