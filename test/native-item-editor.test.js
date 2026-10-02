import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createNativeItemEditor, isNativeItemEditorActive } from '../src/services/native-item-editor.js'

const screen = 'VPWNativeItemEditor'

function setup(chatHidden = false) {
  const group = { Name: 'ItemNeck', Category: 'Item' }
  const asset = { Name: 'PlainCollar', Group: group }
  const source = {
    Group: group.Name, Name: asset.Name, IsItem: true,
    Color: 'Default', Property: { Effect: ['Saved'] }, Difficulty: 1,
  }
  const player = {
    AssetFamily: 'Female3DCG', Inventory: [], Crafting: [],
    Appearance: [{ Asset: asset, Property: { Effect: ['Live'] } }],
    PermissionItems: {},
    CanInteract: () => false,
  }
  const originalCanInteract = player.CanInteract
  const prior = {
    CurrentScreen: 'ChatRoom', CurrentModule: 'Online',
    CurrentScreenFunctions: { Run() {} }, CurrentCharacter: player,
    DialogFocusItem: { name: 'previous focus' },
    DialogFocusSourceItem: { name: 'previous source' },
    DialogFocusItemName: 'previous name', DialogMenuMode: 'previous mode',
    DialogExtendedMessage: 'previous message',
    ExtendedItemSubscreen: 'previous subscreen',
    ExtendedItemPermissionMode: true,
    ChatRoomChatHidden: chatHidden,
    DialogTightenLoosenItem: { name: 'previous tighten' },
  }
  const previousHandler = () => player
  const sent = []
  const updates = []
  const screens = []
  const deleted = []
  const hostElement = { style: { display: 'grid' } }
  const host = {
    ...prior, Player: player, CharacterGetCurrentHandlers: { [screen]: previousHandler },
    AssetGet: (_family, groupName, assetName) => groupName === group.Name && assetName === asset.Name ? asset : null,
    CharacterLoadSimple: () => ({ AssetFamily: player.AssetFamily, Appearance: [] }),
    CharacterNaked: character => { character.Appearance = [] },
    ServerAppearanceLoadFromBundle: (character, _family, bundle) => {
      character.Appearance = bundle.map(part => ({
        Asset: asset, Color: part.Color, Property: part.Property, Difficulty: part.Difficulty,
      }))
    },
    CharacterRefresh() {},
    CharacterDelete: character => { deleted.push(character) },
    InventoryGet: (character, groupName) => character.Appearance.find(item => item.Asset.Group.Name === groupName),
    ExtendedItemInit(character, item) {
      assert.notStrictEqual(character, player)
      assert.strictEqual(item, character.Appearance[0])
    },
    ExtendedItemExit() {
      if (host.ExtendedItemSubscreen) {
        host.ExtendedItemSubscreen = null
      } else if (host.DialogFocusItem) {
        host.InventoryItemNeckPlainCollarExit()
        host.DialogFocusItem = null
      }
    },
    ServerBundledItemFromAppearanceItem(item) {
      return { Group: item.Asset.Group.Name, Name: item.Asset.Name,
        Color: item.Color, Property: item.Property, Difficulty: item.Difficulty }
    },
    DrawCharacter() {},
    InventoryItemNeckPlainCollarLoad() {},
    InventoryItemNeckPlainCollarDraw() {},
    InventoryItemNeckPlainCollarExit() {
      host.CurrentCharacter.Appearance[0].Property.CommittedOnExit = true
    },
    InventoryItemNeckPlainCollarClick() {
      assert.notStrictEqual(host.CurrentCharacter, player)
      assert.equal(host.Player.CanInteract(), true)
      assert.equal(host.CurrentScreen, screen)
      host.CurrentCharacter.Appearance[0].Property = { Effect: ['Edited'] }
      host.CurrentCharacter.Appearance[0].Color = '#aabbcc'
      host.CurrentCharacter.Appearance[0].Difficulty = 4
      host.ChatRoomCharacterItemUpdate(host.CurrentCharacter)
      host.InventoryTogglePermission()
      host.ServerSend('ChatRoomCharacterItemUpdate', { edited: true })
      host.CommonSetScreen('Online', 'ChatRoom')
      host.DialogLeave()
    },
    DialogLeaveFocusItem() {},
    DialogLeave() {},
    CommonSetScreen(...args) { screens.push(args) },
    ChatRoomCharacterUpdate: character => { updates.push(character) },
    ChatRoomCharacterItemUpdate: character => { updates.push(character) },
    ServerSend: (...args) => { sent.push(args) },
    ChatRoomHideElements() { host.ChatRoomChatHidden = true },
    ChatRoomShowElements() { host.ChatRoomChatHidden = false },
    InventoryTogglePermission: () => { player.PermissionItems.ItemNeck = true },
  }
  const modApi = {
    hookFunction(name, _priority, callback) {
      const original = host[name]
      host[name] = (...args) => callback(args, forwarded => original(...forwarded))
      return () => { host[name] = original }
    },
  }
  const editor = createNativeItemEditor({ host, modApi, hostElement })
  const assertRestored = () => {
    for (const [key, value] of Object.entries(prior)) assert.strictEqual(host[key], value, key)
    assert.strictEqual(host.CharacterGetCurrentHandlers[screen], previousHandler)
    assert.equal(hostElement.style.display, 'grid')
    assert.strictEqual(host.Player.CanInteract, originalCanInteract)
    assert.equal(host.Player.CanInteract(), false)
    assert.equal(deleted.length, 1)
    assert.equal(isNativeItemEditorActive(), false)
  }
  return { source, player, host, editor, sent, updates, screens, deleted, assertRestored }
}

test('native item click edits a scratch character and returns only its saved item', async () => {
  const context = setup()
  const originalAppearance = structuredClone(context.player.Appearance)
  const pending = context.editor.open({ bundle: [context.source], groupName: 'ItemNeck' })
  assert.equal(context.host.CurrentScreen, screen)
  assert.equal(isNativeItemEditorActive(), true)
  assert.equal(context.host.CurrentCharacter, null)
  assert.equal(context.host.DialogFocusItemName, 'ItemNeckPlainCollar')
  assert.notStrictEqual(context.host.CharacterGetCurrentHandlers[screen](), context.player)
  context.host.CurrentScreenFunctions.Click()

  assert.deepEqual(await pending, {
    status: 'saved',
    part: {
      Group: 'ItemNeck', Name: 'PlainCollar', IsItem: true,
      Color: '#aabbcc', Property: { Effect: ['Edited'], CommittedOnExit: true }, Difficulty: 4,
    },
  })
  assert.deepEqual(context.player.Appearance, originalAppearance)
  assert.deepEqual(context.source.Property, { Effect: ['Saved'] })
  assert.deepEqual(context.sent, [])
  assert.deepEqual(context.updates, [])
  assert.deepEqual(context.screens, [])
  assert.deepEqual(context.player.PermissionItems, {})
  context.assertRestored()
  context.editor.dispose()
})

test('cancelling the native item editor discards the scratch changes and restores BC state', async () => {
  const context = setup(true)
  const originalAppearance = structuredClone(context.player.Appearance)
  const pending = context.editor.open({ bundle: [context.source], groupName: 'ItemNeck' })
  context.host.CharacterGetCurrentHandlers[screen]().Appearance[0].Property.Effect.push('Unsaved')
  context.editor.cancel()

  assert.deepEqual(await pending, { status: 'cancelled' })
  assert.deepEqual(context.player.Appearance, originalAppearance)
  context.assertRestored()
  context.editor.dispose()
})
