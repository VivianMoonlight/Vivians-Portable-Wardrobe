import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function openWardrobe(page) {
  await page.goto('/')
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
}

async function updateCloudflareState(page, changes, key) {
  await page.evaluate(async ({ changes, key }) => {
    const storeUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(url => new URL(url).pathname.endsWith('/src/stores/fileSystemStore.js'))
    const { useFileSystemStore } = await import(storeUrl)
    const fs = useFileSystemStore.getState()
    if (key !== undefined) fs._cloudflareKey = key
    fs.cloudflareSyncStatus = { ...fs.cloudflareSyncStatus, ...changes }
  }, { changes, key })
}

test('Cloudflare is opt-in and an unconfigured build keeps BC sync visible', async ({ page }) => {
  await openWardrobe(page)
  await expect(page.getByText('Shared cloud storage', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Settings' }).click()
  await expect(page.getByRole('switch', { name: 'Use Cloudflare sync' })).toBeDisabled()
  await expect(page.getByText('This version has no Cloudflare service URL.')).toBeVisible()
})

test('Cloudflare mode replaces BC quota and never displays a recovery key by default', async ({ page }) => {
  await openWardrobe(page)
  await updateCloudflareState(page, {
    enabled: true, ready: true, syncing: false, pending: false, error: '',
    errorCode: null, bcLegacyRetained: null, bcLegacyChanged: false, lastSyncedAt: Date.now(),
    keyAvailable: true, keySavedToBC: true,
  }, `vpw1_${'A'.repeat(43)}`)
  await expect(page.getByRole('tabpanel', { name: 'Wardrobe' })
    .getByText('Use Cloudflare sync', { exact: true })).toBeVisible()
  await expect(page.getByRole('tabpanel', { name: 'Wardrobe' }).getByText('Estimated cloud data')).toBeVisible()
  await expect(page.getByRole('tabpanel', { name: 'Wardrobe' }).getByText('UTF-8 JSON estimate')).toBeVisible()
  await expect(page.getByText('Shared cloud storage', { exact: true })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Settings' }).click()
  const settingsPanel = page.getByRole('tabpanel', { name: 'Settings' })
  await expect(page.getByRole('switch', { name: 'Use Cloudflare sync' })).toBeChecked()
  await expect(settingsPanel.getByText('The old BC wardrobe copy has not been checked.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show recovery key' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Recovery key' })).toHaveCount(0)
  const downloadStarted = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download recovery key' }).click()
  const download = await downloadStarted
  expect(download.suggestedFilename()).toMatch(/^vpw-cloud-recovery-key-\d{4}-\d{2}-\d{2}\.txt$/)
  expect(await readFile(await download.path(), 'utf8')).toBe(`vpw1_${'A'.repeat(43)}\n`)
  await page.getByRole('button', { name: 'Show recovery key' }).click()
  await expect(page.getByRole('textbox', { name: 'Recovery key' }))
    .toHaveValue(`vpw1_${'A'.repeat(43)}`)
  await page.getByRole('tab', { name: 'Wardrobe' }).click()
  await page.getByRole('tab', { name: 'Settings' }).click()
  await expect(page.getByRole('textbox', { name: 'Recovery key' })).toHaveCount(0)
  await updateCloudflareState(page, { pending: true })
  await expect(settingsPanel.getByText('Local changes waiting to sync to Cloudflare')).toBeVisible()
  await expect(settingsPanel.getByText('Last synced:')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Wardrobe' }).click()
  await expect(page.getByRole('tabpanel', { name: 'Wardrobe' }).getByText('Pending sync')).toBeVisible()
  await page.getByRole('tab', { name: 'Settings' }).click()
  await updateCloudflareState(page, {
    error: 'Cloudflare sync failed (HTTP 413)', errorCode: 'too-large', bcLegacyRetained: true,
  })
  await expect(settingsPanel.getByText('The cloud wardrobe exceeds the 8 MB limit.')).toBeVisible()
  await expect(settingsPanel.getByText('The old BC wardrobe copy still uses space.')).toBeVisible()
  await expect(page.getByText('Cloudflare sync failed (HTTP 413)')).toHaveCount(0)
  await updateCloudflareState(page, { bcLegacyRetained: false })
  await expect(settingsPanel.getByText('A BC login readback confirmed')).toBeVisible()
  await updateCloudflareState(page, { bcLegacyChanged: true })
  await expect(settingsPanel.getByText('We cannot confirm that the old BC wardrobe is unchanged', { exact: false })).toBeVisible()
  await page.getByRole('tab', { name: 'Wardrobe' }).click()
  await expect(page.getByRole('tabpanel', { name: 'Wardrobe' }).getByText('Old BC data needs review; automatic cleanup is paused.')).toBeVisible()
})

test('mobile settings can restore a key without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await openWardrobe(page)
  await updateCloudflareState(page, {
    enabled: false, ready: true, syncing: false, pending: false, error: '',
    errorCode: null, bcLegacyRetained: null, bcLegacyChanged: false, lastSyncedAt: null,
    keyAvailable: false, keySavedToBC: false,
  })
  await page.getByRole('radiogroup').getByText('Settings', { exact: true }).click()
  await page.getByRole('button', { name: 'Have a recovery key?' }).click()
  await expect(page.getByLabel('Recovery key')).toBeVisible()
  expect(await page.locator('#vpw-root').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await updateCloudflareState(page, { keyAvailable: true })
  await expect(page.getByRole('button', { name: 'Switch cloud wardrobe' })).toBeVisible()
  await page.getByRole('button', { name: 'Switch cloud wardrobe' }).click()
  await expect(page.getByLabel('Recovery key')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await updateCloudflareState(page, { enabled: true })
  await page.getByRole('radiogroup').getByText('Wardrobe', { exact: true }).click()
  await expect(page.getByText('Estimated cloud data')).toBeVisible()
  expect(await page.locator('#vpw-root').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
})
