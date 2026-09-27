import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadFileSystemStore } from './helpers/load-file-system-store.js'

function setup() {
  const { fs, hostWindow } = loadFileSystemStore()
  const player = hostWindow.Player
  player.AssetFamily = 'Female3DCG'
  player.Appearance = []
  player.CanChangeOwnClothes = () => false
  hostWindow.AssetGet = (_family, group, name) => ({
    Name: name,
    Group: { Name: group, Category: 'Appearance', Clothing: true, AllowNone: true },
  })
  hostWindow.ValidationIsItemBlockedOrLimited = () => true
  hostWindow.InventoryIsPermissionBlocked = () => true
  hostWindow.InventoryGet = () => null
  hostWindow.InventoryItemHasEffect = () => false
  let loads = 0
  let result = true
  let applied
  hostWindow.ServerAppearanceLoadFromBundle = (_target, _family, bundle) => {
    loads++
    applied = bundle
    return result
  }
  hostWindow.CharacterRefresh = () => {}
  hostWindow.ChatRoomCharacterUpdate = () => {}
  fs.character = player
  fs.previewItem = { data: [{ Group: 'Cloth', Name: 'NewShirt' }] }
  return {
    fs,
    hostWindow,
    player,
    get loads() { return loads },
    get applied() { return applied },
    setResult(value) { result = value },
    enable() { hostWindow.localStorage.setItem('vpw.forceSelfApply.v1.42', '1') },
  }
}

test('force apply requires local opt-in and leaves the ordinary permission check intact', () => {
  const context = setup()
  assert.equal(context.fs.applyCurrentPreviewToSelfForced(), false)
  assert.equal(context.loads, 0)
  context.enable()
  assert.equal(context.fs.applyCurrentPreviewToCharacter(), false)
  assert.equal(context.loads, 0)
  assert.equal(context.fs.applyCurrentPreviewToSelfForced(), true)
  assert.equal(context.loads, 1)
  assert.equal(context.applied[0].Name, 'NewShirt')
})

test('force apply rejects every target other than the exact live Player object', () => {
  const context = setup()
  context.enable()
  context.fs.character = { ...context.player, IsPlayer: () => true }
  assert.equal(context.fs.applyCurrentPreviewToSelfForced(), false)
  assert.equal(context.loads, 0)
  context.fs.character = context.player
  context.hostWindow.Player = { ...context.player, IsPlayer: () => true }
  assert.equal(context.fs.applyCurrentPreviewToSelfForced(), false)
  assert.equal(context.loads, 0)
})

test('force apply reports BC partial rejection and never reports success for an invalid asset', () => {
  const context = setup()
  context.enable()
  context.setResult(false)
  assert.equal(context.fs.applyCurrentPreviewToSelfForced(), false)
  assert.equal(context.loads, 1)
  context.fs.previewItem = { data: [{ Group: 'Cloth', Name: 'Missing' }] }
  context.hostWindow.AssetGet = () => null
  assert.equal(context.fs.applyCurrentPreviewToSelfForced(), false)
  assert.equal(context.loads, 1)
})

test('the final apply boundary keeps live hidden body parts even in force mode', () => {
  const context = setup()
  context.enable()
  const asset = (group, name) => context.hostWindow.AssetGet('', group, name)
  context.player.Appearance = [{
    Asset: asset('Blush', 'CurrentBlush'),
    Color: ['#abc123'],
    Difficulty: 5,
    Property: { Expression: 'Current' },
  }]
  context.hostWindow.ServerAppearanceBundle = (appearance) => appearance.map((item) => ({
    Group: item.Asset.Group.Name,
    Name: item.Asset.Name,
    Color: item.Color,
    Difficulty: item.Difficulty,
    Property: item.Property,
  }))
  context.fs.previewItem = { data: [
    { Group: 'Cloth', Name: 'NewShirt' },
    { Group: 'Blush', Name: 'OtherBlush' },
    { Group: 'ArmsRight', Name: 'MissingOnCurrent' },
  ] }
  assert.equal(context.fs.applyCurrentPreviewToSelfForced(), true)
  assert.deepEqual(Array.from(context.applied, ({ Group, Name }) => [Group, Name]), [
    ['Cloth', 'NewShirt'], ['Blush', 'CurrentBlush'],
  ])
  assert.equal(context.applied[1].Difficulty, 5)
  assert.deepEqual(Array.from(context.applied[1].Color), ['#abc123'])
  assert.equal(context.applied[1].Property.Expression, 'Current')
})

test('a partially sanitized BC result refreshes the actual character without reporting success', () => {
  const context = setup()
  context.enable()
  const liveBlush = { Asset: context.hostWindow.AssetGet('', 'Blush', 'LiveBlush') }
  context.player.Appearance = [liveBlush]
  let refreshes = 0
  let updates = 0
  context.hostWindow.CharacterRefresh = () => { refreshes++ }
  context.hostWindow.ChatRoomCharacterUpdate = character => {
    updates++
    assert.equal(character.Appearance.find(item => item.Asset?.Group?.Name === 'Blush'), liveBlush)
  }
  context.hostWindow.ServerAppearanceLoadFromBundle = (character) => {
    character.Appearance = []
    return false
  }
  assert.equal(context.fs.applyCurrentPreviewToSelfForced(), false)
  assert.equal(refreshes, 1)
  assert.equal(updates, 1)
})

test('normal apply accepts a protected slot even if BC serializes its color differently', () => {
  const context = setup()
  context.player.CanChangeOwnClothes = () => true
  context.player.Appearance = [{
    Asset: context.hostWindow.AssetGet('', 'Blush', 'LiveBlush'),
    Color: ['#abc123'],
  }]
  context.hostWindow.ServerAppearanceBundle = () => [{
    Group: 'Blush', Name: 'LiveBlush', Color: '#abc123',
  }]
  context.hostWindow.ValidationIsItemBlockedOrLimited = (_character, _member, group) => group === 'Blush'
  context.hostWindow.InventoryIsPermissionBlocked = (_character, _name, group) => group === 'Blush'
  assert.equal(context.fs.applyCurrentPreviewToCharacter(), true)
  assert.equal(context.loads, 1)
  assert.equal(context.applied.find((item) => item.Group === 'Blush').Name, 'LiveBlush')
})

test('force apply does not remove a locked item while bypassing clothing settings', () => {
  const context = setup()
  context.enable()
  const lockedItem = {
    Asset: context.hostWindow.AssetGet('', 'ItemArms', 'Cuffs'),
    Property: { Effect: ['Lock'] },
  }
  context.player.Appearance = [lockedItem]
  context.hostWindow.InventoryGet = () => lockedItem
  context.hostWindow.InventoryItemHasEffect = () => true
  assert.equal(context.fs.applyCurrentPreviewToSelfForced(), false)
  assert.equal(context.loads, 0)
})

test('an unavailable live hidden asset blocks the apply instead of being dropped by BC', () => {
  const context = setup()
  context.enable()
  context.player.Appearance = [{
    Asset: context.hostWindow.AssetGet('', 'Blush', 'UnavailableBlush'),
  }]
  const assetGet = context.hostWindow.AssetGet
  context.hostWindow.AssetGet = (family, group, name) =>
    group === 'Blush' ? null : assetGet(family, group, name)
  assert.equal(context.fs.applyCurrentPreviewToSelfForced(), false)
  assert.equal(context.loads, 0)
})

test('full replacement never sends saved arm or hand assets and retains live parts', () => {
  const context = setup()
  context.player.CanChangeOwnClothes = () => true
  context.hostWindow.ValidationIsItemBlockedOrLimited = () => false
  context.hostWindow.InventoryIsPermissionBlocked = () => false
  const protectedGroups = ['ArmsLeft', 'ArmsRight', 'HandsLeft', 'HandsRight']
  const liveParts = protectedGroups.map(Group => ({
    Asset: {
      Name: '',
      Group: { Name: Group, Category: 'Appearance', AllowNone: false },
    },
    Color: ['#abc123'],
    Property: { live: Group },
  }))
  context.player.Appearance = [...liveParts]
  context.hostWindow.ServerAppearanceBundle = appearance => appearance.map(item => ({
    Group: item.Asset.Group.Name,
    Name: item.Asset.Name,
    Color: item.Color,
    Property: item.Property,
  }))
  const assetGet = context.hostWindow.AssetGet
  context.hostWindow.AssetGet = (family, group, name) =>
    name === '' && protectedGroups.includes(group)
      ? liveParts.find(item => item.Asset.Group.Name === group).Asset
      : assetGet(family, group, name)

  let sentBundle
  context.hostWindow.ServerAppearanceLoadFromBundle = (target, family, bundle) => {
    sentBundle = bundle
    const resolved = bundle.map(part => context.hostWindow.AssetGet(family, part.Group, part.Name))
    target.Appearance = bundle.flatMap((part, index) => resolved[index]
      ? [{ Asset: resolved[index], Color: part.Color, Property: part.Property }]
      : [])
    return resolved.every(Boolean)
  }
  const incoming = [
    ...protectedGroups.map(Group => ({ Group, Name: `Saved${Group}` })),
    { Group: 'Cloth', Name: 'NewShirt' },
  ]
  context.fs.filterSnapshot = {
    items: [...protectedGroups, 'Cloth'].map(key => ({ key })),
    groups: [{ groupID: 'HiddenBody', itemList: protectedGroups.map(key => ({ key })) }],
  }
  assert.equal(context.fs.selectOutfit({ type: 'outfit', data: incoming }), true)
  assert.equal(context.fs.setGroupSlotModes('HiddenBody', 'incoming'), false)
  assert.equal(context.fs.progressGroupSource('HiddenBody', 'incoming'), false)
  context.fs.replaceAllFromSource('incoming')
  assert.equal(context.fs.applyCurrentPreviewToCharacter(), true)
  assert.equal(sentBundle.length, 5)
  assert.equal(sentBundle.find(part => part.Group === 'Cloth')?.Name, 'NewShirt')
  for (const [index, Group] of protectedGroups.entries()) {
    assert.equal(sentBundle.find(part => part.Group === Group)?.Name, '')
    assert.equal(context.player.Appearance.find(item => item.Asset?.Group?.Name === Group), liveParts[index])
  }
  assert.equal(context.player.Appearance.find(item => item.Asset?.Group?.Name === 'Cloth')?.Asset.Name, 'NewShirt')
})
