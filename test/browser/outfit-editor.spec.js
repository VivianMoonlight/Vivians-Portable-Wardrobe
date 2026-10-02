import { test, expect } from '@playwright/test'

test('editing a saved outfit uses a draft until overwrite and never applies it to the character', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByTitle("Vivian's Portable Wardrobe", { exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const moduleUrl = suffix => performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(url => new URL(url).pathname.endsWith(suffix))
    const storeUrl = moduleUrl('/src/stores/fileSystemStore.js')
    const { useFileSystemStore } = await import(storeUrl)
    const { ExternalAdapter } = await import(moduleUrl('/src/utils/external_adapters.js'))
    const group = {
      Name: 'Cloth', Description: 'Cloth', Category: 'Appearance', Clothing: true,
      AllowNone: true, Asset: [
        { Name: 'TealShirt', Description: 'Teal shirt' },
        { Name: 'BlueShirt', Description: 'Blue shirt' },
      ],
    }
    window.AssetGroupMap = new Map([['Cloth', group]])
    window.AssetGroup = [group]
    window.AssetGet = (_family, groupName, assetName) => {
      const asset = groupName === 'Cloth' && group.Asset.find(entry => entry.Name === assetName)
      return asset ? { ...asset, Group: group } : null
    }
    window.Player.Appearance = [{ Asset: { Name: 'OriginalShirt', Group: group }, Color: 'Default' }]
    window.__outfitEditorProbe = { storeUrl, applications: [], appearance: structuredClone(window.Player.Appearance) }
    ExternalAdapter.applyOutfitToCharacter = (_character, bundle) => {
      window.__outfitEditorProbe.applications.push(structuredClone(bundle))
      return true
    }
    const fs = useFileSystemStore.getState()
    fs.renderer.drawCallbacks = {
      createRenderSession({ canvas, onUpdate }) {
        const context = canvas.getContext('2d')
        context.fillStyle = '#327d8c'
        context.fillRect(0, 0, canvas.width, canvas.height)
        onUpdate(canvas, { state: 'ready' })
        return { dispose() {} }
      },
    }
    for (const outfit of [...fs.outfits]) await fs.removeOutfit(outfit.id)
    await fs.addOutfit({ name: 'Day outfit', data: [{ Group: 'Cloth', Name: 'TealShirt' }], tagIds: [], cloudSync: false })
  })

  const savedAsset = () => page.evaluate(async () => {
    const { useFileSystemStore } = await import(window.__outfitEditorProbe.storeUrl)
    return useFileSystemStore.getState().outfits.find(outfit => outfit.name === 'Day outfit')?.data
      .find(part => part.Group === 'Cloth')?.Name
  })
  const assertCharacterUnchanged = async () => {
    const state = await page.evaluate(() => ({
      appearance: window.Player.Appearance,
      original: window.__outfitEditorProbe.appearance,
      applications: window.__outfitEditorProbe.applications.length,
    }))
    expect(state.appearance).toEqual(state.original)
    expect(state.applications).toBe(0)
  }
  const openEditor = async () => {
    await page.getByRole('button', { name: 'Edit outfit', exact: true }).click()
    const editor = page.locator('.vpw-outfit-editor-dialog')
    await expect(editor).toBeVisible()
    return editor
  }
  const selectBlueShirt = async editor => {
    await editor.getByRole('textbox', { name: 'Asset', exact: true }).click()
    await page.getByRole('option', { name: 'Blue shirt', exact: true }).click()
    await editor.getByRole('button', { name: 'Replace part', exact: true }).click()
    await expect(editor.locator('.vpw-outfit-editor-part-name')).toHaveText('BlueShirt')
  }

  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await page.getByRole('button', { name: 'Preview Day outfit', exact: true }).click()
  let editor = await openEditor()
  await selectBlueShirt(editor)
  expect(await savedAsset()).toBe('TealShirt')
  await assertCharacterUnchanged()
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('dialog').filter({ hasText: 'Discard your unsaved outfit changes?' })
    .getByRole('button', { name: 'OK', exact: true }).click()
  await expect(editor).toBeHidden()
  expect(await savedAsset()).toBe('TealShirt')

  editor = await openEditor()
  await selectBlueShirt(editor)
  await editor.getByRole('button', { name: 'Overwrite outfit', exact: true }).click()
  await expect(editor).toBeHidden()
  await expect.poll(savedAsset).toBe('BlueShirt')
  await assertCharacterUnchanged()

  editor = await openEditor()
  await editor.getByRole('button', { name: 'Save as new', exact: true }).click()
  const namePrompt = page.getByRole('dialog').filter({ hasText: 'Name the new outfit:' })
  await namePrompt.getByRole('textbox').fill('Day outfit copy')
  await namePrompt.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(editor).toBeHidden()
  await expect(page.getByRole('button', { name: 'Preview Day outfit copy', exact: true })).toBeVisible()
  expect(await savedAsset()).toBe('BlueShirt')
  await assertCharacterUnchanged()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Preview Day outfit', exact: true }).click()
  await expect(page.locator('.vpw-mobile-preview-page')).toBeVisible()
  await page.getByRole('button', { name: 'Edit outfit', exact: true }).click()
  await expect(page.locator('.vpw-outfit-editor-page')).toBeVisible()
  await expect(page.locator('.vpw-outfit-editor-dialog')).toHaveCount(0)
  await page.locator('.vpw-outfit-editor-page').getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.locator('.vpw-mobile-preview-page')).toBeVisible()
  expect(errors).toEqual([])
})
