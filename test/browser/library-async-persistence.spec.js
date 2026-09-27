import { test, expect } from '@playwright/test'

test('a rejected outfit save stays visible and reports the failure', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto('/')
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.getByLabel('Actions for Sample Outfit', { exact: true })).toBeVisible()

  await page.evaluate(async () => {
    const storeUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(url => new URL(url).pathname.endsWith('/src/stores/fileSystemStore.js'))
    const { useFileSystemStore } = await import(storeUrl)
    useFileSystemStore.getState()._getRepository().apply = async () => {
      throw new Error('Injected local write failure')
    }
  })

  await page.getByLabel('Actions for Sample Outfit', { exact: true }).click()
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  await page.getByRole('dialog').last().getByRole('textbox').fill('Unsaved name')
  await page.getByRole('button', { name: 'OK', exact: true }).click()

  await expect(page.getByRole('dialog').last()).toContainText('Injected local write failure')
  await expect(page.getByLabel('Actions for Sample Outfit', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Actions for Unsaved name', { exact: true })).toHaveCount(0)
  expect(pageErrors).toEqual([])
})
