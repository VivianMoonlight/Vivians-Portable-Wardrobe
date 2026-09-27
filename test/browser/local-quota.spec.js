import { test, expect } from '@playwright/test'

async function openSeededWardrobe(page) {
  await page.goto('/')
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.getByLabel('Actions for Sample Outfit', { exact: true })).toBeVisible()
}

test('an actual localStorage quota failure does not prevent IndexedDB wardrobe edits', async ({ page }) => {
  await openSeededWardrobe(page)
  const state = await page.evaluate(async () => {
    const { useFileSystemStore } = await (async () => {
      const url = performance.getEntriesByType('resource').map(entry => entry.name)
        .findLast(value => new URL(value).pathname.endsWith('/src/stores/fileSystemStore.js'))
      return import(url)
    })()
    const fs = useFileSystemStore.getState()
    const member = String(window.Player.MemberNumber)
    const before = await fs._repository.persistence.read(member)
    const chunk = 'x'.repeat(256 * 1024)
    let quotaError = null
    for (let index = 0; index < 128; index++) {
      try { localStorage.setItem(`vpw-quota-fixture-${index}`, chunk) }
      catch (error) { quotaError = error.name; break }
    }
    const available = await navigator.storage.estimate()
    const id = await fs.addOutfit({ name: 'Saved with full localStorage', type: 'outfit', data: [] })
    const after = await fs._repository.persistence.read(member)
    return {
      quotaError,
      availableBytes: available.quota - available.usage,
      previousCount: Object.keys(before.index.outfits).length,
      nextCount: Object.keys(after.index.outfits).length,
      savedName: after.index.outfits[id]?.name,
      localIndex: localStorage.getItem(`VPWardrobe_index_${member}`),
    }
  })
  expect(state.quotaError).toBe('QuotaExceededError')
  expect(state.availableBytes).toBeGreaterThan(1024 * 1024)
  expect(state.nextCount).toBe(state.previousCount + 1)
  expect(state.savedName).toBe('Saved with full localStorage')
  expect(state.localIndex).toBe(null)

  await page.reload()
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.getByLabel('Actions for Saved with full localStorage', { exact: true })).toBeVisible()
})

test('near-quota legacy wardrobe and recovery move to IndexedDB without replacing unrelated site data', async ({ page }) => {
  await openSeededWardrobe(page)
  const result = await page.evaluate(async () => {
    const storeUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(url => new URL(url).pathname.endsWith('/src/stores/fileSystemStore.js'))
    const { useFileSystemStore } = await import(storeUrl)
    const fs = useFileSystemStore.getState()
    const repository = fs._getRepository()
    const source = await repository.persistence.read('12345')
    const member = '987654'
    const key = `VPWardrobe_index_${member}`
    const recoveryKey = `${key}_recovery_original`
    const unrelatedKey = 'another-app-important-record'
    const unrelated = 'keep this value'
    const legacy = { ...source, recoveryKeys: [recoveryKey] }
    const oldRaw = JSON.stringify(legacy)
    const archiveRaw = JSON.stringify({ reason: 'original', data: { name: 'recovery copy' } })
    localStorage.setItem(key, oldRaw)
    localStorage.setItem(recoveryKey, archiveRaw)
    localStorage.setItem(unrelatedKey, unrelated)

    const chunk = 'x'.repeat(256 * 1024)
    let quotaError = null
    for (let index = 0; index < 128; index++) {
      try { localStorage.setItem(`vpw-quota-fixture-${index}`, chunk) }
      catch (error) { quotaError = error.name; break }
    }
    const originalSetItem = Storage.prototype.setItem
    let deniedWrites = 0
    Storage.prototype.setItem = function (...args) {
      deniedWrites++
      throw new DOMException('Simulated exhausted localStorage', 'QuotaExceededError')
    }

    let resumeMigration
    let migrationFinished
    const waiting = new Promise(resolve => { migrationFinished = resolve })
    const blocked = new Promise(resolve => { resumeMigration = resolve })
    const migrate = repository.persistence.migrate
    repository.persistence.migrate = async function (...args) {
      const result = await migrate.apply(this, args)
      migrationFinished()
      await blocked
      return result
    }
    window.Player.MemberNumber = Number(member)
    const opening = fs.loadAll()
    await waiting
    const beforeCleanup = {
      primary: localStorage.getItem(key),
      archive: localStorage.getItem(recoveryKey),
    }
    resumeMigration()
    const opened = await opening
    const id = await fs.addOutfit({ name: 'Near quota edit', type: 'outfit', data: [] })
    const saved = await repository.persistence.read(member)
    const archived = await repository.persistence.readArchive(member, recoveryKey)
    const result = {
      quotaError, deniedWrites, opened, beforeCleanup,
      primaryAfter: localStorage.getItem(key),
      archiveAfter: localStorage.getItem(recoveryKey),
      unrelatedAfter: localStorage.getItem(unrelatedKey),
      oldOutfits: Object.keys(source.index.outfits).length,
      savedOutfits: Object.keys(saved.index.outfits).length,
      addedName: saved.index.outfits[id]?.name,
      archivedName: archived?.data?.name,
    }
    Storage.prototype.setItem = originalSetItem
    return result
  })

  expect(result.quotaError).toBe('QuotaExceededError')
  expect(result.opened).toBe(true)
  expect(result.beforeCleanup.primary).toBeTruthy()
  expect(result.beforeCleanup.archive).toBeTruthy()
  expect(result.primaryAfter).toBe(null)
  expect(result.archiveAfter).toBe(null)
  expect(result.unrelatedAfter).toBe('keep this value')
  expect(result.savedOutfits).toBe(result.oldOutfits + 1)
  expect(result.addedName).toBe('Near quota edit')
  expect(result.archivedName).toBe('recovery copy')
  expect(result.deniedWrites).toBe(0)
})

test('IndexedDB save errors offer backup and retry without blaming localStorage', async ({ page }) => {
  await openSeededWardrobe(page)

  for (const errorCode of ['indexeddb-quota', 'indexeddb-error']) {
    await page.evaluate(async code => {
      const storeUrl = performance.getEntriesByType('resource').map(entry => entry.name)
        .findLast(url => new URL(url).pathname.endsWith('/src/stores/fileSystemStore.js'))
      const { useFileSystemStore } = await import(storeUrl)
      const fs = useFileSystemStore.getState()
      fs._getRepository().cancelPending()
      fs._acceptLibrarySnapshot({ index: fs.wardrobeIndex, quota: fs.cloudQuota,
        status: { ...fs.syncStatus, state: 'error', localSaved: false, errorCode: code,
          error: 'VPWardrobe_index_987654 raw database error', conflicts: [] } })
    }, errorCode)

    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Wardrobe database save failed')
    await expect(alert).toContainText('This wardrobe change was not confirmed saved. You can still export any readable data. Export a backup, then retry the local save. Do not clear all site data.')
    await expect(alert.getByRole('button', { name: 'Export local backup' })).toBeVisible()
    await expect(alert.getByRole('button', { name: 'Retry local save' })).toBeVisible()
    await expect(alert).not.toContainText('Wardrobe indexes (all accounts)')
    await expect(page.locator('.vpw-library-root')).not.toContainText('VPWardrobe_index_987654')
    await expect(page.locator('.vpw-library-root')).not.toContainText('987654')
  }
})
