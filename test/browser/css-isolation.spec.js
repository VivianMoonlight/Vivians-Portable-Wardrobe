import { test, expect } from '@playwright/test'

async function hostStyles(page) {
  return page.evaluate(() => {
    const note = document.querySelector('.host-note')
    const noteStyle = getComputedStyle(note)
    const rootStyle = getComputedStyle(document.documentElement)
    const host = document.getElementById('vpw-shadow-host')
    return {
      headStyles: document.head.querySelectorAll('style').length,
      outsideMantineStyles: document.querySelectorAll('[data-mantine-styles]').length,
      bodyStyle: document.body.getAttribute('style'),
      htmlStyle: document.documentElement.getAttribute('style'),
      bodyClass: document.body.className,
      htmlClass: document.documentElement.className,
      noteColor: noteStyle.color,
      noteFont: noteStyle.fontFamily,
      noteBackground: noteStyle.backgroundImage,
      outsideVpwColor: rootStyle.getPropertyValue('--vpw-color-text'),
      outsideMantineColor: rootStyle.getPropertyValue('--mantine-color-text'),
      hostVpwColor: getComputedStyle(host).getPropertyValue('--vpw-color-text'),
    }
  })
}

test('desktop panels and adjustments do not style or scroll-lock the game page', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTitle("Vivian's Portable Wardrobe", { exact: true })).toBeVisible()
  const before = await hostStyles(page)

  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.locator('.vpw-library-masonry')).toBeVisible()
  expect(await hostStyles(page)).toEqual(before)

  await page.locator('.vpw-outfit-select').first().click()
  await page.locator('.vpw-preview-actions').getByRole('button', { name: 'Adjust outfit', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Outfit adjustments', exact: true })).toBeVisible()
  expect(await hostStyles(page)).toEqual(before)

  const scoped = await page.evaluate(() => {
    const shadow = document.getElementById('vpw-shadow-host').shadowRoot
    const root = shadow.getElementById('vpw-root')
    const style = getComputedStyle(root)
    return {
      ownColor: style.getPropertyValue('--vpw-color-text').trim(),
      mantineColor: style.getPropertyValue('--mantine-color-text').trim(),
      runtimeStyles: shadow.querySelectorAll('[data-mantine-styles]').length,
    }
  })
  expect(scoped.ownColor).toBe(scoped.mantineColor)
  expect(scoped.ownColor).not.toBe('')
  expect(scoped.runtimeStyles).toBeGreaterThan(0)
})

test('mobile full-page wardrobe and filter drawer do not style or scroll-lock the game page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByTitle("Vivian's Portable Wardrobe", { exact: true })).toBeVisible()
  const before = await hostStyles(page)

  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.getByRole('dialog').first()).toBeVisible()
  expect(await hostStyles(page)).toEqual(before)

  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Filters', exact: true })).toBeVisible()
  expect(await hostStyles(page)).toEqual(before)
})
