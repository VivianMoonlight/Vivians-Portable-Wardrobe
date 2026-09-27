import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { HistoryPersistence } from '../src/services/history-persistence.js'

test('history IndexedDB writes require the current member lock, while reads remain available', async () => {
  const indexedDB = new IDBFactory()
  let playerMember = '42'
  let lockMember = '42'
  const persistence = new HistoryPersistence(() => indexedDB,
    member => member === playerMember && member === lockMember)

  await persistence.write('42', { children: [{ name: 'original' }] })
  playerMember = '43'
  await assert.rejects(persistence.write('42', { children: [] }), { code: 'writer-lost' })
  await assert.rejects(persistence.write('43', { children: [] }), { code: 'writer-lost' })
  await assert.rejects(persistence.archiveLegacy('43', 'legacy'), { code: 'writer-lost' })
  assert.deepEqual(await persistence.read('42'), { children: [{ name: 'original' }] })
  assert.equal(await persistence.read('43'), null)

  lockMember = '43'
  await persistence.write('43', { children: [{ name: 'new' }] })
  await persistence.archiveLegacy('43', 'legacy')
  assert.deepEqual(await persistence.read('43'), { children: [{ name: 'new' }] })
  assert.equal((await persistence.listLegacyArchives('43'))[0].raw, 'legacy')
})
