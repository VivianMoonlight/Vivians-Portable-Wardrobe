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
async function openFlowLibrary(page, { extras = 0, render = true, hidden = false } = {}) {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.evaluate(async ({ original, incoming, extras, render, hidden }) => {
    if (hidden) {
      original = { ...original, Blush: 'Live blush', ArmsLeft: 'Live arm' }
      incoming = { ...incoming, Blush: 'Saved blush', ArmsLeft: 'Saved arm', Fluids: 'Saved fluids' }
    }
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
    if (render) fs.renderer.drawCallbacks = {
      createRenderSession({ data, canvas, onUpdate }) {
        const context = canvas.getContext('2d')
        context.fillStyle = data.some(part => part.Group === 'Cloth' && part.Name === original.Cloth) ? '#bd793e' : '#3c9786'
        context.fillRect(0, 0, canvas.width, canvas.height)
        onUpdate(canvas, { state: 'ready' })
        return { dispose() {} }
      },
    }
    for (const outfit of [...fs.outfits]) fs.removeOutfit(outfit.id)
    const tagId = fs.createTag('Daywear')
    const data = Object.entries(incoming).map(([Group, Name]) => ({ Group, Name }))
    fs.addOutfit({ name: 'Teal day outfit', data, tagIds: [tagId], cloudSync: false })
    fs.addOutfit({ name: 'Evening outfit', data, tagIds: [], cloudSync: false })
    for (let index = 0; index < extras; index++) {
      fs.addOutfit({ name: `Daywear ${String(index + 1).padStart(2, '0')}`, data, tagIds: [tagId], cloudSync: false })
    }
  }, { original, incoming, extras, render, hidden })
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

async function centerPixel(canvas) {
  return canvas.evaluate(element => [...element.getContext('2d').getImageData(
    Math.floor(element.width / 2), Math.floor(element.height / 2), 1, 1,
  ).data])
}

async function openAdjustments(page) {
  await page.locator('.vpw-preview-actions').getByRole('button', { name: 'Adjust outfit', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Outfit adjustments', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

test('selection keeps the library visible; adjustment actions follow preview state and only the named apply button changes the character', async ({ page }) => {
  const errors = await openFlowLibrary(page)
  const card = outfitCard(page, 'Teal day outfit')
  await card.hover()
  await expect(page.locator('.vpw-workspace-preview')).toHaveCount(0)
  await expect(page.locator('.vpw-adjustments-dialog')).toHaveCount(0)
  expect(await applicationCount(page)).toBe(0)
  // Keyboard activation follows the same explicit selection flow as pointer input.
  await card.focus()
  await page.keyboard.press('Enter')
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('aria-pressed', 'true')
  await expect(outfitCard(page, 'Evening outfit')).toBeVisible()
  await expect(page.locator('.vpw-workspace-columns')).toHaveAttribute('data-preview-open', 'true')
  await expect(page.getByRole('button', { name: 'Apply to Tester', exact: true })).toHaveCount(1)
  await expect(page.getByText('Default behavior', { exact: true })).toHaveCount(0)
  await expect.poll(() => previewNames(page)).toEqual(incoming)
  const adjustments = await openAdjustments(page)
  await expect(adjustments.getByRole('button', { name: 'Apply to Tester', exact: true })).toHaveCount(0)
  await expect.poll(() => centerPixel(adjustments.locator('canvas'))).toEqual([60, 151, 134, 255])
  await expectSource(page, 'ClothOuter', 'incoming')

  const group = page.locator('[data-group-id="ClothUpper"]')
  const outfitSource = group.locator('button[data-source="incoming"]')
  await expect(outfitSource).toHaveAttribute('data-operation', 'full-replace')
  await expect(outfitSource).toHaveAttribute('data-complete', 'true')
  await expect(outfitSource).toBeDisabled()
  const source = group.locator('button[data-source="original"]')
  await expect(source).toHaveAttribute('data-operation', 'add')
  await source.click()
  await expect.poll(() => previewNames(page)).toEqual({ ...incoming, ClothOuter: original.ClothOuter })
  await expectSource(page, 'Cloth', 'incoming')
  await expect(source).toHaveAttribute('data-operation', 'replace')

  await source.click()
  await expect.poll(() => previewNames(page)).toEqual({ ...incoming, Cloth: original.Cloth, ClothOuter: original.ClothOuter })
  await expectSource(page, 'Cloth', 'original')
  await expectSource(page, 'ClothOuter', 'original')
  await expect(source).toHaveAttribute('data-operation', 'full-replace')
  await expect.poll(() => centerPixel(adjustments.locator('canvas'))).toEqual([189, 121, 62, 255])

  await source.click()
  const fullOriginalGroup = { ...incoming, Cloth: original.Cloth, ClothOuter: original.ClothOuter }
  delete fullOriginalGroup.Suit
  await expect.poll(() => previewNames(page)).toEqual(fullOriginalGroup)
  await expect(source).toHaveAttribute('data-operation', 'full-replace')
  await expect(source).toHaveAttribute('data-complete', 'true')
  await expect(source).toBeDisabled()
  // An absent source clears the bundle, but it must not move the component to Empty.
  await expectSource(page, 'Suit', 'original')
  await expect(slot(page, 'Suit', 'empty')).not.toBeChecked()
  // Reaching completion must not drop keyboard focus or reset the group on Escape.
  await expect(source).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(adjustments).toBeHidden()
  await expect(page.locator('.vpw-preview-actions').getByRole('button', { name: 'Adjust outfit', exact: true })).toBeFocused()
  await openAdjustments(page)
  await expect.poll(() => previewNames(page)).toEqual(fullOriginalGroup)
  await expect(source).toHaveAttribute('data-complete', 'true')

  const selectedShirt = page.locator('[data-slot-key="Cloth"] label').filter({ hasText: 'Teal shirt' })
  await selectedShirt.click()
  await selectedShirt.click()
  await selectedShirt.click()
  await expectSource(page, 'Cloth', 'incoming')
  await expect.poll(() => previewNames(page)).toEqual({ ...fullOriginalGroup, Cloth: incoming.Cloth })
  await page.locator('[data-slot-key="ClothOuter"] label').filter({ hasText: 'Empty' }).click()
  await expectSource(page, 'ClothOuter', 'empty')
  expect(await applicationCount(page)).toBe(0)

  await adjustments.getByRole('button', { name: 'Done adjusting', exact: true }).click()
  await expect(adjustments).toBeHidden()
  expect(await applicationCount(page)).toBe(0)
  await expect.poll(() => centerPixel(page.locator('.vpw-workspace-preview canvas'))).toEqual([60, 151, 134, 255])
  await page.screenshot({ path: test.info().outputPath('outfit-flow-desktop.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Apply to Tester', exact: true }).click()
  await expect.poll(() => applicationCount(page)).toBe(1)
  await expect(page.locator('.vpw-preview-actions').getByRole('status')).toHaveText('Applied to Tester')
  const applied = { ...incoming }
  delete applied.Suit
  expect(await page.evaluate(() => Object.fromEntries(window.__flowProbe.applications[0].bundle.map(part => [part.Group, part.Name]))))
    .toEqual(applied)
  expect(errors).toEqual([])
})

test('body shortcuts act once and a newly selected outfit starts with full replacement', async ({ page }) => {
  const errors = await openFlowLibrary(page)
  await outfitCard(page, 'Teal day outfit').click()
  const adjustments = await openAdjustments(page)
  await page.getByRole('button', { name: 'Keep original body', exact: true }).click()
  await expect.poll(() => previewNames(page)).toEqual({
    ...incoming, Head: original.Head, BodyUpper: original.BodyUpper, HairFront: original.HairFront,
  })
  await page.getByRole('button', { name: 'Replace body only', exact: true }).click()
  await expect.poll(() => previewNames(page)).toEqual({
    ...original, Head: incoming.Head, BodyUpper: incoming.BodyUpper, HairFront: incoming.HairFront,
  })
  await adjustments.getByRole('button', { name: 'Done adjusting', exact: true }).click()
  await outfitCard(page, 'Evening outfit').click()
  await expect.poll(() => previewNames(page)).toEqual(incoming)
  await openAdjustments(page)
  await expectSource(page, 'ClothOuter', 'incoming')
  expect(await applicationCount(page)).toBe(0)
  expect(errors).toEqual([])
})

test('hidden BC body slots stay live in preview and apply, and are absent from adjustments', async ({ page }) => {
  const errors = await openFlowLibrary(page, { hidden: true })
  await outfitCard(page, 'Teal day outfit').click()
  await expect.poll(() => previewNames(page)).toEqual({ ...incoming, Blush: 'Live blush', ArmsLeft: 'Live arm' })
  const adjustments = await openAdjustments(page)
  expect(await page.evaluate(async () => {
    const { useFileSystemStore } = await import(window.__flowProbe.storeUrl)
    return useFileSystemStore.getState().filterSnapshot.groups.some(group => group.groupID === 'HiddenBody')
  })).toBe(true)
  await adjustments.getByRole('checkbox', { name: 'Show all slots' }).check()
  await expect(adjustments.locator('[data-group-id="HiddenBody"]')).toHaveCount(0)
  await expect(adjustments.locator('[data-slot-key="Blush"]')).toHaveCount(0)
  await adjustments.getByRole('button', { name: 'Done adjusting', exact: true }).click()
  await page.getByRole('button', { name: 'Apply to Tester', exact: true }).click()
  const applied = await page.evaluate(() => Object.fromEntries(window.__flowProbe.applications[0].bundle.map(part => [part.Group, part.Name])))
  expect(applied.Blush).toBe('Live blush')
  expect(applied.ArmsLeft).toBe('Live arm')
  expect(applied.Fluids).toBeUndefined()
  expect(errors).toEqual([])
})

test('Cards and List are the only views; list selection keeps rows visible without mounting thumbnails', async ({ page }) => {
  const errors = await openFlowLibrary(page)
  const toolbar = page.locator('.vpw-library-toolbar')
  const cardView = toolbar.getByRole('button', { name: 'Cards', exact: true })
  const listView = toolbar.getByRole('button', { name: 'List', exact: true })
  await expect(toolbar.locator('button[aria-pressed]')).toHaveCount(2)
  await expect(cardView).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.vpw-library-masonry canvas')).toHaveCount(2)
  await listView.click()
  await expect(listView).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.vpw-library-masonry')).toHaveAttribute('data-view', 'list')
  await expect(page.locator('.vpw-library-masonry .vpw-thumbnail')).toHaveCount(0)
  await expect(page.locator('.vpw-library-masonry canvas')).toHaveCount(0)
  const row = outfitCard(page, 'Teal day outfit')
  await row.focus()
  await page.keyboard.press('Enter')
  await expect(row).toBeVisible()
  await expect.poll(() => previewNames(page)).toEqual(incoming)
  await expect(page.locator('.vpw-workspace-preview canvas')).toBeVisible()
  await expect(page.locator('.vpw-library-masonry canvas')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('outfit-list-preview.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Close preview', exact: true }).click()
  await expect(row).toBeFocused()
  await expect(page.locator('.vpw-workspace-preview')).toHaveCount(0)
  await expect(page.locator('.vpw-library-masonry')).toHaveAttribute('data-view', 'list')
  await cardView.click()
  await expect(page.locator('.vpw-library-masonry canvas')).toHaveCount(2)
  expect(await applicationCount(page)).toBe(0)
  expect(errors).toEqual([])
})

test('Escape closes the target picker before closing adjustments and leaves the preview open', async ({ page }) => {
  const errors = await openFlowLibrary(page)
  await outfitCard(page, 'Teal day outfit').click()
  const adjustments = await openAdjustments(page)
  await adjustments.getByRole('textbox', { name: 'Target character', exact: true }).click()
  await expect(page.getByRole('option', { name: 'Tester', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('option', { name: 'Tester', exact: true })).toBeHidden()
  await expect(adjustments).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(adjustments).toBeHidden()
  await expect(page.locator('.vpw-workspace-preview')).toBeVisible()
  await expect(page.locator('.vpw-preview-actions').getByRole('button', { name: 'Adjust outfit', exact: true })).toBeFocused()
  expect(await applicationCount(page)).toBe(0)
  expect(errors).toEqual([])
})

for (const width of [320, 390]) {
  test(`mobile ${width}px uses full pages for preview and adjustments, preserving filters and scroll on return`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 })
    const errors = await openFlowLibrary(page, { extras: 8 })
    await page.getByPlaceholder('Search outfits or tags…').fill('day')
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
    const lastCard = page.locator('.vpw-library-masonry button.vpw-outfit-select').last()
    await lastCard.evaluate(element => {
      element.addEventListener('click', () => {
        window.__flowProbe.browseScroll = element.closest('.vpw-library-scroll').scrollTop
      }, { once: true, capture: true })
    })
    await lastCard.click()
    // Pointer activation may scroll a tall masonry card into view before clicking.
    const savedScroll = await page.evaluate(() => window.__flowProbe.browseScroll)
    expect(savedScroll).toBeGreaterThan(0)
    const apply = page.getByRole('button', { name: 'Apply to Tester', exact: true })
    await expect(apply).toBeInViewport()
    const preview = page.locator('.vpw-mobile-preview-page')
    await expect(preview).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(page.locator('.vpw-adjustments-dialog')).toHaveCount(0)
    await expect(page.locator('.vpw-workspace-browse')).toBeHidden()
    await expect.poll(() => lastCard.locator('canvas').evaluate(canvas => [canvas.width, canvas.height])).toEqual([1, 1])
    await expect(page.getByRole('radio', { name: 'Wardrobe', exact: true })).toHaveCount(0)
    await expect(preview.getByRole('button', { name: 'Back to wardrobe', exact: true })).toBeInViewport()
    await expect.poll(() => previewNames(page)).toEqual(incoming)
    await expect.poll(() => preview.evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(width)
    const bounds = await preview.evaluate(element => ({
      client: element.clientWidth, scroll: element.scrollWidth,
      left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
    }))
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1)
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(width)
    const adjustButton = preview.getByRole('button', { name: 'Adjust outfit', exact: true })
    await expect(adjustButton).not.toHaveAttribute('aria-haspopup', 'dialog')
    await adjustButton.click()
    const adjustments = page.locator('.vpw-adjustments-page')
    await expect(adjustments).toBeVisible()
    await expect(preview).toBeHidden()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(page.locator('.vpw-adjustments-dialog')).toHaveCount(0)
    await expect(adjustments.getByRole('button', { name: 'Back to preview', exact: true })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Apply to Tester', exact: true })).toHaveCount(0)
    if (width === 390) {
      await adjustments.getByRole('textbox', { name: 'Target character', exact: true }).click()
      await expect(page.getByRole('option', { name: 'Tester', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('option', { name: 'Tester', exact: true })).toBeHidden()
      await expect(adjustments).toBeVisible()
    }
    await expect(adjustments.getByRole('button', { name: 'Keep original body', exact: true })).toBeInViewport()
    await expect(adjustments.getByRole('button', { name: 'Done adjusting', exact: true })).toBeInViewport()
    await adjustments.locator('[data-slot-key]').last().scrollIntoViewIfNeeded()
    await expect(adjustments.locator('[data-slot-key]').last()).toBeInViewport()
    await expect(adjustments.getByRole('button', { name: 'Done adjusting', exact: true })).toBeInViewport()
    await adjustments.getByRole('button', { name: 'Keep original body', exact: true }).click()
    await expect.poll(() => previewNames(page)).toEqual({
      ...incoming, Head: original.Head, BodyUpper: original.BodyUpper, HairFront: original.HairFront,
    })
    await page.screenshot({ path: test.info().outputPath(`outfit-flow-mobile-${width}.png`), fullPage: true, animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(adjustments).toBeHidden()
    await expect(preview).toBeVisible()
    await expect(page.locator('.vpw-workspace-browse')).toBeHidden()
    await expect(apply).toBeInViewport()
    if (width === 390) {
      await adjustButton.click()
      await adjustments.getByRole('button', { name: 'Back to preview', exact: true }).click()
      await expect(preview).toBeVisible()
      await adjustButton.click()
      await adjustments.getByRole('button', { name: 'Done adjusting', exact: true }).click()
      await expect(preview).toBeVisible()
      await expect.poll(() => previewNames(page)).toEqual({
        ...incoming, Head: original.Head, BodyUpper: original.BodyUpper, HairFront: original.HairFront,
      })
      await page.keyboard.press('Escape')
    } else {
      await preview.getByRole('button', { name: 'Back to wardrobe', exact: true }).click()
    }
    await expect(preview).toBeHidden()
    await expect(page.locator('.vpw-workspace-browse')).toBeVisible()
    await expect(page.getByRole('radiogroup')).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Wardrobe', exact: true })).toBeChecked()
    await expect(page.getByPlaceholder('Search outfits or tags…')).toHaveValue('day')
    await expect(outfitCard(page, 'Evening outfit')).toHaveCount(0)
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeCloseTo(savedScroll, 0)
    await expect.poll(() => centerPixel(lastCard.locator('canvas'))).toEqual([60, 151, 134, 255])
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
  let adjustments = await openAdjustments(page)
  await adjustments.locator('[data-slot-key]').last().scrollIntoViewIfNeeded()
  await expect(adjustments.locator('[data-slot-key]').last()).toBeInViewport()
  await expect(adjustments.getByRole('button', { name: 'Done adjusting', exact: true })).toBeInViewport()
  await adjustments.getByRole('button', { name: 'Done adjusting', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Apply to Tester', exact: true })).toBeInViewport()
  await page.getByRole('tab', { name: 'History', exact: true }).click()
  await page.getByRole('button', { name: 'Adjust outfit', exact: true }).click()
  adjustments = page.getByRole('dialog', { name: 'Outfit adjustments', exact: true })
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
  await openFlowLibrary(page, { render: false })
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
  await expect(preview.getByRole('img', { name: 'Character preview', exact: true })).toBeVisible()
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
