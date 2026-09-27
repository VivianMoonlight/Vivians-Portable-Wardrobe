import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'

const moduleUrl = '/@fs/' + resolve('src/services/wardrobe-persistence.js').replaceAll('\\', '/')

test('migration retains a newer database document and archives a different local copy', async ({ page }) => {
  await page.goto('/')
  const state = await page.evaluate(async moduleUrl => {
    const { WardrobePersistence } = await import(moduleUrl)
    const storage = new WardrobePersistence(() => indexedDB)
    const member = 9870101
    await storage.write(member, { index: { source: 'database' }, recoveryKeys: ['old-archive'] })
    await storage.archive(member, 'old-archive', { reason: 'first', data: { name: 'original' } })
    const migrated = await storage.migrate(member, {
      document: { index: { source: 'local' }, recoveryKeys: ['old-archive'] },
      archives: [{ key: 'old-archive', record: { reason: 'second', data: { name: 'different' } } }],
    })
    return { migrated, archives: await storage.listArchives(member),
      document: await storage.read(member), otherAccount: await storage.read(member + 1) }
  }, moduleUrl)
  expect(state.document.index.source).toBe('database')
  expect(state.migrated.legacyDocumentArchived).toBe(true)
  expect(state.document.recoveryKeys).toEqual([
    'old-archive', 'old-archive_1', 'VPWardrobe_index_9870101_recovery_legacy_document',
  ])
  expect(state.archives.map(item => item.key)).toEqual([
    'VPWardrobe_index_9870101_recovery_legacy_document', 'old-archive', 'old-archive_1',
  ])
  expect(state.archives.find(item => item.key === 'old-archive').record.data.name).toBe('original')
  expect(state.archives.find(item => item.key === 'old-archive_1').record.data.name).toBe('different')
  expect(state.otherAccount).toBe(null)
})

test('migration commits before exact legacy keys are removed', async ({ page }) => {
  await page.goto('/')
  const state = await page.evaluate(async moduleUrl => {
    const { WardrobePersistence, removeLegacyKeysIfUnchanged } = await import(moduleUrl)
    const storage = new WardrobePersistence(() => indexedDB)
    const member = 9870102
    const primaryKey = `VPWardrobe_index_${member}`
    const archiveKey = `${primaryKey}_recovery_old`
    localStorage.setItem(primaryKey, 'original document bytes')
    localStorage.setItem(archiveKey, 'original archive bytes')
    const migrated = await storage.migrate(member, {
      document: { index: { source: 'local' }, recoveryKeys: [archiveKey] },
      archives: [{ key: archiveKey, record: { reason: 'old', data: { name: 'saved' } } }],
    })
    localStorage.setItem(archiveKey, 'changed by another tab')
    const removed = removeLegacyKeysIfUnchanged(localStorage, [
      { key: primaryKey, raw: 'original document bytes' },
      { key: archiveKey, raw: 'original archive bytes' },
    ])
    return { migrated, removed, primaryRaw: localStorage.getItem(primaryKey),
      archiveRaw: localStorage.getItem(archiveKey), document: await storage.read(member),
      archive: await storage.readArchive(member, archiveKey) }
  }, moduleUrl)
  expect(state.migrated.archiveKeys).toEqual(['VPWardrobe_index_9870102_recovery_old'])
  expect(state.removed).toEqual(['VPWardrobe_index_9870102'])
  expect(state.primaryRaw).toBe(null)
  expect(state.archiveRaw).toBe('changed by another tab')
  expect(state.document.index.source).toBe('local')
  expect(state.archive.data.name).toBe('saved')
})

test('failed migration rolls back all writes and metadata creation is atomic', async ({ page }) => {
  await page.goto('/')
  const state = await page.evaluate(async moduleUrl => {
    const { WardrobePersistence } = await import(moduleUrl)
    const storage = new WardrobePersistence(() => indexedDB)
    const member = 9870103
    await storage.write(member, { index: { source: 'before' }, recoveryKeys: [] })
    let error = ''
    try {
      await storage.migrate(member, { archives: [
        { key: 'valid', record: { reason: 'old', data: { name: 'first' } } },
        { key: 'invalid', record: { reason: 'old', data: () => 'cannot clone' } },
      ] })
    } catch (cause) { error = cause.name }
    const first = await storage.getOrCreateMeta(member, 'deviceId', () => 'first')
    const second = await storage.getOrCreateMeta(member, 'deviceId', () => 'second')
    const updated = await storage.update(member, previous => ({
      ...previous, index: { source: 'after' },
    }))
    return { error, archives: await storage.listArchives(member), first, second, updated,
      stored: await storage.read(member) }
  }, moduleUrl)
  expect(state.error).toBe('DataCloneError')
  expect(state.archives).toEqual([])
  expect(state.first).toBe('first')
  expect(state.second).toBe('first')
  expect(state.updated.previous.index.source).toBe('before')
  expect(state.stored.index.source).toBe('after')
})

test('recovery decision and its document commit or roll back together', async ({ page }) => {
  await page.goto('/')
  const state = await page.evaluate(async moduleUrl => {
    const { WardrobePersistence } = await import(moduleUrl)
    const storage = new WardrobePersistence(() => indexedDB)
    const member = 9870104
    await storage.write(member, { index: { source: 'before' }, recoveryKeys: [] })
    const committed = await storage.writeWithArchive(member,
      { index: { source: 'after' }, recoveryKeys: [] },
      'decision', { reason: 'conflict', data: { selected: 'local' } })
    let error = ''
    try {
      await storage.writeWithArchive(member,
        { index: { source: 'uncommitted', invalid: () => {} }, recoveryKeys: [] },
        'failed-decision', { reason: 'conflict', data: { selected: 'cloud' } })
    } catch (cause) { error = cause.name }
    return { committed, error, document: await storage.read(member),
      archives: await storage.listArchives(member) }
  }, moduleUrl)
  expect(state.committed.archiveKey).toBe('decision')
  expect(state.committed.document.recoveryKeys).toEqual(['decision'])
  expect(state.error).toBe('DataCloneError')
  expect(state.document.index.source).toBe('after')
  expect(state.archives.map(item => item.key)).toEqual(['decision'])
})

test('a lost writer lock blocks every write after a delayed database open', async ({ page }) => {
  await page.goto('/')
  const state = await page.evaluate(async moduleUrl => {
    const { WardrobePersistence } = await import(moduleUrl)
    const member = 9870105
    const seed = new WardrobePersistence(() => indexedDB)
    await seed.write(member, { index: { source: 'before' }, recoveryKeys: [] })
    const database = await seed.open()
    let allowWrite = true
    let releaseOpen
    let transactionAttempts = 0
    const delayedOpen = new Promise(resolve => { releaseOpen = resolve })
    const guarded = new WardrobePersistence(() => indexedDB, () => allowWrite)
    guarded.database = delayedOpen
    const pending = guarded.write(member, { index: { source: 'stale' }, recoveryKeys: [] })
    await Promise.resolve()
    allowWrite = false
    releaseOpen({ transaction(...args) {
      transactionAttempts++
      return database.transaction(...args)
    } })
    const errors = []
    const capture = async operation => {
      try { await operation() } catch (error) { errors.push(error.code); return }
      errors.push('unexpected-success')
    }
    await capture(() => pending)
    await capture(() => guarded.update(member, previous => ({ ...previous, index: { source: 'stale' } })))
    await capture(() => guarded.archive(member, 'stale', { reason: 'test', data: {} }))
    await capture(() => guarded.writeWithArchive(member, { index: {}, recoveryKeys: [] },
      'stale-decision', { reason: 'test', data: {} }))
    await capture(() => guarded.writeMeta(member, 'deviceId', 'stale'))
    await capture(() => guarded.getOrCreateMeta(member, 'deviceId', () => 'stale'))
    await capture(() => guarded.migrate(member, { document: { index: {}, recoveryKeys: [] } }))
    return { errors, transactionAttempts, document: await seed.read(member),
      archives: await seed.listArchives(member), deviceId: await seed.readMeta(member, 'deviceId') }
  }, moduleUrl)
  expect(state.errors).toEqual(Array(7).fill('writer-lost'))
  expect(state.transactionAttempts).toBe(0)
  expect(state.document.index.source).toBe('before')
  expect(state.archives).toEqual([])
  expect(state.deviceId).toBe(null)
})
