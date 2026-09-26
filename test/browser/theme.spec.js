import { test, expect } from '@playwright/test'

async function observeThemeSwitch(page) {
  await page.evaluate(() => {
    const root = document.getElementById('vpw-shadow-host')?.shadowRoot?.getElementById('vpw-root')
    const card = root?.querySelector('.vpw-outfit-select')
    if (!root || !card) throw new Error('Wardrobe card was not mounted')

    window.__themeSwitchProbe = { changes: [], hostStyleInserts: 0 }
    new MutationObserver(() => {
      window.__themeSwitchProbe.changes.push({
        scheme: root.getAttribute('data-mantine-color-scheme'),
        guarded: root.hasAttribute('data-vpw-switching-theme'),
        cardTransition: getComputedStyle(card).transitionDuration,
      })
    }).observe(root, { attributes: true, attributeFilter: ['data-mantine-color-scheme'] })
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && node.hasAttribute('data-mantine-disable-transition')) {
            window.__themeSwitchProbe.hostStyleInserts++
          }
        }
      }
    }).observe(document.head, { childList: true })
  })
}

test('desktop theme switches without animated card colors or touching host page transitions', async ({ page }) => {
  await page.goto('/')
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.locator('.vpw-outfit-select').first()).toBeVisible()
  await observeThemeSwitch(page)

  await page.getByRole('button', { name: 'Switch theme', exact: true }).click()
  const dark = await page.evaluate(() => ({
    scheme: document.getElementById('vpw-shadow-host')?.shadowRoot?.getElementById('vpw-root')?.getAttribute('data-mantine-color-scheme'),
    probe: window.__themeSwitchProbe,
  }))
  expect(dark.scheme).toBe('dark')
  expect(dark.probe.changes).toContainEqual({ scheme: 'dark', guarded: true, cardTransition: '0s' })
  expect(dark.probe.hostStyleInserts).toBe(0)

  await page.getByRole('button', { name: 'Switch theme', exact: true }).click()
  const light = await page.evaluate(() => ({
    scheme: document.getElementById('vpw-shadow-host')?.shadowRoot?.getElementById('vpw-root')?.getAttribute('data-mantine-color-scheme'),
    probe: window.__themeSwitchProbe,
  }))
  expect(light.scheme).toBe('light')
  expect(light.probe.changes).toContainEqual({ scheme: 'light', guarded: true, cardTransition: '0s' })
  expect(light.probe.hostStyleInserts).toBe(0)
})

test('mobile settings theme persists when the wardrobe is reopened', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await page.getByText('Settings', { exact: true }).click()
  await page.getByRole('button', { name: '☾ Dark mode', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.getElementById('vpw-shadow-host')?.shadowRoot?.getElementById('vpw-root')?.getAttribute('data-mantine-color-scheme'))).toBe('dark')

  await page.reload()
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.getElementById('vpw-shadow-host')?.shadowRoot?.getElementById('vpw-root')?.getAttribute('data-mantine-color-scheme'))).toBe('dark')
  await expect(page.getByRole('button', { name: '☾ Dark mode', exact: true })).toHaveAttribute('data-variant', 'filled')
})
