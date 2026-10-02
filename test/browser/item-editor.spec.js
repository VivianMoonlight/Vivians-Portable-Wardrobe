import { test, expect } from '@playwright/test'

test('a saved item can be replaced in the editor without dressing the character', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto('/')
  await expect(page.getByTitle("Vivian's Portable Wardrobe", { exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const moduleUrl = suffix => performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(url => new URL(url).pathname.endsWith(suffix))
    const storeUrl = moduleUrl('/src/stores/fileSystemStore.js')
    const { useFileSystemStore } = await import(storeUrl)
    const { ExternalAdapter } = await import(moduleUrl('/src/utils/external_adapters.js'))
    const group = {
      Name: 'ItemNeck', Description: 'Neck item', Category: 'Item', AllowNone: true,
      Asset: [
        { Name: 'PlainCollar', Description: 'Plain collar' },
        { Name: 'RibbonCollar', Description: 'Ribbon collar' },
      ],
    }
    window.AssetGroupMap = new Map([['ItemNeck', group]])
    window.AssetGroup = [group]
    window.AssetGet = (_family, groupName, assetName) => {
      const asset = groupName === 'ItemNeck' && group.Asset.find(entry => entry.Name === assetName)
      return asset ? { ...asset, Group: group } : null
    }
    window.Player.Appearance = [{ Asset: { Name: 'LiveCollar', Group: group }, Color: 'Default' }]
    window.__itemEditorProbe = { storeUrl, applications: 0, appearance: structuredClone(window.Player.Appearance) }
    ExternalAdapter.applyOutfitToCharacter = () => { window.__itemEditorProbe.applications++; return true }
    const fs = useFileSystemStore.getState()
    fs.renderer.drawCallbacks = {
      createRenderSession({ canvas, onUpdate }) {
        onUpdate(canvas, { state: 'ready' })
        return { dispose() {} }
      },
    }
    for (const outfit of [...fs.outfits]) await fs.removeOutfit(outfit.id)
    await fs.addOutfit({ name: 'Collar set', data: [{
      Group: 'ItemNeck', Name: 'PlainCollar', IsItem: true, Property: { Effect: ['Old'] },
    }], tagIds: [], cloudSync: false })
  })

  const savedItem = () => page.evaluate(async () => {
    const { useFileSystemStore } = await import(window.__itemEditorProbe.storeUrl)
    return useFileSystemStore.getState().outfits.find(outfit => outfit.name === 'Collar set')?.data
      .find(part => part.Group === 'ItemNeck')
  })

  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await page.getByRole('button', { name: 'Preview Collar set', exact: true }).click()
  await page.getByRole('button', { name: 'Edit outfit', exact: true }).click()
  const editor = page.locator('.vpw-outfit-editor-dialog')
  await expect(editor).toBeVisible()
  await expect(editor.getByTestId('vpw-editor-category').getByRole('radio', { name: 'Items', exact: true })).toBeChecked()
  await editor.getByRole('textbox', { name: 'Asset', exact: true }).click()
  await page.getByRole('option', { name: 'Ribbon collar', exact: true }).click()
  await editor.getByRole('button', { name: 'Replace part', exact: true }).click()
  await expect(editor.locator('.vpw-outfit-editor-part-name')).toHaveText('RibbonCollar')
  expect((await savedItem()).Name).toBe('PlainCollar')

  await editor.getByRole('button', { name: 'Overwrite outfit', exact: true }).click()
  await expect(editor).toBeHidden()
  await expect.poll(savedItem).toEqual({ Group: 'ItemNeck', Name: 'RibbonCollar', IsItem: true })
  const character = await page.evaluate(() => ({
    appearance: window.Player.Appearance,
    original: window.__itemEditorProbe.appearance,
    applications: window.__itemEditorProbe.applications,
  }))
  expect(character.appearance).toEqual(character.original)
  expect(character.applications).toBe(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Preview Collar set', exact: true }).click()
  await page.getByRole('button', { name: 'Edit outfit', exact: true }).click()
  const mobileEditor = page.locator('.vpw-outfit-editor-page')
  await expect(mobileEditor).toBeVisible()
  await expect(mobileEditor.getByTestId('vpw-editor-category').getByRole('radio', { name: 'Items', exact: true })).toBeChecked()
  expect(pageErrors).toEqual([])
})

test('BC item settings return edited properties to the draft until the outfit is saved', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto('/')
  await expect(page.getByTitle("Vivian's Portable Wardrobe", { exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const moduleUrl = suffix => performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(url => new URL(url).pathname.endsWith(suffix))
    const storeUrl = moduleUrl('/src/stores/fileSystemStore.js')
    const { useFileSystemStore } = await import(storeUrl)
    const { ExternalAdapter } = await import(moduleUrl('/src/utils/external_adapters.js'))
    const { configureNativeItemEditor } = await import(moduleUrl('/src/services/native-item-editor.js'))
    const group = { Name: 'ItemNeck', Description: 'Neck item', Category: 'Item', AllowNone: true,
      Asset: [{ Name: 'PlainCollar', Description: 'Plain collar' }] }
    const asset = { Name: 'PlainCollar', Group: group }
    window.AssetGroupMap = new Map([['ItemNeck', group]])
    window.AssetGroup = [group]
    window.AssetGet = (_family, groupName, assetName) =>
      groupName === 'ItemNeck' && assetName === 'PlainCollar' ? asset : null
    window.Player.Appearance = [{ Asset: asset, Property: { Effect: ['Live'] } }]
    window.Player.CanInteract = () => false
    window.__nativeItemProbe = { storeUrl, sent: [], applications: 0, deleted: 0,
      appearance: structuredClone(window.Player.Appearance) }
    ExternalAdapter.applyOutfitToCharacter = () => { window.__nativeItemProbe.applications++; return true }
    window.CurrentScreen = 'ChatRoom'
    window.CurrentModule = 'Online'
    window.CurrentScreenFunctions = { Run() {} }
    window.CurrentCharacter = window.Player
    window.CharacterGetCurrentHandlers = {}
    window.DialogLeaveFocusItem = () => {}
    window.DialogLeave = () => {}
    window.CommonSetScreen = () => {}
    window.ChatRoomCharacterUpdate = () => {}
    window.ChatRoomCharacterItemUpdate = () => {}
    window.ServerSend = (...args) => { window.__nativeItemProbe.sent.push(args) }
    window.CharacterLoadSimple = () => ({ AssetFamily: 'Female3DCG', Appearance: [] })
    window.CharacterNaked = character => { character.Appearance = [] }
    window.ServerAppearanceLoadFromBundle = (character, _family, bundle) => {
      character.Appearance = bundle.map(part => ({ Asset: asset, Property: part.Property }))
    }
    window.CharacterRefresh = () => {}
    window.CharacterDelete = () => { window.__nativeItemProbe.deleted++ }
    window.InventoryGet = (character, groupName) =>
      character.Appearance.find(item => item.Asset.Group.Name === groupName)
    window.ExtendedItemInit = () => {}
    window.ExtendedItemExit = () => { window.DialogFocusItem = null }
    window.ServerBundledItemFromAppearanceItem = item => ({
      Group: item.Asset.Group.Name, Name: item.Asset.Name, Property: structuredClone(item.Property),
    })
    window.InventoryItemNeckPlainCollarLoad = () => {}
    window.InventoryItemNeckPlainCollarDraw = () => {}
    window.InventoryItemNeckPlainCollarClick = () => {
      window.CurrentCharacter.Appearance[0].Property = { Effect: ['Edited'] }
      window.ServerSend('ChatRoomCharacterItemUpdate', {})
      window.DialogLeave()
    }
    const modApi = { hookFunction(name, _priority, callback) {
      const original = window[name]
      window[name] = (...args) => callback(args, forwarded => original(...forwarded))
      return () => { window[name] = original }
    } }
    configureNativeItemEditor({ host: window, modApi,
      hostElement: document.getElementById('vpw-shadow-host') })
    const fs = useFileSystemStore.getState()
    fs.renderer.drawCallbacks = { createRenderSession({ canvas, onUpdate }) {
      onUpdate(canvas, { state: 'ready' })
      return { dispose() {} }
    } }
    for (const outfit of [...fs.outfits]) await fs.removeOutfit(outfit.id)
    await fs.addOutfit({ name: 'Settings collar', data: [{
      Group: 'ItemNeck', Name: 'PlainCollar', IsItem: true, Property: { Effect: ['Old'] },
    }], tagIds: [], cloudSync: false })
  })

  const savedPart = () => page.evaluate(async () => {
    const { useFileSystemStore } = await import(window.__nativeItemProbe.storeUrl)
    return useFileSystemStore.getState().outfits.find(outfit => outfit.name === 'Settings collar')?.data[0]
  })
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await page.getByRole('button', { name: 'Preview Settings collar', exact: true }).click()
  await page.getByRole('button', { name: 'Edit outfit', exact: true }).click()
  const editor = page.locator('.vpw-outfit-editor-dialog')
  await editor.getByRole('button', { name: 'Open BC item settings', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.CurrentScreen)).toBe('VPWNativeItemEditor')
  await page.evaluate(() => window.CurrentScreenFunctions.Click())
  await expect.poll(() => page.evaluate(() => window.CurrentScreen)).toBe('ChatRoom')
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Overwrite outfit', exact: true })).toBeEnabled()
  expect((await savedPart()).Property).toEqual({ Effect: ['Old'] })

  await editor.getByRole('button', { name: 'Overwrite outfit', exact: true }).click()
  await expect.poll(savedPart).toEqual({
    Group: 'ItemNeck', Name: 'PlainCollar', IsItem: true, Property: { Effect: ['Edited'] },
  })
  const hostState = await page.evaluate(() => ({
    sent: window.__nativeItemProbe.sent,
    deleted: window.__nativeItemProbe.deleted,
    applications: window.__nativeItemProbe.applications,
    appearance: window.Player.Appearance,
    original: window.__nativeItemProbe.appearance,
    characterRestored: window.CurrentCharacter === window.Player,
  }))
  expect(hostState).toMatchObject({ sent: [], deleted: 1, applications: 0, characterRestored: true })
  expect(hostState.appearance).toEqual(hostState.original)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Preview Settings collar', exact: true }).click()
  await page.getByRole('button', { name: 'Edit outfit', exact: true }).click()
  const mobileEditor = page.locator('.vpw-outfit-editor-page')
  await mobileEditor.getByRole('button', { name: 'Open BC item settings', exact: true }).click()
  await page.evaluate(() => {
    const input = document.createElement('input')
    input.id = 'bc-native-input'
    document.body.append(input)
    input.focus()
  })
  await page.keyboard.type('mode')
  await expect(page.locator('#bc-native-input')).toHaveValue('mode')
  await page.evaluate(() => { window.CurrentScreenFunctions.Click(); document.getElementById('bc-native-input')?.remove() })
  await expect(mobileEditor).toBeVisible()
  expect(pageErrors).toEqual([])
})
