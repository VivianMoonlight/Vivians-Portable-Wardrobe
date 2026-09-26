import { test, expect } from '@playwright/test'

async function openLibrary(page) {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.getByText('Shared cloud storage', { exact: true })).toBeVisible()
  return errors
}

async function selectTag(page, name) {
  const sidebar = page.locator('.vpw-library-sidebar')
  await sidebar.getByRole('button').filter({ has: page.getByText(name, { exact: true }) }).first().click()
}

test('create a tag, classify an outfit, then delete the tag without deleting the outfit', async ({ page }) => {
  const errors = await openLibrary(page)
  await page.getByRole('button', { name: 'Manage tags', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New tag', exact: true }).click()
  await page.getByRole('dialog').last().getByRole('textbox').fill('Evening')
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await selectTag(page, 'All outfits')
  await page.getByLabel('Actions for Sample Outfit', { exact: true }).click()
  await page.getByRole('menuitem', { name: 'Edit tags', exact: true }).click()
  await page.getByRole('textbox', { name: 'Tags', exact: true }).fill('Evening')
  await page.getByRole('option', { name: 'Evening', exact: true }).click()
  await page.getByRole('button', { name: 'Save tags', exact: true }).click()
  await selectTag(page, 'Evening')
  await expect(page.getByLabel('Actions for Sample Outfit', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Actions for Local draft', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Manage tags', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Delete selected tag', exact: true }).click()
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(page.getByLabel('Actions for Sample Outfit', { exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('indexed-library-desktop.png'), fullPage: true, animations: 'disabled' })
  expect(errors).toEqual([])
})

test('rename and deletion survive reload; total extension quota pauses upload without removing local outfits', async ({ page }) => {
  const errors = await openLibrary(page)
  await page.getByLabel('Actions for Sample Outfit', { exact: true }).click()
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  await page.getByRole('dialog').last().getByRole('textbox').fill('Renamed outfit')
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await page.reload()
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.getByLabel('Actions for Renamed outfit', { exact: true })).toBeVisible()
  await page.getByLabel('Actions for Renamed outfit', { exact: true }).click()
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await page.reload()
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.getByLabel('Actions for Renamed outfit', { exact: true })).toHaveCount(0)
  await page.evaluate(() => { window.Player.ExtensionSettings.OtherPlugin = 'x'.repeat(180000) })
  await page.getByRole('button', { name: 'Retry upload', exact: true }).click()
  await expect(page.getByText(/Upload paused: the proposed update exceeds/)).toBeVisible()
  await expect(page.getByLabel('Actions for Local draft', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('mobile index stays usable and can search by a migrated tag', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const errors = await openLibrary(page)
  await page.getByPlaceholder('Search outfits or tags…').fill('夏天')
  await expect(page.getByLabel('Actions for Sample Outfit', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Actions for Local draft', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Manage tags', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'New tag', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.screenshot({ path: test.info().outputPath('indexed-library-mobile.png'), fullPage: true, animations: 'disabled' })
  await expect(page.getByText('Shared cloud storage', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
