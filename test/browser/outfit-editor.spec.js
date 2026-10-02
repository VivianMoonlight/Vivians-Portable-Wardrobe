import { test, expect } from '@playwright/test'

test('BC Appearance draft can be discarded, saved as a copy, or left with mobile Back', async ({ page }) => {
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
    const { configureNativeWardrobeEditor } = await import(moduleUrl('/src/services/native-wardrobe-editor.js'))
    const group = { Name: 'Cloth', Description: 'Cloth', Category: 'Appearance', Clothing: true,
      AllowNone: true, Asset: [
        { Name: 'TealShirt', Description: 'Teal shirt' },
        { Name: 'BlueShirt', Description: 'Blue shirt' },
      ] }
    window.AssetGroupMap = new Map([['Cloth', group]])
    window.AssetGroup = [group]
    window.AssetGet = (_family, groupName, assetName) => {
      const asset = groupName === 'Cloth' && group.Asset.find(entry => entry.Name === assetName)
      return asset ? { ...asset, Group: group } : null
    }
    window.Player.Appearance = [{ Asset: { Name: 'OriginalShirt', Group: group }, Color: 'Default' }]
    window.__outfitEditorProbe = {
      storeUrl, applications: [], sent: [], deleted: 0,
      appearance: structuredClone(window.Player.Appearance), scratch: null, accept: null,
    }
    ExternalAdapter.applyOutfitToCharacter = (_character, bundle) => {
      window.__outfitEditorProbe.applications.push(structuredClone(bundle))
      return true
    }
    window.CurrentScreen = 'ChatRoom'
    window.CurrentModule = 'Online'
    window.CurrentScreenFunctions = { Run() {} }
    window.CurrentCharacter = window.Player
    window.CharacterAppearanceSelection = null
    window.CharacterAppearanceLoadCharacter = (character, accept) => {
      window.__outfitEditorProbe.scratch = character
      window.__outfitEditorProbe.accept = accept
      window.CharacterAppearanceSelection = character
      window.CurrentScreen = 'Appearance'
      window.CurrentModule = 'Character'
    }
    window.CharacterAppearanceExit = () => window.__outfitEditorProbe.accept(false)
    window.CommonSetScreen = (module, screen) => {
      window.CurrentModule = module
      window.CurrentScreen = screen
    }
    window.CharacterLoadSimple = () => ({ AssetFamily: 'Female3DCG', Appearance: [] })
    window.CharacterNaked = character => { character.Appearance = [] }
    window.ServerAppearanceLoadFromBundle = (character, _family, bundle) => {
      character.Appearance = bundle.map(part => ({
        Asset: window.AssetGet(character.AssetFamily, part.Group, part.Name),
        Color: part.Color ?? 'Default',
      }))
    }
    window.CharacterRefresh = () => {}
    window.CharacterDelete = () => { window.__outfitEditorProbe.deleted++ }
    window.ServerBundledItemFromAppearanceItem = item => ({
      Group: item.Asset.Group.Name, Name: item.Asset.Name, Color: item.Color,
    })
    window.ServerSend = (...args) => { window.__outfitEditorProbe.sent.push(args) }
    window.ChatRoomHideElements = () => { window.ChatRoomChatHidden = true }
    window.ChatRoomShowElements = () => { window.ChatRoomChatHidden = false }
    const modApi = { hookFunction(name, _priority, callback) {
      const original = window[name]
      window[name] = (...args) => callback(args, forwarded => original(...forwarded))
      return () => { window[name] = original }
    } }
    configureNativeWardrobeEditor({ host: window, modApi,
      hostElement: document.getElementById('vpw-shadow-host') })
    const fs = useFileSystemStore.getState()
    fs.renderer.drawCallbacks = { createRenderSession({ canvas, onUpdate }) {
      const context = canvas.getContext('2d')
      context.fillStyle = '#327d8c'
      context.fillRect(0, 0, canvas.width, canvas.height)
      onUpdate(canvas, { state: 'ready' })
      return { dispose() {} }
    } }
    for (const outfit of [...fs.outfits]) await fs.removeOutfit(outfit.id)
    await fs.addOutfit({ name: 'Day outfit', data: [{ Group: 'Cloth', Name: 'TealShirt' }],
      tagIds: [], cloudSync: false })
  })

  const savedAsset = name => page.evaluate(async name => {
    const { useFileSystemStore } = await import(window.__outfitEditorProbe.storeUrl)
    return useFileSystemStore.getState().outfits.find(outfit => outfit.name === name)?.data
      .find(part => part.Group === 'Cloth')?.Name
  }, name)
  const editInNativeAppearance = async () => {
    await page.getByRole('button', { name: 'Edit outfit', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.CurrentScreen)).toBe('Appearance')
    await page.evaluate(() => {
      const probe = window.__outfitEditorProbe
      if (probe.scratch === window.Player) throw new Error('Appearance edited the real player')
      probe.scratch.Appearance.find(item => item.Asset.Group.Name === 'Cloth').Asset =
        window.AssetGet('Female3DCG', 'Cloth', 'BlueShirt')
      window.ServerSend('AccountUpdate', { Appearance: 'should remain local' })
      probe.accept(true)
    })
    await expect(page.getByTestId('vpw-editor-item-page')).toBeVisible()
  }
  const discard = async (button) => {
    await button.click()
    await page.getByRole('dialog').filter({ hasText: 'Discard your unsaved outfit changes?' })
      .getByRole('button', { name: 'OK', exact: true }).click()
  }

  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await page.getByRole('button', { name: 'Preview Day outfit', exact: true }).click()
  await editInNativeAppearance()
  expect(await savedAsset('Day outfit')).toBe('TealShirt')
  await discard(page.getByTestId('vpw-editor-item-page').getByRole('button', { name: 'Cancel', exact: true }))
  await expect(page.getByTestId('vpw-editor-item-page')).toHaveCount(0)
  expect(await savedAsset('Day outfit')).toBe('TealShirt')

  await editInNativeAppearance()
  await page.getByTestId('vpw-editor-item-page').getByRole('button', { name: 'Save as new' }).click()
  const namePrompt = page.getByRole('dialog').filter({ hasText: 'Name the new outfit:' })
  await namePrompt.getByRole('textbox').fill('Day outfit copy')
  await namePrompt.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => savedAsset('Day outfit copy')).toBe('BlueShirt')
  expect(await savedAsset('Day outfit')).toBe('TealShirt')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Preview Day outfit', exact: true }).click()
  await expect(page.locator('.vpw-mobile-preview-page')).toBeVisible()
  await editInNativeAppearance()
  const mobilePage = page.locator('.vpw-outfit-editor-page')
  await expect(mobilePage).toBeVisible()
  await expect(page.locator('.vpw-outfit-editor-dialog')).toHaveCount(0)
  await discard(mobilePage.getByRole('button', { name: 'Back', exact: true }))
  await expect(page.locator('.vpw-mobile-preview-page')).toBeVisible()
  expect(await savedAsset('Day outfit')).toBe('TealShirt')
  const hostState = await page.evaluate(() => ({
    appearance: window.Player.Appearance,
    original: window.__outfitEditorProbe.appearance,
    applications: window.__outfitEditorProbe.applications,
    sent: window.__outfitEditorProbe.sent,
    deleted: window.__outfitEditorProbe.deleted,
    characterRestored: window.CurrentCharacter === window.Player,
  }))
  expect(hostState.appearance).toEqual(hostState.original)
  expect(hostState).toMatchObject({ applications: [], sent: [], deleted: 3,
    characterRestored: true })
  expect(errors).toEqual([])
})
