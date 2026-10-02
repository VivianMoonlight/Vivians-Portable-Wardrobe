import { test, expect } from '@playwright/test'

async function setupWardrobe(page, outfitName, data) {
  await page.goto('/')
  await expect(page.getByTitle("Vivian's Portable Wardrobe", { exact: true })).toBeVisible()
  await page.evaluate(async ({ outfitName, data }) => {
    const moduleUrl = suffix => performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(url => new URL(url).pathname.endsWith(suffix))
    const { useFileSystemStore } = await import(moduleUrl('/src/stores/fileSystemStore.js'))
    const { ExternalAdapter } = await import(moduleUrl('/src/utils/external_adapters.js'))
    const { configureNativeWardrobeEditor } = await import(moduleUrl('/src/services/native-wardrobe-editor.js'))
    const { configureNativeItemEditor } = await import(moduleUrl('/src/services/native-item-editor.js'))
    const cloth = { Name: 'Cloth', Description: 'Cloth', Category: 'Appearance', Clothing: true,
      AllowNone: true, Asset: [{ Name: 'TealShirt', Description: 'Teal shirt' },
        { Name: 'BlueShirt', Description: 'Blue shirt' }] }
    const item = { Name: 'ItemNeck', Description: 'Neck item', Category: 'Item', AllowNone: true,
      Asset: [{ Name: 'PlainCollar', Description: 'Plain collar' }] }
    const groups = [cloth, item]
    window.AssetGroupMap = new Map(groups.map(group => [group.Name, group]))
    window.AssetGroup = groups
    window.AssetGet = (_family, groupName, assetName) => {
      const group = groups.find(entry => entry.Name === groupName)
      const asset = group?.Asset.find(entry => entry.Name === assetName)
      return asset ? { ...asset, Group: group } : null
    }
    window.Player.Appearance = [
      { Asset: { Name: 'OriginalShirt', Group: cloth }, Color: 'Default' },
      { Asset: { Name: 'LiveCollar', Group: item }, Property: { Effect: ['Live'] } },
    ]
    window.Player.CanInteract = () => false
    window.__wardrobeEditorProbe = {
      storeUrl: moduleUrl('/src/stores/fileSystemStore.js'),
      applications: 0, sent: [], deleted: [], appearance: structuredClone(window.Player.Appearance),
      appearanceLoads: 0, screenTransitions: [], scratch: null, accept: null,
    }
    ExternalAdapter.applyOutfitToCharacter = () => { window.__wardrobeEditorProbe.applications++; return true }
    window.CurrentScreen = 'ChatRoom'
    window.CurrentModule = 'Online'
    window.CurrentScreenFunctions = { Run() {} }
    window.CurrentCharacter = window.Player
    window.CharacterGetCurrentHandlers = {}
    window.CharacterAppearanceSelection = null
    window.CharacterAppearanceLoadCharacter = (character, accept) => {
      window.__wardrobeEditorProbe.appearanceLoads++
      window.__wardrobeEditorProbe.scratch = character
      window.__wardrobeEditorProbe.accept = accept
      window.CharacterAppearanceSelection = character
      window.CurrentScreen = 'Appearance'
      window.CurrentModule = 'Character'
    }
    window.CharacterAppearanceExit = () => window.__wardrobeEditorProbe.accept(false)
    window.AppearanceMenuBuild = () => {
      window.AppearanceMenu = ['Wardrobe', 'Character', 'Color', 'Exit']
    }
    window.CharacterLoadSimple = () => ({ AssetFamily: 'Female3DCG', Appearance: [] })
    window.CharacterNaked = character => { character.Appearance = [] }
    window.ServerAppearanceLoadFromBundle = (character, _family, bundle) => {
      character.Appearance = bundle.map(part => ({
        Asset: window.AssetGet(character.AssetFamily, part.Group, part.Name),
        Color: structuredClone(part.Color ?? 'Default'),
        ...(part.Property ? { Property: structuredClone(part.Property) } : {}),
      }))
    }
    window.CharacterRefresh = () => {}
    window.CharacterDelete = character => { window.__wardrobeEditorProbe.deleted.push(character) }
    window.ServerBundledItemFromAppearanceItem = appearance => ({
      Group: appearance.Asset.Group.Name, Name: appearance.Asset.Name,
      Color: appearance.Color,
      ...(appearance.Property ? { Property: structuredClone(appearance.Property) } : {}),
    })
    window.InventoryGet = (character, groupName) =>
      character.Appearance.find(entry => entry.Asset.Group.Name === groupName)
    window.ExtendedItemInit = () => {}
    window.ExtendedItemExit = () => { window.DialogFocusItem = null }
    window.DialogLeaveFocusItem = () => {}
    window.DialogLeave = () => {}
    window.CommonSetScreen = (module, screen) => {
      window.__wardrobeEditorProbe.screenTransitions.push([module, screen])
      window.CurrentModule = module
      window.CurrentScreen = screen
    }
    window.ChatRoomCharacterUpdate = () => {}
    window.ChatRoomCharacterItemUpdate = () => {}
    window.ServerSend = (...args) => { window.__wardrobeEditorProbe.sent.push(args) }
    window.DrawCharacter = () => {}
    window.ChatRoomHideElements = () => { window.ChatRoomChatHidden = true }
    window.ChatRoomShowElements = () => { window.ChatRoomChatHidden = false }
    window.InventoryItemNeckPlainCollarLoad = () => {}
    window.InventoryItemNeckPlainCollarDraw = () => {}
    window.InventoryItemNeckPlainCollarClick = () => {
      window.CurrentCharacter.Appearance.find(entry => entry.Asset.Group.Name === 'ItemNeck')
        .Property = { Effect: ['Edited'] }
      window.ServerSend('ChatRoomCharacterItemUpdate', {})
      window.DialogLeave()
    }
    const modApi = { hookFunction(name, _priority, callback) {
      const original = window[name]
      window[name] = (...args) => callback(args, forwarded => original(...forwarded))
      return () => { window[name] = original }
    } }
    const hostElement = document.getElementById('vpw-shadow-host')
    configureNativeItemEditor({ host: window, modApi, hostElement })
    configureNativeWardrobeEditor({ host: window, modApi, hostElement })
    const fs = useFileSystemStore.getState()
    fs.renderer.drawCallbacks = { createRenderSession({ canvas, onUpdate }) {
      onUpdate(canvas, { state: 'ready' })
      return { dispose() {} }
    } }
    for (const outfit of [...fs.outfits]) await fs.removeOutfit(outfit.id)
    await fs.addOutfit({ name: outfitName, data, tagIds: [], cloudSync: false })
  }, { outfitName, data })
}

async function openSavedOutfit(page, name) {
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await page.getByRole('button', { name: `Preview ${name}`, exact: true }).click()
  await page.getByRole('button', { name: 'Edit outfit', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.CurrentScreen)).toBe('Appearance')
}

async function savedPart(page, outfitName, groupName) {
  return page.evaluate(async ({ outfitName, groupName }) => {
    const { useFileSystemStore } = await import(window.__wardrobeEditorProbe.storeUrl)
    return useFileSystemStore.getState().outfits.find(outfit => outfit.name === outfitName)?.data
      .find(part => part.Group === groupName)
  }, { outfitName, groupName })
}

test('BC Appearance edits a scratch character and saves clothing only after overwrite', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await setupWardrobe(page, 'Day outfit', [{ Group: 'Cloth', Name: 'TealShirt' }])
  await openSavedOutfit(page, 'Day outfit')
  const nativeMenu = await page.evaluate(() => {
    window.AppearanceMenuBuild()
    return window.AppearanceMenu
  })
  expect(nativeMenu).toEqual(['Color', 'Exit'])
  await page.evaluate(() => window.__wardrobeEditorProbe.accept(false))
  await expect.poll(() => page.evaluate(() => window.CurrentScreen)).toBe('ChatRoom')
  expect((await savedPart(page, 'Day outfit', 'Cloth')).Name).toBe('TealShirt')

  await page.getByRole('button', { name: 'Edit outfit', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.CurrentScreen)).toBe('Appearance')
  await page.evaluate(() => {
    const probe = window.__wardrobeEditorProbe
    if (probe.scratch === window.Player) throw new Error('Appearance loaded the real player')
    probe.scratch.Appearance.find(entry => entry.Asset.Group.Name === 'Cloth').Asset =
      window.AssetGet('Female3DCG', 'Cloth', 'BlueShirt')
    window.ServerSend('AccountUpdate', { Appearance: 'should not leave' })
    probe.accept(true)
  })
  await expect(page.getByTestId('vpw-editor-item-page')).toBeVisible()
  expect((await savedPart(page, 'Day outfit', 'Cloth')).Name).toBe('TealShirt')
  await page.getByTestId('vpw-editor-reopen-wardrobe').click()
  await expect.poll(() => page.evaluate(() => window.CurrentScreen)).toBe('Appearance')
  await page.evaluate(() => window.__wardrobeEditorProbe.accept(false))
  await expect(page.getByTestId('vpw-editor-item-page')).toBeVisible()
  await page.getByTestId('vpw-editor-item-page').getByRole('button', { name: 'Overwrite outfit' }).click()
  await expect.poll(async () => (await savedPart(page, 'Day outfit', 'Cloth'))?.Name).toBe('BlueShirt')
  const state = await page.evaluate(() => ({
    appearance: window.Player.Appearance, original: window.__wardrobeEditorProbe.appearance,
    applications: window.__wardrobeEditorProbe.applications,
    sent: window.__wardrobeEditorProbe.sent,
    deleted: window.__wardrobeEditorProbe.deleted.length,
    appearanceLoads: window.__wardrobeEditorProbe.appearanceLoads,
    screenTransitions: window.__wardrobeEditorProbe.screenTransitions,
    characterRestored: window.CurrentCharacter === window.Player,
  }))
  expect(state).toMatchObject({ applications: 0, sent: [], deleted: 3,
    appearanceLoads: 3, characterRestored: true,
    screenTransitions: [['Online', 'ChatRoom'], ['Online', 'ChatRoom'], ['Online', 'ChatRoom']] })
  expect(state.appearance).toEqual(state.original)
  expect(pageErrors).toEqual([])
})

test('mobile Appearance returns to the item page; BC item settings remain draft until saved', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.setViewportSize({ width: 390, height: 844 })
  await setupWardrobe(page, 'Collar set', [{ Group: 'ItemNeck', Name: 'PlainCollar', IsItem: true,
    Property: { Effect: ['Old'] } }])
  await openSavedOutfit(page, 'Collar set')
  await page.evaluate(() => {
    const input = document.createElement('input')
    input.id = 'bc-native-input'
    document.body.append(input)
    input.focus()
  })
  await page.keyboard.type('mode')
  await expect(page.locator('#bc-native-input')).toHaveValue('mode')
  await page.evaluate(() => {
    document.getElementById('bc-native-input')?.remove()
    window.__wardrobeEditorProbe.accept(true)
  })
  const itemPage = page.getByTestId('vpw-editor-item-page')
  await expect(itemPage).toBeVisible()
  await expect(page.locator('.vpw-outfit-editor-dialog')).toHaveCount(0)
  await itemPage.getByRole('button', { name: 'Open BC item settings' }).click()
  await expect.poll(() => page.evaluate(() => window.CurrentScreen)).toBe('VPWNativeItemEditor')
  await page.evaluate(() => window.CurrentScreenFunctions.Click())
  await expect.poll(() => page.evaluate(() => window.CurrentScreen)).toBe('ChatRoom')
  await expect(itemPage).toBeVisible()
  expect((await savedPart(page, 'Collar set', 'ItemNeck')).Property).toEqual({ Effect: ['Old'] })
  await itemPage.getByRole('button', { name: 'Overwrite outfit' }).click()
  await expect.poll(async () => (await savedPart(page, 'Collar set', 'ItemNeck'))?.Property)
    .toEqual({ Effect: ['Edited'] })
  const state = await page.evaluate(() => ({
    appearance: window.Player.Appearance, original: window.__wardrobeEditorProbe.appearance,
    applications: window.__wardrobeEditorProbe.applications,
    sent: window.__wardrobeEditorProbe.sent,
    deleted: window.__wardrobeEditorProbe.deleted.length,
  }))
  expect(state).toMatchObject({ applications: 0, sent: [], deleted: 2 })
  expect(state.appearance).toEqual(state.original)
  expect(pageErrors).toEqual([])
})
