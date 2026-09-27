import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadFileSystemStore } from './helpers/load-file-system-store.js'
import { CLOUDFLARE_KEY_SETTING } from '../src/services/cloudflare-wardrobe-client.js'
import { applyWardrobeOperations, createWardrobeIndex } from '../src/services/wardrobe-index.js'

const outfit = name => ({ name, type: 'outfit', data: [{ Group: 'Cloth', Name: name, Color: ['Default'] }] })
const recoveryKey = `vpw1_${'A'.repeat(43)}`
const wrongRecoveryKey = `vpw1_${'B'.repeat(43)}`
const markerKey = `VPW4_M_${'a'.repeat(32)}`
const legacySettings = () => ({ VPWardrobe: JSON.stringify(applyWardrobeOperations(createWardrobeIndex(), [
  { type: 'put-outfit', id: 'legacy-dress', changes: outfit('Legacy dress') },
], { replicaId: 'legacy-device' })),
  [markerKey]: '{"v":1,"s":0}' })

async function setup({ client, bcKey, settings } = {}) {
  const fixture = loadFileSystemStore()
  const { fs, hostWindow } = fixture
  const sent = []
  hostWindow.navigator = { onLine: true }
  hostWindow.ServerSend = (event, fields) => { sent.push({ event, fields }); return true }
  if (bcKey) hostWindow.Player.ExtensionSettings[CLOUDFLARE_KEY_SETTING] = bcKey
  if (settings) Object.assign(hostWindow.Player.ExtensionSettings, settings)
  fs._cloudflareClient = client || { available: true,
    read: async () => ({ revision: 0, index: null }),
    write: async () => 1,
  }
  assert.equal(await fs.loadAll(), true)
  return { ...fixture, sent }
}

function garmentUploads(sent) {
  return sent.filter(({ fields }) => Object.hasOwn(fields, 'ExtensionSettings.VPWardrobe'))
}

function legacyCleanup(sent) {
  return sent.filter(({ fields }) => fields['ExtensionSettings.VPWardrobe'] === null)
}

test('opt-in makes Cloudflare primary, stores the key locally and submits only the key to BC', async () => {
  const { fs, hostWindow, sent } = await setup()
  assert.equal(fs.cloudflareSyncStatus.enabled, false)
  await fs.importCloudflareKey(recoveryKey)
  assert.equal(await fs.enableCloudflareSync(), true)
  const key = await fs.exportCloudflareKey()
  assert.match(key, /^vpw1_[A-Za-z0-9_-]{43}$/)
  assert.equal(await fs._submitCloudflareKeyToBC(key), false)

  const id = await fs.addOutfit(outfit('Cloud dress'))
  assert.equal(await fs.syncNow(), true)
  assert.equal(hostWindow.Player.ExtensionSettings[CLOUDFLARE_KEY_SETTING], key)
  assert.deepEqual(JSON.parse(JSON.stringify(await fs._repository.persistence.readMeta('42', 'cloudflareSync'))),
    { enabled: true, key, keySubmittedToBC: true })
  assert.equal(fs.cloudflareSyncStatus.enabled, true)
  assert.equal((await fs._repository.persistence.read('42')).index.outfits[id].name, 'Cloud dress')
  assert.equal(garmentUploads(sent).length, 0)
  assert.ok(sent.some(({ event, fields }) => event === 'AccountUpdate'
    && fields[`ExtensionSettings.${CLOUDFLARE_KEY_SETTING}`] === key))
  assert.equal(sent.every(({ fields }) => !/email/i.test(JSON.stringify(fields))), true)
})

test('Cloudflare failure stays opt-in and does not block durable local edits or fall back to BC', async () => {
  const { fs, sent } = await setup({ client: { available: true,
    read: async () => { throw new Error('Cloudflare offline') },
  } })
  await fs.importCloudflareKey(recoveryKey)
  await fs.enableCloudflareSync()
  const id = await fs.addOutfit(outfit('Offline dress'))
  assert.equal(await fs.syncNow(), false)
  assert.equal(fs.cloudflareSyncStatus.enabled, true)
  assert.match(fs.cloudflareSyncStatus.error, /Cloudflare offline/)
  assert.equal(fs.outfits[0].id, id)
  assert.equal((await fs._repository.persistence.read('42')).index.outfits[id].name, 'Offline dress')
  assert.equal(garmentUploads(sent).length, 0)
})

test('turning Cloudflare off waits for a fresh BC login snapshot before uploading garments', async () => {
  const { fs, hostWindow, sent } = await setup()
  assert.equal(await fs.receiveCloud({ memberNumber: 42,
    extensionSettings: hostWindow.Player.ExtensionSettings }), true)
  await fs.importCloudflareKey(recoveryKey)
  await fs.enableCloudflareSync()
  await fs.addOutfit(outfit('Return to BC'))
  assert.equal(await fs.disableCloudflareSync(), true)
  assert.equal(fs.cloudflareSyncStatus.enabled, false)
  assert.equal((await fs._repository.persistence.readMeta('42', 'cloudflareSync')).enabled, false)
  const before = garmentUploads(sent).length
  assert.equal(await fs.syncNow(), false)
  assert.equal(garmentUploads(sent).length, before)
  assert.equal(await fs.receiveCloud({ memberNumber: 42,
    extensionSettings: hostWindow.Player.ExtensionSettings }), true)
  assert.equal(await fs.syncNow(), true)
  assert.equal(garmentUploads(sent).length, before + 1)
})

test('a recovery key can be imported and exported, persisted and reused from BC on another device', async () => {
  const { fs, sent } = await setup()
  assert.equal(await fs.importCloudflareKey(`  ${recoveryKey}  `), true)
  assert.equal(await fs.exportCloudflareKey(), recoveryKey)
  assert.equal(await fs._submitCloudflareKeyToBC(recoveryKey), false)
  assert.deepEqual(JSON.parse(JSON.stringify(await fs._repository.persistence.readMeta('42', 'cloudflareSync'))),
    { enabled: false, key: recoveryKey, keySubmittedToBC: false })
  assert.equal(await fs.enableCloudflareSync(), true)
  assert.equal(await fs.syncNow(), true)
  assert.equal(await fs.exportCloudflareKey(), recoveryKey)
  assert.equal(garmentUploads(sent).length, 0)

  const otherDevice = await setup({ bcKey: recoveryKey })
  assert.equal(await otherDevice.fs.exportCloudflareKey(), recoveryKey)
  assert.equal(otherDevice.fs.cloudflareSyncStatus.enabled, false)
  assert.equal(await otherDevice.fs.enableCloudflareSync(), true)
  assert.equal(await otherDevice.fs.exportCloudflareKey(), recoveryKey)
  assert.equal(otherDevice.sent.some(({ fields }) => /email/i.test(JSON.stringify(fields))), false)
})

test('BC wardrobe remains until Cloudflare acknowledges it, then one update clears it with the key', async () => {
  const { fs, hostWindow, sent } = await setup({ settings: legacySettings() })
  assert.equal(await fs.receiveCloud({ memberNumber: 42,
    extensionSettings: { ...hostWindow.Player.ExtensionSettings } }), true)
  await fs.importCloudflareKey(recoveryKey)
  await fs.enableCloudflareSync()
  const fresh = { ...hostWindow.Player.ExtensionSettings }
  assert.equal(await fs.receiveCloud({ memberNumber: 42, extensionSettings: fresh }), true)
  assert.equal(fs.cloudflareSyncStatus.bcLegacyRetained, true)
  assert.equal(legacyCleanup(sent).length, 0)

  assert.equal(await fs.syncNow(), true)
  assert.equal(fs._repository.document.cloudflareRevision, 1)
  assert.equal(legacyCleanup(sent).length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(legacyCleanup(sent)[0].fields)), {
    'ExtensionSettings.VPWardrobe': null,
    [`ExtensionSettings.${markerKey}`]: null,
    [`ExtensionSettings.${CLOUDFLARE_KEY_SETTING}`]: recoveryKey,
  })
  assert.equal(fs.cloudflareSyncStatus.bcLegacyRetained, null)
  assert.equal(await fs.receiveCloud({ memberNumber: 42,
    extensionSettings: { ...fresh, VPWardrobe: null, [markerKey]: null } }), true)
  assert.equal(fs.cloudflareSyncStatus.bcLegacyRetained, false)
  assert.equal(legacyCleanup(sent).length, 1)
})

test('a failed Cloudflare upload leaves the old BC wardrobe and markers in place', async () => {
  const { fs, hostWindow, sent } = await setup({ settings: legacySettings(),
    client: { available: true, read: async () => ({ revision: 0, index: null }),
      write: async () => { throw new Error('Cloudflare offline') } },
  })
  await fs.importCloudflareKey(recoveryKey)
  await fs.enableCloudflareSync()
  assert.equal(await fs.syncNow(), false)
  assert.equal(legacyCleanup(sent).length, 0)
  assert.equal(fs.cloudflareSyncStatus.bcLegacyRetained, null)
  assert.notEqual(hostWindow.Player.ExtensionSettings.VPWardrobe, null)
  assert.notEqual(hostWindow.Player.ExtensionSettings[markerKey], null)
})

test('Cloudflare success alone cannot clear BC data without a fresh login snapshot', async () => {
  const { fs, hostWindow, sent } = await setup({ settings: legacySettings() })
  await fs.importCloudflareKey(recoveryKey)
  await fs.enableCloudflareSync()
  assert.equal(await fs.syncNow(), true)
  assert.equal(legacyCleanup(sent).length, 0)
  assert.notEqual(hostWindow.Player.ExtensionSettings.VPWardrobe, null)
})

test('another device changing BC after opt-in blocks cleanup across reloads', async () => {
  const { fs, hostWindow, sent } = await setup({ settings: legacySettings() })
  assert.equal(await fs.receiveCloud({ memberNumber: 42,
    extensionSettings: { ...hostWindow.Player.ExtensionSettings } }), true)
  await fs.importCloudflareKey(recoveryKey)
  await fs.enableCloudflareSync()
  const changed = { ...hostWindow.Player.ExtensionSettings,
    [markerKey]: '{"v":1,"s":1}',
  }
  assert.equal(await fs.receiveCloud({ memberNumber: 42, extensionSettings: changed }), true)
  assert.equal(fs.cloudflareSyncStatus.bcLegacyChanged, true)
  assert.equal(await fs.syncNow(), true)
  assert.equal(legacyCleanup(sent).length, 0)

  assert.equal(await fs.loadAll(), true)
  assert.equal(await fs.receiveCloud({ memberNumber: 42, extensionSettings: changed }), true)
  assert.equal(fs.cloudflareSyncStatus.bcLegacyChanged, true)
  assert.equal(legacyCleanup(sent).length, 0)
  assert.notEqual(hostWindow.Player.ExtensionSettings.VPWardrobe, null)
})

test('BC cache changing after a fresh login blocks its pending cleanup', async () => {
  const { fs, hostWindow, sent } = await setup({ settings: legacySettings() })
  assert.equal(await fs.receiveCloud({ memberNumber: 42,
    extensionSettings: { ...hostWindow.Player.ExtensionSettings } }), true)
  await fs.importCloudflareKey(recoveryKey)
  await fs.enableCloudflareSync()
  assert.equal(await fs.receiveCloud({ memberNumber: 42,
    extensionSettings: { ...hostWindow.Player.ExtensionSettings } }), true)
  hostWindow.Player.ExtensionSettings[markerKey] = '{"v":1,"s":2}'
  assert.equal(await fs.syncNow(), true)
  assert.equal(fs.cloudflareSyncStatus.bcLegacyChanged, true)
  assert.equal(legacyCleanup(sent).length, 0)
})

test('a login response for another member cannot replace the Cloudflare cleanup evidence', async () => {
  const { fs, hostWindow, sent } = await setup({ settings: legacySettings() })
  await fs.importCloudflareKey(recoveryKey)
  await fs.enableCloudflareSync()
  assert.equal(await fs.receiveCloud({ memberNumber: 999,
    extensionSettings: { VPWardrobe: 'another account', [markerKey]: 'changed' } }), false)
  assert.equal(fs.cloudflareSyncStatus.bcLegacyRetained, null)
  assert.equal(await fs.syncNow(), true)
  assert.equal(legacyCleanup(sent).length, 0)
  assert.notEqual(hostWindow.Player.ExtensionSettings.VPWardrobe, null)
})

test('cleanup carries the correct key atomically even when the fresh BC key differs', async () => {
  const { fs, hostWindow, sent } = await setup({ settings: legacySettings() })
  assert.equal(await fs.receiveCloud({ memberNumber: 42,
    extensionSettings: { ...hostWindow.Player.ExtensionSettings } }), true)
  await fs.importCloudflareKey(recoveryKey)
  await fs.enableCloudflareSync()
  assert.equal(await fs.receiveCloud({ memberNumber: 42,
    extensionSettings: { ...hostWindow.Player.ExtensionSettings,
      [CLOUDFLARE_KEY_SETTING]: wrongRecoveryKey } }), true)
  assert.equal(await fs.syncNow(), true)
  assert.equal(legacyCleanup(sent).length, 1)
  assert.equal(legacyCleanup(sent)[0].fields[`ExtensionSettings.${CLOUDFLARE_KEY_SETTING}`], recoveryKey)
  assert.equal(fs.cloudflareSyncStatus.bcLegacyRetained, null)
})

test('changing the recovery key starts a new cloud revision without losing local outfits', async () => {
  const cloud = new Map()
  let rejectNewKey = true
  const client = { available: true,
    read: async key => cloud.get(key) || { revision: 0, index: null },
    write: async (key, expectedRevision, index) => {
      if (key === wrongRecoveryKey && rejectNewKey) throw new Error('Cloudflare offline')
      const current = cloud.get(key) || { revision: 0, index: null }
      assert.equal(expectedRevision, current.revision)
      const revision = expectedRevision + 1
      cloud.set(key, { revision, index })
      return revision
    },
  }
  const { fs, hostWindow } = await setup({ client })
  await fs.importCloudflareKey(recoveryKey)
  await fs.enableCloudflareSync()
  const id = await fs.addOutfit(outfit('Key A dress'))
  assert.equal(await fs.syncNow(), true)
  assert.equal(cloud.get(recoveryKey).revision, 1)
  assert.equal(hostWindow.Player.ExtensionSettings[CLOUDFLARE_KEY_SETTING], recoveryKey)
  assert.equal(await fs.disableCloudflareSync(), true)

  await fs.importCloudflareKey(wrongRecoveryKey)
  assert.equal(fs._repository.document.cloudflareRevision, 0)
  await fs.enableCloudflareSync()
  assert.equal(await fs.syncNow(), false)
  assert.equal(hostWindow.Player.ExtensionSettings[CLOUDFLARE_KEY_SETTING], recoveryKey)
  rejectNewKey = false
  assert.equal(await fs.syncNow(), true)
  assert.equal(hostWindow.Player.ExtensionSettings[CLOUDFLARE_KEY_SETTING], wrongRecoveryKey)
  assert.equal(cloud.get(wrongRecoveryKey).revision, 1)
  assert.equal(cloud.get(wrongRecoveryKey).index.outfits[id].name, 'Key A dress')
  assert.equal(cloud.get(recoveryKey).revision, 1)
})

test('a fresh BC key mismatch is resubmitted after sync even if the player cache still has this key', async () => {
  let cloud = { revision: 0, index: null }
  const client = { available: true,
    read: async () => cloud,
    write: async (_key, revision, index) => {
      cloud = { revision: revision + 1, index }
      return cloud.revision
    },
  }
  const { fs, hostWindow, sent } = await setup({ client })
  await fs.importCloudflareKey(recoveryKey)
  await fs.enableCloudflareSync()
  await fs.addOutfit(outfit('Cloud dress'))
  assert.equal(await fs.syncNow(), true)
  assert.equal(hostWindow.Player.ExtensionSettings[CLOUDFLARE_KEY_SETTING], recoveryKey)
  const before = sent.length
  assert.equal(await fs.receiveCloud({ memberNumber: 42,
    extensionSettings: { [CLOUDFLARE_KEY_SETTING]: wrongRecoveryKey } }), true)
  assert.equal(fs.cloudflareSyncStatus.keySavedToBC, false)
  assert.equal(await fs.syncNow(), true)
  assert.equal(sent.length, before + 1)
  assert.equal(sent.at(-1).fields[`ExtensionSettings.${CLOUDFLARE_KEY_SETTING}`], recoveryKey)
})

test('an old account GET cannot merge into the next account or upload under its key', async () => {
  let finishOldRead
  const uploads = []
  const oldCloud = applyWardrobeOperations(createWardrobeIndex(), [
    { type: 'put-outfit', id: 'old-shirt', changes: outfit('Old shirt') },
  ], { replicaId: 'old-device' })
  const client = { available: true,
    read: key => key === recoveryKey
      ? new Promise(resolve => { finishOldRead = resolve })
      : Promise.resolve({ revision: 0, index: null }),
    write: async (key, revision) => { uploads.push([key, revision]); return revision + 1 },
  }
  const { fs, hostWindow } = await setup({ client })
  await fs.importCloudflareKey(recoveryKey)
  await fs.enableCloudflareSync()
  const oldTask = fs.syncNow()
  assert.equal(typeof finishOldRead, 'function')

  hostWindow.Player = { ...hostWindow.Player, MemberNumber: 43, ExtensionSettings: {} }
  hostWindow.__VPW_WARDROBE_LOCK_MEMBER = '43'
  assert.equal(await fs.loadAll(), true)
  await fs.importCloudflareKey(wrongRecoveryKey)
  await fs.enableCloudflareSync()
  assert.equal(await fs.syncNow(), true)

  finishOldRead({ revision: 1, index: oldCloud })
  assert.equal(await oldTask, false)
  assert.equal(fs._repository.member, '43')
  assert.equal(fs.outfits.some(item => item.id === 'old-shirt'), false)
  assert.equal(uploads.some(([key]) => key === recoveryKey), false)
})
