import { test, expect } from '@playwright/test'

const original = {
  Cloth: 'Original shirt', ClothOuter: 'Original jacket', Head: 'Original face',
  BodyUpper: 'Original body', HairFront: 'Original hair', Hat: 'Original hat',
}
const incoming = {
  Cloth: 'Teal shirt', Suit: 'New undershirt', Head: 'Selected face',
  BodyUpper: 'Selected body', HairFront: 'Selected hair',
}

/** Supply BC appearance metadata and spy only on the final game adapter boundary. */
async function openFlowLibrary(page, { extras = 0 } = {}) {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.evaluate(async ({ original, incoming, extras }) => {
    const moduleUrl = suffix => performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(url => new URL(url).pathname.endsWith(suffix))
    const storeUrl = moduleUrl('/src/stores/fileSystemStore.js')
    const { useFileSystemStore } = await import(storeUrl)
    const { ExternalAdapter } = await import(moduleUrl('/src/utils/external_adapters.js'))
    const keys = [...new Set([...Object.keys(original), ...Object.keys(incoming)])]
    const body = new Set(['Head', 'BodyUpper', 'HairFront'])
    const metadata = new Map(keys.map(key => [key, {
      Name: key, Description: key, Category: 'Appearance', Clothing: !body.has(key),
    }]))
    window.AssetGroupMap = metadata
    window.AssetGroup = [...metadata.values()]
    const asAppearance = data => data.map(part => ({
      Asset: { Name: part.Name, Group: metadata.get(part.Group) }, Color: part.Color, Property: part.Property,
    }))
    window.Player.Appearance = asAppearance(Object.entries(original).map(([Group, Name]) => ({ Group, Name })))
    window.__flowProbe = { storeUrl, applications: [] }
    ExternalAdapter.applyOutfitToCharacter = (character, bundle) => {
      window.__flowProbe.applications.push({ name: character.Name, bundle: structuredClone(bundle) })
      character.Appearance = asAppearance(bundle)
      return true
    }
    const fs = useFileSystemStore.getState()
    for (const outfit of [...fs.outfits]) fs.removeOutfit(outfit.id)
    const tagId = fs.createTag('Daywear')
    const data = Object.entries(incoming).map(([Group, Name]) => ({ Group, Name }))
    fs.addOutfit({ name: 'Teal day outfit', data, tagIds: [tagId], cloudSync: false })
    fs.addOutfit({ name: 'Evening outfit', data, tagIds: [], cloudSync: false })
    for (let index = 0; index < extras; index++) {
      fs.addOutfit({ name: `Daywear ${String(index + 1).padStart(2, '0')}`, data, tagIds: [tagId], cloudSync: false })
    }
  }, { original, incoming, extras })
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.locator('.vpw-library-masonry')).toBeVisible()
  return errors
}

function outfitCard(page, name) {
  return page.locator('button.vpw-outfit-select').filter({ has: page.getByText(name, { exact: true }) })
}

async function previewNames(page) {
  return page.evaluate(async () => {
    const { useFileSystemStore } = await import(window.__flowProbe.storeUrl)
    return Object.fromEntries(useFileSystemStore.getState().previewItem.data.map(part => [part.Group, part.Name]))
  })
}

async function applicationCount(page) {
  return page.evaluate(() => window.__flowProbe.applications.length)
}

function slot(page, key, source) {
  return page.locator(`[data-slot-key="${key}"] input[value="${source}"]`)
}

async function expectSource(page, key, source) {
  await expect(slot(page, key, source)).toBeChecked()
}

test('select, preview, fine-tune and apply uses one named final action; only group sources cycle', async ({ page }) => {
  const errors = await openFlowLibrary(page)
  const card = outfitCard(page, 'Teal day outfit')
  await card.hover()
  await expect(page.locator('.vpw-workspace-edit')).toHaveCount(0)
  expect(await applicationCount(page)).toBe(0)
  // Keyboard activation follows the same explicit selection flow as pointer input.
  await card.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Apply to Tester', exact: true })).toHaveCount(1)
  await expect(page.getByText('Default behavior', { exact: true })).toHaveCount(0)
  await expect.poll(() => previewNames(page)).toEqual(incoming)
  await expectSource(page, 'ClothOuter', 'incoming')

  const group = page.locator('[data-group-id="ClothUpper"]')
  const source = group.locator('button[data-source="incoming"]')
  await source.click()
  await expect(source).toHaveAttribute('data-operation', 'add')
  await expect.poll(() => previewNames(page)).toEqual({ ...incoming, Cloth: original.Cloth, ClothOuter: original.ClothOuter })
  await expectSource(page, 'Cloth', 'original')

  await source.click()
  await expect(source).toHaveAttribute('data-operation', 'replace')
  await expect.poll(() => previewNames(page)).toEqual({ ...incoming, ClothOuter: original.ClothOuter })
  await expectSource(page, 'Cloth', 'incoming')
  await expectSource(page, 'ClothOuter', 'original')

  await source.click()
  await expect(source).toHaveAttribute('data-operation', 'full-replace')
  await expect.poll(() => previewNames(page)).toEqual(incoming)
  // An absent source clears the bundle, but it must not move the component to Empty.
  await expectSource(page, 'ClothOuter', 'incoming')
  await expect(slot(page, 'ClothOuter', 'empty')).not.toBeChecked()

  const originalShirt = page.locator('[data-slot-key="Cloth"] label').filter({ hasText: 'Original shirt' })
  await originalShirt.click()
  await originalShirt.click()
  await originalShirt.click()
  await expectSource(page, 'Cloth', 'original')
  await expect.poll(() => previewNames(page)).toEqual({ ...incoming, Cloth: original.Cloth })
  await page.locator('[data-slot-key="ClothOuter"] label').filter({ hasText: 'Empty' }).click()
  await expectSource(page, 'ClothOuter', 'empty')
  expect(await applicationCount(page)).toBe(0)

  await page.screenshot({ path: test.info().outputPath('outfit-flow-desktop.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Apply to Tester', exact: true }).click()
  await expect.poll(() => applicationCount(page)).toBe(1)
  await expect(page.locator('.vpw-workspace-footer').getByRole('status')).toHaveText('Applied to Tester')
  expect(await page.evaluate(() => Object.fromEntries(window.__flowProbe.applications[0].bundle.map(part => [part.Group, part.Name]))))
    .toEqual({ ...incoming, Cloth: original.Cloth })
  expect(errors).toEqual([])
})

test('body shortcuts act once and a newly selected outfit starts with full replacement', async ({ page }) => {
  const errors = await openFlowLibrary(page)
  await outfitCard(page, 'Teal day outfit').click()
  await page.getByRole('button', { name: 'Keep original body', exact: true }).click()
  await expect.poll(() => previewNames(page)).toEqual({
    ...incoming, Head: original.Head, BodyUpper: original.BodyUpper, HairFront: original.HairFront,
  })
  await page.getByRole('button', { name: 'Replace body only', exact: true }).click()
  await expect.poll(() => previewNames(page)).toEqual({
    ...original, Head: incoming.Head, BodyUpper: incoming.BodyUpper, HairFront: incoming.HairFront,
  })
  await page.getByRole('button', { name: /Back to wardrobe/ }).click()
  await outfitCard(page, 'Evening outfit').click()
  await expect.poll(() => previewNames(page)).toEqual(incoming)
  await expectSource(page, 'ClothOuter', 'incoming')
  expect(await applicationCount(page)).toBe(0)
  expect(errors).toEqual([])
})

for (const width of [320, 390]) {
  test(`mobile ${width}px keeps filters, scroll and final action reachable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const errors = await openFlowLibrary(page, { extras: 8 })
    await page.getByPlaceholder('Search outfit names and tags…').fill('day')
    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    const drawer = page.getByRole('dialog').last()
    await drawer.getByRole('textbox', { name: 'Filter by tag', exact: true }).fill('Daywear')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('option', { name: 'Daywear', exact: true })).toBeHidden()
    await expect(drawer).toBeVisible()
    await drawer.getByRole('textbox', { name: 'Filter by tag', exact: true }).click()
    await page.getByRole('option', { name: 'Daywear', exact: true }).click()
    await drawer.getByRole('button', { name: /Show .* outfits/ }).click()
    await expect(page.getByRole('button', { name: /Show .* outfits/ })).toHaveCount(0)
    const scroll = page.locator('.vpw-library-scroll')
    await outfitCard(page, 'Teal day outfit').evaluate(element => {
      element.addEventListener('click', () => {
        window.__flowProbe.browseScroll = element.closest('.vpw-library-scroll').scrollTop
      }, { once: true, capture: true })
    })
    await outfitCard(page, 'Teal day outfit').click()
    // Pointer activation may scroll a tall masonry card into view before clicking.
    const savedScroll = await page.evaluate(() => window.__flowProbe.browseScroll)
    expect(savedScroll).toBeGreaterThan(0)
    const apply = page.getByRole('button', { name: 'Apply to Tester', exact: true })
    await expect(apply).toBeInViewport()
    const body = page.locator('.vpw-workspace-adjustments')
    await expect(body.getByRole('button', { name: 'Keep original body', exact: true })).toBeInViewport()
    const bounds = await page.locator('.vpw-workspace-edit').evaluate(element => ({
      client: element.clientWidth, scroll: element.scrollWidth,
      left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
    }))
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1)
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(width)
    await page.screenshot({ path: test.info().outputPath(`outfit-flow-mobile-${width}.png`), fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: /Back to wardrobe/ }).click()
    await expect(page.getByPlaceholder('Search outfit names and tags…')).toHaveValue('day')
    await expect(outfitCard(page, 'Evening outfit')).toHaveCount(0)
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeCloseTo(savedScroll, 0)
    await page.getByRole('button', { name: /^Filters/ }).click()
    await expect(page.getByRole('dialog').last().getByRole('textbox', { name: 'Filter by tag', exact: true })).toHaveValue('Daywear')
    expect(await applicationCount(page)).toBe(0)
    expect(errors).toEqual([])
  })
}

test('short desktop keeps the final action reachable and mounted adjustment groups have unique IDs', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 400 })
  const errors = await openFlowLibrary(page)
  await outfitCard(page, 'Teal day outfit').click()
  await expect(page.getByRole('button', { name: 'Apply to Tester', exact: true })).toBeInViewport()
  await page.locator('.vpw-workspace-adjustments [data-slot-key]').last().scrollIntoViewIfNeeded()
  await expect(page.locator('.vpw-workspace-adjustments [data-slot-key]').last()).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Apply to Tester', exact: true })).toBeInViewport()
  await page.getByRole('tab', { name: 'History', exact: true }).click()
  await page.getByRole('button', { name: 'Outfit adjustments', exact: true }).click()
  const ids = await page.locator('[data-group-id] button[aria-controls]').evaluateAll(buttons => buttons.map(button => {
    const id = button.getAttribute('aria-controls')
    return { id, targetExists: !!button.getRootNode().getElementById(id) }
  }))
  expect(ids.length).toBeGreaterThan(1)
  expect(new Set(ids.map(({ id }) => id)).size).toBe(ids.length)
  expect(ids.every(({ targetExists }) => targetExists)).toBe(true)
  expect(errors).toEqual([])
})

test('failed preview explains the state and can render again after retry', async ({ page }) => {
  await openFlowLibrary(page)
  await outfitCard(page, 'Teal day outfit').click()
  const preview = page.locator('.vpw-workspace-preview')
  await expect(preview.getByRole('status')).toHaveText('The preview could not load. Try again.')
  await page.evaluate(async () => {
    const { useFileSystemStore } = await import(window.__flowProbe.storeUrl)
    window.addEventListener('pointerdown', () => { window.__flowProbe.retryClicked = true }, { once: true })
    useFileSystemStore.getState().renderer.drawCallbacks = {
      createRenderSession({ canvas, onUpdate }) {
        if (!window.__flowProbe.retryClicked) {
          onUpdate(null, { state: 'error', error: new Error('Preview fixture unavailable') })
          return { dispose() {} }
        }
        const context = canvas.getContext('2d')
        context.fillStyle = '#138579'
        context.fillRect(0, 0, canvas.width, canvas.height)
        onUpdate(canvas, { state: 'ready' })
        return { dispose() {} }
      },
    }
  })
  await preview.getByRole('button', { name: 'Reload preview', exact: true }).click()
  await expect(preview.getByRole('button', { name: 'Reload preview', exact: true })).toHaveCount(0)
  await expect(preview.getByRole('img', { name: 'Preview panel', exact: true })).toBeVisible()
  expect(await applicationCount(page)).toBe(0)
})

test('short mobile filter drawer keeps its result action visible with many tags', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  const errors = await openFlowLibrary(page)
  await page.evaluate(async () => {
    const { useFileSystemStore } = await import(window.__flowProbe.storeUrl)
    for (let index = 0; index < 15; index++) {
      useFileSystemStore.getState().createTag(`Collection ${index + 1} / A longer seasonal wardrobe label`)
    }
  })
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  const drawer = page.getByRole('dialog').last()
  const results = drawer.getByRole('button', { name: /Show .* outfits/ })
  await expect(results).toBeInViewport()
  await drawer.getByRole('button').filter({ has: page.getByText('Collection 15 / A longer seasonal wardrobe label', { exact: true }) }).click()
  await expect(results).toBeInViewport()
  await results.click()
  await expect(page.locator('.vpw-library-root')).toBeVisible()
  expect(errors).toEqual([])
})
