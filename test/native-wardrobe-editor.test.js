import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createNativeWardrobeEditor,
  isNativeWardrobeEditorActive,
} from '../src/services/native-wardrobe-editor.js'

function setup({ immediateReady = false, deferredEntry = false, chatHidden = false } = {}) {
  const groups = {
    Cloth: { Name: 'Cloth', Category: 'Appearance' },
    Socks: { Name: 'Socks', Category: 'Appearance' },
    Hat: { Name: 'Hat', Category: 'Appearance' },
    BodyUpper: { Name: 'BodyUpper', Category: 'Appearance' },
    ArmsLeft: { Name: 'ArmsLeft', Category: 'Appearance' },
    ItemNeck: { Name: 'ItemNeck', Category: 'Item' },
  }
  const assets = new Map()
  for (const [groupName, names] of Object.entries({
    Cloth: ['OldDress', 'NewDress'], Socks: ['OldSocks'], Hat: ['NewHat'],
    BodyUpper: ['BaseBody'], ArmsLeft: ['ProtectedArm'], ItemNeck: ['Collar'],
  })) {
    for (const name of names) assets.set(`${groupName}/${name}`, { Name: name, Group: groups[groupName] })
  }
  const source = [
    { Group: 'Cloth', Name: 'OldDress', Color: '#112233', IsItem: false },
    { Group: 'Socks', Name: 'OldSocks', IsItem: false },
    { Group: 'ItemNeck', Name: 'Collar', IsItem: true, Property: { LockedBy: 'Saved' } },
    { Group: 'ArmsLeft', Name: 'ProtectedArm', IsItem: false },
  ]
  const item = part => ({
    Asset: assets.get(`${part.Group}/${part.Name}`),
    Color: part.Color,
    Property: part.Property ? structuredClone(part.Property) : undefined,
  })
  const player = {
    AssetFamily: 'Female3DCG', MemberNumber: 123, Inventory: [], Crafting: [],
    Wardrobe: [{ Name: 'Original slot' }], WardrobeCharacterNames: ['Original name'],
    VisualSettings: { UseCharacterInPreviews: false },
    Appearance: source.map(item), PermissionItems: {},
  }
  const originalPlayer = structuredClone(player)
  const prior = {
    CurrentScreen: 'ChatRoom', CurrentModule: 'Online',
    CurrentScreenFunctions: { Run() {} }, CurrentCharacter: player,
    CharacterAppearanceForceUpCharacter: 42,
    CharacterAppearanceSelection: { name: 'prior selection' },
    CharacterAppearanceBackup: [{ name: 'prior backup' }],
    CharacterAppearanceReturnScreen: { name: 'prior return' },
    CharacterAppearanceResultCallback: () => {},
    DialogFocusItem: { name: 'prior focus' },
    DialogFocusSourceItem: { name: 'prior source' },
    DialogFocusItemName: 'prior item', DialogMenuMode: 'prior mode',
    DialogExtendedMessage: 'prior message', ExtendedItemSubscreen: 'prior subscreen',
    ExtendedItemPermissionMode: true, DialogTightenLoosenItem: { name: 'prior tighten' },
    AppearanceUseCharacterInPreviewsSetting: false, ChatRoomChatHidden: chatHidden,
  }
  const sent = []
  const deleted = []
  const screens = []
  const queued = []
  const intervals = new Set()
  const intervalCallbacks = new Map()
  const hostElement = { style: { display: 'grid' } }
  let openedCharacter = null
  let nextInterval = 0
  const enterAppearance = () => {
    host.CurrentScreen = 'Appearance'
    host.CurrentModule = 'Character'
    host.CurrentScreenFunctions = { Run() {}, Click() {} }
  }
  const host = {
    ...prior, Player: player, AppearanceMenu: [],
    ServerAccountUpdate: { QueueData: data => queued.push(data) },
    AssetGet: (_family, group, name) => assets.get(`${group}/${name}`),
    CharacterLoadSimple: () => ({ AssetFamily: player.AssetFamily, Appearance: [], IsPlayer: () => false }),
    CharacterNaked: character => { character.Appearance = [item({ Group: 'BodyUpper', Name: 'BaseBody' })] },
    ServerAppearanceLoadFromBundle(character, _family, bundle) {
      character.Appearance.push(...bundle.map(item))
    },
    ServerBundledItemFromAppearanceItem(appearanceItem) {
      return {
        Group: appearanceItem.Asset.Group.Name, Name: appearanceItem.Asset.Name,
        Color: appearanceItem.Color, Property: appearanceItem.Property,
      }
    },
    CharacterRefresh() {},
    CharacterDelete: character => { deleted.push(character) },
    CharacterAppearanceLoadCharacter(character, callback) {
      openedCharacter = character
      host.CharacterAppearanceSelection = character
      host.CharacterAppearanceBackup = character.Appearance.map(appearanceItem => ({ ...appearanceItem }))
      host.CharacterAppearanceReturnScreen = 'ChatRoom'
      host.CharacterAppearanceResultCallback = callback
      if (!deferredEntry) enterAppearance()
      if (immediateReady) host.CharacterAppearanceReady(character)
    },
    AppearanceMenuBuild(character) {
      host.AppearanceMenu = character.IsPlayer()
        ? ['Wardrobe', 'WearRandom', 'Random', 'Copy', 'Paste', 'Character', 'Cancel', 'Accept']
        : ['WardrobeDisabled', 'Character', 'Cancel', 'Accept']
    },
    CharacterAppearanceWardrobeLoad() { player.Wardrobe.push({ Name: 'Leaked slot' }) },
    CharacterAppearanceClose() {
      if (host.AppearanceUseCharacterInPreviewsSetting !== player.VisualSettings.UseCharacterInPreviews) {
        player.VisualSettings.UseCharacterInPreviews = host.AppearanceUseCharacterInPreviewsSetting
        host.ServerAccountUpdate.QueueData({ VisualSettings: player.VisualSettings })
      }
    },
    CharacterAppearanceReady(character) {
      host.CharacterAppearanceClose(character)
      host.CharacterAppearanceResultCallback(true)
    },
    CharacterAppearanceExit(character) {
      host.CharacterAppearanceClose(character)
      character.Appearance = host.CharacterAppearanceBackup
      host.CharacterAppearanceResultCallback(false)
    },
    CommonSetScreen(module, screen) {
      screens.push([module, screen])
      host.CurrentModule = module
      host.CurrentScreen = screen
    },
    ServerPlayerAppearanceSync() { sent.push(['appearance sync']) },
    ServerSend: (...args) => { sent.push(args) },
    ChatRoomCharacterUpdate: character => { sent.push(['character update', character]) },
    ChatRoomCharacterItemUpdate: character => { sent.push(['item update', character]) },
    InventoryTogglePermission() { player.PermissionItems.Cloth = true },
    InventorySetPermission() { player.PermissionItems.Socks = true },
    ChatRoomHideElements() { host.ChatRoomChatHidden = true },
    ChatRoomShowElements() { host.ChatRoomChatHidden = false },
    setInterval(callback) {
      const id = ++nextInterval
      intervals.add(id)
      intervalCallbacks.set(id, callback)
      return id
    },
    clearInterval(id) { intervals.delete(id); intervalCallbacks.delete(id) },
  }
  const modApi = {
    hookFunction(name, _priority, callback) {
      const original = host[name]
      host[name] = (...args) => callback(args, forwarded => original(...forwarded))
      return () => { host[name] = original }
    },
  }
  const editor = createNativeWardrobeEditor({ host, modApi, hostElement })
  function assertRestored() {
    for (const [key, value] of Object.entries(prior)) assert.strictEqual(host[key], value, key)
    assert.equal(hostElement.style.display, 'grid')
    assert.equal(isNativeWardrobeEditorActive(), false)
    assert.equal(intervals.size, 0)
    assert.equal(deleted.length, 1)
    assert.deepEqual(player, originalPlayer)
  }
  return { source, player, host, editor, sent, screens, queued, deleted, intervals, hostElement,
    get openedCharacter() { return openedCharacter }, enterAppearance,
    tickIntervals() { for (const callback of intervalCallbacks.values()) callback() },
    assertRestored }
}

test('native wardrobe edits a scratch Appearance and merges only changed clothing', async () => {
  const context = setup()
  const pending = context.editor.open({ bundle: context.source })
  const scratch = context.openedCharacter
  assert.ok(scratch)
  assert.notStrictEqual(scratch, context.player)
  assert.equal(context.host.CurrentScreen, 'Appearance')
  assert.equal(context.host.CurrentCharacter, null)
  assert.equal(context.hostElement.style.display, 'none')
  assert.equal(isNativeWardrobeEditorActive(), true)
  scratch.Appearance = scratch.Appearance.filter(part => part.Asset.Group.Name !== 'Socks')
  scratch.Appearance.find(part => part.Asset.Group.Name === 'Cloth').Asset =
    context.host.AssetGet(scratch.AssetFamily, 'Cloth', 'NewDress')
  scratch.Appearance.push({ Asset: context.host.AssetGet(scratch.AssetFamily, 'Hat', 'NewHat') })
  context.host.CharacterAppearanceReady(scratch)

  const result = await pending
  assert.equal(result.status, 'saved')
  assert.deepEqual(result.bundle, [
    { Group: 'Cloth', Name: 'NewDress', Color: '#112233', IsItem: false },
    context.source[2], context.source[3],
    { Group: 'Hat', Name: 'NewHat', IsItem: false },
  ])
  assert.deepEqual(context.source[0], { Group: 'Cloth', Name: 'OldDress', Color: '#112233', IsItem: false })
  assert.deepEqual(context.sent, [])
  assert.deepEqual(context.queued, [])
  context.assertRestored()
  context.editor.dispose()
})

test('cancel discards scratch edits and blocks native Player wardrobe and permission writes', async () => {
  const context = setup({ chatHidden: true })
  const pending = context.editor.open({ bundle: context.source })
  const scratch = context.openedCharacter
  context.host.AppearanceMenuBuild(scratch)
  assert.equal(context.host.AppearanceMenu.includes('Wardrobe'), false)
  assert.equal(context.host.AppearanceMenu.includes('Character'), false)
  context.host.CharacterAppearanceWardrobeLoad(scratch)
  context.host.InventoryTogglePermission()
  context.host.InventorySetPermission()
  context.host.ServerPlayerAppearanceSync()
  context.host.ServerSend('AccountUpdate', { leaked: true })
  context.host.AppearanceUseCharacterInPreviewsSetting = true
  scratch.Appearance[1].Color = '#ffffff'
  context.editor.cancel()

  assert.deepEqual(await pending, { status: 'cancelled' })
  assert.deepEqual(context.sent, [])
  assert.deepEqual(context.queued, [])
  context.assertRestored()
  context.editor.dispose()
})

test('a synchronous BC completion callback leaves no timer or active session', async () => {
  const context = setup({ immediateReady: true })
  const result = await context.editor.open({ bundle: context.source })
  assert.equal(result.status, 'saved')
  assert.deepEqual(result.bundle, context.source)
  context.assertRestored()
  context.editor.dispose()
})

test('cancel before asynchronous BC Appearance entry waits for the screen then restores it', async () => {
  const context = setup({ deferredEntry: true })
  const pending = context.editor.open({ bundle: context.source })
  assert.equal(context.host.CurrentScreen, 'ChatRoom')
  assert.equal(context.host.CurrentCharacter, null)
  assert.equal(context.intervals.size, 1)
  context.editor.cancel()
  assert.equal(isNativeWardrobeEditorActive(), true)
  assert.equal(context.deleted.length, 0)
  context.host.ServerSend('AccountUpdate', { leaked: true })
  context.enterAppearance()
  context.tickIntervals()

  assert.deepEqual(await pending, { status: 'cancelled' })
  assert.deepEqual(context.sent, [])
  assert.deepEqual(context.queued, [])
  assert.deepEqual(context.screens, [['Online', 'ChatRoom']])
  context.assertRestored()
  context.editor.dispose()
})
