import assert from 'node:assert/strict'
import { test } from 'node:test'
import LZString from 'lz-string'
import { loadFileSystemStore } from './helpers/load-file-system-store.js'

const keys = ['Cloth', 'Shoes', 'Gloves', 'Hair']
const clothes = ['Cloth', 'Shoes', 'Gloves']

function part(Group, Name) {
  return { Group, Name, Color: ['Default'] }
}

function setup({ modes = {} } = {}) {
  const fixture = loadFileSystemStore()
  const { fs } = fixture
  const character = [part('Cloth', 'old-shirt'), part('Hair', 'old-hair')]
  const candidate = { name: 'Candidate', type: 'outfit', data: [part('Cloth', 'new-shirt'), part('Shoes', 'new-shoes')] }
  fs.characterItem = character
  fs.activeItem = { data: candidate.data }
  fs.filterSnapshot = {
    items: keys.map((key) => ({ key })),
    groups: [
      { groupID: 'clothes', itemList: clothes.map((key) => ({ key })) },
      { groupID: 'body', itemList: [{ key: 'Hair' }] },
    ],
  }
  fs.slotControlMap = Object.fromEntries(keys.map((key) => [key, { mode: modes[key] || 'empty', locked: false }]))
  fs.history.filter = keys
  return { ...fixture, character, candidate }
}

function modes(fs) {
  return Object.fromEntries(Object.entries(fs.slotControlMap).map(([key, control]) => [key, control.mode]))
}

function names(fs) {
  return Array.from(fs.previewItem.data, (entry) => entry.Name)
}

test('global mode changes update every known slot and render only when modes change', () => {
  const { fs, renders } = setup()

  assert.equal(fs.setAllSlotModes('incoming'), true)
  assert.deepEqual(modes(fs), { Cloth: 'incoming', Shoes: 'incoming', Gloves: 'incoming', Hair: 'incoming' })
  assert.deepEqual(names(fs), ['new-shirt', 'new-shoes'])
  assert.deepEqual(Array.from(fs.activeFilters), keys)
  assert.equal(renders.length, 1)
  assert.equal(renders[0], fs.previewItem)

  const controls = fs.slotControlMap
  const preview = fs.previewItem
  assert.equal(fs.setAllSlotModes('incoming'), false)
  assert.equal(fs.slotControlMap, controls)
  assert.equal(fs.previewItem, preview)
  assert.equal(renders.length, 1)

  assert.equal(fs.setAllSlotModes('original'), true)
  assert.deepEqual(names(fs), ['old-shirt', 'old-hair'])
  assert.equal(renders.length, 2)

  assert.equal(fs.setAllSlotModes('invalid'), true)
  assert.deepEqual(modes(fs), { Cloth: 'empty', Shoes: 'empty', Gloves: 'empty', Hair: 'empty' })
  assert.deepEqual(names(fs), [])
  assert.deepEqual(Array.from(fs.activeFilters), [])
  assert.equal(renders.length, 3)
  assert.equal(fs.setAllSlotModes('empty'), false)
  assert.equal(renders.length, 3)
})

test('hidden BC body slots stay original through global, group, direct, and legacy controls', () => {
  const { fs } = setup()
  const protectedGroups = ['Blush', 'ArmsLeft', 'ArmsRight', 'HandsLeft', 'HandsRight', 'Emoticon', 'Fluids']
  const original = protectedGroups.map(Group => part(Group, `live-${Group}`))
  const incoming = protectedGroups.map(Group => part(Group, `saved-${Group}`))
  fs.characterItem.push(...original)
  fs.activeItem.data.push(...incoming)
  fs.filterSnapshot.items.push(...protectedGroups.map(key => ({ key })))
  fs.filterSnapshot.groups.push({ groupID: 'HiddenBody', itemList: protectedGroups.map(key => ({ key })) })
  fs.slotControlMap.Blush = { mode: 'incoming', locked: false }

  fs._ensureSlotControls()
  assert.deepEqual(protectedGroups.map(key => fs.getSlotControlState(key).mode), protectedGroups.map(() => 'original'))
  assert.equal(fs.setSlotMode('Blush', 'incoming'), false)
  assert.equal(fs.setGroupSlotModes('HiddenBody', 'incoming'), false)
  assert.equal(fs.progressGroupSource('HiddenBody', 'incoming'), false)
  fs.replaceAllFromSource('incoming')
  fs.setActiveFilters(['Cloth'])
  fs.filterInvertAll()
  fs.replaceBodyOnly()
  fs.updatePreviewItem()

  assert.deepEqual(protectedGroups.map(key => fs.slotControlMap[key].mode), protectedGroups.map(() => 'original'))
  assert.deepEqual(
    Array.from(fs.previewItem.data.filter(entry => protectedGroups.includes(entry.Group)), entry => `${entry.Group}/${entry.Name}`),
    original.map(entry => `${entry.Group}/${entry.Name}`),
  )
  assert.equal(fs.getGroupSourceAction('HiddenBody', 'incoming'), null)
})

test('group updates preserve slots outside the group and ignore unknown groups', () => {
  const { fs, renders } = setup({ modes: { Hair: 'original' } })
  const hairControl = fs.slotControlMap.Hair

  assert.equal(fs.setGroupSlotModes('clothes', 'incoming'), true)
  assert.deepEqual(modes(fs), { Cloth: 'incoming', Shoes: 'incoming', Gloves: 'incoming', Hair: 'original' })
  assert.equal(fs.slotControlMap.Hair, hairControl)
  assert.deepEqual(names(fs), ['new-shirt', 'old-hair', 'new-shoes'])
  assert.equal(renders.length, 1)

  assert.equal(fs.setGroupSlotModes('clothes', 'incoming'), false)
  assert.equal(fs.setGroupSlotModes('unknown', 'empty'), false)
  assert.equal(renders.length, 1)
  assert.equal(fs.setGroupSlotModes('clothes', 'invalid'), true)
  assert.deepEqual(names(fs), ['old-hair'])
  assert.equal(fs.slotControlMap.Hair, hairControl)
  assert.equal(renders.length, 2)
})

for (const source of ['incoming', 'original']) {
  test(`group ${source} progresses from actual contents and remains fully replaced`, () => {
    const { fs, renders } = setup()
    fs.characterItem = [...fs.characterItem, part('Gloves', 'old-gloves')]
    fs.replaceAllFromSource(source === 'incoming' ? 'original' : 'incoming')
    fs.setSlotMode('Hair', 'original')
    const outside = fs.slotControlMap.Hair
    const expected = source === 'incoming' ? [
      { Cloth: 'original', Shoes: 'incoming', Gloves: 'original' },
      { Cloth: 'incoming', Shoes: 'incoming', Gloves: 'original' },
      { Cloth: 'incoming', Shoes: 'incoming', Gloves: 'incoming' },
    ] : [
      { Cloth: 'incoming', Shoes: 'incoming', Gloves: 'original' },
      { Cloth: 'original', Shoes: 'incoming', Gloves: 'original' },
      { Cloth: 'original', Shoes: 'original', Gloves: 'original' },
    ]
    for (const [index, operation] of ['add', 'replace', 'full-replace'].entries()) {
      assert.equal(fs.getGroupSourceAction('clothes', source).operation, operation)
      assert.equal(fs.progressGroupSource('clothes', source), operation)
      assert.deepEqual(Object.fromEntries(clothes.map(key => [key, fs.slotControlMap[key].mode])), expected[index])
      assert.equal(fs.slotControlMap.Hair, outside)
      assert.equal(fs.groupOperations.clothes.mode, source)
      assert.equal(fs.groupOperations.clothes.operation, operation)
    }
    assert.equal(fs.getGroupSourceAction('clothes', source).complete, true)
    const controls = fs.slotControlMap
    const preview = fs.previewItem
    const renderCount = renders.length
    assert.equal(fs.progressGroupSource('clothes', source), 'full-replace')
    assert.equal(fs.slotControlMap, controls)
    assert.equal(fs.previewItem, preview)
    assert.equal(renders.length, renderCount)
  })
}

test('group source changes and direct slot edits use actual contents without changing other groups', () => {
  const { fs, candidate } = setup()
  fs.selectOutfit(candidate)
  assert.equal(fs.progressGroupSource('clothes', 'incoming'), 'full-replace')
  assert.equal(fs.progressGroupSource('body', 'original'), 'add')
  const bodyOperation = fs.groupOperations.body
  assert.equal(fs.progressGroupSource('clothes', 'original'), 'replace')
  fs.setSlotMode('Cloth', fs.slotControlMap.Cloth.mode)
  assert.equal(fs.groupOperations.clothes, undefined)
  assert.equal(fs.groupOperations.body, bodyOperation)
  assert.equal(fs.progressGroupSource('clothes', 'incoming'), 'replace')
  assert.equal(fs.progressGroupSource('unknown', 'incoming'), false)
  assert.equal(fs.progressGroupSource('clothes', 'empty'), false)
  fs.replaceAllFromSource('original')
  assert.deepEqual(Object.keys(fs.groupOperations), [])
  assert.deepEqual(names(fs), ['old-shirt', 'old-hair'])
})

test('partial replacement preserves manually cleared source-absent slots and skips completed stages', () => {
  const { fs } = setup()
  fs.characterItem.push(part('Gloves', 'old-gloves'))
  fs.replaceAllFromSource('original')
  fs.setSlotMode('Gloves', 'empty')
  assert.equal(fs.progressGroupSource('clothes', 'incoming'), 'add')
  assert.equal(fs.slotControlMap.Gloves.mode, 'empty')
  assert.equal(fs.progressGroupSource('clothes', 'incoming'), 'replace')
  assert.equal(fs.slotControlMap.Gloves.mode, 'empty')
  assert.equal(fs.progressGroupSource('clothes', 'incoming'), 'full-replace')
  assert.equal(fs.slotControlMap.Gloves.mode, 'incoming')

  fs.setSlotMode('Shoes', 'empty')
  assert.equal(fs.progressGroupSource('clothes', 'incoming'), 'add')
  assert.equal(fs.getGroupSourceAction('clothes', 'incoming').operation, 'full-replace')
  fs.setSlotMode('Cloth', 'original')
  assert.equal(fs.getGroupSourceAction('clothes', 'incoming').operation, 'replace')
})

test('matching contents count as covered even before their source controls are aligned', () => {
  const { fs } = setup()
  fs.characterItem = JSON.parse(JSON.stringify(fs.activeItem.data))
  fs.replaceAllFromSource('original')
  assert.equal(fs.getGroupSourceAction('clothes', 'incoming').operation, 'full-replace')
  assert.equal(fs.getGroupSourceAction('clothes', 'incoming').complete, false)
  fs.progressGroupSource('clothes', 'incoming')
  assert.equal(fs.getGroupSourceAction('clothes', 'incoming').complete, true)
})

test('an empty group source clears the group directly without moving controls to empty', () => {
  const { fs, candidate } = setup()
  fs.selectOutfit(candidate)
  fs.setSlotMode('Hair', 'original')
  assert.equal(fs.progressGroupSource('body', 'incoming'), 'full-replace')
  assert.equal(fs.slotControlMap.Hair.mode, 'incoming')
  assert.deepEqual(names(fs), ['new-shirt', 'new-shoes'])
})

test('single slots select directly with no cycle and missing sources retain the chosen slider position', () => {
  const { fs, candidate } = setup()
  fs.selectOutfit(candidate)
  fs.setSlotMode('Cloth', 'original')
  fs.setSlotMode('Cloth', 'original')
  assert.equal(fs.slotControlMap.Cloth.mode, 'original')
  fs.setSlotMode('Cloth', 'incoming')
  assert.equal(fs.slotControlMap.Cloth.mode, 'incoming')
  fs.setSlotMode('Cloth', 'empty')
  assert.equal(fs.slotControlMap.Cloth.mode, 'empty')
  fs.setSlotMode('Hair', 'incoming')
  assert.equal(fs.slotControlMap.Hair.mode, 'incoming')
  assert.deepEqual(names(fs), ['new-shoes'])
  assert.deepEqual(Object.keys(fs.groupOperations), [])
})

test('selecting an outfit always starts with full replacement and does not write or apply game data', () => {
  const { fs, character, candidate, hostWindow, renders, writes } = setup()
  assert.equal('defaultReplaceMode' in fs, false)
  assert.equal(typeof fs.setDefaultReplaceMode, 'undefined')
  const gameBefore = JSON.stringify(hostWindow.Player)
  assert.equal(fs.selectOutfit(candidate), true)
  assert.equal(fs.lockedItem, candidate)
  assert.equal(fs.activeItem.data, candidate.data)
  assert.deepEqual(modes(fs), { Cloth: 'incoming', Shoes: 'incoming', Gloves: 'incoming', Hair: 'incoming' })
  assert.deepEqual(names(fs), ['new-shirt', 'new-shoes'])
  assert.equal(renders.length, 1)
  assert.notEqual(fs.previewItem.data[0], candidate.data[0])
  fs.previewItem.data[0].Color[0] = 'render-mutated'
  assert.equal(candidate.data[0].Color[0], 'Default')
  assert.equal(character[0].Color[0], 'Default')
  assert.equal(JSON.stringify(hostWindow.Player), gameBefore)
  assert.deepEqual(writes, [])

  fs.progressGroupSource('clothes', 'incoming')
  fs.setSlotMode('Shoes', 'empty')
  fs.selectOutfit(candidate)
  assert.deepEqual(names(fs), ['new-shirt', 'new-shoes'])
  assert.deepEqual(Object.keys(fs.groupOperations), [])
  assert.equal(fs.selectOutfit({ name: 'Invalid', type: 'folder' }), false)
})

test('body shortcuts preserve or replace body, face and hair while retaining complete part details', () => {
  const { fs } = setup()
  fs.characterItem = [part('Cloth', 'old-shirt'), part('BodyUpper', 'old-body'), part('Eyes', 'old-eyes'), part('HairFront', 'old-hair')]
  fs.characterItem[3].Color = ['#123456']
  const candidate = { name: 'Whole outfit', type: 'outfit', data: [
    part('Cloth', 'new-shirt'), part('BodyUpper', 'new-body'), part('Eyes', 'new-eyes'), part('HairFront', 'new-hair')
  ] }
  candidate.data[3].Color = ['#abcdef']
  const originalSnapshot = JSON.stringify(fs.characterItem)
  const candidateSnapshot = JSON.stringify(candidate)
  fs.selectOutfit(candidate)
  fs.preserveBody()
  assert.deepEqual(names(fs), ['new-shirt', 'old-body', 'old-eyes', 'old-hair'])
  assert.equal(fs.previewItem.data.find(entry => entry.Group === 'HairFront').Color[0], '#123456')
  fs.replaceBodyOnly()
  assert.deepEqual(names(fs), ['old-shirt', 'new-body', 'new-eyes', 'new-hair'])
  assert.equal(fs.previewItem.data.find(entry => entry.Group === 'HairFront').Color[0], '#abcdef')
  assert.equal(JSON.stringify(fs.characterItem), originalSnapshot)
  assert.equal(JSON.stringify(candidate), candidateSnapshot)
  assert.deepEqual(Object.keys(fs.groupOperations), [])
  fs.selectOutfit(candidate)
  assert.deepEqual(names(fs), ['new-shirt', 'new-body', 'new-eyes', 'new-hair'])
})

test('file selections respect preview locking while -1 restores a deep character copy without clearing the lock', () => {
  const { fs, character, candidate, renders } = setup()
  fs.lockedItem = candidate
  const another = { name: 'Another', type: 'outfit', data: [part('Cloth', 'another-shirt')] }
  const active = fs.activeItem
  const controls = fs.slotControlMap
  fs.setActiveItem(another)
  fs.setActiveItem(null)
  fs.setActiveItem({ name: 'Folder', type: 'folder' }, { ignoreLock: true })
  assert.equal(fs.activeItem, active)
  assert.equal(fs.slotControlMap, controls)
  assert.equal(renders.length, 0)

  fs.setActiveItem(-1)
  assert.equal(fs.lockedItem, candidate)
  assert.notEqual(fs.activeItem.data, character)
  assert.notEqual(fs.activeItem.data[0], character[0])
  assert.notEqual(fs.activeItem.data[0].Color, character[0].Color)
  assert.deepEqual(JSON.parse(JSON.stringify(fs.activeItem.data)), character)
  assert.deepEqual(names(fs), ['old-shirt', 'old-hair'])
  assert.equal(renders.length, 1)
  fs.activeItem.data[0].Color[0] = 'Red'
  assert.equal(character[0].Color[0], 'Default')

  fs.setActiveItem(candidate)
  assert.equal(fs.activeItem.data, candidate.data)
  assert.equal(renders.length, 2)
  fs.setActiveItem(another, { ignoreLock: true })
  assert.equal(fs.activeItem.data, another.data)
  assert.equal(fs.lockedItem, candidate)
  assert.equal(renders.length, 3)
})

test('history preview clones data, keeps slot choices and locking, and does not record preview activity', () => {
  const { fs, candidate, renders, writes, flushTimers } = setup({ modes: { Cloth: 'incoming', Hair: 'original' } })
  const record = { name: 'History', data: [part('Cloth', 'history-shirt'), part('Shoes', 'history-shoes')] }
  fs.lockedItem = candidate
  const controls = fs.slotControlMap
  fs.loadHistoryRecord(record)
  assert.equal(fs.slotControlMap, controls)
  assert.equal(fs.lockedItem, candidate)
  assert.notEqual(fs.activeItem.data, record.data)
  assert.notEqual(fs.activeItem.data[0], record.data[0])
  assert.notEqual(fs.activeItem.data[0].Color, record.data[0].Color)
  assert.deepEqual(names(fs), ['history-shirt', 'old-hair'])
  assert.equal(renders.length, 1)
  fs.activeItem.data[0].Color[0] = 'Red'
  assert.equal(record.data[0].Color[0], 'Default')

  flushTimers()
  assert.equal(fs.getHistoryRecords().length, 0)
  assert.equal(fs.historyVersion, 0)
  assert.deepEqual(writes, [])

  fs.loadHistoryRecord(null)
  fs.loadHistoryRecord({ name: 'Missing data' })
  assert.equal(renders.length, 1)
})

test('history saves in the local UTF-16 format and restores the same records', () => {
  const { fs, hostWindow } = setup()
  const record = [part('Cloth', 'saved-shirt'), part('Shoes', 'saved-shoes')]
  fs.history.addRecord(record)
  const expected = JSON.parse(JSON.stringify(fs.history.toJSON()))

  fs.saveHistory()
  const key = 'VPWardrobe_VPWardrobe_history_42'
  const saved = hostWindow.localStorage.getItem(key)
  assert.ok(saved.startsWith('~VPWH1:'))
  assert.deepEqual(JSON.parse(LZString.decompressFromUTF16(saved.slice('~VPWH1:'.length))), expected)

  fs.history.clear()
  fs.loadHistory()
  assert.deepEqual(JSON.parse(JSON.stringify(fs.getHistoryRecords()[0].data)), record)
})

test('loading Base64 history migrates it to UTF-16 without losing records', () => {
  const { fs, hostWindow } = setup()
  fs.history.addRecord([part('Cloth', 'legacy-shirt')])
  const expected = JSON.parse(JSON.stringify(fs.history.toJSON()))
  const key = 'VPWardrobe_VPWardrobe_history_42'
  const legacy = LZString.compressToBase64(JSON.stringify(expected))
  hostWindow.localStorage.setItem(key, legacy)
  fs.history.clear()

  fs.loadHistory()

  assert.deepEqual(JSON.parse(JSON.stringify(fs.getHistoryRecords()[0].data)), expected.children[0].data)
  const migrated = hostWindow.localStorage.getItem(key)
  assert.ok(migrated.startsWith('~VPWH1:'))
  assert.deepEqual(JSON.parse(LZString.decompressFromUTF16(migrated.slice('~VPWH1:'.length))), expected)
})

test('history falls back to Base64 when a UTF-8 byte quota rejects UTF-16', () => {
  const { fs, hostWindow } = setup()
  const record = Array.from({ length: 20 }, (_, index) => part(`Cloth${index}`, `shirt-${index}`))
  fs.history.addRecord(record)
  const json = JSON.stringify(fs.history.toJSON())
  const utf16 = '~VPWH1:' + LZString.compressToUTF16(json)
  const base64 = LZString.compressToBase64(json)
  const bytes = value => new TextEncoder().encode(value).length
  assert.ok(bytes(utf16) > bytes(base64))
  const originalSetItem = hostWindow.localStorage.setItem
  hostWindow.localStorage.setItem = (key, value) => {
    if (bytes(value) > bytes(base64)) {
      throw Object.assign(new Error('Local storage quota reached'), { name: 'QuotaExceededError' })
    }
    originalSetItem(key, value)
  }

  fs.saveHistory()

  const key = 'VPWardrobe_VPWardrobe_history_42'
  assert.equal(hostWindow.localStorage.getItem(key), base64)
  fs.history.clear()
  fs.loadHistory()
  assert.deepEqual(JSON.parse(JSON.stringify(fs.getHistoryRecords()[0].data)), record)
  assert.equal(hostWindow.localStorage.getItem(key), base64)
})

test('initialization previews the character before metadata resolves and preserves a selection made while waiting', async () => {
  const { fs, hostWindow, renders } = loadFileSystemStore()
  fs.history.filter = ['Cloth', 'Shoes']
  assert.equal(fs.loadAll(), true)
  renders.length = 0
  hostWindow.Player.Appearance = [{
    Asset: { Name: 'initial-shirt', Group: { Name: 'Cloth', Category: 'Appearance' } },
    Color: ['Blue'], Property: { Custom: 'preserved' }
  }]
  let releaseMetadata
  const metadata = new Promise(resolve => { releaseMetadata = resolve })
  fs._filterInitPromise = metadata.then(items => fs.initFilterService(items))
  let completed = false
  const initializing = fs.initialize(hostWindow.Player).then(() => { completed = true })

  assert.equal(fs.filterService, null)
  assert.deepEqual(names(fs), ['initial-shirt'])
  assert.equal(renders.length, 1)
  assert.equal(renders[0], fs.previewItem)
  assert.deepEqual(Array.from(fs.previewItem.data[0].Color), ['Blue'])
  await Promise.resolve()
  assert.equal(completed, false)

  const candidate = { name: 'Chosen while loading', type: 'outfit', data: [
    part('Cloth', 'chosen-shirt'), part('Shoes', 'chosen-shoes')
  ] }
  fs.togglePreviewLock(candidate)
  fs.setSlotMode('Shoes', 'empty')
  assert.deepEqual(names(fs), ['chosen-shirt'])
  releaseMetadata([
    { key: 'Cloth', data: { Name: 'Cloth', Category: 'Appearance' } },
    { key: 'Shoes', data: { Name: 'Shoes', Category: 'Appearance' } },
    { key: 'Gloves', data: { Name: 'Gloves', Category: 'Appearance' } }
  ])
  await initializing

  assert.equal(completed, true)
  assert.ok(fs.filterService)
  assert.equal(fs.lockedItem, candidate)
  assert.equal(fs.activeItem.data, candidate.data)
  assert.equal(fs.slotControlMap.Shoes.mode, 'empty')
  assert.deepEqual(names(fs), ['chosen-shirt'])
  assert.equal(renders.at(-1), fs.previewItem)
})


test('selecting an outfit captures the current target and isolates nested original properties', () => {
  const { fs, candidate, hostWindow } = setup()
  hostWindow.Player.Appearance = [{
    Asset: { Name: 'live-shirt', Group: { Name: 'Cloth', Category: 'Appearance' } },
    Color: ['Green'], Property: { TypeRecord: { typed: 1 } }, Craft: { Nested: { Value: 2 } }
  }]
  fs.selectOutfit(candidate)
  fs.replaceAllFromSource('original')
  assert.deepEqual(names(fs), ['live-shirt'])
  hostWindow.Player.Appearance[0].Property.TypeRecord.typed = 9
  hostWindow.Player.Appearance[0].Craft.Nested.Value = 8
  assert.equal(fs.characterItem[0].Property.TypeRecord.typed, 1)
  assert.equal(fs.characterItem[0].Craft.Nested.Value, 2)
  fs.updatePreviewItem()
  assert.equal(fs.previewItem.data[0].Property.TypeRecord.typed, 1)
})

test('switching targets resolves active group operations against the new target and retains direct slot choices', async () => {
  const expectedBySource = {
    incoming: [
      ['target-shoes', 'target-hair', 'new-shirt'],
      ['new-shoes', 'target-hair', 'new-shirt'],
      ['new-shoes', 'target-hair', 'new-shirt'],
    ],
    original: [
      ['new-shoes', 'target-hair', 'new-shirt'],
      ['target-shoes', 'target-hair', 'new-shirt'],
      ['target-shoes', 'target-hair'],
    ],
  }
  const appearance = (Group, Name) => ({ Asset: { Name, Group: { Name: Group, Category: 'Appearance' } } })
  for (const source of ['incoming', 'original']) {
    for (let clicks = 1; clicks <= 3; clicks++) {
      const { fs, candidate, hostWindow } = setup()
      fs.loadAll()
      hostWindow.Player.Appearance = [appearance('Cloth', 'initial-shirt'), appearance('Gloves', 'initial-gloves'), appearance('HairFront', 'initial-hair')]
      fs.selectOutfit(candidate)
      fs.replaceAllFromSource(source === 'incoming' ? 'original' : 'incoming')
      for (let click = 0; click < clicks; click++) fs.progressGroupSource('clothes', source)
      fs.setSlotMode('HairFront', 'original')
      const groupOperation = fs.groupOperations.clothes
      const target = { MemberNumber: 43, Appearance: [appearance('Shoes', 'target-shoes'), appearance('HairFront', 'target-hair')] }
      await fs.initialize(target, { preInitialize: false, keepSelection: true, preserveSlotControls: true })
      assert.deepEqual(names(fs), expectedBySource[source][clicks - 1], `${source} click ${clicks}`)
      assert.equal(fs.groupOperations.clothes, groupOperation)
      assert.equal(fs.slotControlMap.HairFront.mode, 'original')

      const nextTarget = { MemberNumber: 44, Appearance: [appearance('Cloth', 'third-shirt'), appearance('HairFront', 'third-hair')] }
      await fs.initialize(nextTarget, { preInitialize: false, keepSelection: true, preserveSlotControls: true })
      assert.equal(fs.groupOperations.clothes, groupOperation)
      if (source === 'incoming' && clicks === 1) {
        assert.deepEqual(names(fs), ['third-shirt', 'third-hair', 'new-shoes'])
      }
    }
  }
})

test('switching targets does not resurrect a group policy cleared by a manual part choice', async () => {
  const { fs, candidate, hostWindow } = setup()
  fs.loadAll()
  const appearance = (Group, Name) => ({ Asset: { Name, Group: { Name: Group, Category: 'Appearance' } } })
  hostWindow.Player.Appearance = [appearance('Cloth', 'initial-shirt')]
  fs.selectOutfit(candidate)
  fs.progressGroupSource('clothes', 'incoming')
  fs.setSlotMode('Cloth', 'incoming')
  const target = { MemberNumber: 43, Appearance: [appearance('Cloth', 'target-shirt'), appearance('Shoes', 'target-shoes')] }
  await fs.initialize(target, { preInitialize: false, keepSelection: true, preserveSlotControls: true })
  assert.deepEqual(names(fs), ['new-shirt', 'new-shoes'])
  assert.equal(fs.groupOperations.clothes, undefined)
})

test('only final apply writes the selected snapshot and game mutations cannot alter saved outfit data', () => {
  const { fs, candidate, hostWindow } = setup()
  const asset = (Group, Name) => ({ Name, Group: { Name: Group, Category: 'Appearance' } })
  hostWindow.Player.AssetFamily = 'Female3DCG'
  hostWindow.Player.Appearance = [{ Asset: asset('Cloth', 'captured-shirt'), Color: ['Green'] }]
  hostWindow.AssetGet = (_family, Group, Name) => asset(Group, Name)
  hostWindow.InventoryGet = (character, group) => character.Appearance.find(entry => entry.Asset.Group.Name === group)
  hostWindow.InventoryItemHasEffect = () => false
  hostWindow.CharacterRefresh = () => {}
  hostWindow.ChatRoomCharacterUpdate = () => {}
  let writes = 0
  let applied
  hostWindow.ServerAppearanceLoadFromBundle = (character, _family, bundle) => {
    writes += 1
    applied = JSON.parse(JSON.stringify(bundle))
    bundle[1].Color[0] = 'host-mutation'
    character.Appearance = bundle.map(entry => ({ Asset: asset(entry.Group, entry.Name), Color: entry.Color }))
  }
  fs.selectOutfit(candidate)
  fs.replaceAllFromSource('original')
  fs.progressGroupSource('clothes', 'incoming')
  const expected = JSON.stringify(fs.previewItem.data)
  assert.deepEqual(names(fs), ['captured-shirt', 'new-shoes'])
  assert.equal(writes, 0)
  hostWindow.Player.Appearance[0].Asset.Name = 'changed-during-preview'
  assert.equal(fs.applyCurrentPreviewToCharacter(), true)
  assert.equal(JSON.stringify(applied), expected)
  assert.equal(writes, 1)
  assert.equal(candidate.data[1].Color[0], 'Default')
})

test('group coverage compares prepared crafting data and refreshes changed crafting before completion', () => {
  const { fs, candidate, hostWindow } = setup()
  hostWindow.Player.AssetFamily = 'Female3DCG'
  hostWindow.Player.Appearance = []
  hostWindow.Player.Crafting = [{ Item: 'new-shirt', Group: 'Cloth', Color: ['#123abc'], TypeRecord: { style: 2 } }]
  fs.selectOutfit(candidate)
  assert.equal(fs.getGroupSourceAction('clothes', 'incoming').operation, 'full-replace')
  assert.equal(fs.getGroupSourceAction('clothes', 'incoming').complete, true)
  const prepared = fs.previewItem
  hostWindow.Player.Crafting[0].Color[0] = '#fedcba'
  assert.equal(fs.getGroupSourceAction('clothes', 'incoming').operation, 'replace')
  assert.equal(fs.getGroupSourceAction('clothes', 'incoming').complete, false)
  assert.equal(fs.previewItem, prepared)
  assert.equal(fs.progressGroupSource('clothes', 'incoming'), 'replace')
  assert.equal(fs.previewItem.data[0].Color[0], '#fedcba')
  assert.equal(fs.getGroupSourceAction('clothes', 'incoming').complete, true)
})


test('crafting visuals are prepared in preview and final apply keeps that snapshot when crafting changes', () => {
  const { fs, candidate, hostWindow } = setup()
  const asset = (Group, Name) => ({ Name, Group: { Name: Group, Category: 'Appearance' } })
  hostWindow.Player.AssetFamily = 'Female3DCG'
  hostWindow.Player.Appearance = []
  hostWindow.Player.Crafting = [{ Item: 'new-shirt', Group: 'Cloth', Color: ['#123abc'], TypeRecord: { style: 2 } }]
  hostWindow.AssetGet = (_family, Group, Name) => asset(Group, Name)
  hostWindow.InventoryGet = (character, group) => character.Appearance.find(entry => entry.Asset.Group.Name === group)
  hostWindow.InventoryItemHasEffect = () => false
  hostWindow.CharacterRefresh = () => {}
  hostWindow.ChatRoomCharacterUpdate = () => {}
  const applied = []
  hostWindow.ServerAppearanceLoadFromBundle = (character, _family, bundle) => {
    applied.push(JSON.parse(JSON.stringify(bundle)))
    bundle[0].Color[0] = 'host-mutated'
    character.Appearance = bundle.map(entry => ({ Asset: asset(entry.Group, entry.Name), Color: entry.Color, Property: entry.Property }))
  }
  const savedBefore = JSON.stringify(candidate)
  fs.selectOutfit(candidate)
  assert.equal(fs.previewItem.data[0].Color[0], '#123abc')
  assert.equal(fs.previewItem.data[0].Property.TypeRecord.style, 2)
  const prepared = JSON.stringify(fs.previewItem.data)
  hostWindow.Player.Crafting[0].Color[0] = '#fedcba'
  hostWindow.Player.Crafting[0].TypeRecord.style = 3
  assert.equal(fs.applyCurrentPreviewToCharacter(), true)
  assert.equal(JSON.stringify(applied[0]), prepared)
  assert.equal(JSON.stringify(fs.previewItem.data), prepared)
  assert.equal(JSON.stringify(candidate), savedBefore)

  assert.equal(fs.applyFilteredOutfitToCharacter({ outfitData: candidate.data }), true)
  assert.equal(applied[1][0].Color[0], '#fedcba')
  assert.equal(applied[1][0].Property.TypeRecord.style, 3)
  assert.equal(JSON.stringify(candidate), savedBefore)
})

test('original sources preserve captured colors and properties even when the player owns a matching craft', () => {
  const { fs, hostWindow } = setup()
  const asset = (Group, Name) => ({ Name, Group: { Name: Group, Category: 'Appearance' } })
  hostWindow.Player.AssetFamily = 'Female3DCG'
  hostWindow.Player.Appearance = [
    { Asset: asset('HairFront', 'original-hair'), Color: ['#112233'], Property: { Expression: 'Original' } },
    { Asset: asset('Cloth', 'original-shirt'), Color: ['#334455'] },
  ]
  hostWindow.Player.Crafting = [
    { Item: 'original-hair', Group: 'HairFront', Color: ['#ff0000'], TypeRecord: { style: 2 } },
    { Item: 'original-shirt', Group: 'Cloth', Color: ['#00ff00'], TypeRecord: { style: 3 } },
  ]
  hostWindow.AssetGet = (_family, Group, Name) => asset(Group, Name)
  hostWindow.InventoryGet = (character, group) => character.Appearance.find(entry => entry.Asset.Group.Name === group)
  hostWindow.InventoryItemHasEffect = () => false
  hostWindow.CharacterRefresh = () => {}
  hostWindow.ChatRoomCharacterUpdate = () => {}
  const applied = []
  hostWindow.ServerAppearanceLoadFromBundle = (_character, _family, bundle) => {
    applied.push(JSON.parse(JSON.stringify(bundle)))
    bundle[0].Color[0] = 'host-mutation'
  }
  const candidate = { type: 'outfit', data: [part('HairFront', 'incoming-hair'), part('Cloth', 'original-shirt')] }
  fs.selectOutfit(candidate)
  fs.preserveBody()
  const hair = fs.previewItem.data.find(entry => entry.Group === 'HairFront')
  assert.deepEqual(Array.from(hair.Color), ['#112233'])
  assert.equal(hair.Property.Expression, 'Original')
  assert.equal(hair.Property.TypeRecord, undefined)
  // The incoming shirt still receives its matching craft.
  assert.deepEqual(Array.from(fs.previewItem.data.find(entry => entry.Group === 'Cloth').Color), ['#00ff00'])

  fs.replaceAllFromSource('original')
  const original = JSON.stringify(fs.characterItem)
  assert.equal(JSON.stringify(fs.previewItem.data), original)
  assert.notEqual(fs.previewItem.data[0], fs.characterItem[0])
  assert.equal(fs.applyCurrentPreviewToCharacter(), true)
  assert.equal(JSON.stringify(applied[0]), original)
  assert.equal(JSON.stringify(fs.previewItem.data), original)
  assert.equal(fs.applyFilteredOutfitToCharacter({ outfitData: candidate.data }), true)
  assert.equal(JSON.stringify(applied[1]), original)
})

test('applying retains the editing session original until a new selection captures the live character', () => {
  const { fs, hostWindow } = setup()
  const asset = (Group, Name) => ({ Name, Group: { Name: Group, Category: 'Appearance' } })
  hostWindow.Player.AssetFamily = 'Female3DCG'
  hostWindow.Player.Appearance = [
    { Asset: asset('Cloth', 'original-shirt'), Color: ['#123456'] },
    { Asset: asset('HairFront', 'original-hair'), Color: ['#abcdef'] },
  ]
  hostWindow.AssetGet = (_family, Group, Name) => asset(Group, Name)
  hostWindow.InventoryGet = (character, group) => character.Appearance.find(entry => entry.Asset.Group.Name === group)
  hostWindow.InventoryItemHasEffect = () => false
  hostWindow.CharacterRefresh = () => {}
  hostWindow.ChatRoomCharacterUpdate = () => {}
  hostWindow.ServerAppearanceLoadFromBundle = (character, _family, bundle) => {
    character.Appearance = bundle.map(entry => ({ Asset: asset(entry.Group, entry.Name), Color: entry.Color }))
  }
  const candidate = { type: 'outfit', data: [part('Cloth', 'new-shirt'), part('HairFront', 'new-hair')] }
  fs.selectOutfit(candidate)
  const original = JSON.stringify(fs.characterItem)
  assert.equal(fs.applyCurrentPreviewToCharacter(), true)
  assert.equal(hostWindow.Player.Appearance[0].Asset.Name, 'new-shirt')
  assert.equal(JSON.stringify(fs.characterItem), original)
  fs.preserveBody()
  assert.deepEqual(names(fs), ['new-shirt', 'original-hair'])
  assert.deepEqual(Array.from(fs.previewItem.data[1].Color), ['#abcdef'])
  fs.replaceAllFromSource('original')
  assert.equal(JSON.stringify(fs.previewItem.data), original)

  fs.selectOutfit(candidate)
  fs.replaceAllFromSource('original')
  assert.deepEqual(names(fs), ['new-shirt', 'new-hair'])
})
