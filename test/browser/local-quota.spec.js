import { readFile } from 'node:fs/promises'
import LZString from 'lz-string'
import { test, expect } from '@playwright/test'
import { decodeWardrobePayload } from '../../src/services/WardrobeRepository.js'

test('local storage quota failure preserves a readable backup and recovers on manual retry', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto('/')
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.getByLabel('Actions for Sample Outfit', { exact: true })).toBeVisible()

  const key = 'VPWardrobe_index_12345'
  const encoded = await page.evaluate(key => localStorage.getItem(key), key)
  const document = decodeWardrobePayload(encoded)
  expect(Object.keys(document.index.outfits)).toHaveLength(2)
  delete document.pending
  const readableDocument = JSON.stringify(document)
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key, value: readableDocument })

  const loadAttempt = await page.evaluate(async () => {
    const originalSetItem = Storage.prototype.setItem
    window.__vpwQuotaProbe = { blocked: true, attempts: 0 }
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('VPWardrobe_index_') && window.__vpwQuotaProbe.blocked) {
        window.__vpwQuotaProbe.attempts++
        throw new DOMException('Simulated browser storage quota', 'QuotaExceededError')
      }
      return originalSetItem.call(this, key, value)
    }
    const storeUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(url => new URL(url).pathname.endsWith('/src/stores/fileSystemStore.js'))
    const { useFileSystemStore } = await import(storeUrl)
    const result = useFileSystemStore.getState().loadAll()
    return { result, attempts: window.__vpwQuotaProbe.attempts }
  })
  expect(loadAttempt.result).toBe(false)
  expect(loadAttempt.attempts).toBeGreaterThan(0)

  await expect(page.getByRole('alert')).toContainText('Browser rejected this local save')
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

test('browser localStorage can fill while origin storage has room, without losing the old wardrobe', async ({ page }) => {
  await page.goto('/')
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.getByLabel('Actions for Sample Outfit', { exact: true })).toBeVisible()

  const key = 'VPWardrobe_index_12345'
  const original = await page.evaluate(key => localStorage.getItem(key), key)
  expect(decodeWardrobePayload(original).index.outfits).toBeDefined()

  const probe = await page.evaluate(async key => {
    const chunk = 'x'.repeat(256 * 1024)
    let failure = null
    for (let index = 0; index < 128; index++) {
      try {
        localStorage.setItem(`vpw-quota-fixture-${index}`, chunk)
      } catch (error) {
        failure = error.name
        break
      }
    }
    let wardrobeWriteFailure = null
    const oldWardrobe = localStorage.getItem(key)
    try {
      localStorage.setItem(key, oldWardrobe + chunk)
    } catch (error) {
      wardrobeWriteFailure = error.name
    }
    const estimate = await navigator.storage.estimate()
    return {
      failure,
      wardrobeWriteFailure,
      availableBytes: estimate.quota - estimate.usage,
      originalStillReadable: localStorage.getItem(key),
    }
  }, key)

  expect(probe.failure).toBe('QuotaExceededError')
  expect(probe.wardrobeWriteFailure).toBe('QuotaExceededError')
  expect(probe.availableBytes).toBeGreaterThan(1024 * 1024)
  expect(probe.originalStillReadable).toBe(original)

  await page.reload()
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.getByLabel('Actions for Sample Outfit', { exact: true })).toBeVisible()
  const persisted = await page.evaluate(key => localStorage.getItem(key), key)
  expect(decodeWardrobePayload(persisted).index.outfits).toEqual(decodeWardrobePayload(original).index.outfits)
})

test('large legacy Base64 wardrobe migrates to a smaller UTF16 record and survives reload', async ({ page }) => {
  await page.goto('/')
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.getByLabel('Actions for Sample Outfit', { exact: true })).toBeVisible()

  const key = 'VPWardrobe_index_12345'
  const initial = await page.evaluate(key => localStorage.getItem(key), key)
  const document = decodeWardrobePayload(initial)
  const template = Object.values(document.index.outfits)[0]
  for (let index = 0; index < 120; index++) {
    const id = `legacy-outfit-${index}`
    document.index.outfits[id] = {
      ...structuredClone(template), id, name: `Imported outfit ${index}`,
      data: Array.from({ length: 8 }, (_, part) => ({
        Group: `Cloth${part}`, Name: `Garment${index}-${part}`, Color: [`#${(index * 7919 + part * 104729).toString(16)}`],
      })),
    }
  }
  const legacy = LZString.compressToBase64(JSON.stringify(document))
  expect(legacy.length).toBeGreaterThan(10_000)
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key, value: legacy })

  await page.reload()
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.getByLabel('Actions for Sample Outfit', { exact: true })).toBeVisible()
  const migrated = await page.evaluate(key => localStorage.getItem(key), key)
  expect(migrated).toMatch(/^VPW-LZ16:/)
  expect(migrated.length).toBeLessThan(legacy.length * 0.7)
  expect(decodeWardrobePayload(migrated).index).toEqual(document.index)

  await page.reload()
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.getByLabel('Actions for Sample Outfit', { exact: true })).toBeVisible()
  const reloaded = await page.evaluate(key => localStorage.getItem(key), key)
  expect(decodeWardrobePayload(reloaded).index).toEqual(document.index)

  const compact = `VPW-LZ16:${LZString.compressToUTF16(JSON.stringify(document))}`
  await page.route('**/__vpw_quota_probe__', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Storage probe</title>',
  }))
  await page.goto('/__vpw_quota_probe__')
  const capacity = await page.evaluate(({ key, legacy, compact }) => {
    const measure = value => {
      localStorage.clear()
      localStorage.setItem(key, value)
      let low = 0
      let high = 16 * 1024 * 1024
      while (high - low > 1024) {
        const middle = Math.floor((low + high) / 2)
        try {
          localStorage.setItem('filler', 'x'.repeat(middle))
          low = middle
        } catch (error) {
          if (error.name !== 'QuotaExceededError') throw error
          high = middle
        }
      }
      return low
    }
    const result = {
      browser: navigator.userAgent,
      base64: { characters: legacy.length, utf8Bytes: new TextEncoder().encode(legacy).length,
        fillerCharacters: measure(legacy) },
      utf16: { characters: compact.length, utf8Bytes: new TextEncoder().encode(compact).length,
        fillerCharacters: measure(compact) },
    }
    localStorage.clear()
    localStorage.setItem(key, legacy)
    localStorage.setItem('filler', 'x'.repeat(result.base64.fillerCharacters - 2048))
    return result
  }, { key, legacy, compact })
  expect(capacity.utf16.fillerCharacters - capacity.base64.fillerCharacters,
    JSON.stringify(capacity)).toBeGreaterThan(4096)

  await page.goto('/')
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.getByLabel('Actions for Sample Outfit', { exact: true })).toBeVisible()
  const nearLimit = await page.evaluate(key => ({
    raw: localStorage.getItem(key),
    deviceId: localStorage.getItem('VPW4_device_12345'),
  }), key)
  expect(nearLimit.raw).toMatch(/^VPW-LZ16:/)
  expect(decodeWardrobePayload(nearLimit.raw).index).toEqual(document.index)
  expect(nearLimit.deviceId).toMatch(/^[0-9a-f]{32}$/)

  await page.evaluate(async () => {
    const storeUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(url => new URL(url).pathname.endsWith('/src/stores/fileSystemStore.js'))
    const { useFileSystemStore } = await import(storeUrl)
    useFileSystemStore.getState().addOutfit({ name: 'Near quota edit', type: 'outfit', data: [] })
  })
  const edited = decodeWardrobePayload(await page.evaluate(key => localStorage.getItem(key), key))
  expect(Object.values(edited.index.outfits).some(outfit => outfit.name === 'Near quota edit')).toBe(true)
})
