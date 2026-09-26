import { test, expect } from '@playwright/test'

async function openWardrobeWithOutfit(page) {
  await page.goto('/')
  await expect(page.getByTitle("Vivian's Portable Wardrobe", { exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(entry => new URL(entry).pathname.endsWith('/src/stores/fileSystemStore.js'))
    const adapterUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(entry => new URL(entry).pathname.endsWith('/src/utils/external_adapters.js'))
    const { useFileSystemStore } = await import(url)
    const { ExternalAdapter } = await import(adapterUrl)
    window.__forceUiProbe = { storeUrl: url, calls: 0 }
    window.AssetGroupMap = new Map([['Cloth', { Name: 'Cloth', Description: 'Cloth', Category: 'Appearance', Clothing: true }]])
    window.AssetGroup = [...window.AssetGroupMap.values()]
    const fs = useFileSystemStore.getState()
    for (const outfit of [...fs.outfits]) fs.removeOutfit(outfit.id)
    fs.addOutfit({ name: 'Force test outfit', data: [{ Group: 'Cloth', Name: 'New shirt' }], tagIds: [], cloudSync: false })
    ExternalAdapter.applyOutfitToSelfForced = () => {
      window.__forceUiProbe.calls++
      return true
    }
  })
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await page.getByRole('button', { name: 'Preview Force test outfit', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Apply to Tester', exact: true })).toBeVisible()
}

test('force apply stays hidden until enabled and disappears for a player-like non-self target', async ({ page }) => {
  test.slow()
  await openWardrobeWithOutfit(page)
  const forceButton = page.getByRole('button', { name: 'Force apply to Tester', exact: true })
  await expect(forceButton).toHaveCount(0)

  await page.getByRole('tab', { name: 'Settings', exact: true }).click()
  const setting = page.getByRole('switch', { name: 'Allow force apply to myself' })
  await expect(setting).not.toBeChecked()
  await setting.check()
  await expect(setting).toBeChecked()
  await page.getByRole('tab', { name: 'Wardrobe', exact: true }).click()
  await expect(forceButton).toBeVisible()
  await forceButton.click()
  await expect.poll(() => page.evaluate(() => window.__forceUiProbe.calls)).toBe(1)
  await expect(page.locator('.vpw-preview-actions').getByRole('status')).toContainText('Force apply attempted for Tester')

  await page.evaluate(async () => {
    const { useFileSystemStore } = await import(window.__forceUiProbe.storeUrl)
    useFileSystemStore.getState().setCharacter({ ...window.Player, IsPlayer: () => true })
  })
  await expect(forceButton).toHaveCount(0)
  await page.evaluate(async () => {
    const { useFileSystemStore } = await import(window.__forceUiProbe.storeUrl)
    useFileSystemStore.getState().setCharacter(window.Player)
  })
  await expect(forceButton).toBeVisible()

  await page.getByRole('tab', { name: 'Settings', exact: true }).click()
  await setting.uncheck()
  await page.getByRole('tab', { name: 'Wardrobe', exact: true }).click()
  await expect(forceButton).toHaveCount(0)
})

test('mobile settings reveal a reachable force button on the preview page', async ({ page }) => {
  test.slow()
  await page.setViewportSize({ width: 320, height: 568 })
  await openWardrobeWithOutfit(page)
  const preview = page.locator('.vpw-mobile-preview-page')
  await expect(preview).toBeVisible()
  await expect(preview.getByRole('button', { name: 'Force apply to Tester', exact: true })).toHaveCount(0)
  await preview.getByRole('button', { name: 'Back to wardrobe', exact: true }).click()
  await page.getByRole('radiogroup').getByText('Settings', { exact: true }).click()
  const setting = page.getByRole('switch', { name: 'Allow force apply to myself' })
  await setting.check()
  await page.getByRole('radiogroup').getByText('Wardrobe', { exact: true }).click()
  await page.getByRole('button', { name: 'Preview Force test outfit', exact: true }).click()
  const forceButton = preview.getByRole('button', { name: 'Force apply to Tester', exact: true })
  await expect(forceButton).toBeInViewport()
  expect(await preview.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
})
