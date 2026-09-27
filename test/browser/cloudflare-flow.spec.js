import { test, expect } from '@playwright/test'

const endpoint = 'http://127.0.0.1:5180'

async function mockCloudflare(page) {
  const server = { revision: 0, index: null, calls: [], offline: false }

  // The normal browser suite tests an unconfigured build. Supply the test URL
  // only to this page so its real client and settings UI can run end to end.
  await page.route('**/cloudflare-wardrobe-client.js*', async route => {
    const response = await route.fetch()
    const source = await response.text()
    const original = "return import.meta.env?.VITE_CLOUDFLARE_SYNC_URL || ''"
    expect(source).toContain(original)
    await route.fulfill({ response, body: source.replace(original, `return '${endpoint}'`) })
  })

  await page.route('**/api/wardrobe', async route => {
    const request = route.request()
    const body = request.method() === 'PUT' ? request.postDataJSON() : null
    server.calls.push({ method: request.method(), authorization: request.headers().authorization, body })
    const send = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (server.offline) return send(503, { error: 'offline' })
    if (request.method() === 'GET') return send(200, { revision: server.revision, index: server.index })
    if (request.method() !== 'PUT') return send(405, { error: 'method' })
    if (body.expectedRevision !== server.revision) {
      return send(409, { revision: server.revision, index: server.index })
    }
    server.index = body.index
    server.revision++
    return send(200, { revision: server.revision })
  })
  return server
}

async function openSettings(page) {
  await page.goto('/')
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await page.getByRole('tab', { name: 'Settings' }).click()
}

async function savedGameUpdates(page) {
  return page.evaluate(() => window.__vpwMockAccountUpdates || [])
}

test('opt-in writes a CAS wardrobe to Cloudflare while BC receives only the recovery key', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const server = await mockCloudflare(page)
  await openSettings(page)

  const baseline = (await savedGameUpdates(page)).length
  const toggle = page.getByRole('switch', { name: 'Use Cloudflare sync' })
  await expect(toggle).toBeEnabled()
  await toggle.check()
  await expect(toggle).toBeChecked()
  await expect.poll(() => server.revision).toBe(1)

  const key = await page.evaluate(() => window.Player.ExtensionSettings.VPWCloudKey)
  expect(key).toMatch(/^vpw1_[A-Za-z0-9_-]{43}$/)
  expect(server.calls.map(call => call.method)).toEqual(['GET', 'PUT'])
  expect(server.calls.every(call => call.authorization === `Bearer ${key}`)).toBe(true)
  expect(server.calls[1].body.expectedRevision).toBe(0)
  expect(Object.values(server.index.outfits).map(item => item.name)).toContain('Sample Outfit')
  expect(Object.values(server.index.outfits).map(item => item.name)).not.toContain('Local draft')

  const dashboard = page.getByRole('link', { name: 'Open cloud data page' })
  await expect(dashboard).toHaveAttribute('href', endpoint)
  await expect(dashboard).toHaveAttribute('target', '_blank')
  expect(await dashboard.getAttribute('href')).not.toContain(key)

  await page.getByRole('tab', { name: 'Wardrobe' }).click()
  await page.evaluate(async () => {
    const storeUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(url => new URL(url).pathname.endsWith('/src/stores/fileSystemStore.js'))
    const { useFileSystemStore } = await import(storeUrl)
    useFileSystemStore.getState().characterItem = [{ Group: 'Cloth', Name: 'Cloud test shirt' }]
  })
  await page.getByRole('button', { name: 'Import / Export' }).click()
  await page.getByRole('menuitem', { name: 'Save current outfit' }).click()
  await page.getByRole('dialog').last().getByRole('textbox').fill('Cloud flow outfit')
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(page.getByText('Saved "Cloud flow outfit" to this device.')).toBeVisible()
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => server.revision).toBe(2)
  expect(server.calls.filter(call => call.method === 'PUT').map(call => call.body.expectedRevision)).toEqual([0, 1])
  expect(Object.values(server.index.outfits).map(item => item.name)).toContain('Cloud flow outfit')

  const updates = (await savedGameUpdates(page)).slice(baseline)
  expect(updates.length).toBeGreaterThan(0)
  expect(updates.some(fields => fields['ExtensionSettings.VPWCloudKey'] === key)).toBe(true)
  expect(updates.every(fields => !Object.hasOwn(fields, 'ExtensionSettings.VPWardrobe')
    || fields['ExtensionSettings.VPWardrobe'] === null)).toBe(true)
  expect(errors).toEqual([])
})

test('Cloudflare outage leaves an outfit edit saved locally and never sends its payload to BC', async ({ page }) => {
  const server = await mockCloudflare(page)
  await openSettings(page)
  await page.getByRole('switch', { name: 'Use Cloudflare sync' }).check()
  await expect.poll(() => server.revision).toBe(1)
  const baseline = (await savedGameUpdates(page)).length
  server.offline = true

  await page.getByRole('tab', { name: 'Wardrobe' }).click()
  await page.getByLabel('Actions for Sample Outfit', { exact: true }).click()
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  await page.getByRole('dialog').last().getByRole('textbox').fill('Saved despite outage')
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(page.getByLabel('Actions for Saved despite outage', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Sync now', exact: true }).click()
  await expect(page.getByText('Cloudflare sync failed (HTTP 503)').first()).toBeVisible()
  expect(server.revision).toBe(1)
  expect((await savedGameUpdates(page)).slice(baseline).every(fields =>
    !Object.hasOwn(fields, 'ExtensionSettings.VPWardrobe'))).toBe(true)

  await page.reload()
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.getByLabel('Actions for Saved despite outage', { exact: true })).toBeVisible()
})
