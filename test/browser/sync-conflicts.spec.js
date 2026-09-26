import { test, expect } from '@playwright/test'

async function openLibrary(page) {
  await page.goto('/')
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.getByText('Shared cloud storage', { exact: true })).toBeVisible()
}

async function showConflict(page, conflict, quarantine = false) {
  await page.evaluate(async ({ incoming, quarantine }) => {
    const storeUrl = performance.getEntriesByType('resource').map((entry) => entry.name)
      .findLast((url) => new URL(url).pathname.endsWith('/src/stores/fileSystemStore.js'))
    const { useFileSystemStore } = await import(storeUrl)
    window.__vpwConflictDecisions = []
    const fs = useFileSystemStore.getState()
    const repository = fs._getRepository()
    repository.cancelPending()
    repository.resolveSyncConflict = (resolutions) => {
      window.__vpwConflictDecisions.push(resolutions)
      fs._acceptLibrarySnapshot({
        index: fs.wardrobeIndex,
        quota: fs.cloudQuota,
        status: { ...fs.syncStatus, state: 'pending', conflicts: [] },
      })
      return true
    }
    const index = quarantine ? structuredClone(fs.wardrobeIndex) : fs.wardrobeIndex
    if (quarantine) {
      index.outfits = Object.fromEntries(Object.entries(index.outfits)
        .filter(([id]) => index.cloudState[id]?.enabled === false))
      const retainedTags = new Set(Object.values(index.outfits).flatMap((outfit) => outfit.tagIds))
      index.tags = Object.fromEntries(Object.entries(index.tags)
        .filter(([id]) => retainedTags.has(id)))
    }
    fs._acceptLibrarySnapshot({
      index,
      quota: fs.cloudQuota,
      status: { ...fs.syncStatus, state: 'conflict', localSaved: true, conflicts: [incoming] },
    })
  }, { incoming: conflict, quarantine })
}

test('desktop reviews same-field conflict without silently choosing a version', async ({ page }) => {
  await openLibrary(page)
  await showConflict(page, {
    kind: 'outfit', id: 'sample', field: 'name', type: 'same-field',
    base: 'Original outfit', local: 'Local name', remote: 'Cloud name',
  })
  await expect(page.getByText('Conflict · upload paused')).toBeVisible()
  await expect(page.getByText('Cloud upload paused. Review conflicting changes to continue.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry upload', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Review 1 conflicts' }).click()
  const review = page.getByRole('dialog', { name: 'Review sync conflicts' })
  await expect(review).toBeVisible()
  await expect(review.getByText('Local name', { exact: true })).toBeVisible()
  await expect(review.getByText('Cloud name', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.__vpwConflictDecisions)).toEqual([])
  await review.getByRole('button', { name: "Keep this device's version" }).click()
  await expect(review).toHaveCount(0)
  expect(await page.evaluate(() => window.__vpwConflictDecisions)).toEqual([[
    { kind: 'outfit', id: 'sample', field: 'name', choice: 'local' },
  ]])
})

test('delete versus edit labels restoration as a new item', async ({ page }) => {
  await openLibrary(page)
  await showConflict(page, {
    kind: 'outfit', id: 'removed', field: '$record', type: 'delete-edit',
    base: { name: 'Saved outfit' }, local: null, remote: { name: 'Edited outfit' },
  })
  await page.getByRole('button', { name: 'Review 1 conflicts' }).click()
  const review = page.getByRole('dialog', { name: 'Review sync conflicts' })
  await expect(review.getByRole('button', { name: 'Keep deletion' })).toBeVisible()
  await review.getByRole('button', { name: 'Restore as new outfit' }).click()
  expect(await page.evaluate(() => window.__vpwConflictDecisions)).toEqual([[
    { kind: 'outfit', id: 'removed', field: '$record', choice: 'cloud' },
  ]])
})

test('mobile reviews missing-device change as a page and lets the user wait', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openLibrary(page)
  await showConflict(page, {
    kind: 'device', id: 'anonymous-device', field: 'sequence', type: 'missing-device',
    base: null, local: null, remote: null,
  })
  await page.getByRole('button', { name: 'Review 1 conflicts' }).click()
  await expect(page.locator('.vpw-sync-conflict-review')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Review sync conflicts' })).toHaveCount(0)
  await expect(page.getByText('A reported change is missing')).toBeVisible()
  await page.getByRole('button', { name: 'Wait for original device' }).click()
  await expect(page.getByText('Shared cloud storage', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.__vpwConflictDecisions)).toEqual([])
  await page.getByRole('button', { name: 'Review 1 conflicts' }).click()
  await page.getByRole('button', { name: 'Discard missing change' }).click()
  const confirmation = page.getByRole('dialog').last()
  await expect(confirmation).toContainText('The cloud cannot restore its content')
  await confirmation.getByRole('button', { name: 'OK' }).click()
  expect(await page.evaluate(() => window.__vpwConflictDecisions)).toEqual([[
    { kind: 'device', id: 'anonymous-device', field: 'sequence', choice: 'discard' },
  ]])
})

test('quarantining an incomplete cloud copy closes its preview and keeps private outfits usable', async ({ page }) => {
  await openLibrary(page)
  await page.getByRole('button', { name: 'Preview Sample Outfit' }).click()
  await expect(page.locator('.vpw-workspace-preview')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Apply to Tester' })).toBeVisible()
  await showConflict(page, {
    kind: 'device', id: 'offline-device', field: 'sequence', type: 'missing-device',
    base: null, local: null, remote: null,
  }, true)
  await expect(page.getByText(/Synced outfits are temporarily hidden and cannot be previewed or applied/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Preview Sample Outfit' })).toHaveCount(0)
  await expect(page.locator('.vpw-workspace-preview')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Apply to Tester' })).toHaveCount(0)
  const privateOutfit = page.getByRole('button', { name: 'Preview Local draft' })
  await expect(privateOutfit).toBeVisible()
  await expect(page.getByRole('button', { name: 'This device only', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Import / Export' }).click()
  await expect(page.getByRole('menuitem', { name: 'Save current outfit' })).toBeDisabled()
  await expect(page.getByRole('menuitem', { name: 'Import backup' })).toBeDisabled()
  await expect(page.getByRole('menuitem', { name: 'Save backup' })).toBeEnabled()
  await page.keyboard.press('Escape')
  await privateOutfit.click()
  await expect(page.getByRole('button', { name: 'Apply to Tester' })).toBeVisible()
})

test('capacity separates last BC read from a smaller quarantined upload estimate', async ({ page }) => {
  await openLibrary(page)
  await showConflict(page, {
    kind: 'device', id: 'offline-device', field: 'sequence', type: 'missing-device',
    base: null, local: null, remote: null,
  }, true)
  await page.evaluate(async () => {
    const storeUrl = performance.getEntriesByType('resource').map((entry) => entry.name)
      .findLast((url) => new URL(url).pathname.endsWith('/src/stores/fileSystemStore.js'))
    const { useFileSystemStore } = await import(storeUrl)
    const fs = useFileSystemStore.getState()
    fs._acceptLibrarySnapshot({
      index: fs.wardrobeIndex,
      status: fs.syncStatus,
      quota: { ...fs.cloudQuota,
        wardrobeBytes: 1500, otherExtensionsBytes: 500, totalBytes: 2000,
        remainingBytes: 178000, usageRatio: 2000 / 180000,
        observed: {
          wardrobeBytes: 110000, otherExtensionsBytes: 10000, totalBytes: 120000,
          remainingBytes: 60000, limitBytes: 180000, usageRatio: 120000 / 180000,
          isWarning: false, isOverLimit: false,
        },
        observedSource: 'login-response',
      },
    })
  })
  await expect(page.getByText('Last read from BC at login')).toBeVisible()
  await expect(page.getByText('120.0 kB / 180.0 kB')).toBeVisible()
  await page.getByRole('button', { name: 'Storage details' }).click()
  await expect(page.getByText('Estimated next upload · not uploaded yet')).toBeVisible()
  await expect(page.getByText('2.0 kB / 180.0 kB')).toBeVisible()
  await expect(page.getByRole('progressbar', { name: /Last read from BC at login: 120.0 kB of 180.0 kB/ })).toBeVisible()
  await page.evaluate(async () => {
    const storeUrl = performance.getEntriesByType('resource').map((entry) => entry.name)
      .findLast((url) => new URL(url).pathname.endsWith('/src/stores/fileSystemStore.js'))
    const { useFileSystemStore } = await import(storeUrl)
    const fs = useFileSystemStore.getState()
    fs._acceptLibrarySnapshot({ index: fs.wardrobeIndex, status: fs.syncStatus,
      quota: { ...fs.cloudQuota, observedSource: 'player-cache' } })
  })
  await expect(page.getByText('BC local cache estimate · not yet checked')).toBeVisible()
})

test('device registration limit explains local-only recovery and offers a backup', async ({ page }) => {
  await openLibrary(page)
  await page.evaluate(async () => {
    const storeUrl = performance.getEntriesByType('resource').map((entry) => entry.name)
      .findLast((url) => new URL(url).pathname.endsWith('/src/stores/fileSystemStore.js'))
    const { useFileSystemStore } = await import(storeUrl)
    const fs = useFileSystemStore.getState()
    fs._getRepository().cancelPending()
    fs._acceptLibrarySnapshot({ index: fs.wardrobeIndex, quota: fs.cloudQuota,
      status: { ...fs.syncStatus, state: 'error', localSaved: true, conflicts: [],
        errorCode: 'device-limit', error: 'Cloud wardrobe has reached its 16-device marker limit' } })
  })
  await expect(page.getByText(/Cloud sync has 16 registered installations/)).toBeVisible()
  await expect(page.getByText('Cloud wardrobe has reached its 16-device marker limit')).toHaveCount(0)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export local backup' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^vpw-backup_.*\.json$/)
})
