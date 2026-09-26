import { readFile } from 'node:fs/promises'
import LZString from 'lz-string'
import { test, expect } from '@playwright/test'

test('local storage quota failure preserves a readable backup and recovers on manual retry', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto('/')
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.getByLabel('Actions for Sample Outfit', { exact: true })).toBeVisible()

  const key = 'VPWardrobe_index_12345'
  const encoded = await page.evaluate(key => localStorage.getItem(key), key)
  const document = JSON.parse(LZString.decompressFromBase64(encoded))
  expect(Object.keys(document.index.outfits)).toHaveLength(2)
  const readableDocument = JSON.stringify(document)
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key, value: readableDocument })

  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem
    window.__vpwQuotaProbe = { blocked: true, attempts: 0 }
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('VPWardrobe_index_') && window.__vpwQuotaProbe.blocked) {
        window.__vpwQuotaProbe.attempts++
        throw new DOMException('Simulated browser storage quota', 'QuotaExceededError')
      }
      return originalSetItem.call(this, key, value)
    }
  })
  await page.reload()
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()

  await expect(page.getByRole('alert')).toContainText('Browser storage limit reached')
  await expect(page.getByText(/separate from BC's 180 kB cloud limit/)).toBeVisible()
  await expect(page.getByLabel('Actions for Sample Outfit', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Storage details' }).click()
  await expect(page.getByText('Cloud usage has not been read yet')).toBeVisible()
  await expect(page.getByText('Estimated next upload · not uploaded yet')).toHaveCount(0)
  await expect(page.getByText('VPW 0.0 kB')).toHaveCount(0)
  await expect(page.getByText('Other extensions 0.0 kB')).toHaveCount(0)

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export local backup' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^vpw-backup_.*\.json$/)
  const backup = JSON.parse(await readFile(await download.path(), 'utf8'))
  expect(Object.values(backup.outfits).map(outfit => outfit.name).sort())
    .toEqual(['Local draft', 'Sample Outfit'])

  await page.waitForTimeout(600)
  const attempts = await page.evaluate(() => window.__vpwQuotaProbe.attempts)
  expect(attempts).toBeGreaterThanOrEqual(1)
  await page.waitForTimeout(1000)
  expect(await page.evaluate(() => window.__vpwQuotaProbe.attempts)).toBe(attempts)

  await page.evaluate(() => { window.__vpwQuotaProbe.blocked = false })
  await page.getByRole('button', { name: 'Retry local save' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('Saved on this device')).toBeVisible()
  expect(await page.evaluate(key => localStorage.getItem(key), key)).not.toBe(readableDocument)
  expect(pageErrors).toEqual([])
})
