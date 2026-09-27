import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'

const lockUrl = '/@fs/' + resolve('src/utils/wardrobe-tab-lock.js').replaceAll('\\', '/')

async function loadedStoreUrl(page) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const url = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name)
        .findLast(value => new URL(value).pathname.endsWith('/src/stores/fileSystemStore.js')))
      if (url) return url
    } catch (error) {
      if (!String(error).includes('Execution context was destroyed')) throw error
    }
    await page.waitForLoadState('load')
  }
  throw new Error('Wardrobe store module did not load')
}

async function openAs(context, member) {
  const page = await context.newPage()
  await page.addInitScript(memberNumber => {
    window.Player = {
      MemberNumber: memberNumber,
      Name: `Character ${memberNumber}`,
      AssetFamily: 'Female3DCG',
      Appearance: [],
      ExtensionSettings: {},
      OnlineSharedSettings: {},
    }
  }, member)
  await page.goto('/')
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.getByLabel('Actions for Sample Outfit', { exact: true })).toBeVisible()
  return page
}

async function addOutfit(page, member, name) {
  const storeUrl = await loadedStoreUrl(page)
  return page.evaluate(async ({ storeUrl, member, name }) => {
    const { useFileSystemStore } = await import(storeUrl)
    const store = useFileSystemStore.getState()
    const id = await store.addOutfit({ name, type: 'outfit', data: [] })
    const persistence = store._getRepository().persistence
    const own = await persistence.read(member)
    return { openedMember: store._getRepository().member, savedName: own.index.outfits[id]?.name }
  }, { storeUrl, member, name })
}

test('same-origin tabs keep each character wardrobe in its own IndexedDB document and lock', async ({ context }) => {
  const firstMember = 9900101
  const secondMember = 9900102
  const first = await openAs(context, firstMember)
  const second = await openAs(context, secondMember)

  expect(await addOutfit(first, firstMember, 'First character only')).toEqual({
    openedMember: String(firstMember), savedName: 'First character only',
  })
  expect(await addOutfit(second, secondMember, 'Second character only')).toEqual({
    openedMember: String(secondMember), savedName: 'Second character only',
  })
  await expect(first.getByLabel('Actions for First character only', { exact: true })).toBeVisible()
  await expect(second.getByLabel('Actions for Second character only', { exact: true })).toBeVisible()
  await expect(first.getByLabel('Actions for Second character only', { exact: true })).toHaveCount(0)
  await expect(second.getByLabel('Actions for First character only', { exact: true })).toHaveCount(0)

  const documents = await first.evaluate(async ({ storeUrl, firstMember, secondMember }) => {
    const { useFileSystemStore } = await import(storeUrl)
    const persistence = useFileSystemStore.getState()._getRepository().persistence
    const first = await persistence.read(firstMember)
    const second = await persistence.read(secondMember)
    return {
      firstNames: Object.values(first.index.outfits).map(outfit => outfit.name),
      secondNames: Object.values(second.index.outfits).map(outfit => outfit.name),
    }
  }, { storeUrl: await loadedStoreUrl(first), firstMember, secondMember })
  expect(documents.firstNames).toContain('First character only')
  expect(documents.firstNames).not.toContain('Second character only')
  expect(documents.secondNames).toContain('Second character only')
  expect(documents.secondNames).not.toContain('First character only')

  for (const [page, member] of [[first, firstMember], [second, secondMember]]) {
    expect(await page.evaluate(async ({ lockUrl, member }) => {
      const { createWardrobeTabLock } = await import(lockUrl)
      window.__memberIsolationLock = createWardrobeTabLock({ locks: navigator.locks })
      return window.__memberIsolationLock.acquire(member)
    }, { lockUrl, member })).toBe(true)
  }

  const sameMember = await context.newPage()
  await sameMember.goto('/')
  await sameMember.evaluate(async ({ lockUrl, member }) => {
    const { createWardrobeTabLock } = await import(lockUrl)
    window.__memberIsolationLock = createWardrobeTabLock({ locks: navigator.locks })
    window.__memberIsolationLockState = 'waiting'
    void window.__memberIsolationLock.acquire(member).then(acquired => {
      window.__memberIsolationLockState = acquired ? 'held' : 'failed'
    })
  }, { lockUrl, member: firstMember })
  await expect.poll(() => sameMember.evaluate(member => navigator.locks.query()
    .then(state => state.pending.some(lock => lock.name === `VPW:wardrobe:${member}`)), firstMember)).toBe(true)
  expect(await sameMember.evaluate(() => window.__memberIsolationLockState)).toBe('waiting')

  await first.evaluate(() => window.__memberIsolationLock.release())
  await expect.poll(() => sameMember.evaluate(() => window.__memberIsolationLockState)).toBe('held')
  expect(await second.evaluate(member => window.__memberIsolationLock.isHeldFor(member), secondMember)).toBe(true)
  await second.evaluate(() => window.__memberIsolationLock.release())
  await sameMember.evaluate(() => window.__memberIsolationLock.release())
})
